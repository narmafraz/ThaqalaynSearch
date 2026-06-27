// Build the Thaqalayn search bundle: one Pagefind index per language (keyed by
// the real verse URL) + qref.json (Quran cross-references) + manifest.json.
//
// Reads verse_detail files from ../ThaqalaynData and writes the bundle into this
// repo (deployed to thaqalaynsearch.netlify.app). Self-contained Node build —
// no Python step. Run via `npm run build` or the generator's regen_search.ps1.
//
// Per-language AI content (summary / chunks / key_terms / word_analysis) comes
// from sister files `{path}.{lang}.json` (see PER_LANGUAGE_VERSE_SPLIT.md). For
// data still in the legacy monolithic shape, `buildContent` falls back to the
// inline `v.ai.summaries[lang]` etc.
//
// Usage:
//   node build.mjs                  # all books, all languages
//   node build.mjs al-amali-mufid   # limit to given book slugs (for testing)
import * as pagefind from "pagefind";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContent, filtersFor, loadSister } from "./lib/build-content.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "..", "ThaqalaynData");
const OUT = path.join(HERE, "dist"); // deploy-clean output dir (gitignored; netlify publish root)
const LANGS = ["ar", "en", "ur", "fa", "tr", "id", "bn", "es", "fr", "de", "ru", "zh"];
// Fail the build if any of these langs end up empty. Guards against silent
// regressions like a verse-detail schema change that strips all per-lang
// content (the 2026-06 per-language split was such a near-miss).
const REQUIRED_LANGS = ["ar", "en"];
const ONLY_BOOKS = process.argv.slice(2);

function discoverBooks() {
  const dir = path.join(DATA, "books");
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "complete")
    .map((e) => e.name)
    .filter((b) => !ONLY_BOOKS.length || ONLY_BOOKS.includes(b))
    .sort();
}

function* walkVerseDetails(bookSlug) {
  const stack = [path.join(DATA, "books", bookSlug)];
  while (stack.length) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.name.endsWith(".json")) {
        // Skip per-language sister files; they're loaded on demand per lang.
        if (/\.[a-z]{2}\.json$/.test(ent.name)) continue;
        try {
          const j = JSON.parse(fs.readFileSync(p, "utf8"));
          if (j.kind === "verse_detail" && j.data?.verse) yield j.data.verse;
        } catch { /* skip unparseable */ }
      }
    }
  }
}

// --- collect verses once ---
const books = discoverBooks();
const verses = [];
for (const book of books) for (const v of walkVerseDetails(book)) verses.push({ book, v });
console.log(`Collected ${verses.length} verses across ${books.length} books`);

// --- qref.json (Quran cross-references) ---
const qref = {};
const add = (ref, p) => { (qref[ref] ||= new Set()).add(p); };
for (const { v } of verses) {
  for (const rq of v.ai?.related_quran || []) if (rq?.ref) add(rq.ref, v.path);
  const m = v.path.match(/\/books\/quran:(\d+):(\d+)$/);
  if (m) add(`${m[1]}:${m[2]}`, v.path);
}
const qrefOut = {};
for (const k of Object.keys(qref).sort()) qrefOut[k] = [...qref[k]].sort();
fs.writeFileSync(path.join(OUT, "qref.json"), JSON.stringify(qrefOut));
console.log(`Wrote qref.json (${Object.keys(qrefOut).length} refs)`);

// --- per-language Pagefind indexes ---
const builtLangs = [];
for (const lang of LANGS) {
  const { index } = await pagefind.createIndex();
  let n = 0;
  for (const { book, v } of verses) {
    // Sister only exists for non-Arabic langs (Arabic is in base.text).
    const sister = lang === "ar" ? null : loadSister(v.path, lang, DATA);
    const content = buildContent(v, lang, sister);
    if (!content) continue;
    await index.addCustomRecord({
      url: v.path,
      content,
      language: lang,
      meta: { path: v.path },
      filters: filtersFor(v, book),
    });
    n++;
  }
  if (n === 0) {
    if (REQUIRED_LANGS.includes(lang)) {
      throw new Error(`Search build produced 0 records for required language '${lang}'. ` +
        `This usually means the verse-detail schema changed and buildContent is reading ` +
        `from the wrong field. Aborting to avoid shipping an empty search index.`);
    }
    await index.deleteIndex?.(); continue; // coverage-gated: skip empty langs
  }
  await index.writeFiles({ outputPath: path.join(OUT, lang) });
  builtLangs.push({ code: lang, pages: n });
  console.log(`  ${lang}: ${n} records`);
}

// --- manifest.json ---
let dataVersion = "";
try {
  dataVersion = JSON.parse(fs.readFileSync(path.join(DATA, "index", "data_version.json"), "utf8"))?.version || "";
} catch { /* optional */ }
const manifest = {
  schema_version: 1,
  data_version: dataVersion,
  books,
  languages: builtLangs,
  filters: ["book", "content_type", "has_chain", "topic", "tag"],
};
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Wrote manifest.json (langs: ${builtLangs.map((l) => l.code).join(", ")})`);

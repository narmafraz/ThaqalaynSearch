// Build the Thaqalayn search bundle: one Pagefind index per language (keyed by
// the real verse URL) + qref.json (Quran cross-references) + manifest.json.
//
// RESUMABLE: progress is tracked in dist/.build-state.json keyed by the data's
// `data_version`. Re-running skips qref + languages already built for that
// version, so an interrupted build continues where it left off and a completed
// build is a fast no-op. `data_version` is renewed by add_data.ps1, which forces
// a full rebuild. (Pairs with deploy.mjs, which resumes per-site the same way.)
//
// Reads verse_detail files from ../ThaqalaynData. Per-language AI content comes
// from sister files `{path}.{lang}.json` (PER_LANGUAGE_VERSE_SPLIT.md); for data
// in the legacy monolithic shape, buildContent falls back to inline ai.* fields.
//
// Usage:
//   node build.mjs                 # all books, all languages (resumable)
//   node build.mjs --langs en,ar   # only these languages (resumable subset)
//   node build.mjs --force         # ignore state, rebuild everything
//   node build.mjs al-amali-mufid  # ad-hoc: only these books (no resume state)
import * as pagefind from "pagefind";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContent, filtersFor, loadSister } from "./lib/build-content.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "..", "ThaqalaynData");
const OUT = path.join(HERE, "dist");
const META = path.join(OUT, "_meta");
const STATE_FILE = path.join(OUT, ".build-state.json");
fs.mkdirSync(META, { recursive: true });

const ALL_LANGS = ["ar", "en", "ur", "fa", "tr", "id", "bn", "es", "fr", "de", "ru", "zh"];
// Fail the build if any of these end up empty — guards against a verse-detail
// schema change silently stripping all per-language content.
const REQUIRED_LANGS = ["ar", "en"];
const FILTERS = ["book", "content_type", "has_chain", "topic", "tag"];

// --- args ---
const argv = process.argv.slice(2);
let force = false;
let onlyLangs = null;
const onlyBooks = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--force") { force = true; }
  else if (a === "--langs") { onlyLangs = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean); }
  else { onlyBooks.push(a); }
}
const adHoc = onlyBooks.length > 0; // book-subset = throwaway test build; no resume state
const targetLangs = onlyLangs && onlyLangs.length ? onlyLangs : ALL_LANGS;

// --- data_version + resume state ---
let dataVersion = "";
try {
  dataVersion = JSON.parse(fs.readFileSync(path.join(DATA, "index", "data_version.json"), "utf8"))?.version || "";
} catch { /* optional */ }

let state = { data_version: dataVersion, qref: false, langs: [] };
if (!adHoc && !force && fs.existsSync(STATE_FILE)) {
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (prev.data_version === dataVersion) {
      state = prev;
      console.log(`Resuming build for data_version ${dataVersion}: ${state.langs.length} language(s) already built.`);
    } else {
      console.log(`data_version changed (${prev.data_version} -> ${dataVersion}); full rebuild.`);
    }
  } catch { /* corrupt state -> rebuild */ }
}
const saveState = () => { if (!adHoc) { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } };

const builtSet = new Set(state.langs.map((l) => l.code));
const langsToBuild = targetLangs.filter((l) => adHoc || force || !builtSet.has(l));
const needQref = adHoc || force || !state.qref;

function discoverBooks() {
  const dir = path.join(DATA, "books");
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "complete")
    .map((e) => e.name)
    .filter((b) => !adHoc || onlyBooks.includes(b))
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
        if (/\.[a-z]{2}\.json$/.test(ent.name)) continue; // skip per-language sisters
        try {
          const j = JSON.parse(fs.readFileSync(p, "utf8"));
          if (j.kind === "verse_detail" && j.data?.verse) yield j.data.verse;
        } catch { /* skip unparseable */ }
      }
    }
  }
}

const books = discoverBooks(); // cheap (dir listing); always needed for the manifest

function writeManifest(langsArr) {
  const languages = [...langsArr].sort((a, b) => ALL_LANGS.indexOf(a.code) - ALL_LANGS.indexOf(b.code));
  const manifest = { schema_version: 1, data_version: dataVersion, books, languages, filters: FILTERS };
  fs.writeFileSync(path.join(META, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Wrote manifest.json (langs: ${languages.map((l) => l.code).join(", ") || "none"})`);
}

// --- fast path: nothing to do ---
if (!langsToBuild.length && !needQref) {
  console.log(`Search bundle already up to date for data_version ${dataVersion} — nothing to build.`);
  writeManifest(state.langs);
  process.exit(0);
}

// --- collect verses once (expensive; only when something needs building) ---
const verses = [];
for (const book of books) for (const v of walkVerseDetails(book)) verses.push({ book, v });
console.log(`Collected ${verses.length} verses across ${books.length} books`);

// --- qref.json (Quran cross-references) ---
if (needQref) {
  const qref = {};
  const add = (ref, p) => { (qref[ref] ||= new Set()).add(p); };
  for (const { v } of verses) {
    for (const rq of v.ai?.related_quran || []) if (rq?.ref) add(rq.ref, v.path);
    const m = v.path.match(/\/books\/quran:(\d+):(\d+)$/);
    if (m) add(`${m[1]}:${m[2]}`, v.path);
  }
  const qrefOut = {};
  for (const k of Object.keys(qref).sort()) qrefOut[k] = [...qref[k]].sort();
  fs.writeFileSync(path.join(META, "qref.json"), JSON.stringify(qrefOut));
  console.log(`Wrote qref.json (${Object.keys(qrefOut).length} refs)`);
  state.qref = true;
  saveState();
}

// --- per-language Pagefind indexes (only the ones still needed) ---
const adHocBuilt = [];
for (const lang of langsToBuild) {
  const { index } = await pagefind.createIndex();
  let n = 0;
  for (const { book, v } of verses) {
    const sister = lang === "ar" ? null : loadSister(v.path, lang, DATA); // ar lives in base.text
    const content = buildContent(v, lang, sister);
    if (!content) continue;
    await index.addCustomRecord({ url: v.path, content, language: lang, meta: { path: v.path }, filters: filtersFor(v, book) });
    n++;
  }
  if (n === 0) {
    if (REQUIRED_LANGS.includes(lang)) {
      throw new Error(`Search build produced 0 records for required language '${lang}'. ` +
        `The verse-detail schema likely changed and buildContent is reading the wrong field. ` +
        `Aborting to avoid shipping an empty search index.`);
    }
    await index.deleteIndex?.();
    continue; // coverage-gated: skip empty languages
  }
  await index.writeFiles({ outputPath: path.join(OUT, lang) });
  console.log(`  ${lang}: ${n} records`);
  if (adHoc) {
    adHocBuilt.push({ code: lang, pages: n });
  } else {
    state.langs = state.langs.filter((l) => l.code !== lang).concat([{ code: lang, pages: n }]);
    saveState(); // persist after each language -> resumable mid-loop
  }
}

writeManifest(adHoc ? adHocBuilt : state.langs);

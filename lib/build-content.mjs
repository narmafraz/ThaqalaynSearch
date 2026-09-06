// Build per-verse, per-language search text. Extracted from build.mjs for unit
// testing. Two verse_detail shapes are supported:
//
// - Split shape (current): base file carries language-agnostic AI fields
//   plus `key_terms_keys`; per-language AI content lives in sister files
//   `{path}.{lang}.json` with shape
//   `{ ai: { summary, seo_question, chunks: (string|null)[], key_terms,
//      word_analysis: (string|null)[] } }`. See PER_LANGUAGE_VERSE_SPLIT.md.
//
// - Legacy monolithic shape: base file's `ai` carries the per-language dicts
//   inline (`ai.summaries[lang]`, `ai.chunks[i].translations[lang]`,
//   `ai.key_terms[lang]`). Retained as a fallback for the transition window.
//
// Anywhere the split shape provides a value, it wins. Falls back to the legacy
// shape so the builder works on partially-migrated data.
import fs from "node:fs";
import path from "node:path";
import { normalizeArabic } from "./normalize-arabic.mjs";

export function loadSister(versePath, lang, dataRoot) {
  if (!versePath?.startsWith("/books/")) return null;
  const rel = versePath.slice("/books/".length).replace(/:/g, "/");
  const fp = path.join(dataRoot, "books", `${rel}.${lang}.json`);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch { return null; }
}

export function humanTranslation(v, lang, sister) {
  for (const [id, txt] of Object.entries(v.translations || {})) {
    if (id.startsWith(lang + ".") && id !== lang + ".ai" && id !== "en.transliteration") {
      return Array.isArray(txt) ? txt.join(" ") : String(txt);
    }
  }
  // Chunk-aligned scraped translations (align-scraped, 2026-09): the flat
  // text is removed from base and lives ONLY in the sister as
  // `chunk_translations[translationId] = [parts]`. Without this branch a
  // rebuild would silently index the AI translation instead of the human one
  // for every aligned verse.
  for (const [id, parts] of Object.entries(sister?.chunk_translations || {})) {
    if (id.startsWith(lang + ".") && id !== lang + ".ai" && id !== "en.transliteration") {
      return (parts || []).filter(Boolean).join(" ");
    }
  }
  return "";
}

// AI-translated chunks. Split shape: sister.ai.chunks is a flat string|null
// array, one entry per base chunk. Legacy shape: v.ai.chunks[i].translations[lang].
export function chunkText(v, sister, lang) {
  if (sister?.ai?.chunks) {
    return sister.ai.chunks.filter((s) => typeof s === "string" && s).join(" ");
  }
  return (v.ai?.chunks || []).map((c) => c.translations?.[lang]).filter(Boolean).join(" ");
}

export function buildContent(v, lang, sister) {
  const ai = v.ai || {};
  const sai = sister?.ai || {};
  const parts = [];
  if (lang === "ar") {
    parts.push(normalizeArabic((v.text || []).join(" ")));
    // Base carries `key_terms_keys` (canonical Arabic-term ordering) in the
    // split shape; otherwise fall back to legacy lang-keyed key_terms.
    const arTerms = ai.key_terms_keys
      ? ai.key_terms_keys
      : Object.keys(ai.key_terms?.en || ai.key_terms?.ar || {});
    parts.push(normalizeArabic(arTerms.join(" ")));
    for (const kp of ai.key_phrases || []) if (kp.phrase_ar) parts.push(normalizeArabic(kp.phrase_ar));
  } else {
    parts.push(humanTranslation(v, lang, sister) || chunkText(v, sister, lang));
    const summary = sai.summary ?? ai.summaries?.[lang];
    if (summary) parts.push(summary);
    const kt = sai.key_terms ?? ai.key_terms?.[lang];
    if (kt) parts.push(Object.values(kt).join(" "));
    if (lang === "en") for (const kp of ai.key_phrases || []) if (kp.phrase_en) parts.push(kp.phrase_en);
  }
  return parts.filter(Boolean).join("  ").trim();
}

export function filtersFor(v, book) {
  const ai = v.ai || {};
  return {
    book: [book],
    content_type: ai.content_type ? [ai.content_type] : [],
    has_chain: [ai.isnad_matn?.has_chain ? "yes" : "no"],
    topic: ai.topics || [],
    tag: ai.tags || [],
  };
}

// Unit tests for buildContent — guards against the regression that triggered
// these tests in the first place: a verse-detail schema change (per-language
// split) silently produced empty per-language search content.
//
// Run: node --test tests/build-content.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildContent, chunkText, humanTranslation, loadSister, filtersFor } from "../lib/build-content.mjs";

// Verse in the split shape (current): per-language AI fields stripped from
// base; live in sister files.
function splitShapeVerse() {
  return {
    path: "/books/al-amali-mufid:1:1:1",
    text: ["أَخْبَرَنَا أَبُو جَعْفَرٍ"],
    translations: { "en.hubeali": ["The grand Shaikh..."] },
    ai: {
      ai_attribution: { model: "test" },
      chunks: [
        { chunk_type: "isnad", arabic_text: "أَخْبَرَنَا", word_start: 0, word_end: 1 },
        { chunk_type: "body", arabic_text: "أَبُو جَعْفَرٍ", word_start: 1, word_end: 3 },
      ],
      content_type: "hadith",
      isnad_matn: { has_chain: true, narrators: [] },
      key_terms_keys: ["العقل", "الإيمان"],
      key_phrases: [{ phrase_ar: "بِسْمِ اللَّهِ", phrase_en: "In the name of Allah" }],
      topics: ["reasoning"],
      tags: ["theology"],
      available_languages: ["en", "fa"],
    },
  };
}

function splitShapeSister(lang) {
  if (lang === "en") {
    return {
      lang: "en",
      path: "/books/al-amali-mufid:1:1:1",
      ai: {
        summary: "English summary of the hadith.",
        seo_question: "What about intellect?",
        chunks: ["Informed us, Abu Ja'far"],
        key_terms: { "العقل": "intellect", "الإيمان": "faith" },
      },
    };
  }
  if (lang === "fa") {
    return {
      lang: "fa", path: "/books/al-amali-mufid:1:1:1",
      ai: { summary: "خلاصه فارسی", chunks: ["ابو جعفر ما را خبر داد"] },
    };
  }
  return null;
}

// Verse in the legacy monolithic shape: per-language AI fields inline.
function legacyShapeVerse() {
  return {
    path: "/books/al-kafi:1:1:1:1",
    text: ["أَخْبَرَنَا أَبُو"],
    translations: { "en.hubeali": ["Informed us Abu"] },
    ai: {
      chunks: [
        { chunk_type: "isnad", arabic_text: "أَخْبَرَنَا", translations: { en: "Informed us", fa: "ما را خبر داد" } },
      ],
      summaries: { en: "Legacy English summary.", fa: "خلاصه قدیمی" },
      key_terms: { en: { "العقل": "intellect" }, fa: { "العقل": "عقل" } },
      key_phrases: [{ phrase_ar: "أَخْبَرَنَا", phrase_en: "informed us" }],
      isnad_matn: { has_chain: true, narrators: [] },
      topics: [], tags: [],
    },
  };
}

test("split shape: en sister populates summary + key_terms", () => {
  const v = splitShapeVerse();
  const sister = splitShapeSister("en");
  const content = buildContent(v, "en", sister);
  // Must contain summary and key_terms values. None of these come from
  // `v.ai` directly under the split shape — only the sister.
  assert.ok(content.includes("English summary"), "summary missing");
  assert.ok(content.includes("intellect"), "key_terms value missing");
  // Human translation gets priority over AI chunk text — see also the
  // chunk-fallback test below for the no-human-translation case.
  assert.ok(content.includes("The grand Shaikh"), "human translation missing");
});

test("split shape: AI chunk text from sister fills in when no human translation", () => {
  const v = splitShapeVerse();
  delete v.translations; // no human translation in this lang
  const sister = splitShapeSister("en");
  const content = buildContent(v, "en", sister);
  assert.ok(content.includes("Informed us, Abu Ja'far"),
    "chunk text from sister.ai.chunks missing when no human translation");
});

test("split shape: missing sister falls back to human translation only", () => {
  const v = splitShapeVerse();
  const content = buildContent(v, "en", null);
  // Human translator text from v.translations still surfaces.
  assert.ok(content.includes("The grand Shaikh"), "human translation missing");
  // No AI summary / key_terms because the sister didn't load.
  assert.ok(!content.includes("English summary"));
  assert.ok(!content.includes("intellect"));
});

test("split shape: fa sister works without key_terms", () => {
  const v = splitShapeVerse();
  const sister = splitShapeSister("fa");
  const content = buildContent(v, "fa", sister);
  assert.ok(content.includes("خلاصه فارسی"));
  assert.ok(content.includes("ابو جعفر"));
});

test("split shape: Arabic content uses base.text + key_terms_keys", () => {
  const v = splitShapeVerse();
  const content = buildContent(v, "ar", null);
  // base.text is normalized; check the key_terms_keys are joined in
  assert.ok(content.length > 0);
  // Arabic key phrases are appended (normalized)
  assert.ok(content.includes("بسم") || content.includes("الله"));
});

// REGRESSION GUARD: the bug we're guarding against — under the split shape,
// reading from `v.ai.summaries[lang]` (legacy path) yields empty content
// because those fields no longer exist in base. The fix routes through the
// sister. If buildContent ever stops reading from `sister.ai.*`, this test
// catches it.
test("REGRESSION: split-shape verse with sister must NOT produce empty content", () => {
  const v = splitShapeVerse();
  const sister = splitShapeSister("en");
  const content = buildContent(v, "en", sister);
  assert.ok(content.length > 0, "buildContent returned empty — sister wasn't read");
  // Specifically the per-lang AI fields must be present
  assert.ok(content.includes("English summary"));
  assert.ok(content.includes("intellect"));
});

test("legacy shape: inline ai.summaries[lang] still works (no sister)", () => {
  const v = legacyShapeVerse();
  const content = buildContent(v, "en", null);
  assert.ok(content.includes("Legacy English summary"));
  assert.ok(content.includes("intellect"));
  assert.ok(content.includes("Informed us"));
});

test("sister wins when both legacy + sister are present (transition)", () => {
  // Belt-and-braces: if a verse is in the split shape but the merger left
  // legacy fields inline by mistake, the sister should take precedence.
  const v = legacyShapeVerse();
  const sister = {
    ai: { summary: "Sister summary takes precedence.", chunks: ["sister chunk text"] },
  };
  const content = buildContent(v, "en", sister);
  assert.ok(content.includes("Sister summary takes precedence."));
  assert.ok(!content.includes("Legacy English summary"));
});

test("humanTranslation skips ai-suffixed translation IDs", () => {
  const v = {
    translations: {
      "en.ai": ["AI translation"],
      "en.qarai": ["Qarai translation"],
    },
  };
  assert.equal(humanTranslation(v, "en"), "Qarai translation");
});

test("chunkText prefers sister (string array) over legacy (object array)", () => {
  const v = { ai: { chunks: [{ translations: { en: "legacy en" } }] } };
  const sister = { ai: { chunks: ["sister en"] } };
  assert.equal(chunkText(v, sister, "en"), "sister en");
  assert.equal(chunkText(v, null, "en"), "legacy en");
});

test("loadSister returns null when sister file is missing", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-"));
  try {
    assert.equal(loadSister("/books/foo:1:2:3", "en", tmpRoot), null);
    assert.equal(loadSister("not-a-books-path", "en", tmpRoot), null);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("loadSister reads parsed JSON from disk", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tsearch-"));
  try {
    const dir = path.join(tmpRoot, "books", "x", "1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "2.en.json"), JSON.stringify({
      lang: "en", path: "/books/x:1:2", ai: { summary: "hello" },
    }));
    const got = loadSister("/books/x:1:2", "en", tmpRoot);
    assert.equal(got.ai.summary, "hello");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// --- filtersFor (facet metadata) ---

test("filtersFor maps all facet fields from ai", () => {
  const v = { ai: { content_type: "hadith", isnad_matn: { has_chain: true }, topics: ["a", "b"], tags: ["x"] } };
  const f = filtersFor(v, "al-kafi");
  assert.deepEqual(f.book, ["al-kafi"]);
  assert.deepEqual(f.content_type, ["hadith"]);
  assert.deepEqual(f.has_chain, ["yes"]);
  assert.deepEqual(f.topic, ["a", "b"]);
  assert.deepEqual(f.tag, ["x"]);
});

test("filtersFor defaults when ai is missing/empty", () => {
  const f = filtersFor({}, "quran");
  assert.deepEqual(f.book, ["quran"]);
  assert.deepEqual(f.content_type, []);  // omitted when absent
  assert.deepEqual(f.has_chain, ["no"]); // no isnad_matn -> "no"
  assert.deepEqual(f.topic, []);
  assert.deepEqual(f.tag, []);
});

// --- buildContent edge cases ---

// The empty-string return is load-bearing: build.mjs skips records with empty
// content, and REQUIRED_LANGS turns an all-empty language into a hard error.
test("buildContent returns empty string when a language has no content", () => {
  const v = { path: "/books/x:1", text: ["x"], translations: {}, ai: { topics: [] } };
  assert.equal(buildContent(v, "fr", null), "");
});

test("buildContent (non-ar) with no ai uses human translation only", () => {
  const v = { translations: { "en.qarai": ["Hello world"] } };
  assert.equal(buildContent(v, "en", null), "Hello world");
});

test("buildContent ar with no ai uses normalized base text only (diacritics stripped)", () => {
  const fatha = String.fromCharCode(0x064e);
  // العَقل (with a fatha that must be stripped)
  const withFatha = String.fromCharCode(0x0627, 0x0644, 0x0639, 0x064e, 0x0642, 0x0644);
  const out = buildContent({ text: [withFatha] }, "ar", null);
  assert.ok(out.length > 0, "ar content empty");
  assert.ok(!out.includes(fatha), "fatha not stripped by normalizer");
});

test("buildContent ar falls back to legacy key_terms when no key_terms_keys", () => {
  const sabr = String.fromCharCode(0x0627, 0x0644, 0x0635, 0x0628, 0x0631); // الصبر
  const v = { text: [String.fromCharCode(0x0646, 0x0635)], ai: { key_terms: { en: { [sabr]: "patience" } } } };
  const out = buildContent(v, "ar", null);
  assert.ok(out.includes(sabr), "legacy ar key_terms key not indexed");
});

// --- v3 / v4 schema coverage (the indexer must handle both) ---

// v3 = legacy monolithic (per-language AI inline) and may carry word_analysis.
// v4 = per-language split (sisters) with key_terms_keys + available_languages on
// the base and word_analysis as a base remnant. word_analysis is never a search
// source; this guards that neither shape regresses to empty content.
test("v3 legacy (monolithic + word_analysis remnant) still builds from inline AI", () => {
  const v = legacyShapeVerse();
  v.ai.word_analysis = [{ word: "x", pos: "N", translation: { en: "thing", fa: "z" } }]; // v3 remnant
  const content = buildContent(v, "en", null);
  assert.ok(content.includes("Legacy English summary"), "v3 inline summary not indexed");
  assert.ok(content.includes("Informed us"), "v3 translation not indexed");
  assert.ok(content.length > 0);
});

test("v4 split (key_terms_keys + available_languages + word_analysis base): ar/en/fa all non-empty", () => {
  const v = splitShapeVerse();
  v.ai.word_analysis = [{ word: "x", pos: "N" }]; // base remnant, must be ignored
  const ar = buildContent(v, "ar", null);
  const en = buildContent(v, "en", splitShapeSister("en"));
  const fa = buildContent(v, "fa", splitShapeSister("fa"));
  assert.ok(ar.length > 0, "ar content empty under v4 split schema");
  assert.ok(en.length > 0, "en content empty under v4 split schema");
  assert.ok(fa.length > 0, "fa content empty under v4 split schema");
});

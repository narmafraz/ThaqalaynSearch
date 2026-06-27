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
import { buildContent, chunkText, humanTranslation, loadSister } from "../lib/build-content.mjs";

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

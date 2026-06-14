# ThaqalaynSearch

Static [Pagefind](https://pagefind.app) search bundle for the Thaqalayn corpus,
deployed to **thaqalaynsearch.netlify.app** and consumed cross-origin by the
Angular app (`environment.searchBaseUrl`).

Part of the bandwidth-first search overhaul — see
`Thaqalayn/docs/SEARCH_OVERHAUL_PLAN.md`.

## What's here

- `build.mjs` — reads verse_detail files from `../ThaqalaynData/books/`, builds
  **one Pagefind index per language** (keyed by the real verse URL), plus
  `qref.json` (Quran cross-references) and `manifest.json` (built languages +
  `data_version`). Self-contained Node build; no Python step.
- `lib/normalize-arabic.mjs` — Arabic normalizer mirroring the Python canonical
  (`ThaqalaynDataGenerator/app/arabic_normalization.py`). The Angular query path
  uses the same logic; a parity fixture keeps them in sync.
- `netlify.toml` — CORS + cache headers (mirrors `ThaqalaynWords`).
- `<lang>/`, `qref.json`, `manifest.json` — the generated bundle (committed).

## Build

```bash
npm install
npm run build                 # all books, all languages
node build.mjs al-amali-mufid # limit to book slugs (for testing)
```

Per the corpus's per-verse design, Pagefind writes ~one fragment file per verse
per language, so the full bundle is large (hundreds of thousands of files). Only
languages with content are built (`manifest.json` lists them).

Run after `ThaqalaynDataGenerator/add_data.ps1` has regenerated `ThaqalaynData`,
via the generator's `regen_search.ps1` (kept out of the routine `add_data.ps1`
run because it is slow — same convention as `regen_words.ps1`).

# ThaqalaynSearch

Static [Pagefind](https://pagefind.app) search bundles for the Thaqalayn corpus,
consumed cross-origin by the Angular app.

Part of the bandwidth-first search overhaul — see
`Thaqalayn/docs/SEARCH_OVERHAUL_PLAN.md`.

## Hosting topology (multiple sites)

A single Netlify site can't take the full ~650K-file bundle (a full-corpus
single-site deploy was attempted and is impractical). Pagefind writes ~one
fragment file per verse per language, so the bundle is sharded **one site per
language**, plus a tiny meta site:

| Site | Serves |
|------|--------|
| `thaqalaynsearch.netlify.app` | meta: `manifest.json` + `qref.json` |
| `thaqalaynsearch-<lang>.netlify.app` | that language's Pagefind bundle (served at root) |

The client reads `manifest.json` from the meta site to know which languages are
built, then loads the chosen language's Pagefind bundle from its own site.

## What's here

- `build.mjs` — reads verse_detail files from `../ThaqalaynData/books/`, builds
  **one Pagefind index per language** (keyed by the real verse URL), plus
  `qref.json` (Quran cross-references) and `manifest.json` (built languages +
  `data_version`). Self-contained Node build; no Python step.
- `lib/normalize-arabic.mjs` — Arabic normalizer mirroring the Python canonical
  (`ThaqalaynDataGenerator/app/arabic_normalization.py`). The Angular query path
  uses the same logic; a parity fixture keeps them in sync.
- `netlify.toml` — CORS + cache headers; paths are root-relative (each language
  site serves its bundle at root).
- `dist/<lang>/`, `dist/qref.json`, `dist/manifest.json` — the generated bundle.
  **Gitignored** (~650K files / 2.7 GB at full coverage); deployed via Netlify CLI.
- `tests/` — `build-content.test.mjs` (`npm test`) + the normalizer parity check.

## Build

```bash
npm install
npm run build                 # all books, all languages
node build.mjs al-amali-mufid # limit to book slugs (for testing)
npm test                      # unit tests for buildContent / filters
```

Only languages with content are built (`manifest.json` lists them).

## Deploy

Each `dist/<lang>/` is a self-contained Pagefind bundle. Deploy each as its own
prebuilt site (run once `netlify login` is set up):

```bash
# one language (e.g. testing en)
netlify deploy --prod --no-build --dir=dist/en --site thaqalaynsearch-en

# meta site
netlify deploy --prod --no-build --dir=dist/_meta --site thaqalaynsearch
```

Normally driven by the generator's **`regen_search.ps1`** (build, and `-Deploy`
to build + deploy meta + all built languages; `-Langs en` to limit). Kept out of
the routine `add_data.ps1` run because it is slow — same convention as
`regen_words.ps1`.

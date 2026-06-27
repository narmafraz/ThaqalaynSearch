// Resilient multi-site deploy for the Thaqalayn search bundles.
//
// Deploys the meta site (manifest + qref) and each built language site, and is
// RESUMABLE: progress is recorded in dist/.deploy-state.json keyed by the
// build's data_version, so re-running after an interruption (sleep/crash)
// skips sites already finished and continues from where it stopped. Within a
// single site, Netlify's CDN dedups by file digest, so an interrupted site
// re-uploads only the files it hadn't sent yet.
//
// Usage (run from the ThaqalaynSearch repo root, after `netlify login`):
//   node deploy.mjs                 # meta + all built languages
//   node deploy.mjs --langs en,ar   # meta + just these languages
//   node deploy.mjs --force         # ignore saved state, redeploy everything
//   node deploy.mjs --retries 5     # per-site retry attempts (default 3)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, "dist");
const META = path.join(DIST, "_meta");
const STATE_FILE = path.join(DIST, ".deploy-state.json"); // under gitignored dist/

// --- args ---
const argv = process.argv.slice(2);
const getOpt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const force = argv.includes("--force");
const retries = Number(getOpt("--retries") || 3);
const onlyLangs = getOpt("--langs")?.split(",").map((s) => s.trim()).filter(Boolean);

// --- manifest / targets ---
const manifestPath = path.join(META, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`No build found at ${manifestPath}. Run \`node build.mjs\` first.`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const dataVersion = manifest.data_version || "";
let langs = manifest.languages.map((l) => l.code);
if (onlyLangs) langs = langs.filter((l) => onlyLangs.includes(l));

// targets: meta first (small, gives the client the manifest), then languages
const targets = [
  { name: "_meta", dir: "dist/_meta", site: "thaqalaynsearch" },
  ...langs.map((l) => ({ name: l, dir: `dist/${l}`, site: `thaqalaynsearch-${l}` })),
];

// --- resume state ---
let state = { data_version: dataVersion, completed: [] };
if (!force && fs.existsSync(STATE_FILE)) {
  try {
    const prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (prev.data_version === dataVersion) {
      state = prev;
      console.log(`Resuming: ${state.completed.length} site(s) already done for data_version ${dataVersion}.`);
    } else {
      console.log(`data_version changed (${prev.data_version} -> ${dataVersion}); redeploying all sites.`);
    }
  } catch { /* ignore corrupt state */ }
}
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// --- deploy one site, with retries ---
function deployOne(t) {
  if (state.completed.includes(t.name)) {
    console.log(`✓ skip ${t.site} (already deployed)`);
    return;
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`\n→ Deploying ${t.dir} -> ${t.site} (attempt ${attempt}/${retries})`);
    const r = spawnSync(
      "netlify",
      ["deploy", "--prod", "--no-build", "--dir", t.dir, "--site", t.site],
      { cwd: HERE, stdio: "inherit", shell: true }
    );
    if (r.status === 0) {
      state.completed.push(t.name);
      saveState();
      console.log(`✓ ${t.site} live`);
      return;
    }
    console.warn(`✗ ${t.site} failed (exit ${r.status}).` + (attempt < retries ? " Retrying..." : ""));
  }
  throw new Error(`Deploy failed for ${t.site} after ${retries} attempts. Re-run to resume.`);
}

// --- run ---
console.log(`Deploying ${targets.length} site(s): ${targets.map((t) => t.name).join(", ")}`);
for (const t of targets) deployOne(t);

// all done — clear state so the next build starts fresh
fs.rmSync(STATE_FILE, { force: true });
console.log(`\n✓ All ${targets.length} site(s) deployed.`);

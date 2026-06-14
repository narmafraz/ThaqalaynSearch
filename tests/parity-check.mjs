// Assert the JS Arabic normalizer matches the Python canonical on real verse
// text. Run parity-check.py first (it writes parity_py.json), then:
//   node tests/parity-check.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeArabic } from "../lib/normalize-arabic.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "..", "..", "ThaqalaynData");
const py = JSON.parse(fs.readFileSync(path.join(HERE, "parity_py.json"), "utf8"));

let ok = 0, bad = 0;
const mismatches = [];
for (const [p, expected] of Object.entries(py)) {
  const file = path.join(DATA, "books", p.replace("/books/", "").replace(/:/g, "/") + ".json");
  const v = JSON.parse(fs.readFileSync(file, "utf8")).data.verse;
  const got = normalizeArabic((v.text || []).join(" "));
  if (got === expected) ok++;
  else { bad++; if (mismatches.length < 3) mismatches.push({ p, expected: expected.slice(0, 80), got: got.slice(0, 80) }); }
}
console.log(JSON.stringify({ ok, bad, mismatches }, null, 2));
process.exit(bad === 0 ? 0 : 1);

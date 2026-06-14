"""Emit Python-canonical normalized forms for real verse text, for the JS parity
check. Run with the generator venv:
  cd ../ThaqalaynDataGenerator; .venv/Scripts/python.exe ../ThaqalaynSearch/tests/parity-check.py
Writes parity_py.json next to this file; parity-check.mjs then asserts the JS
normalizer produces identical output.
"""
import sys, os, json, glob

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.abspath(os.path.join(HERE, "..", "..", "ThaqalaynDataGenerator"))
DATA = os.path.abspath(os.path.join(HERE, "..", "..", "ThaqalaynData"))
sys.path.insert(0, GEN)
sys.path.insert(0, os.path.join(GEN, "app"))

from arabic_normalization import normalize_arabic  # noqa: E402

out = {}
for f in sorted(glob.glob(os.path.join(DATA, "books", "al-amali-mufid", "**", "*.json"), recursive=True)):
    try:
        j = json.load(open(f, encoding="utf-8"))
    except Exception:
        continue
    if j.get("kind") != "verse_detail":
        continue
    v = j["data"]["verse"]
    out[v["path"]] = normalize_arabic(" ".join(v.get("text", [])))
    if len(out) >= 50:
        break

json.dump(out, open(os.path.join(HERE, "parity_py.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("wrote", len(out), "normalized samples")

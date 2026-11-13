// Lists English strings passed to t() (or kept in label tables) that have no French translation.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../web/src");
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f) && !/(fr|i18n)\.ts$/.test(f)) files.push(p);
  }
})(root);

const keys = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
  // label tables translated at render time: { label: "…" }, ["key", "…"], hint: "…"
  for (const m of src.matchAll(/\b(?:label|hint):\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
  for (const m of src.matchAll(/^\s*"[\w.]+":\s*"((?:[^"\\]|\\.)*)",?$/gm)) keys.add(JSON.parse(`"${m[1]}"`));
  for (const m of src.matchAll(/\["[a-z]+", "([A-Z][^"]+)"\]/g)) keys.add(m[1]);
}
const { fr } = await import(path.join(root, "lib/fr.ts").replace(/\.ts$/, ".ts"));
const missing = [...keys].filter((k) => !(k in fr)).sort();
if (process.argv.includes("--json")) console.log(JSON.stringify(missing, null, 1));
else {
  for (const k of missing) console.log(k);
  console.error(`${missing.length} missing of ${keys.size}`);
}
process.exitCode = missing.length ? 1 : 0;

// Applies the proposed one-line fix to node_modules/next in place, so the repro can be re-run
// against it: wherever the response writer resolves `finished` on 'finish', resolve it on 'close'
// too. Covers dist/server/pipe-readable.js, its ESM copy (which Turbopack bundles into
// .next/server/chunks, so rebuild after this) and the copies in dist/compiled/next-server.
// Undo with `npm ci`.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("node_modules/next/dist");
const files = [path.join(root, "server/pipe-readable.js"), path.join(root, "esm/server/pipe-readable.js")];
const compiled = path.join(root, "compiled/next-server");
for (const f of fs.readdirSync(compiled)) if (f.endsWith(".js")) files.push(path.join(compiled, f));

let patched = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const out = src
    // Readable source: res.once('finish', ()=>{ finished.resolve(); });
    .replace(/res\.once\('finish', \(\)=>\{\n(\s*)finished\.resolve\(\);\n(\s*)\}\);(?!\n\s*res\.once\('close')/,
      (m, a, b) => `${m}\n${b}res.once('close', ()=>{\n${a}finished.resolve();\n${b}});`)
    // Minified: e.once("finish",()=>{a.resolve()})
    .replace(/(\w+)\.once\("finish",\(\)=>\{(\w+)\.resolve\(\)\}\)(?!,\w+\.once\("close")/g,
      (m, res, p) => `${m},${res}.once("close",()=>{${p}.resolve()})`);
  if (out !== src) {
    fs.writeFileSync(file, out);
    patched++;
  }
}
console.log(`patched ${patched} of ${files.length} files`);

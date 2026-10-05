// List the license of every installed production dependency; exit 1 on anything outside the allow list.
// `node scripts/licenses.mjs` after `npm ci`. The release does not ship node_modules;
// install.sh installs them on the user's machine from the npm registry.
// Reads package-lock.json and each installed package.json directly (no `npm ls`, whose
// output masks UUID-looking path segments).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOW = new Set(["MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "CC0-1.0", "Python-2.0", "BlueOak-1.0.0", "(MIT AND Zlib)"]);
// Reviewed exceptions: a dynamically linked prebuilt binary that sharp (via hyperframes) downloads per platform.
const REVIEWED = { "@img/sharp-libvips-": "LGPL-3.0-or-later" };

const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const rows = [];
let bad = 0;
let missing = 0;
for (const [key, entry] of Object.entries(lock.packages ?? {})) {
  if (!key || entry.dev) continue;
  const dir = path.join(root, key);
  const manifest = path.join(dir, "package.json");
  if (!fs.existsSync(manifest)) {
    // Optional packages for other platforms are not installed here.
    if (!entry.optional) missing++;
    continue;
  }
  const p = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const lic = typeof p.license === "string" ? p.license : p.license?.type ?? p.licenses?.map((l) => l.type).join(" OR ") ?? entry.license ?? "UNKNOWN";
  const reviewed = Object.entries(REVIEWED).some(([prefix, l]) => p.name.startsWith(prefix) && l === lic);
  const ok = ALLOW.has(lic) || reviewed;
  if (!ok) bad++;
  rows.push(`${ok ? (reviewed ? "reviewed" : "ok") : "CHECK"}\t${lic}\t${p.name}@${p.version}`);
}
console.log(rows.sort().join("\n"));
if (missing) {
  console.error(`${missing} required package(s) from package-lock.json are not installed; run npm ci first`);
  process.exit(1);
}
if (bad) {
  for (const r of rows) if (r.startsWith("CHECK")) console.error(r);
  console.error(`${bad} dependency license(s) need review`);
  process.exit(1);
}

// List the license of every production dependency; exit 1 on anything outside the allow list.
// `node scripts/licenses.mjs` after `npm ci`. The release does not ship node_modules;
// install.sh installs them on the user's machine from the npm registry.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ALLOW = new Set(["MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "CC0-1.0", "Python-2.0", "BlueOak-1.0.0", "(MIT AND Zlib)"]);
// Reviewed exceptions: a dynamically linked prebuilt binary that sharp (via hyperframes) downloads per platform.
const REVIEWED = { "@img/sharp-libvips-": "LGPL-3.0-or-later" };

const dirs = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], { encoding: "utf8" }).trim().split("\n").slice(1);
let bad = 0;
const rows = [];
for (const d of [...new Set(dirs)]) {
  const p = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8"));
  const lic = typeof p.license === "string" ? p.license : p.license?.type ?? p.licenses?.map((l) => l.type).join(" OR ") ?? "UNKNOWN";
  const reviewed = Object.entries(REVIEWED).some(([prefix, l]) => p.name.startsWith(prefix) && l === lic);
  const ok = ALLOW.has(lic) || reviewed;
  if (!ok) bad++;
  rows.push(`${ok ? (reviewed ? "reviewed" : "ok") : "CHECK"}\t${lic}\t${p.name}@${p.version}`);
}
console.log(rows.sort().join("\n"));
if (bad) {
  console.error(`${bad} dependency license(s) need review`);
  process.exit(1);
}

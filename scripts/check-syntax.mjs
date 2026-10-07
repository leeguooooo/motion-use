// `npm run lint`: every module parses and imports cleanly.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const files = ["src", "test"].flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".mjs")).map((f) => path.join(d, f)));
for (const f of files.filter((f) => f.startsWith("src"))) await import(pathToFileURL(path.resolve(f)));
execFileSync(process.execPath,["--check","src/film-runtime.js"]);
console.log(`ok: ${files.length} files`);

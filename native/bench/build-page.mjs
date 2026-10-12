#!/usr/bin/env node
// Build the exact page motion-use renders for one language/format (src/film.mjs buildFilm), so
// Chrome (HyperFrames) and motion-render draw from the same index.html, fonts, assets and footage.
//   node native/bench/build-page.mjs <film dir> <lang> <format> <out dir>
import fs from "node:fs";
import path from "node:path";
import { checkFilm, buildFilm } from "../../src/film.mjs";

const [dir, lang, format, out] = process.argv.slice(2);
if (!out) {
  console.error("usage: build-page.mjs <film dir> <lang> <format> <out dir>");
  process.exit(2);
}
const c = checkFilm(dir, { lang, format });
if (!c.ok) {
  console.error(JSON.stringify(c.report.errors, null, 2));
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const proj = await buildFilm(c.film, lang, format, path.resolve(out));
console.log(JSON.stringify({ dir: proj.dir, w: proj.fmt.w, h: proj.fmt.h, fps: proj.fps, total: proj.total, shots: c.film.shots.map((s) => [s.id, s.start, s.end]) }));

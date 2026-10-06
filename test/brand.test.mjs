import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { contrast, validateBrief } from "../src/brief.mjs";
import { buildProject } from "../src/build.mjs";
import { missingGlyphs } from "../src/fonts.mjs";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-brand-"));
fs.writeFileSync(path.join(tmp, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="#f60"/></svg>');
fs.copyFileSync(path.join(root, "assets/fonts/JetBrainsMono[wght].ttf"), path.join(tmp, "Brand.ttf"));
fs.copyFileSync(path.join(root, "assets/fonts/OFL-JetBrainsMono.txt"), path.join(tmp, "OFL.txt"));
const v = (over) => validateBrief({ version: 1, name: "b", languages: ["en"], music: "none", scenes: [{ id: "a", type: "title", title: "Hi" }, { id: "z", type: "cta", title: "X" }], ...over }, tmp);

test("contrast follows WCAG", () => {
  assert.equal(contrast("#ffffff", "#000000").toFixed(0), "21");
  assert.equal(contrast("#777777", "#777777").toFixed(0), "1");
});

test("palette keys, contrast warnings, brand and font rules", () => {
  assert.deepEqual(v({ theme: { accent2: "#ffd166", panel: "#222222", dim: "#999999", border: "#333333" } }).errors, []);
  assert.ok(v({ theme: { accent: "#0c0e13" } }).warnings.some((w) => w.path === "$.theme.accent"));
  assert.ok(v({ brand: { corner: true } }).errors.some((e) => e.path === "$.brand.logo"));
  assert.ok(v({ fonts: { sans: { file: "Brand.ttf" } } }).errors.some((e) => e.path === "$.fonts.sans.license"));
  assert.ok(v({ fonts: { serif: { file: "Brand.ttf", license: "OFL.txt" } } }).errors.some((e) => e.path === "$.fonts.serif"));
});

test("brand fonts ship with their license, logos land on cover, end card and corner", async () => {
  const { brief, errors } = v({ brand: { logo: "logo.svg", corner: true }, fonts: { sans: { file: "Brand.ttf", license: "OFL.txt" } } });
  assert.deepEqual(errors, []);
  const dir = path.join(tmp, "out");
  await buildProject(brief, "en", "landscape", dir);
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.ok(fs.existsSync(path.join(dir, "assets/fonts/brand-sans.woff2")));
  assert.ok(fs.existsSync(path.join(dir, "assets/fonts/LICENSE-brand-sans.txt")));
  assert.match(html, /--font-sans: "MU Brand Sans", "MU Sans"/);
  assert.equal((html.match(/class="mu-logo"/g) ?? []).length, 2);
  assert.match(html, /class="mu-corner-logo"/);
});

test("glyph coverage counts the brand fonts", () => {
  assert.deepEqual(missingGlyphs("abc", { sans: { file: path.join(tmp, "Brand.ttf") } }), []);
});

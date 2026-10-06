import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { customText, lintCustomHtml, validateBrief } from "../src/brief.mjs";
import { buildProject } from "../src/build.mjs";
import { main } from "../src/cli.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-html-"));
fs.mkdirSync(path.join(tmp, "scenes", "a"), { recursive: true });
fs.writeFileSync(path.join(tmp, "scenes", "a", "a.html"), '<style>.x{background:url("bg.svg")}</style><div class="x"><img src="./pic.svg" alt=""><p>量子 {{lang}}</p></div>');
fs.writeFileSync(path.join(tmp, "scenes", "a", "pic.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
fs.writeFileSync(path.join(tmp, "scenes", "a", "bg.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
fs.writeFileSync(path.join(tmp, "top.html"), "<p>hi</p>");
const brief = (scene) => ({ version: 1, name: "h", languages: ["en"], music: "none", scenes: [{ id: "a", type: "html", duration: 3, ...scene }] });

test("custom HTML is checked for network use, nondeterminism and full documents", () => {
  const rules = (src) => lintCustomHtml(src).map((x) => x.rule);
  assert.deepEqual(rules('<img src="https://cdn.example.com/a.png">'), ["network"]);
  assert.deepEqual(rules("<script>fetch('/x')</script>"), ["network"]);
  assert.deepEqual(rules("<script>Math.random(); Date.now()</script>"), ["nondeterministic", "nondeterministic"]);
  assert.deepEqual(rules("<script>requestAnimationFrame(f)</script>"), ["nondeterministic"]);
  assert.deepEqual(rules("<iframe src=x></iframe><body>"), ["structure", "structure", "structure"]);
  assert.deepEqual(rules('<div style="animation: a 1s 0.4s both">ok</div>'), []);
});

test("a fragment needs its own folder and a duration", () => {
  const e = (s) => validateBrief(brief(s), tmp).errors.map((x) => x.path);
  assert.ok(e({ file: "top.html" }).includes("$.scenes[0].file"));
  assert.ok(e({ file: "scenes/a/a.html", duration: undefined }).includes("$.scenes[0].duration"));
  assert.deepEqual(validateBrief(brief({ file: "scenes/a/a.html" }), tmp).errors, []);
});

test("relative URLs point at the copied folder; its text is in the font subset", async () => {
  const { brief: b } = validateBrief(brief({ file: "scenes/a/a.html" }), tmp);
  assert.match(customText(b), /量子/);
  const dir = path.join(tmp, "out", ".build", "x");
  await buildProject(b, "en", "landscape", dir);
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.match(html, /src="assets\/custom\/0\/pic\.svg"/);
  assert.match(html, /url\("assets\/custom\/0\/bg\.svg"\)/);
  assert.match(html, /量子 en/);
  assert.ok(fs.existsSync(path.join(dir, "assets/custom/0/pic.svg")));
  assert.ok(!fs.existsSync(path.join(dir, "assets/custom/0/a.html")), "the fragment itself is not copied");
});

test("render refuses custom HTML without --allow-custom-html", async () => {
  fs.writeFileSync(path.join(tmp, "brief.json"), JSON.stringify(brief({ file: "scenes/a/a.html" })));
  const saved = console.error;
  let said = "";
  console.error = (m) => (said += m);
  process.env.MOTION_USE_NO_UPDATE_CHECK = "1";
  const code = await main(["render", path.join(tmp, "brief.json")]);
  console.error = saved;
  assert.equal(code, 1);
  assert.match(said, /--allow-custom-html/);
});

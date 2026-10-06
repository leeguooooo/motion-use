import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectText, validateBrief } from "../src/brief.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-test-"));
const base = (over = {}) => ({ version: 1, name: "t", languages: ["en"], formats: ["landscape"], scenes: [{ id: "a", type: "title", title: "Hi" }], ...over });
const errs = (b) => validateBrief(b, tmp).errors.map((e) => e.path);

test("a minimal brief is valid", () => {
  const { errors, brief } = validateBrief(base(), tmp);
  assert.deepEqual(errors, []);
  assert.equal(brief.style, "promo");
  assert.equal(brief.fps, 30);
});

test("inherited property names are not formats", () => {
  assert.ok(errs(base({ formats: ["toString"] })).includes("$.formats[0]"));
  assert.ok(errs(base({ formats: ["__proto__"] })).includes("$.formats[0]"));
  assert.ok(errs(base({ formats: ["landscape", "landscape"] })).includes("$.formats"));
});

test("theme accepts only known keys with hex colors, and drops everything else", () => {
  const evil = "red;}</style><script>globalThis.INJECTED=true</script><style>";
  assert.ok(errs(base({ theme: { panel: evil } })).includes("$.theme.panel"));
  assert.ok(errs(base({ theme: { accent: evil } })).includes("$.theme.accent"));
  const { brief } = validateBrief(base({ theme: { accent: "#123456", panel: evil } }), tmp);
  assert.deepEqual(brief.theme, { accent: "#123456" });
});

test("text must exist for every language; plain strings apply to all", () => {
  const b = base({ languages: ["zh", "en"], scenes: [{ id: "a", type: "title", title: { zh: "你好" } }] });
  assert.ok(errs(b).includes("$.scenes[0].title.en"));
  const ok = validateBrief(base({ languages: ["zh", "en"] }), tmp);
  assert.deepEqual(ok.brief.scenes[0].title, { zh: "Hi", en: "Hi" });
});

test("media must be local files that exist", () => {
  const b = base({ scenes: [{ id: "a", type: "image", image: "https://example.com/x.png" }] });
  assert.ok(errs(b).includes("$.scenes[0].image"));
  assert.ok(errs(base({ scenes: [{ id: "a", type: "image", image: "nope.png" }] })).includes("$.scenes[0].image"));
  assert.ok(errs(base({ voiceover: { dir: "missing" } })).includes("$.voiceover.dir"));
  fs.writeFileSync(path.join(tmp, "file.txt"), "x");
  assert.ok(errs(base({ voiceover: { dir: "file.txt" } })).includes("$.voiceover.dir"));
});

test("cover accepts first-scene or animate", () => {
  assert.equal(validateBrief(base(), tmp).brief.cover, "first-scene");
  assert.ok(errs(base({ cover: "black" })).includes("$.cover"));
});

test("scene ids, types, numbers and diagram references are checked", () => {
  assert.ok(errs(base({ scenes: [{ id: "A B", type: "title", title: "x" }] })).includes("$.scenes[0].id"));
  assert.ok(errs(base({ scenes: [{ type: "nope" }] })).includes("$.scenes[0].type"));
  assert.ok(errs(base({ scenes: [{ type: "title", title: "x", duration: 0 }] })).includes("$.scenes[0].duration"));
  assert.ok(errs(base({ fps: 29 })).includes("$.fps"));
  const d = { id: "d", type: "diagram", title: "x", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "zz" }] };
  assert.ok(errs(base({ scenes: [d] })).includes("$.scenes[0].edges[0].to"));
});

test("voiceover files are found by scene id", () => {
  const dir = path.join(tmp, "vo");
  fs.mkdirSync(path.join(dir, "en"), { recursive: true });
  fs.writeFileSync(path.join(dir, "en", "a.mp3"), "");
  const { brief, errors } = validateBrief(base({ voiceover: { dir: "vo" } }), tmp);
  assert.deepEqual(errors, []);
  assert.equal(brief.scenes[0].voiceover.en, path.join(dir, "en", "a.mp3"));
});

test("collectText gathers drawn text only", () => {
  const { brief } = validateBrief(base({ languages: ["zh", "en"], scenes: [{ id: "a", type: "title", title: { zh: "量子", en: "Q" } }] }), tmp);
  assert.equal(collectText(brief, ["zh"]), "量子");
});

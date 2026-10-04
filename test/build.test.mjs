import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateBrief } from "../src/brief.mjs";
import { FADE, VO_LEAD, buildProject, claimDir, plan } from "../src/build.mjs";
import { missingGlyphs } from "../src/fonts.mjs";
import { synthMusic } from "../src/music.mjs";
import { fitPx } from "../src/styles.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-build-"));
const brief = (scenes, over = {}) => {
  const r = validateBrief({ version: 1, name: "t", languages: ["en"], formats: ["landscape", "vertical"], music: "none", scenes, ...over }, tmp);
  assert.deepEqual(r.errors, []);
  return r.brief;
};

test("voiceover stretches its scene and never overlaps the next one", () => {
  const b = brief([{ id: "a", type: "title", title: "A" }, { id: "b", type: "title", title: "B" }, { id: "c", type: "title", title: "C" }]);
  b.scenes[0].voiceover = { en: "a.mp3" };
  b.scenes[1].voiceover = { en: "b.mp3" };
  const lengths = { "a.mp3": 9.5, "b.mp3": 4 };
  const p = plan(b, "en", "landscape", { probe: (f) => lengths[f] });
  const [a, s2] = p.scenes;
  assert.ok(a.stretched);
  assert.ok(a.duration >= VO_LEAD + 9.5);
  assert.ok(a.vo.at + a.vo.seconds < s2.vo.at, "voiceovers overlap");
  assert.equal(s2.start, a.start + a.duration - FADE);
});

test("an explicit duration never cuts off a scene's animation", () => {
  const long = "x".repeat(150);
  const b = brief([{ id: "t", type: "terminal", duration: 1, lines: [{ cmd: long }] }]);
  const p = plan(b, "en", "landscape");
  assert.ok(p.scenes[0].duration > 150 / 28);
  assert.ok(p.scenes[0].raised);
});

test("brief text is escaped: hostile text cannot add markup", async () => {
  const evil = `<script>alert(1)</script><img src=x onerror=alert(1)>"'&`;
  const b = brief([{ id: "a", type: "title", title: evil, subtitle: evil }, { id: "b", type: "terminal", panes: [{ label: "</div><script>x()</script>" }], lines: [{ cmd: evil }, { out: evil }] }, { id: "c", type: "cta", title: "x", command: evil, url: evil }]);
  const dir = path.join(tmp, "evil");
  await buildProject(b, "en", "landscape", dir);
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.equal(/<script/i.test(html), false);
  assert.equal(/<img src=x/i.test(html), false);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(fs.existsSync(path.join(dir, "assets", "fonts", "OFL-NotoSansSC.txt")));
});

test("output folders not created by motion-use are never emptied", () => {
  const mine = path.join(tmp, "user-folder");
  fs.mkdirSync(mine);
  fs.writeFileSync(path.join(mine, "keep.txt"), "important");
  assert.throws(() => claimDir(mine), /not created by motion-use/);
  assert.equal(fs.readFileSync(path.join(mine, "keep.txt"), "utf8"), "important");
});

test("music is deterministic and sized to the video", () => {
  const a = synthMusic("explainer", 3);
  const b = synthMusic("explainer", 3);
  assert.ok(a.equals(b));
  assert.equal(a.length, 44 + Math.ceil(3 * 44100) * 4);
});

test("headlines shrink to fit and CJK coverage is checked", () => {
  assert.equal(fitPx("Hi", 1000, 90), 90);
  assert.ok(fitPx("每天重复同一件事，真的很烦", 840, 96) < 96);
  assert.deepEqual(missingGlyphs("量子纠缠与龘字 abc"), []);
  assert.deepEqual(missingGlyphs("\u{1F600}"), ["\u{1F600}"]);
});

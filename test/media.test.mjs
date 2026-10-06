import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateBrief } from "../src/brief.mjs";
import { buildProject, checkMedia, mediaInfo, plan } from "../src/build.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-media-"));
const clip = path.join(tmp, "clip.mp4");
const png = path.join(tmp, "shot.png");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=3", "-pix_fmt", "yuv420p", clip]);
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=800x600:duration=1", "-frames:v", "1", png]);
fs.writeFileSync(path.join(tmp, "pic.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760"></svg>');

const brief = (scenes, over = {}) => {
  const r = validateBrief({ version: 1, name: "m", languages: ["en"], formats: ["landscape", "vertical"], music: "none", cover: "animate", scenes, ...over }, tmp);
  return r;
};

test("media sizes come from the files", () => {
  assert.deepEqual(mediaInfo(png), { w: 800, h: 600, duration: null, audio: false });
  const v = mediaInfo(clip);
  assert.equal(v.w, 640);
  assert.ok(Math.abs(v.duration - 3) < 0.1);
  assert.deepEqual(mediaInfo(path.join(tmp, "pic.svg")), { w: 1200, h: 760, duration: null, audio: false });
});

test("highlight and zoom fields are validated", () => {
  const errs = (s) => brief([s]).errors.map((e) => e.path);
  assert.ok(errs({ type: "image", image: "shot.png", highlights: [{ box: [1, 2, 3] }] }).includes("$.scenes[0].highlights[0].box"));
  assert.ok(errs({ type: "image", image: "shot.png", highlights: [{ box: [0, 0, 10, 10], at: 2, until: 1 }] }).includes("$.scenes[0].highlights[0].until"));
  assert.ok(errs({ type: "image", image: "shot.png", zoom: [{ box: [0, 0, 10, 10], at: 1, hold: 2 }, { box: [0, 0, 10, 10], at: 2 }] }).includes("$.scenes[0].zoom"));
  assert.ok(errs({ type: "video", video: "clip.mp4", speed: 9 }).includes("$.scenes[0].speed"));
  assert.ok(errs({ type: "video", video: "https://x/y.mp4" }).includes("$.scenes[0].video"));
  assert.deepEqual(brief([{ type: "video", video: "clip.mp4", start: 0.5, length: 2, highlights: [{ box: [10, 10, 100, 50], label: "here" }] }]).errors, []);
});

test("boxes and clip times are checked against the real media", () => {
  const { brief: b } = brief([{ type: "image", image: "shot.png", highlights: [{ box: [700, 500, 200, 200] }] }]);
  assert.throws(() => checkMedia(b.scenes[0], 0, mediaInfo(png)), /outside the 800×600 picture/);
  const { brief: v } = brief([{ type: "video", video: "clip.mp4", start: 2, length: 2 }]);
  assert.throws(() => checkMedia(v.scenes[0], 0, mediaInfo(clip)), /past the end/);
});

test("a video scene lasts for the clip, places it on the timeline and keeps a last-frame poster", async () => {
  const { brief: b, errors } = brief([{ id: "a", type: "title", title: "A" }, { id: "v", type: "video", video: "clip.mp4", start: 0.5, length: 2, speed: 2, zoom: [{ box: [0, 0, 320, 180], at: 0.2, hold: 0.5 }] }]);
  assert.deepEqual(errors, []);
  const p = plan(b, "en", "landscape");
  const v = p.scenes[1];
  assert.ok(v.duration >= 0.6 + 2 / 2);
  assert.equal(p.posters.length, 1);
  const dir = path.join(tmp, "build");
  await buildProject(b, "en", "landscape", dir);
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.equal(/<<T\+/.test(html), false, "unreplaced time marker");
  const start = Number(html.match(/<video[^>]*data-start="([\d.]+)"/)[1]);
  assert.ok(Math.abs(start - (v.start + 0.6)) < 0.002);
  assert.ok(/<video[^>]* muted /.test(html));
  assert.ok(fs.existsSync(path.join(dir, p.posters[0].rel)));
  assert.ok(html.includes("--zs:"));
});

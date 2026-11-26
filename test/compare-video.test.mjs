import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { compareVideoClip } from "../src/compare.mjs";
import { rasterText, textWidth } from "../src/text-raster.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "motion-use.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-compare-video-"));
const ff = (...args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
// a: 3 s red 640×360 at 30 fps with a tone; b: 3 s blue 480×480 at 25 fps, silent.
const a = path.join(tmp, "a.mp4"),
  b = path.join(tmp, "b.mp4");
ff("-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=3", "-f", "lavfi", "-i", "sine=f=440:d=3", "-shortest", "-pix_fmt", "yuv420p", a);
ff("-f", "lavfi", "-i", "color=c=blue:s=480x480:r=25:d=3", "-pix_fmt", "yuv420p", b);

const probe = (file, entries, stream = "v:0") =>
  execFileSync("ffprobe", ["-v", "error", "-select_streams", stream, "-show_entries", entries, "-of", "csv=p=0", file], { encoding: "utf8" }).trim();
// Mean RGB of a rectangle of the frame at t.
const mean = (file, t, x, y, w, h) => {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const s = [0, 0, 0];
  for (let i = 0; i < raw.length; i += 3) for (let c = 0; c < 3; c++) s[c] += raw[i + c];
  return s.map((v) => v / (raw.length / 3));
};
const brightest = (file, t, x, y, w, h) => {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
  return Math.max(...raw);
};

test("text raster: the bundled font fills real glyphs, CJK included, and shrinks to a max width", () => {
  const m = rasterText("全选 Claude", 48);
  assert.equal(m.data.length, m.width * m.height);
  const ink = m.data.filter((v) => v > 128).length / m.data.length;
  assert.ok(ink > 0.08 && ink < 0.6, `ink share ${ink}`);
  assert.ok(m.data.some((v) => v > 0 && v < 255), "anti-aliased edges");
  assert.ok(textWidth("全选全选", 40) > 1.9 * textWidth("全选", 40));
  const fit = rasterText("a very long label that does not fit", 48, { maxWidth: 200 });
  assert.ok(fit.width <= 202 && fit.size < 48, `${fit.width} px at ${fit.size}`);
  assert.equal(rasterText(" ", 40).data.every((v) => v === 0), true);
});

test("compare --video: title, two labelled sides playing together, own start and speed, shorter side holds", () => {
  const out = path.join(tmp, "cmp.mp4");
  // a from 1 s at speed 1: 2 s; b from 0 at speed 2: 1.5 s, then held for 0.5 s.
  const r = compareVideoClip(a, b, out, { title: "同一段提示词", labels: ["模型 A", "模型 B"], from: [1, 0], speed: [1, 2], width: 320 });
  assert.equal(r.duration, 2);
  assert.deepEqual(r.sides.map((s) => [s.label, s.from, s.speed, s.seconds, s.held]), [["模型 A", 1, 1, 2, 0], ["模型 B", 0, 2, 1.5, 0.5]]);
  const [w, h] = probe(out, "stream=width,height").split(",").map(Number);
  assert.deepEqual([w, h], [r.width, r.height]);
  assert.ok(Math.abs(Number(probe(out, "format=duration", "v:0")) - 2) < 0.1);
  assert.equal(probe(out, "stream=index", "a"), "", "no audio unless asked");
  // Layout: margin 12, title band 42, panels 320×320 (b is square), labels 32 under them.
  const m = 12,
    top = m + 42;
  assert.deepEqual([w, h], [2 * 320 + 3 * m, m + 42 + 320 + 32 + m / 2]);
  const left = mean(out, 1.8, m + 100, top + 100, 120, 120),
    right = mean(out, 1.8, 2 * m + 320 + 100, top + 100, 120, 120);
  assert.ok(left[0] > 180 && left[2] < 80, `a is red: ${left}`);
  assert.ok(right[2] > 180 && right[0] < 80, `b holds its last (blue) frame: ${right}`);
  assert.ok(brightest(out, 0.5, m, 0, w - 2 * m, top - 4) > 200, "the title is drawn");
  for (const x of [m, 2 * m + 320]) assert.ok(brightest(out, 0.5, x, top + 320, 320, 32) > 200, `label under the panel at x ${x}`);
  // The background between them stays dark.
  assert.ok(mean(out, 0.5, m + 320 + 2, top + 100, m - 4, 100).every((v) => v < 40));
});

test("compare --video: audio follows the chosen side's speed; bad starts, speeds and silent sides are refused", () => {
  const out = path.join(tmp, "audio.mp4");
  const r = compareVideoClip(a, b, out, { speed: [2, 1], audio: "a", width: 160 });
  assert.equal(r.duration, 3, "b at speed 1 is the longer side");
  assert.deepEqual(r.sides.map((s) => s.label), ["a", "b"], "labels default to the file names");
  assert.ok(Math.abs(Number(probe(out, "stream=duration", "a:0")) - 3) < 0.15);
  assert.throws(() => compareVideoClip(a, b, path.join(tmp, "x.mp4"), { from: [5, 0] }), /from 5 is outside/);
  assert.throws(() => compareVideoClip(a, b, path.join(tmp, "x.mp4"), { speed: 0 }), /speed must be 0.1–16/);
  assert.throws(() => compareVideoClip(a, b, path.join(tmp, "x.mp4"), { audio: "b" }), /has no audio track/);
  assert.throws(() => compareVideoClip(a, b, path.join(tmp, "x.mp4"), { labels: ["only one"] }), /labels takes two names/);
});

test("compare CLI: --video writes the MP4 and reports both sides; --labels needs two names", () => {
  const out = path.join(tmp, "cli.mp4");
  const ok = spawnSync(process.execPath, [BIN, "compare", a, b, "--video", "--title", "T", "--labels", "A,B", "--from", "0.5", "--speed", "1,1.5", "--duration", "1", "--width", "160", "--out", out, "--json"], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const j = JSON.parse(ok.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.duration, 1);
  assert.deepEqual(j.sides.map((s) => [s.label, s.from, s.speed]), [["A", 0.5, 1], ["B", 0.5, 1.5]]);
  assert.ok(fs.existsSync(out));
  const again = spawnSync(process.execPath, [BIN, "compare", a, b, "--video", "--out", out], { encoding: "utf8" });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /exists; pass --force/);
  const one = spawnSync(process.execPath, [BIN, "compare", a, b, "--video", "--labels", "A", "--out", path.join(tmp, "one.mp4")], { encoding: "utf8" });
  assert.notEqual(one.status, 0);
  assert.match(one.stderr, /--labels takes two names/);
});

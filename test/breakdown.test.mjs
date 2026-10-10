import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { breakdownVideo, fitBeatGrid } from "../src/breakdown.mjs";
import { compareVideos } from "../src/compare.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-breakdown-"));
const clip = path.join(tmp, "cuts.mp4");
const other = path.join(tmp, "other.mp4");
// Six 1 s flat colours with distinct luma, then 1 s of moving testsrc: hard cuts every 30 frames.
const colors = ["0x202020", "0xe0e0e0", "0x3020c0", "0xc0c040", "0x5010a0", "0xffa0a0"];
const inputs = colors.flatMap((c) => ["-f", "lavfi", "-i", `color=c=${c}:s=320x180:r=30:d=1`]);
inputs.push("-f", "lavfi", "-i", "testsrc=s=320x180:r=30:d=1,scroll=h=0.01");
const n = colors.length + 1;
execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", `${Array.from({ length: n }, (_, i) => `[${i}:v]`).join("")}concat=n=${n}:v=1[v]`, "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "15", clip]);
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=640x480:r=25:d=3", "-pix_fmt", "yuv420p", other]);

test("breakdown finds cuts, beat grid, palette and writes its files", async () => {
  const out = path.join(tmp, "bd");
  const s = await breakdownVideo(clip, out);
  const times = s.transitions.map((t) => t.time);
  assert.equal(times.length, 6, `cuts: ${times}`);
  times.forEach((t, i) => assert.ok(Math.abs(t - (i + 1)) <= 1 / 30 + 1e-6, `cut ${i} at ${t}`));
  assert.ok(s.beat_grid, "beat grid fitted");
  assert.ok(Math.abs(s.beat_grid.step_frames - 30) <= 0.5, `step ${s.beat_grid.step_frames}`);
  assert.equal(s.beat_grid.inliers, 6);
  assert.equal(s.beat_grid.bpm_if_quarter, 60);
  assert.equal(s.segments.length, 7);
  assert.ok(s.segments[0].motion_area < 0.01, "flat colour has no motion");
  assert.ok(s.segments[6].motion_area > 0.2, `scrolling testsrc moves: ${s.segments[6].motion_area}`);
  assert.ok(s.palette.colors.length > 0 && s.palette.colors.every((c) => /^#[0-9a-f]{6}$/.test(c.hex)));
  assert.ok(s.palette.blue_purple.frames >= 1, "blue-purple segments flagged");
  assert.ok(s.contact_sheets.length >= 1 && s.contact_sheets[0].times[1] === 0.25);
  for (const f of ["breakdown.json", "breakdown.md", "transitions/T01.jpg", "transitions/T06.jpg", "heatmaps/seg01.png", "ref/seg07.png", s.contact_sheets[0].file]) assert.ok(fs.existsSync(path.join(out, f)), f);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, "breakdown.json"), "utf8")).transitions.length, 6);
  // A directory motion-use did not create is refused.
  await assert.rejects(breakdownVideo(clip, tmp), /not created by motion-use/);
});

test("beat grid prefers the largest step and tolerates outliers", () => {
  const S = [10, 34, 58, 82, 106, 130, 154, 178, 190, 202];
  const g = fitBeatGrid(S, 30);
  assert.ok(Math.abs(g.step_frames - 24) < 0.2 || Math.abs(g.step_frames - 12) < 0.2, `step ${g.step_frames}`);
  assert.equal(fitBeatGrid([1, 2, 3], 30), null);
  assert.ok(g.inliers >= 8);
});

test("compare stacks frames side by side", () => {
  const out = path.join(tmp, "cmp.png");
  const r = compareVideos(clip, other, out, { times: [0.5, 1.5, 2.5], width: 320 });
  assert.ok(fs.existsSync(out));
  const [w, h] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", out], { encoding: "utf8" }).trim().split(",").map(Number);
  assert.equal(w, 640);
  assert.equal(h, r.height);
  assert.throws(() => compareVideos(clip, other, out, { times: [5] }), /outside both videos/);
});

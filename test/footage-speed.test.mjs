import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { atempoChain, footageAnchorTime, layoutSpeed, mapSourceTime, parseFreezes, parseSpeedRange, planSpeed, scheduleLines, speedFootage } from "../src/footage-speed.mjs";
import { initFilm, validateFilm } from "../src/film.mjs";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const ff = (...args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const seconds = (f, stream) => Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", stream, "-show_entries", "stream=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim());
// Gray 2 s, moving test pattern 3 s, white 2 s: still / moving / still with known edges.
function recording(file, { audio = true } = {}) {
  ff("-f", "lavfi", "-i", "color=c=gray:s=160x90:r=30:d=2", "-f", "lavfi", "-i", "testsrc=s=160x90:r=30:d=3", "-f", "lavfi", "-i", "color=c=white:s=160x90:r=30:d=2",
    ...(audio ? ["-f", "lavfi", "-i", "sine=f=440:d=7:r=48000"] : []),
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", ...(audio ? ["-map", "3:a", "-c:a", "aac", "-shortest"] : []), "-pix_fmt", "yuv420p", "-c:v", "libx264", file);
}
// Spread of gray levels in one frame: a flat color is near 0, the test pattern is not.
function spread(file, t) {
  const px = execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=32:18,format=gray", "-f", "rawvideo", "-"]);
  const mean = px.reduce((a, b) => a + b, 0) / px.length;
  return Math.sqrt(px.reduce((a, b) => a + (b - mean) ** 2, 0) / px.length);
}

test("freezedetect log becomes freeze spans; a freeze open at the end runs to the end", () => {
  const log = "[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 1.5\n[freezedetect @ 0x1] lavfi.freezedetect.freeze_duration: 2\n[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 3.5\nlavfi.freezedetect.freeze_start: 8.2\n";
  assert.deepEqual(parseFreezes(log, 10), [{ from: 1.5, to: 3.5 }, { from: 8.2, to: 10 }]);
  assert.deepEqual(parseSpeedRange("120-150:1.2"), { from: 120, to: 150, speed: 1.2 });
  assert.throws(() => parseSpeedRange("120:1.2"), /from-to:speed/);
});

test("still spans speed up more than moving ones, short spans merge, manual ranges are kept", () => {
  const plan = planSpeed({ duration: 20, freezes: [{ from: 0, to: 6 }, { from: 6.5, to: 12 }], still: 3, motion: 2, minSegment: 1.5 });
  // The 0.5 s moving blip between two freezes joins them instead of jumping 3× → 2× → 3×.
  assert.deepEqual(plan.map((s) => [s.from, s.to, s.kind, s.speed]), [[0, 12, "still", 3], [12, 20, "motion", 2]]);
  const manual = planSpeed({ duration: 20, freezes: [{ from: 0, to: 6 }], minSegment: 1.5, ranges: [{ from: 5.5, to: 6.2, speed: 1.2 }] });
  assert.deepEqual(manual.map((s) => [s.from, s.to, s.kind, s.speed]), [[0, 5.5, "still", 3], [5.5, 6.2, "manual", 1.2], [6.2, 20, "motion", 2]], "a short manual range is never merged away");
  assert.throws(() => planSpeed({ duration: 20, ranges: [{ from: 1, to: 5, speed: 1 }, { from: 4, to: 6, speed: 1 }] }), /overlap/);
  assert.throws(() => planSpeed({ duration: 20, still: 40 }), /0\.25 to 16/);
  assert.deepEqual(planSpeed({ duration: 4 }).map((s) => s.kind), ["motion"], "no freeze: one moving span");
});

test("the speed map is frame-exact and maps source seconds to output seconds", () => {
  const segs = layoutSpeed(planSpeed({ duration: 7, freezes: [{ from: 0, to: 2 }, { from: 5, to: 7 }], minSegment: 0.5 }), 30);
  assert.deepEqual(segs.map((s) => s.frames), [20, 45, 20]);
  const map = { segments: segs };
  assert.equal(mapSourceTime(map, 0), 0);
  assert.ok(Math.abs(mapSourceTime(map, 2) - 20 / 30) < 1e-9);
  assert.ok(Math.abs(mapSourceTime(map, 3.5) - (20 + 22.5) / 30) < 1e-9);
  assert.ok(Math.abs(mapSourceTime(map, 7) - 85 / 30) < 1e-9);
  assert.throws(() => mapSourceTime(map, 8), /outside the mapped source/);
});

test("atempo stages keep each factor inside 0.5–2 so pitch is preserved at any speed", () => {
  assert.equal(atempoChain(3), "atempo=2,atempo=1.5");
  assert.equal(atempoChain(1.2), "atempo=1.2");
  assert.equal(atempoChain(1), "atempo=1");
  assert.equal(atempoChain(8), "atempo=2,atempo=2,atempo=2");
  assert.equal(atempoChain(0.3), "atempo=0.5,atempo=0.6");
});

test("footage anchors go through the speed map, the clip placement and an offset", () => {
  const map = { segments: layoutSpeed(planSpeed({ duration: 7, freezes: [{ from: 0, to: 2 }, { from: 5, to: 7 }], minSegment: 0.5 }), 30), marks: { pattern: 2 } };
  const clip = { at: 4, from: 0, rate: 1, marks: { end: 5 } };
  assert.ok(Math.abs(footageAnchorTime({ footage: "demo", t: 2 }, clip, { clipStart: 4, map }) - (4 + 20 / 30)) < 1e-9);
  assert.ok(Math.abs(footageAnchorTime({ footage: "demo", mark: "pattern", offset: -0.5 }, clip, { clipStart: 4, map }) - (4 + 20 / 30 - 0.5)) < 1e-9);
  assert.ok(Math.abs(footageAnchorTime({ footage: "demo", mark: "end" }, clip, { clipStart: 4, map }) - (4 + 65 / 30)) < 1e-9);
  assert.throws(() => footageAnchorTime({ footage: "demo", mark: "nope" }, clip, { clipStart: 4, map }), /no mark "nope"/);
  assert.throws(() => footageAnchorTime({ footage: "demo", t: 1, mark: "end" }, clip, { clipStart: 4, map }), /not both/);
  // from 1 s of the sped-up file at rate 1: source 0 (output 0) was never played.
  assert.throws(() => footageAnchorTime({ footage: "demo", t: 0 }, { ...clip, from: 1 }, { clipStart: 4, map }), /not in the played part/);
  assert.throws(() => footageAnchorTime({ footage: "demo", t: 6 }, clip, { clipStart: 4, map, length: 1 }), /not in the played part/);
});

test("lines start at max(anchor, previous end + gap); pushes and overflow are reported", () => {
  const lines = [{ id: "a", anchor: 1 }, { id: "b", anchor: 2 }, { id: "c", anchor: 10, gap: 0.2 }, { id: "d", anchor: null }];
  const r = scheduleLines(lines, { a: 2, b: 1, c: 3, d: 1 }, { end: 12, gap: 0.4 });
  assert.deepEqual(r.slice(0, 3).map((x) => [x.start, +x.pushed.toFixed(3), +x.overflow.toFixed(3)]), [[1, 0, 0], [3.4, 1.4, 0], [10, 0, 1]]);
  assert.equal(r[3].pending, true, "an anchor not resolved yet is pending, not pushed");
  assert.equal(scheduleLines([{ id: "a", anchor: 1 }], {}, {})[0].pending, true, "no audio yet: pending");
});

test("footage speed encodes a recording frame-exactly and writes its map", { skip: !hasFfmpeg }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mu-speed-"));
  const src = path.join(d, "rec.mp4"), out = path.join(d, "fast.mp4");
  recording(src);
  const r = speedFootage(src, { out, minSegment: 0.5 });
  assert.deepEqual(r.segments.map((s) => [s.from, s.to, s.kind, s.speed]), [[0, 2, "still", 3], [2, 5, "motion", 2], [5, 7, "still", 3]]);
  const map = JSON.parse(fs.readFileSync(r.map, "utf8"));
  assert.equal(map.output.bytes, fs.statSync(out).size);
  const total = map.segments.at(-1).end;
  assert.ok(Math.abs(seconds(out, "v:0") - total) < 1 / 30 + 1e-3, "video lasts what the map says");
  assert.ok(Math.abs(seconds(out, "a:0") - total) < 0.06, "sound follows the picture");
  // Source second 2 (the pattern starts) lands at output 20/30 s.
  const edge = mapSourceTime(map, 2);
  assert.ok(Math.abs(edge - 20 / 30) < 1e-3);
  assert.ok(spread(out, edge - 0.1) < 2 && spread(out, edge + 0.1) > 20, "the moving pattern starts where the map says");
  assert.throws(() => speedFootage(src, { out }), /already exists/);
  // Screen recordings often have no sound.
  const mute = path.join(d, "mute.mp4");
  recording(mute, { audio: false });
  const m = speedFootage(mute, { out: path.join(d, "mute-fast.mp4"), minSegment: 0.5, ranges: [{ from: 3, to: 4, speed: 1 }] });
  assert.deepEqual(m.segments.map((s) => s.kind), ["still", "motion", "manual", "motion", "still"]);
  assert.ok(Math.abs(seconds(m.file, "v:0") - m.segments.at(-1).end) < 1 / 30 + 1e-3);
});

test("many spans and a variable-frame-rate recording keep the file on the map", { skip: !hasFfmpeg }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mu-speed-vfr-"));
  const inputs = [];
  for (let i = 0; i < 12; i++) inputs.push("-f", "lavfi", "-i", "color=c=gray:s=160x90:r=30:d=0.6", "-f", "lavfi", "-i", "testsrc=s=160x90:r=30:d=0.7");
  const cfr = path.join(d, "cfr.mp4"), vfr = path.join(d, "vfr.mp4");
  ff(...inputs, "-filter_complex", inputs.filter((x, i) => i % 4 === 3).map((_, i) => "[" + i + ":v]").join("") + "concat=n=24:v=1:a=0[v]", "-map", "[v]", "-pix_fmt", "yuv420p", "-c:v", "libx264", cfr);
  // A screen recorder that writes no frame while nothing changes.
  ff("-i", cfr, "-vf", "mpdecimate", "-fps_mode", "vfr", "-c:v", "libx264", vfr);
  for (const src of [cfr, vfr]) {
    const r = speedFootage(src, { out: src.replace(".mp4", "-fast.mp4"), minSegment: 0 });
    assert.ok(r.segments.length >= 20, "every still/moving span is its own segment");
    const frames = r.segments.reduce((a, s) => a + s.frames, 0);
    const pts = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", r.file], { encoding: "utf8" }).trim().split("\n").map(Number).sort((a, b) => a - b);
    assert.equal(pts.length, frames, path.basename(src) + ": one frame per mapped frame");
    assert.ok(pts.every((p, k) => Math.abs(p - k / 30) < 1 / 30), path.basename(src) + ": no drift across joins");
  }
});

test("narration lines anchored to footage land at film time and are pushed when the previous line still speaks", { skip: !hasFfmpeg }, () => {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "mu-anchor-"));
  initFilm({ lang: "en", format: "landscape" }, d);
  const data = JSON.parse(fs.readFileSync(path.join(d, "film.json"), "utf8"));
  recording(path.join(d, "rec.mp4"));
  const r = speedFootage(path.join(d, "rec.mp4"), { out: path.join(d, "footage", "fast.mp4"), minSegment: 0.5, marks: { pattern: 2 } });
  fs.mkdirSync(path.join(d, "voiceover", "en"), { recursive: true });
  for (const [id, len] of [["one", 1.5], ["two", 0.5], ["three", 0.5]]) ff("-f", "lavfi", "-i", "sine=f=300:d=" + len, path.join(d, "voiceover", "en", id + ".wav"));
  Object.assign(data, {
    duration: 6,
    voiceover: { dir: "voiceover" },
    videos: { demo: { file: "footage/fast.mp4", speedMap: "footage/fast.speed.json", at: 1, marks: { white: 5 } } },
    narration: [
      { id: "one", text: { en: "Gray first." }, at: { footage: "demo", t: 0 } },
      { id: "two", text: { en: "The pattern." }, at: { footage: "demo", mark: "pattern" } },
      { id: "three", text: { en: "Then white." }, at: { footage: "demo", mark: "white", offset: -0.25 } },
    ],
  });
  // One long shot of footage, as in a screen-recording walkthrough.
  const { narration: _unused, ...shot } = data.shots[0];
  const sized = (duration) => ({ ...data, duration, shots: [{ ...shot, start: 0, end: duration }] });
  Object.assign(data, sized(6));
  const v = validateFilm(data, d);
  assert.deepEqual(v.errors, []);
  const starts = Object.fromEntries(v.film.tracks.filter((t) => t.role === "voiceover").map((t) => [t.id, +t.start.toFixed(3)]));
  // one: film 1 s. two: anchor 1 + 20/30 ≈ 1.667 s but one speaks until 2.5 s, so 2.9 s (gap 0.4).
  // three: anchor 1 + 65/30 − 0.25 ≈ 2.917 s, pushed after two (ends 3.4) to 3.8 s.
  assert.deepEqual(starts, { one: 1, two: 2.9, three: 3.8 });
  const sched = Object.fromEntries(v.film.narrationSchedule.map((x) => [x.id, x]));
  assert.equal(sched.two.anchor, 1.667);
  assert.equal(sched.two.pushed, 1.233);
  assert.ok(v.warnings.some((w) => w.path === "$.narration[1].at" && /pushed 1\.233s/.test(w.message) && /still --at/.test(w.message)));
  // The narration phase (voiceover, retime) resolves the same anchors without probing footage.
  const n = validateFilm(data, d, { phase: "narration" });
  assert.deepEqual(n.errors, []);
  assert.equal(n.film.narrationSchedule.find((x) => x.id === "two").start, 2.9);
  // A line that cannot fit before the film ends is an error, never truncated.
  const short = validateFilm(sized(4), d);
  assert.ok(short.errors.some((e) => e.path === "$.voiceover.en.three" && /does not fit/.test(e.message)));
  // Anchors that do not resolve are errors at the line.
  const bad = validateFilm({ ...data, narration: [{ id: "one", text: "x", at: { footage: "nope", t: 1 } }, { id: "two", text: "y", at: { footage: "demo", mark: "missing" } }] }, d);
  assert.ok(bad.errors.some((e) => e.path === "$.narration[0].at" && /videos/.test(e.message)));
  assert.ok(bad.errors.some((e) => e.path === "$.narration[1].at" && /no mark/.test(e.message)));
  // A map written for another file is refused.
  fs.appendFileSync(path.join(d, "footage", "fast.mp4"), "x");
  assert.ok(validateFilm(data, d).errors.some((e) => e.path === "$.videos.demo" && /different file/.test(e.message)));
  assert.ok(r.map.endsWith("fast.speed.json"));
});

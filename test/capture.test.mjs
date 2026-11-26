import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { RENDER_QUANTUM, audioStats, clockScript, mixContexts, pageKeyTimes, parsePresses, resolveTarget, wavBuffer } from "../src/capture.mjs";
import { runHyperframes } from "../src/hf.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "bin", "motion-use.mjs");
const fixture = path.join(here, "fixtures", "capture", "index.html");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mu-capture-"));
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const chrome = await runHyperframes(["browser", "path"], {}).then((r) => r.code === 0 && fs.existsSync(r.out.trim().split("\n").pop())).catch(() => false);

test("capture: --press keys with an optional second, page keys every n seconds before the end", () => {
  assert.deepEqual(parsePresses(["a", "A@1.5", "ArrowRight@3", " @2"]), [{ key: "a", at: 0 }, { key: "A", at: 1.5 }, { key: "ArrowRight", at: 3 }, { key: " ", at: 2 }]);
  assert.throws(() => parsePresses(["@1"]), /--press takes a key/);
  assert.throws(() => parsePresses(["a@-1"]), /--press takes a key/);
  assert.throws(() => parsePresses(["Arrow Right"]), /--press takes a key/);
  assert.deepEqual(pageKeyTimes("ArrowRight", 8, 30).map((p) => p.at), [8, 16, 24]);
  assert.deepEqual(pageKeyTimes("PageDown", 10, 30).map((p) => p.at), [10, 20]);
  assert.throws(() => pageKeyTimes("ArrowRight", 0, 30), /--page-every/);
});

test("capture: local files and folders are served, URLs pass through, missing pages are refused", () => {
  assert.deepEqual(resolveTarget("https://example.com/demo"), { url: "https://example.com/demo" });
  assert.equal(resolveTarget(fixture).page, "index.html");
  assert.equal(resolveTarget(path.dirname(fixture)).file, fixture);
  assert.throws(() => resolveTarget(path.join(here, "no-such-page.html")), /not found/);
  assert.throws(() => resolveTarget(), /capture needs a page/);
  assert.match(clockScript({ duration: 2 }), /__motionUseCapture/);
});

test("capture: contexts are mixed at the second they were made and cut where the page closed them", () => {
  const sr = 10;
  const one = new Float32Array(10).fill(0.25);
  const [l, r] = mixContexts([{ born: 0.5, closedAt: null, data: [one, one] }, { born: 0, closedAt: 0.3, data: [one] }], 20, sr);
  assert.deepEqual([...l].slice(0, 8), [0.25, 0.25, 0.25, 0, 0, 0.25, 0.25, 0.25]);
  assert.equal(l[14], 0.25);
  assert.equal(l[15], 0);
  assert.deepEqual(r, l, "a mono context is copied to both channels");
  const s = audioStats([l, r], sr);
  assert.equal(s.first_sound_s, 0);
  assert.equal(s.silent, false);
  assert.equal(s.peak_db, -12.04);
  assert.equal(audioStats([new Float32Array(5), new Float32Array(5)], sr).silent, true);
});

test("capture: WAV header and 16-bit samples", () => {
  const b = wavBuffer([Float32Array.of(0, 1, -1, 2), Float32Array.of(0.5, 0, 0, 0)], 48000);
  assert.equal(b.toString("ascii", 0, 4), "RIFF");
  assert.equal(b.readUInt16LE(22), 2);
  assert.equal(b.readUInt32LE(24), 48000);
  assert.equal(b.readUInt32LE(40), 16);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => b.readInt16LE(44 + i * 2)), [0, 16384, 32767, 0, -32768, 0, 32767, 0]);
});

test("capture CLI: refuses missing options and a folder it did not make", () => {
  const run = (...a) => spawnSync(process.execPath, [cli, "capture", ...a], { encoding: "utf8" });
  assert.match(run(fixture, "--duration", "2").stderr, /capture <url\|file.html> --out <dir> --duration/);
  assert.match(run(fixture, "--out", tmp(), "--duration", "abc").stderr, /--duration takes a number/);
  assert.match(run(fixture, "--out", tmp(), "--duration", "2", "--page-key", "ArrowRight").stderr, /--page-key and --page-every go together/);
  const foreign = tmp();
  fs.writeFileSync(path.join(foreign, "keep.txt"), "mine");
  const r = run(fixture, "--out", foreign, "--duration", "1");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /was not created by motion-use/);
  assert.ok(fs.existsSync(path.join(foreign, "keep.txt")));
});

// One frame of the delivered MP4 as RGB rows: [y][x] -> [r, g, b].
function frameAt(file, n, crop) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),crop=${crop}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return raw;
}
const mean = (buf) => { let s = 0; for (const v of buf) s += v; return s / buf.length; };

test("capture: canvas, WebGL, CSS animation and an OscillatorNode on one clock, headless", { skip: !ffmpeg ? "ffmpeg missing" : !chrome ? "no Chrome (motion-use doctor --install-browser)" : false, timeout: 120000 }, () => {
  const out = path.join(tmp(), "cap");
  // A is pressed at 0.5 s; the page starts its tone 1 s later and paints the left half white from then on.
  const r = spawnSync(process.execPath, [cli, "capture", fixture, "--out", out, "--duration", "3", "--press", "a@0.5", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const rep = JSON.parse(r.stdout);
  assert.deepEqual(rep.frames, { expected: 90, measured: 90 });
  assert.equal(rep.video_s, 3);
  assert.equal(rep.width, 1920);
  assert.equal(rep.height, 1080);
  assert.deepEqual(rep.presses, [{ key: "a", at: 0.5 }]);
  assert.deepEqual(rep.page_errors, []);
  assert.deepEqual(rep.audio.contexts, [{ started_s: 0.5, closed_s: null }]);
  assert.equal(rep.audio.silent, false);
  assert.ok(Math.abs(rep.audio.first_sound_s - 1.5) <= RENDER_QUANTUM / 48000, `first sound at ${rep.audio.first_sound_s}`);
  assert.ok(Math.abs(rep.audio.peak_db - -6.02) < 0.1, `peak ${rep.audio.peak_db}`);
  for (const f of ["capture.mp4", "audio.wav", "capture.json"]) assert.ok(fs.existsSync(path.join(out, f)), f);
  assert.ok(!fs.existsSync(path.join(out, "video.mp4")), "the silent intermediate is removed");
  // The WAV is exactly the duration at 48 kHz stereo.
  const wav = fs.readFileSync(path.join(out, "audio.wav"));
  assert.equal(wav.readUInt32LE(40), 3 * 48000 * 2 * 2);
  // The MP4 carries sound of the same length.
  assert.ok(Math.abs(rep.audio.mp4_seconds - 3) < 0.03, `mp4 audio ${rep.audio.mp4_seconds}`);
  // Picture: frame 44 (1.4667 s) has no white half, frame 45 (1.5 s) has it: same instant as the sound.
  const mp4 = path.join(out, "capture.mp4");
  assert.ok(mean(frameAt(mp4, 44, "200:200:300:300")) < 20, "left half dark before the tone");
  assert.ok(mean(frameAt(mp4, 45, "200:200:300:300")) > 235, "left half white when the tone starts");
  // WebGL: the green corner.
  const gl = frameAt(mp4, 10, "32:32:1904:16");
  assert.ok(gl[1] > 200 && gl[0] < 60 && gl[2] < 60, `WebGL corner rgb ${[...gl.subarray(0, 3)]}`);
  // CSS animation follows the virtual clock: at 1 s the box has moved half of its 1000 px.
  const row = frameAt(mp4, 30, "1920:2:0:110");
  const blue = [];
  for (let x = 0; x < 1920; x++) if (row[x * 3 + 2] > 180 && row[x * 3] < 80) blue.push(x);
  assert.ok(blue.length >= 10, "box visible");
  assert.ok(Math.abs(blue[0] - 500) <= 4, `box left edge at ${blue[0]} px`);
});

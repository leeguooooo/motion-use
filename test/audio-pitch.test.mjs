import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { peakTime } from "../src/beats.mjs";
import { buildFilm, initFilm, validateFilm } from "../src/film.mjs";
import { mixArgs, mixAudio } from "../src/mix.mjs";

const SFX = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "assets", "sfx");
const seconds = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }));
const UI = ["type", "delete", "select", "pop", "tick", "rise"];

function film() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mu-pitch-"));
  initFilm({ lang: "en", format: "landscape" }, dir);
  const data = JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8"));
  data.voiceover = false;
  return { dir, data };
}

test("audio pitch is a 0.5–2 playback rate; the track's length is the played time", () => {
  const { dir, data } = film();
  for (const pitch of [0.3, 2.5, "1.1", 0])
    assert.ok(
      validateFilm({ ...data, audio: [{ effect: "select", start: 1, pitch }] }, dir).errors.some((e) => String(e.path ?? e).includes("$.audio[0].pitch")),
      `pitch ${pitch} is refused`,
    );
  const v = validateFilm({ ...data, audio: [{ effect: "select", start: 1 }, { effect: "select", start: 1.25, pitch: 1.06 }, { effect: "select", start: 1.5, pitch: 1.12 }] }, dir);
  assert.deepEqual(v.errors, []);
  const src = seconds(path.join(SFX, "select.wav"));
  const [a, b, c] = v.film.tracks;
  assert.equal(a.pitch, undefined);
  assert.ok(Math.abs(a.length - src) < 1e-6);
  assert.equal(b.pitch, 1.06);
  assert.ok(Math.abs(b.length - src / 1.06) < 1e-6);
  assert.ok(Math.abs(c.length - src / 1.12) < 1e-6);
});

test("the cut-off check uses length / pitch", () => {
  const { dir, data } = film();
  const src = seconds(path.join(SFX, "rise.wav")); // 0.8 s
  const start = data.duration - src * 0.7; // room for 70% of it
  const cut = (pitch) => validateFilm({ ...data, audio: [{ effect: "rise", start, ...(pitch ? { pitch } : {}) }] }, dir).errors.some((e) => /cut off/.test(e.message ?? e));
  assert.equal(cut(), true, "unpitched runs past the film");
  assert.equal(cut(0.8), true, "slower runs even longer");
  assert.equal(cut(1.5), false, "1.5× plays in 0.53 s and fits");
  // An explicit source length that overruns the file is still refused, whatever the pitch.
  assert.ok(validateFilm({ ...data, audio: [{ effect: "rise", start: 0, length: 1.2, pitch: 2 }] }, dir).errors.some((e) => /cut off/.test(e.message ?? e)));
});

test("align peak still lands a pitched hit on start", () => {
  const { dir, data } = film();
  const hit = peakTime(path.join(SFX, "whoosh.wav"));
  const v = validateFilm({ ...data, audio: [{ effect: "whoosh", start: 3, align: "peak", pitch: 2 }, { effect: "whoosh", start: 0, align: "peak", pitch: 1.5 }] }, dir);
  assert.deepEqual(v.errors, []);
  const [late, early] = v.film.tracks;
  assert.ok(Math.abs(late.peak - hit / 2) < 2e-3, `peak ${late.peak} vs ${hit / 2}`);
  assert.ok(Math.abs(late.start + late.peak - 3) < 2e-3);
  // trimmed at the head: offset is source seconds, so it moves by the played peak × pitch
  assert.equal(early.start, 0);
  assert.ok(Math.abs(early.offset - early.peak * 1.5) < 2e-3);
});

test("the ffmpeg mix resamples a pitched clip before delaying it; unpitched clips are unchanged", () => {
  const clip = { file: "a.wav", start: 1.5, mediaStart: 0.1, duration: 0.5, volume: 1, channels: 2 };
  const plain = mixArgs([clip], 4, "out.wav");
  assert.equal(plain.join(" ").includes("asetrate"), false);
  assert.deepEqual(mixArgs([{ ...clip, pitch: 1 }], 4, "out.wav"), plain);
  const args = mixArgs([{ ...clip, pitch: 1.12 }], 4, "out.wav");
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.match(graph, /aresample=48000,asetrate=53760,aresample=48000/);
  assert.ok(graph.indexOf("asetrate") < graph.indexOf("adelay"));
  // the played half second reads 0.56 s of the source
  assert.equal(args[args.indexOf("-t") + 1], "0.56");
});

test("a mixed clip at pitch 2 plays in half the time and hits at half its peak time", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mu-pitch-mix-"));
  const src = path.join(SFX, "whoosh.wav"), len = seconds(src), out = path.join(dir, "mix.wav");
  mixAudio([{ file: src, start: 0, mediaStart: 0, duration: len / 2, volume: 1, pitch: 2 }], len / 2, out);
  assert.ok(Math.abs(seconds(out) - len / 2) < 0.01);
  assert.ok(Math.abs(peakTime(out) - peakTime(src) / 2) < 5e-3);
});

test("the bundled UI effects exist, validate, and are short (rise is a 0.8 s riser)", () => {
  const { dir, data } = film();
  const v = validateFilm({ ...data, audio: UI.map((effect, i) => ({ effect, start: 1 + i * 0.5 })) }, dir);
  assert.deepEqual(v.errors, []);
  for (const name of UI) {
    const s = seconds(path.join(SFX, `${name}.wav`));
    assert.ok(name === "rise" ? Math.abs(s - 0.8) < 0.01 : s < 0.3, `${name} is ${s}s`);
  }
  assert.ok(validateFilm({ ...data, audio: [{ effect: "beep", start: 1 }] }, dir).errors.some((e) => /rise/.test(e.message ?? e)));
});

test("a built film bakes a pitched clip once, so the page's <audio> and the native mix play the same file", async () => {
  const { dir, data } = film();
  data.music = "none";
  data.audio = [{ effect: "select", start: 1 }, { effect: "whoosh", start: 3, pitch: 2, align: "peak" }];
  const v = validateFilm(data, dir);
  assert.deepEqual(v.errors, []);
  const out = path.join(dir, "out");
  const proj = await buildFilm(v.film, "en", "landscape", out);
  const tags = fs.readFileSync(path.join(out, "index.html"), "utf8").match(/<audio[^>]*>/g);
  assert.equal(tags.length, 2);
  assert.ok(tags.every((t) => !t.includes("data-playback-rate")));
  const pitched = proj.mix.find((m) => m.id === "film-audio-1");
  assert.equal(pitched.pitch, undefined, "the bake already holds the pitch: nothing applies it twice");
  assert.equal(pitched.mediaStart, 0);
  const track = v.film.tracks[1];
  assert.ok(Math.abs(pitched.duration - track.length) < 1e-9);
  assert.ok(tags[1].includes(`data-media-start="0"`) && tags[1].includes(`data-duration="${track.length}"`));
  assert.ok(Math.abs(seconds(pitched.file) - track.length) < 0.005);
  assert.ok(Math.abs(track.start + peakTime(pitched.file) - 3) < 2e-3, "the baked hit lands on start");
});

// Licensed music for narrated explainers (#122): plan, source record, ducking, phrase loops,
// audition under the film's narration, choose, and a remembered user preference.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-music-"));
process.env.MOTION_USE_CONFIG = path.join(tmp, "config.json");
process.env.MOTION_USE_KEYCHAIN = "0";

const lib = await import("../src/music-library.mjs");
const { initFilm, checkFilm, buildFilm, validateFilm } = await import("../src/film.mjs");

test("plan: explainer settings route to a licensed track; a remembered style comes first", () => {
  const p = lib.musicPlan("meeting-explainer", {});
  assert.equal(p.route, "licensed-track");
  assert.ok(p.queries.some((q) => /cafe jazz/.test(q.query)));
  assert.ok(p.checks.some((c) => /licen/.test(c)));
  assert.equal(lib.musicPlan("feed-short", {}).route, "score-or-licensed");
  const pref = lib.musicPlan("course", { music: { style: "cafe jazz" } });
  assert.equal(pref.queries[0].style, "cafe jazz");
  assert.ok(lib.isExplainer("tech-review"));
});

test("add: refuses without a source record, then copies, hashes and records the track", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "proj-"));
  const song = path.join(tmp, "Cafe Song.mp3");
  fs.writeFileSync(song, "not really audio");
  assert.throws(() => lib.addTrack(dir, song, { url: "https://x.test/t/1" }), /--author, --license/);
  const rec = lib.addTrack(dir, song, { url: "https://x.test/t/1", author: "Someone", license: "Pixabay Content License", probe: () => 479 });
  assert.equal(rec.file, "assets/music/cafe-song.mp3");
  assert.match(rec.sha256, /^[0-9a-f]{64}$/);
  assert.equal(lib.readMusicSources(dir).tracks.length, 1);
  const md = fs.readFileSync(path.join(dir, "SOURCES.md"), "utf8");
  assert.match(md, /## Music tracks \(motion-use music add\)/);
  assert.match(md, /Pixabay Content License/);
  lib.addTrack(dir, song, { url: "https://x.test/t/1", author: "Someone", license: "Pixabay Content License" });
  assert.equal(lib.readMusicSources(dir).tracks.length, 1, "re-adding the same file replaces its record");
});

test("ducking: -20 dB under narration, stays down across short gaps, rises in a real pause", () => {
  const env = lib.duckPoints([{ start: 1, end: 4 }, { start: 4.5, end: 8 }, { start: 11, end: 14 }], 0.6, { duration: 20 });
  const low = 0.6 * 10 ** (-20 / 20);
  const at = (t) => env.filter((p) => p.t <= t).at(-1).v;
  assert.ok(Math.abs(at(4.2) - low) < 1e-9, "a half-second breath stays ducked");
  assert.equal(at(9.5), 0.6, "a three-second pause lets the music back up");
  assert.ok(Math.abs(at(12) - low) < 1e-9);
  assert.equal(lib.duckPoints([{ start: 0, end: 3 }], 0.5, { duration: 10 })[0].v, 0.05, "narration from second 0 starts ducked");
});

test("loop: a short song repeats on 4-bar phrases with a crossfade; a long one plays once", () => {
  assert.equal(lib.loopPlan(479, 330).length, 1);
  const pieces = lib.loopPlan(60, 150, { bpm: 120, crossfade: 2 });
  // 4 bars at 120 bpm = 8 s; (60 - 2) / 8 → 7 phrases = 56 s per repeat
  assert.equal(pieces[1].start, 56);
  assert.equal(pieces[0].duration, 58);
  assert.equal(pieces[0].fadeOut, 2);
  assert.equal(pieces[1].fadeIn, 2);
  assert.ok(pieces.at(-1).start + pieces.at(-1).duration >= 150 - 1e-9);
  assert.equal(pieces.at(-1).fadeOut, 0);
  const shifted = lib.shiftEnvelope([{ t: 0, v: 1 }, { t: 10, v: 0 }], 5);
  assert.deepEqual(shifted, [{ t: 0, v: 0.5 }, { t: 5, v: 0 }]);
});

test("audition: one mix per candidate under the same narration; choose writes film.json only then", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "film-"));
  initFilm({ lang: "zh", format: "landscape", setting: "meeting-explainer" }, dir);
  const filmFile = path.join(dir, "film.json");
  assert.equal(JSON.parse(fs.readFileSync(filmFile, "utf8")).music, "none", "explainer init does not start from the synthesized score");
  const a = path.join(tmp, "a.mp3"), b = path.join(tmp, "b.mp3");
  fs.writeFileSync(a, "a"); fs.writeFileSync(b, "b");
  const ra = lib.addTrack(dir, a, { url: "https://x.test/a", author: "A", license: "L" });
  const calls = [];
  const out = path.join(tmp, "aud");
  const r = lib.auditionMusic({
    voices: [{ file: path.join(tmp, "vo.wav"), start: 0.5, offset: 0, length: 10, channels: 1 }],
    seconds: 40,
    candidates: [{ file: path.join(dir, ra.file), source: ra }, { file: b }],
    out,
    probe: (f) => (f === b ? 15 : 300),
    run: (args) => { calls.push(args); fs.writeFileSync(args.at(-1), "wav"); },
  });
  assert.equal(r.candidates.length, 2);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].join(" ").includes("volume="), "the music is enveloped (ducked)");
  assert.ok(r.candidates[1].loops > 0, "a 15 s song loops to cover 40 s");
  assert.match(fs.readFileSync(path.join(out, "index.html"), "utf8"), /UNREVIEWED/);
  assert.equal(JSON.parse(fs.readFileSync(filmFile, "utf8")).music, "none", "the audition writes nothing into film.json");
  assert.throws(() => lib.chooseMusic(out, "b", filmFile), /outside the project/);
  const c = lib.chooseMusic(out, "a", filmFile, { remember: true });
  assert.equal(c.music.file, "assets/music/a.mp3");
  assert.equal(JSON.parse(fs.readFileSync(filmFile, "utf8")).music.file, "assets/music/a.mp3");
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, "audition.json"), "utf8")).selected, "a");
  const cfg = JSON.parse(fs.readFileSync(process.env.MOTION_USE_CONFIG, "utf8"));
  assert.equal(cfg.music.track.url, "https://x.test/a");
  lib.writeMusicPreference({ style: "cafe jazz" });
  assert.equal(JSON.parse(fs.readFileSync(process.env.MOTION_USE_CONFIG, "utf8")).music.style, "cafe jazz");
});

test("validate: an explainer delivering synthesized music is a high warning; a feed film is not", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "val-"));
  initFilm({ lang: "zh", format: "landscape" }, dir);
  const data = JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8"));
  const has = (d, id) => validateFilm(d, dir).warnings.some((w) => w.message.includes(id));
  assert.ok(!has(data, "explainer-synth-music"));
  const explainer = { ...data, brief: { ...data.brief, setting: "course" } };
  assert.ok(has(explainer, "[high] explainer-synth-music"));
  assert.ok(!has({ ...explainer, music: { ...explainer.music, why: "deliberate chiptune lesson" } }, "explainer-synth-music"));
  assert.ok(has({ ...explainer, music: "none" }, "explainer-no-music"));
  assert.ok(validateFilm({ ...data, music: { file: "x.wav", duck: 5 } }, dir).errors.some((e) => e.path === "$.music.duck"));
});

// The envelope as both renderers play it: straight lines between points, held after the last.
const level = (env, t) => {
  if (t <= env[0].t) return env[0].v;
  for (let i = 1; i < env.length; i++)
    if (t <= env[i].t) return env[i - 1].v + ((env[i].v - env[i - 1].v) * (t - env[i - 1].t)) / Math.max(1e-9, env[i].t - env[i - 1].t);
  return env.at(-1).v;
};
// One narration clip as TTS reads it: 1 s of voice, a 0.6 s comma pause, 1 s of voice (8 kHz mono).
const RATE = 8000;
const pausedClip = () => {
  const s = new Float32Array(Math.round(2.6 * RATE));
  for (let i = 0; i < s.length; i++) {
    const t = i / RATE;
    s[i] = t >= 1 && t < 1.6 ? 0 : 0.3 * Math.sin(2 * Math.PI * 220 * t);
  }
  return s;
};
const clip = { file: "vo.wav", start: 2, offset: 0, length: 2.6 };
const decode = () => ({ samples: pausedClip(), rate: RATE });

test("sentence ducking (#130): a comma pause inside the clip keeps the music down, smooth ramps around it", () => {
  const s = lib.duckSettings(undefined);
  assert.deepEqual([s.mode, s.duckTo, s.attack, s.release], ["sentence", -20, 0.5, 0.9]);
  const windows = lib.duckWindows([clip], s, { decode: () => assert.fail("sentence mode does not read the signal") });
  const env = lib.duckPoints(windows, 0.6, { ...s, duration: 10 });
  const low = 0.6 * 10 ** (-20 / 20);
  for (let t = 2; t <= 4.6 + 1e-9; t += 0.01) assert.ok(level(env, t) <= low + 1e-9, `ducked at ${t.toFixed(2)} s: ${level(env, t)}`);
  assert.equal(level(env, 2 - 0.5), 0.6, "full until the attack starts 0.5 s before the clip");
  assert.ok(level(env, 1.75) < 0.6 && level(env, 1.75) > low, "ramps down over the attack, no step");
  assert.ok(level(env, 5.05) > low && level(env, 5.05) < 0.6, "ramps back over the release");
  assert.ok(Math.abs(level(env, 5.5) - 0.6) < 1e-9, "back up 0.9 s after the clip");
  for (let i = 1; i < env.length; i++) assert.ok(env[i].t > env[i - 1].t, "points in time order");
});

test("sentence ducking: a gap too short for release + attack stays down; a long pause lets it up", () => {
  const s = lib.duckSettings({ duckTo: -18, attack: 0.5, release: 0.9 });
  const env = lib.duckPoints([{ start: 1, end: 4 }, { start: 5, end: 8 }, { start: 12, end: 14 }], 0.5, { ...s, duration: 20 });
  const low = 0.5 * 10 ** (-18 / 20);
  for (let t = 1; t <= 8; t += 0.05) assert.ok(level(env, t) <= low + 1e-9, `1 s gap between sentences stays down at ${t.toFixed(2)}`);
  assert.equal(level(env, 10), 0.5, "a four-second pause lets the music back up");
  for (let i = 1; i < env.length; i++) assert.ok(env[i].t > env[i - 1].t, "no overlapping ramps");
});

test("signal ducking (optional): follows the voice level, so the music rises in the same pause", () => {
  const spans = lib.voicedSpans(pausedClip(), RATE, { threshold: -35 });
  assert.equal(spans.length, 2);
  assert.ok(Math.abs(spans[0].end - 1) < 0.03 && Math.abs(spans[1].start - 1.6) < 0.03, JSON.stringify(spans));
  const s = lib.duckSettings({ mode: "signal" });
  assert.deepEqual([s.attack, s.release, s.hold], [0.05, 0.6, 0]);
  const env = lib.duckPoints(lib.duckWindows([clip], s, { decode }), 0.6, { ...s, duration: 10 });
  const low = 0.6 * 10 ** (-20 / 20);
  assert.ok(level(env, 2.5) <= low + 1e-9, "down while speaking");
  assert.ok(level(env, 3.3) > low * 2, "up inside the comma pause");
  assert.ok(level(env, 4) <= low + 1e-9, "down again on the next word");
});

test("music.duck: a dB number or {mode, duckTo, attack, release}; bad keys are named", () => {
  assert.deepEqual(lib.duckProblems(-20), []);
  assert.deepEqual(lib.duckProblems({ mode: "signal", duckTo: -24, attack: 0.3, release: 1.2 }), []);
  assert.equal(lib.duckSettings(-14).duckTo, -14);
  assert.equal(lib.duckSettings(undefined, { file: false }).attack, 0.15, "an authored score keeps its short ramps");
  const paths = lib.duckProblems({ mode: "sidechain", duckTo: 3, atack: 1 }).map((p) => p.path);
  assert.deepEqual(paths, ["$.music.duck.mode", "$.music.duck.duckTo", "$.music.duck.atack"]);
  assert.ok(lib.duckProblems("loud").length);
  const dir = fs.mkdtempSync(path.join(tmp, "duckval-"));
  initFilm({ lang: "zh", format: "landscape" }, dir);
  const data = JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8"));
  assert.ok(validateFilm({ ...data, music: { file: "x.wav", duck: { release: -1 } } }, dir).errors.some((e) => e.path === "$.music.duck.release"));
});

test("audition ducks as the film will: its duck settings in the mix and report, and choose keeps them", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "film-duck-"));
  initFilm({ lang: "zh", format: "landscape", setting: "meeting-explainer" }, dir);
  const filmFile = path.join(dir, "film.json");
  const a = path.join(tmp, "duck-a.mp3");
  fs.writeFileSync(a, "a");
  const ra = lib.addTrack(dir, a, { url: "https://x.test/a", author: "A", license: "L" });
  const calls = [];
  const out = path.join(tmp, "aud-duck");
  const duck = { mode: "signal", duckTo: -26, release: 0.4 };
  const r = lib.auditionMusic({
    voices: [{ ...clip, file: path.join(tmp, "vo.wav"), channels: 1 }],
    seconds: 10, candidates: [{ file: path.join(dir, ra.file), source: ra }], out, volume: 0.5, duck, decode,
    probe: () => 300, run: (args) => { calls.push(args); fs.writeFileSync(args.at(-1), "wav"); },
  });
  assert.equal(r.duckDb, -26);
  assert.equal(r.duckSettings.mode, "signal");
  const expected = lib.duckPoints(lib.duckWindows([clip], lib.duckSettings(duck), { decode }), 0.5, { ...lib.duckSettings(duck), duration: 10 });
  assert.ok(expected.length > 6, "the pause shows in the envelope");
  assert.ok(calls[0].join(" ").includes(String(expected.at(-1).t).slice(0, 4)), "the mix uses the same envelope");
  assert.match(fs.readFileSync(path.join(out, "index.html"), "utf8"), /-26 dB.*signal/);
  const c = lib.chooseMusic(out, r.candidates[0].id, filmFile);
  assert.deepEqual(c.music.duck, duck, "the film mixes as the audition was heard");
  assert.equal(c.music.volume, 0.5, "a film without a music volume takes the one heard in the audition");
});

let ffmpeg = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { ffmpeg = false; }
test("build: a licensed song shorter than the film loops with crossfades, ducked and faded", { skip: !ffmpeg && "ffmpeg missing" }, async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "loop-"));
  initFilm({ lang: "zh", format: "landscape" }, dir);
  const filmFile = path.join(dir, "film.json");
  const data = JSON.parse(fs.readFileSync(filmFile, "utf8"));
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=4", "-ac", "2", path.join(dir, "song.wav")]);
  data.music = { file: "song.wav", volume: 0.5 };
  fs.writeFileSync(filmFile, JSON.stringify(data, null, 2));
  const c = checkFilm(dir);
  assert.ok(c.ok, JSON.stringify(c.report?.errors));
  const out = path.join(tmp, "out-build");
  const proj = await buildFilm(c.film, "zh", "landscape", out);
  const music = proj.mix.filter((m) => m.id.startsWith("film-music"));
  assert.ok(music.length > 1, "the 4 s song repeats to cover the film");
  assert.equal(music[0].fadeIn, lib.FILE_FADE.in);
  assert.equal(music.at(-1).fadeOut, lib.FILE_FADE.out);
  assert.ok(music[1].fadeIn > 0);
});

test("build: narration ducks the licensed track by sentence; mode signal lets it up in the pause", { skip: !ffmpeg && "ffmpeg missing" }, async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "duckbuild-"));
  initFilm({ lang: "zh", format: "landscape" }, dir);
  const filmFile = path.join(dir, "film.json");
  const data = JSON.parse(fs.readFileSync(filmFile, "utf8"));
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=220:duration=${data.duration}`, "-ac", "2", path.join(dir, "song.wav")]);
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc='if(between(t,1,1.6),0,0.3*sin(2*PI*330*t))':s=48000:d=2.6", path.join(dir, "vo.wav")]);
  const mixFor = async (duck, name) => {
    data.music = { file: "song.wav", volume: 0.5, ...(duck ? { duck } : {}) };
    data.audio = [{ file: "vo.wav", role: "voiceover", start: 1 }];
    data.voiceover = false;
    fs.writeFileSync(filmFile, JSON.stringify(data, null, 2));
    const c = checkFilm(dir);
    assert.ok(c.ok, JSON.stringify(c.report?.errors));
    const proj = await buildFilm(c.film, "zh", "landscape", path.join(tmp, name));
    return proj.mix.find((m) => m.id === "film-music").automation;
  };
  const low = 0.5 * 10 ** (-20 / 20);
  const sentence = await mixFor(undefined, "out-sentence");
  assert.ok(level(sentence, 2.3) <= low + 1e-9, "the 0.6 s pause inside the sentence stays ducked");
  const signal = await mixFor({ mode: "signal" }, "out-signal");
  assert.ok(level(signal, 2.3) > low * 2, "signal mode follows the voice and rises in the pause");
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateBrief } from "../src/brief.mjs";
import { resolveNarration } from "../src/film-voiceover.mjs";
import { probeSpeech } from "../src/tts-command.mjs";
import { applyVoiceProfile, bridgeSpeech, checkProfile, elevenBody, resetProviderCache } from "../src/tts-providers.mjs";
import { MANIFEST, deliveryFor, generateVoiceover, narrationFreshness, pauseFilter, speechWarnings, splitTake, takeText } from "../src/voiceover.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-v4-"));
const quiet = { MOTION_USE_KEYCHAIN: "0", MOTION_USE_CONFIG: path.join(tmp, "none.json"), ELEVENLABS_API_KEY: "k" };
const reply = (status, body = {}, bytes = new TextEncoder().encode("ID3fake")) => ({ status, ok: status >= 200 && status < 300, json: async () => body, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

// Run with a fake ElevenLabs: process.env carries a test key, fetch is replaced.
async function withFetch(fetch, run) {
  const saved = { ...process.env }, real = globalThis.fetch;
  Object.assign(process.env, quiet);
  resetProviderCache();
  globalThis.fetch = fetch;
  try { return await run(); } finally {
    globalThis.fetch = real;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    resetProviderCache();
  }
}

// Tone / silence pattern as a real MP3: [["tone", 1], ["silence", 0.6], ...].
function mp3(parts, file) {
  const inputs = parts.flatMap(([kind, d]) => ["-f", "lavfi", "-i", kind === "tone" ? `sine=f=440:d=${d}:sample_rate=44100` : `anullsrc=r=44100:cl=mono:d=${d}`]);
  const filter = parts.map((_, i) => `[${i}]`).join("") + `concat=n=${parts.length}:v=0:a=1`;
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", file]);
  assert.equal(r.status, 0, String(r.stderr));
  return fs.readFileSync(file);
}

// A character alignment laid out from [text, start, end] runs, one entry per character.
function align(runs) {
  const a = { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] };
  for (const [text, start, end] of runs) {
    const chars = [...text], step = (end - start) / chars.length;
    chars.forEach((c, i) => {
      a.characters.push(c);
      a.character_start_times_seconds.push(+(start + i * step).toFixed(3));
      a.character_end_times_seconds.push(+(start + (i + 1) * step).toFixed(3));
    });
  }
  return a;
}

test("eleven_v4 / v4_turbo / v3: no speed or style, stability and similarity passed through, language_code sent", () => {
  for (const model of ["eleven_v4", "eleven_v4_turbo", "eleven_v3"]) {
    const body = elevenBody({ text: "你好", model, rate: "+12%", stability: 0.5, similarity: 0.8, lang: "zh-CN" });
    assert.deepEqual(body, { text: "你好", model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.8 }, language_code: "zh" });
  }
  assert.deepEqual(elevenBody({ text: "x", model: "eleven_v4", rate: "+0%", lang: "en" }), { text: "x", model_id: "eleven_v4", language_code: "en" });
  // Older models keep the speed they honour, and no language_code.
  assert.deepEqual(elevenBody({ text: "x", model: "eleven_multilingual_v2", rate: "+10%", stability: 0.3, lang: "zh" }), { text: "x", model_id: "eleven_multilingual_v2", voice_settings: { speed: 1.1, stability: 0.3 } });
});

test("a rate on a tag model is a warning; delivery tags on a model that reads none are a warning", () => {
  const vo = { rates: { zh: "+12%", en: "+0%" } };
  const w = speechWarnings("elevenlabs", "eleven_v4", vo, ["zh", "en"]);
  assert.equal(w.length, 1);
  assert.match(w[0], /^zh: eleven_v4 does not take a speaking rate, so rate \+12% is not applied; change the speed afterwards/);
  assert.deepEqual(speechWarnings("elevenlabs", "eleven_v4", { rates: {} }, ["zh"]), []);
  assert.deepEqual(speechWarnings("openai", "gpt-4o-mini-tts", vo, ["zh"]), []);
  assert.match(speechWarnings("elevenlabs", "eleven_multilingual_v2", { rates: {} }, ["zh"], [{ delivery: "[curious]" }])[0], /delivery tags are not sent/);
});

test("the /with-timestamps request writes the decoded audio and returns the character alignment", async () => {
  const seen = [];
  const alignment = align([["你好。", 0, 0.6]]);
  const f = async (url, init) => (seen.push({ url, init }), reply(200, { audio_base64: Buffer.from("ID3take").toString("base64"), alignment }));
  const out = path.join(tmp, "take.mp3");
  const res = await bridgeSpeech("elevenlabs", { text: "你好。", voice: "v 1", model: "eleven_v4", rate: "+12%", lang: "zh", timestamps: true, out }, { fetch: f, cred: { key: "k" } });
  assert.match(seen[0].url, /text-to-speech\/v%201\/with-timestamps\?output_format=mp3_44100_128$/);
  assert.equal(seen[0].init.headers.Accept, "application/json");
  assert.equal(JSON.parse(seen[0].init.body).voice_settings, undefined);
  assert.equal(fs.readFileSync(out, "latin1"), "ID3take");
  assert.deepEqual(res.alignment, alignment);
  await assert.rejects(bridgeSpeech("elevenlabs", { text: "x", voice: "v", timestamps: true, out }, { fetch: async () => reply(200, { audio_base64: "" }), cred: { key: "k" } }), /no audio or no character alignment/);
  await assert.rejects(bridgeSpeech("openai", { text: "x", voice: "coral", timestamps: true, out }, { fetch: f, cred: { key: "k" } }), /needs elevenlabs/);
});

test("one-take cut points: a line ends after its last letter (not its punctuation) and never runs into the next line", () => {
  // ElevenLabs stretches "。" up to the next line's first word: 1.0–1.9 here, the next line starts at 1.9.
  const alignment = align([
    ["[calm] ", 0, 0.05],
    ["第一句", 0.1, 1.0], ["。", 1.0, 1.9], ["\n\n", 1.9, 1.9],
    ["第二句话", 1.9, 2.5], ["，", 2.5, 2.55], ["有逗号", 2.6, 3.0], ["！", 3.0, 3.6], ["\n\n", 3.6, 3.6],
    ["[softly] ", 3.6, 3.62],
    ["Last line 3", 3.65, 4.4], [".", 4.4, 4.9],
  ]);
  const spans = splitTake(alignment, ["第一句。", "第二句话，有逗号！", "Last line 3."]);
  assert.deepEqual(spans, [
    { start: 0, end: 1.15 },      // 第一句 ends at 1.0 (+0.15); the stretched 。 to 1.9 is left out
    { start: 1.8, end: 3.15 },    // starts 0.1 early, but never before 1.0, where 第一句 ends
    { start: 3.55, end: 4.55 },   // the "[softly]" tag and its letters are not a line's words
  ]);
  // The end is clamped to the next line's first letter when the padding would reach it.
  const tight = splitTake(align([["一二", 0, 1.0], ["。", 1.0, 1.05], ["三四", 1.05, 2]]), ["一二。", "三四"]);
  assert.deepEqual(tight, [{ start: 0, end: 1.05 }, { start: 1, end: 2 }]);
  // The last line ends at the audio duration when that comes first.
  assert.equal(splitTake(align([["一二", 0, 1.0]]), ["一二"], { duration: 1.05 })[0].end, 1.05);
  assert.throws(() => splitTake(alignment, ["第一句。", "另一句。", "Last line 3."]), /does not match line 2/);
  assert.throws(() => splitTake(alignment, ["第一句。", "第二句话，有逗号！"]), /speech after the last line/);
  assert.throws(() => splitTake({ characters: ["a"] }, ["a"]), /missing or differ in length/);
});

test("voice settings, delivery, take and maxPause are validated; delivery is never narration", () => {
  const v = (vo, scene = {}) => validateBrief({ version: 1, name: "t", languages: ["zh"], voiceover: vo, scenes: [{ id: "a", type: "title", title: "A", narration: "你好。", ...scene }] }, tmp);
  const ok = v({ engine: "elevenlabs", voices: { zh: "v" }, model: "eleven_v4", stability: 0.5, similarity: 0.8, delivery: "[calm, conversational]", take: "one", maxPause: 0.3 }, { delivery: "[curious]" });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual([ok.brief.voiceover.stability, ok.brief.voiceover.similarity, ok.brief.voiceover.delivery, ok.brief.voiceover.take, ok.brief.voiceover.maxPause], [0.5, 0.8, "[calm, conversational]", "one", 0.3]);
  assert.equal(ok.brief.scenes[0].delivery, "[curious]");
  assert.deepEqual(ok.brief.scenes[0].narration, { zh: "你好。" });
  const paths = (r) => r.errors.map((e) => e.path).sort();
  assert.deepEqual(paths(v({ engine: "openai", stability: 0.5, take: "one", delivery: "[x]" })), ["$.voiceover.delivery", "$.voiceover.stability", "$.voiceover.take"]);
  assert.deepEqual(paths(v({ engine: "elevenlabs", stability: 2, similarity: "high", take: "all", maxPause: 5 })), ["$.voiceover.maxPause", "$.voiceover.similarity", "$.voiceover.stability", "$.voiceover.take"]);
  assert.deepEqual(paths(v({ engine: "edge", maxPause: 0.3 }, { delivery: "spoken words" })), ["$.scenes[0].delivery"]);
  assert.deepEqual(paths(v({ engine: "elevenlabs", voices: { zh: "v" }, delivery: "[a] [b] [c] [d] [e]" })), ["$.voiceover.delivery"]);
});

test("profiles carry stability and similarity for elevenlabs only; the project still wins", () => {
  assert.deepEqual(checkProfile({ provider: "elevenlabs", voices: { zh: "v" }, model: "eleven_v4", stability: 0.5, similarity: 0.8 }), { provider: "elevenlabs", voices: { zh: "v" }, model: "eleven_v4", stability: 0.5, similarity: 0.8 });
  assert.throws(() => checkProfile({ provider: "openai", stability: 0.5 }), /only elevenlabs/);
  assert.throws(() => checkProfile({ provider: "elevenlabs", similarity: 1.5 }), /0 to 1/);
  const env = { MOTION_USE_CONFIG: path.join(tmp, "profiles.json") };
  fs.writeFileSync(env.MOTION_USE_CONFIG, JSON.stringify({ voiceProfile: "julia", voiceProfiles: { julia: { provider: "elevenlabs", voices: { zh: "j" }, model: "eleven_v4", stability: 0.5, similarity: 0.8 } } }));
  assert.deepEqual(applyVoiceProfile({ dir: "vo" }, env).vo, { dir: "vo", engine: "elevenlabs", voices: { zh: "j" }, model: "eleven_v4", stability: 0.5, similarity: 0.8 });
  assert.equal(applyVoiceProfile({ dir: "vo", stability: 0.3 }, env).vo.stability, 0.3);
});

test("film shots: delivery is spoken before the line and never captioned", () => {
  const dir = path.join(tmp, "film");
  fs.mkdirSync(dir, { recursive: true });
  const errors = [];
  const film = { dir, duration: 4, languages: ["zh"], voiceover: { dir: "voiceover", engine: "elevenlabs", voices: { zh: "v" }, model: "eleven_v4" },
    shots: [{ id: "a", start: 0, end: 2, narration: { zh: "第一句。" }, delivery: "[curious]" }, { id: "b", start: 2, end: 4, narration: { zh: "第二句。" }, delivery: "plain words" }] };
  const { plans } = resolveNarration(film, { error: (p, m) => errors.push(p) });
  assert.equal(plans[0].delivery, "[curious]");
  assert.deepEqual([plans[0].narration, plans[0].display], [{ zh: "第一句。" }, { zh: "第一句。" }]);
  assert.deepEqual(errors, ["$.shots.b.delivery"]);
  assert.equal(deliveryFor({ engine: "elevenlabs", model: "eleven_v4" }, "[curious]"), "[curious]");
  assert.equal(deliveryFor({ engine: "elevenlabs", model: "eleven_v4", delivery: "[calm]" }, undefined), "[calm]");
  assert.equal(deliveryFor({ engine: "elevenlabs", model: "eleven_v4", delivery: "[calm]", take: "one" }, "[curious]"), "[calm] [curious]");
  assert.equal(deliveryFor({ engine: "elevenlabs", model: "eleven_multilingual_v2" }, "[curious]"), "");
  assert.equal(takeText({ delivery: "[calm]" }, [{ text: "一。", delivery: "[curious]" }, { text: "二。" }]), "[calm] [curious] 一。\n\n二。");
});

const v4Brief = (dir, vo = {}, scenes) => {
  fs.mkdirSync(path.join(tmp, dir), { recursive: true });
  const r = validateBrief({ version: 1, name: "t", languages: ["zh"], voiceover: { dir, engine: "elevenlabs", voices: { zh: "v" }, model: "eleven_v4", rate: "+12%", ...vo },
    scenes: scenes ?? [{ id: "a", type: "title", title: "A", narration: "第一句。", delivery: "[curious]" }] }, tmp);
  assert.deepEqual(r.errors, []);
  return r.brief;
};

test("line mode: the tag is spoken, the manifest keeps the plain text, and a changed tag regenerates", async () => {
  const bodies = [];
  await withFetch(async (url, init) => (bodies.push(JSON.parse(init.body)), reply(200)), async () => {
    const logs = [];
    const res = await generateVoiceover(v4Brief("vo-line", { stability: 0.5, similarity: 0.8 }), { log: (m) => logs.push(m) });
    assert.equal(res.rows[0].status, "generated");
    assert.deepEqual(bodies[0], { text: "[curious] 第一句。", model_id: "eleven_v4", voice_settings: { stability: 0.5, similarity_boost: 0.8 }, language_code: "zh" });
    assert.match(res.warnings[0], /rate \+12% is not applied/);
    assert.ok(logs.some((l) => /^warning: zh: eleven_v4 does not take a speaking rate/.test(l)));
    const dir = path.join(tmp, "vo-line");
    const rec = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8"))[path.join("zh", "a.mp3")];
    assert.deepEqual([rec.text, rec.delivery, rec.stability, rec.similarity], ["第一句。", "[curious]", 0.5, 0.8]);
    const config = v4Brief("vo-line", { stability: 0.5, similarity: 0.8 }).voiceover;
    const file = path.join(dir, "zh", "a.mp3");
    assert.equal(narrationFreshness(dir, file, "第一句。", config, "zh", { delivery: "[curious]" }).current, true);
    assert.equal(narrationFreshness(dir, file, "第一句。", config, "zh", { delivery: "[sad]" }).current, false);
    assert.equal(narrationFreshness(dir, file, "第一句。", { ...config, stability: 0.3 }, "zh", { delivery: "[curious]" }).current, false);
    assert.equal((await generateVoiceover(v4Brief("vo-line", { stability: 0.5, similarity: 0.8 }))).rows[0].status, "unchanged");
    assert.equal(bodies.length, 1);
    const changed = await generateVoiceover(v4Brief("vo-line", { stability: 0.5, similarity: 0.8 }, [{ id: "a", type: "title", title: "A", narration: "第一句。", delivery: "[sad]" }]));
    assert.equal(changed.rows[0].status, "generated");
    assert.equal(bodies[1].text, "[sad] 第一句。");
  });
});

test("a manifest written before these settings existed stays current", () => {
  const dir = path.join(tmp, "vo-old");
  fs.mkdirSync(path.join(dir, "zh"), { recursive: true });
  const file = path.join(dir, "zh", "a.mp3");
  fs.writeFileSync(file, "old");
  const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify({ [path.join("zh", "a.mp3")]: { text: "你好。", engine: "elevenlabs", voice: "v", rate: "+0%", model: "eleven_v4", instructions: "", sha } }));
  const config = { engine: "elevenlabs", voices: { zh: "v" }, rates: {}, model: "eleven_v4", instructions: "" };
  assert.equal(narrationFreshness(dir, file, "你好。", config, "zh").current, true);
  assert.equal(narrationFreshness(dir, file, "你好。", { ...config, maxPause: 0.3 }, "zh").current, false);
});

test("one take: the whole script in one request, cut by character timing into scene clips", async () => {
  // 第一句 1.0 s, a 0.8 s pause that its "。" stretches over, then 第二句 1.0 s.
  const take = mp3([["tone", 1], ["silence", 0.8], ["tone", 1]], path.join(tmp, "take-src.mp3"));
  const alignment = align([["[calm] ", 0, 0.02], ["第一句", 0.02, 1.0], ["。", 1.0, 1.8], ["\n\n", 1.8, 1.8], ["第二句", 1.8, 2.8], ["。", 2.8, 2.8]]);
  const scenes = (second = "第二句。") => [{ id: "a", type: "title", title: "A", narration: "第一句。" }, { id: "b", type: "title", title: "B", narration: second, delivery: "[softly]" }];
  const requests = [], alignments = [alignment, alignment, align([["[calm] ", 0, 0.02], ["第一句", 0.02, 1.0], ["。", 1.0, 1.8], ["\n\n", 1.8, 1.8], ["[softly] ", 1.8, 1.8], ["又一句", 1.8, 2.8]])];
  await withFetch(async (url, init) => (requests.push({ url, body: JSON.parse(init.body) }), reply(200, { audio_base64: take.toString("base64"), alignment: alignments[requests.length - 1] })), async () => {
    const vo = { delivery: "[calm]", take: "one", stability: 0.5 };
    const res = await generateVoiceover(v4Brief("vo-take", vo, scenes()));
    assert.deepEqual(res.rows.map((r) => [r.scene, r.status]), [["a", "generated"], ["b", "generated"]]);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/with-timestamps\?/);
    assert.equal(requests[0].body.text, "[calm] 第一句。\n\n[softly] 第二句。");
    const dir = path.join(tmp, "vo-take");
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8"));
    assert.deepEqual(manifest[path.join("zh", "a.mp3")].takeSpan, { start: 0, end: 1.15 });
    assert.deepEqual(manifest[path.join("zh", "b.mp3")].takeSpan, { start: 1.7, end: 2.8 });
    assert.ok(Math.abs(probeSpeech(path.join(dir, "zh", "a.mp3")) - 1.15) < 0.06);
    assert.ok(Math.abs(probeSpeech(path.join(dir, "zh", "b.mp3")) - 1.1) < 0.08);
    assert.equal(fs.readdirSync(path.join(dir, "zh")).sort().join(), "a.mp3,b.mp3");
    assert.equal(manifest[path.join("zh", "a.mp3")].delivery, "[calm]");
    assert.equal(manifest[path.join("zh", "b.mp3")].delivery, "[calm] [softly]");
    // Nothing changed: no request.
    assert.deepEqual((await generateVoiceover(v4Brief("vo-take", vo, scenes()))).rows.map((r) => r.status), ["unchanged", "unchanged"]);
    assert.equal(requests.length, 1);
    // One line changed: the whole take is recorded again, so both clips come from one performance.
    // (The fake service returns the old alignment, which no longer matches: every clip fails, none is replaced.)
    const before = fs.readFileSync(path.join(dir, "zh", "a.mp3"));
    const failed = await generateVoiceover(v4Brief("vo-take", vo, scenes("别的句子。")));
    assert.equal(requests.length, 2);
    assert.ok(failed.rows.every((r) => r.status === "error" && /does not match line 2/.test(r.error)));
    assert.deepEqual(fs.readFileSync(path.join(dir, "zh", "a.mp3")), before);
    const again = await generateVoiceover(v4Brief("vo-take", vo, scenes("又一句。")));
    assert.deepEqual(again.rows.map((r) => r.status), ["generated", "generated"]);
    assert.equal(requests[2].body.text, "[calm] 第一句。\n\n[softly] 又一句。");
  });
});

test("maxPause shortens pauses inside a clip", async () => {
  assert.equal(pauseFilter(0.3), "silenceremove=stop_periods=-1:stop_duration=0.3:stop_threshold=-42dB");
  const audio = mp3([["tone", 0.5], ["silence", 1.2], ["tone", 0.5]], path.join(tmp, "pause-src.mp3"));
  await withFetch(async () => reply(200, {}, audio), async () => {
    const res = await generateVoiceover(v4Brief("vo-pause", { maxPause: 0.3, rate: "+0%" }));
    assert.equal(res.rows[0].status, "generated");
    const seconds = probeSpeech(path.join(tmp, "vo-pause", "zh", "a.mp3"));
    assert.ok(seconds > 1.1 && seconds < 1.5, `pause not shortened: ${seconds}s`);
    assert.equal(res.warnings, undefined);
  });
});

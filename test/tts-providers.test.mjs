import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateBrief } from "../src/brief.mjs";
import { generateVoiceover } from "../src/voiceover.mjs";
import {
  bridgeSpeech, chooseEngine, discoverProviders, rateToSpeed, readUserConfig, resetProviderCache,
  resolveVoice, validateProvider, writeUserVoice,
} from "../src/tts-providers.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-tts-"));
const quiet = { MOTION_USE_KEYCHAIN: "0", MOTION_USE_CONFIG: path.join(tmp, "none.json") };
const reply = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body, arrayBuffer: async () => new TextEncoder().encode("ID3fake").buffer });

test("providers are found in env, keychain and user config; secrets stay out of the source label", () => {
  const keychain = (s) => (s === "motion-use-elevenlabs" ? "kc-secret" : null);
  const found = discoverProviders({
    env: { ...quiet, AZURE_SPEECH_KEY: "env-secret", AZURE_SPEECH_REGION: "japaneast" }, keychain,
    config: { voiceover: { credentials: { minimax: { key: "cfg-secret" } } } },
  });
  assert.deepEqual(found.map((p) => [p.provider, p.source, p.complete]), [
    ["azure", "env AZURE_SPEECH_KEY", true], ["elevenlabs", "keychain motion-use-elevenlabs", true], ["minimax", "user config", true],
  ]);
  assert.ok(!JSON.stringify(found.map(({ cred, ...rest }) => rest)).includes("secret"));
  const half = discoverProviders({ env: { ...quiet, AZURE_SPEECH_KEY: "k" }, config: {} });
  assert.deepEqual(half[0].missing, ["region"]);
});

test("doctor's key check: 401/403 is a rejected key, 200 is accepted, network failure is unverified", async () => {
  const calls = [];
  const bad = await validateProvider("azure", { key: "k", region: "japaneast" }, { fetch: async (url, init) => (calls.push([url, init.method]), reply(401)) });
  assert.equal(bad.ok, false);
  assert.equal(bad.keyInvalid, true);
  assert.match(bad.detail, /key invalid \(HTTP 401\)/);
  assert.deepEqual(calls, [["https://japaneast.api.cognitive.microsoft.com/sts/v1.0/issueToken", "POST"]]);
  const good = await validateProvider("elevenlabs", { key: "k" }, { fetch: async (url) => (assert.match(url, /\/v1\/user\/subscription$/), reply(200, { tier: "creator", character_count: 10, character_limit: 100000 })) });
  assert.equal(good.ok, true);
  assert.match(good.detail, /tier creator/);
  assert.equal((await validateProvider("openai", { key: "k" }, { fetch: async () => reply(403) })).keyInvalid, true);
  assert.equal((await validateProvider("minimax", { key: "k" }, { fetch: async () => reply(200, { base_resp: { status_code: 1004 } }) })).keyInvalid, true);
  const off = await validateProvider("openai", { key: "k" }, { fetch: async () => { throw new TypeError("fetch failed"); } });
  assert.equal(off.ok, false);
  assert.ok(!off.keyInvalid);
});

test("engine choice: the user's pick, the only provider, ask when several, edge preview when none", () => {
  const p = (...names) => names.map((provider) => ({ provider, complete: true, source: "env" }));
  assert.equal(chooseEngine({ providers: p("azure", "elevenlabs"), config: { voiceover: { provider: "elevenlabs" } } }).engine, "elevenlabs");
  assert.equal(chooseEngine({ providers: p("elevenlabs"), config: {} }).engine, "elevenlabs");
  assert.throws(() => chooseEngine({ providers: p("azure", "elevenlabs"), config: {} }), (e) => e.choices.join() === "azure,elevenlabs" && /voiceover use/.test(e.message));
  const none = chooseEngine({ providers: [], config: {} });
  assert.equal(none.engine, "edge");
  assert.equal(none.preview, true);
});

test("voiceover use remembers provider and voice at user level", () => {
  const env = { MOTION_USE_CONFIG: path.join(tmp, "cfg", "config.json") };
  writeUserVoice({ provider: "elevenlabs", voices: { zh: "voice-zh" }, model: "eleven_v3" }, env);
  writeUserVoice({ provider: "elevenlabs", voices: { en: "voice-en" } }, env);
  const cfg = readUserConfig(env);
  assert.deepEqual(cfg.voiceover, { provider: "elevenlabs", voices: { zh: "voice-zh", en: "voice-en" }, model: "eleven_v3" });
  assert.equal(resolveVoice("elevenlabs", { voices: {} }, "zh", cfg), "voice-zh");
  assert.equal(resolveVoice("elevenlabs", { voices: { zh: "film" } }, "zh", cfg), "film");
  assert.equal(resolveVoice("azure", {}, "zh", cfg), "zh-CN-YunxiNeural");
  assert.throws(() => writeUserVoice({ provider: "nope" }, env), /unknown voiceover provider/);
});

test("built-in bridges map voice, model and rate onto each provider's API", async () => {
  const seen = [];
  const f = async (url, init) => (seen.push({ url, body: JSON.parse(init.body), headers: init.headers }), reply(200, { data: { audio: "494433" }, base_resp: { status_code: 0 } }));
  const out = path.join(tmp, "b.mp3");
  await bridgeSpeech("elevenlabs", { text: "你好", voice: "v1", rate: "+10%", out }, { fetch: f, cred: { key: "k" } });
  await bridgeSpeech("openai", { text: "hi", voice: "coral", instructions: "calm", rate: "-20%", out }, { fetch: f, cred: { key: "k" } });
  await bridgeSpeech("minimax", { text: "hi", voice: "male-qn-qingse", rate: "+0%", out }, { fetch: f, cred: { key: "k", groupId: "g" } });
  assert.match(seen[0].url, /text-to-speech\/v1\?output_format=mp3_44100_128/);
  assert.deepEqual([seen[0].body.model_id, seen[0].body.voice_settings.speed, seen[0].headers["xi-api-key"]], ["eleven_multilingual_v2", 1.1, "k"]);
  assert.deepEqual([seen[1].body.model, seen[1].body.voice, seen[1].body.instructions, seen[1].body.speed], ["gpt-4o-mini-tts", "coral", "calm", 0.8]);
  assert.match(seen[2].url, /t2a_v2\?GroupId=g$/);
  assert.equal(seen[2].body.voice_setting.voice_id, "male-qn-qingse");
  assert.equal(fs.readFileSync(out, "latin1"), "ID3");
  assert.equal(rateToSpeed("+90%", [0.7, 1.2]), 1.2);
});

test("a rejected key stops voiceover at the first line instead of failing every scene", async () => {
  const saved = { ...process.env };
  const real = globalThis.fetch;
  let calls = 0;
  Object.assign(process.env, quiet, { ELEVENLABS_API_KEY: "k" });
  resetProviderCache();
  globalThis.fetch = async () => (calls++, reply(401));
  try {
    fs.mkdirSync(path.join(tmp, "vo"), { recursive: true });
    const { brief, errors } = validateBrief({ version: 1, name: "t", languages: ["zh"], voiceover: { dir: "vo", engine: "elevenlabs", voices: { zh: "v1" } },
      scenes: [{ id: "a", type: "title", title: "A", narration: "一。" }, { id: "b", type: "title", title: "B", narration: "二。" }] }, tmp);
    assert.deepEqual(errors, []);
    const res = await generateVoiceover(brief);
    assert.equal(calls, 1);
    assert.equal(res.rows.length, 2);
    assert.ok(res.rows.every((r) => r.status === "error" && /key invalid \(HTTP 401\)/.test(r.error)));
    assert.match(res.keyInvalid, /ElevenLabs key invalid/);
  } finally {
    globalThis.fetch = real;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    resetProviderCache();
  }
});

test("edge output is labelled as a preview that cannot be delivered", async () => {
  const { brief } = validateBrief({ version: 1, name: "t", languages: ["zh"], voiceover: { dir: "vo", engine: "edge" }, scenes: [{ id: "a", type: "title", title: "A" }] }, tmp);
  const res = await generateVoiceover(brief);
  assert.equal(res.preview, true);
  assert.match(res.note, /预览声音，不能交付/);
});

test("built-in providers take provider voice IDs; only openai takes free-text instructions", () => {
  const v = (vo) => validateBrief({ version: 1, name: "t", languages: ["zh"], voiceover: { dir: "vo", ...vo }, scenes: [{ type: "title", title: "A" }] }, tmp).errors.map((e) => e.path);
  assert.deepEqual(v({ engine: "elevenlabs", voices: { zh: "JBFqnCBsd6RMkjVDRZzb" }, model: "eleven_v3" }), []);
  assert.deepEqual(v({ engine: "openai", voices: { zh: "coral" }, instructions: "像同事讲" }), []);
  assert.deepEqual(v({ engine: "minimax", instructions: "x" }), ["$.voiceover.instructions"]);
  assert.deepEqual(v({ engine: "azure", model: "x" }), ["$.voiceover.model"]);
});

// User-level voice profiles (#118): saved once, spoken by every project that does not choose its own.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-profiles-"));
const cfgFile = path.join(tmp, "config.json");
process.env.MOTION_USE_CONFIG = cfgFile;
process.env.MOTION_USE_KEYCHAIN = "0";

const { validateBrief } = await import("../src/brief.mjs");
const { generateVoiceover, readVoManifest } = await import("../src/voiceover.mjs");
const { applyVoiceProfile, credentialsFor, getProfile, listProfiles, readUserConfig, removeProfile, saveProfile, useProfile, writeUserVoice } = await import("../src/tts-providers.mjs");
const { resolvedVoice, createSnapshot, restoreSnapshot, findSnapshot } = await import("../src/snapshot.mjs");

const BIN = path.join(import.meta.dirname, "..", "bin", "motion-use.mjs");
const reset = () => fs.rmSync(cfgFile, { force: true });
const julia = { provider: "elevenlabs", model: "eleven_v4", voices: { zh: "julia-zh" }, rate: "+12%", key: { env: "JULIA_KEY" } };

test("profiles: save, list, default, use, remove; the key is only ever a name", () => {
  reset();
  saveProfile("julia", julia);
  saveProfile("calm", { provider: "openai", voices: { zh: "coral" }, instructions: "slow" });
  let l = listProfiles();
  assert.equal(l.default, "julia", "the first profile saved becomes the default");
  assert.deepEqual(Object.keys(l.profiles), ["julia", "calm"]);
  assert.equal(readUserConfig().voiceover.provider, "elevenlabs", "older callers see the default profile");
  useProfile("calm");
  assert.equal(listProfiles().default, "calm");
  removeProfile("calm");
  assert.equal(listProfiles().default, null);
  assert.throws(() => saveProfile("x", { provider: "elevenlabs", key: { env: "A", keychain: "b" } }), /never the key/);
  assert.throws(() => saveProfile("Bad Name", julia), /slugs/);
  assert.ok(!fs.readFileSync(cfgFile, "utf8").includes("secret"));
});

test("legacy `voiceover use` selection is read as the default profile and kept working", () => {
  fs.writeFileSync(cfgFile, JSON.stringify({ voiceover: { provider: "minimax", voices: { zh: "m1" }, credentials: { minimax: { key: "stored" } } } }));
  assert.equal(getProfile(null).name, "default");
  assert.equal(getProfile(null).provider, "minimax");
  const res = writeUserVoice({ provider: "minimax", voices: { en: "m2" } });
  assert.equal(res.profile, "default");
  const raw = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  assert.deepEqual(raw.voiceProfiles.default.voices, { zh: "m1", en: "m2" });
  assert.deepEqual(raw.voiceover, { credentials: { minimax: { key: "stored" } } }, "stored credentials survive");
});

test("a film without its own voice takes the default profile; the project still wins", () => {
  reset();
  saveProfile("julia", julia);
  const brief = (voiceover) => validateBrief({ version: 1, name: "t", languages: ["zh"], voiceover, scenes: [{ id: "a", type: "title", title: "A" }] }, tmp);
  const plain = brief({}).brief.voiceover;
  assert.equal(plain.engine, "elevenlabs");
  assert.equal(plain.voices.zh, "julia-zh");
  assert.equal(plain.model, "eleven_v4");
  assert.equal(plain.rates.zh, "+12%");
  assert.equal(plain.profile, "julia");
  assert.deepEqual(plain.keySource, { env: "JULIA_KEY" });
  const own = brief({ engine: "azure", voices: { zh: "zh-CN-XiaoxiaoNeural" } }).brief.voiceover;
  assert.equal(own.engine, "azure", "an explicit engine is never replaced by the profile");
  assert.equal(own.profile, undefined);
  const tweaked = brief({ profile: "julia", rate: "+0%" }).brief.voiceover;
  assert.equal(tweaked.rates.zh, "+0%");
  assert.equal(brief({ profile: false }).brief.voiceover.engine, null);
  assert.match(brief({ profile: "nobody" }).errors.map((e) => e.message).join(), /no voice profile "nobody"/);
  assert.match(applyVoiceProfile({ profile: "julia", engine: "openai" }).error, /drop one/);
});

test("generation reads the profile's key source and records resolved settings, not the profile name", async () => {
  reset();
  saveProfile("julia", julia);
  process.env.JULIA_KEY = "the-key";
  assert.equal(credentialsFor("elevenlabs", { keySource: { env: "JULIA_KEY" } }).key, "the-key");
  assert.throws(() => credentialsFor("elevenlabs", { keySource: { env: "NOPE_KEY" } }), /env NOPE_KEY, which is empty/);
  const dir = path.join(tmp, "vo");
  fs.mkdirSync(dir, { recursive: true });
  const checked = validateBrief({ version: 1, name: "t", languages: ["zh"], voiceover: { dir: "vo" }, scenes: [{ id: "a", type: "title", title: "A", narration: { zh: "你好" } }] }, tmp);
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (calls.push([url, init.headers["xi-api-key"], JSON.parse(init.body)]), { status: 200, ok: true, arrayBuffer: async () => new TextEncoder().encode("ID3fake").buffer });
  try {
    const res = await generateVoiceover(checked.brief);
    assert.equal(res.profile, "julia");
    assert.equal(res.rows[0].status, "generated");
  } finally { globalThis.fetch = real; }
  assert.match(calls[0][0], /text-to-speech\/julia-zh/);
  assert.equal(calls[0][1], "the-key");
  assert.equal(calls[0][2].model_id, "eleven_v4");
  const rec = readVoManifest(dir)["zh/a.mp3"];
  assert.deepEqual([rec.engine, rec.voice, rec.rate, rec.model], ["elevenlabs", "julia-zh", "+12%", "eleven_v4"]);
  assert.ok(!JSON.stringify(rec).includes("julia\""), "the manifest has no profile name");
  assert.ok(!JSON.stringify(rec).includes("the-key"));
});

test("a snapshot pins the voice the profile resolved to, so changing the profile later changes nothing", () => {
  const proj = path.join(tmp, "snap");
  fs.mkdirSync(proj, { recursive: true });
  const filmFile = path.join(proj, "film.json");
  fs.writeFileSync(filmFile, JSON.stringify({ voiceover: { dir: "voiceover", profile: "julia" } }));
  const film = { dir: proj, narrationConfig: { profile: "julia", engine: "elevenlabs", voices: { zh: "julia-zh" }, rates: { zh: "+40%" }, baseRates: { zh: "+12%" }, model: "eleven_v4" } };
  assert.deepEqual(resolvedVoice(film.narrationConfig), { profile: "julia", engine: "elevenlabs", voices: { zh: "julia-zh" }, rates: { zh: "+12%" }, model: "eleven_v4" });
  const out = path.join(proj, "out");
  const rec = createSnapshot(film, filmFile, out, { version: "t" });
  assert.equal(rec.voiceover.engine, "elevenlabs");
  const restored = JSON.parse(fs.readFileSync(restoreSnapshot(findSnapshot(rec.id, out)), "utf8"));
  assert.deepEqual(restored.voiceover, { dir: "voiceover", profile: false, engine: "elevenlabs", voices: { zh: "julia-zh" }, rate: { zh: "+12%" }, model: "eleven_v4" });
});

test("CLI: voice save turns an audition pick into the default; init references it", () => {
  reset();
  const aud = path.join(tmp, "aud");
  fs.mkdirSync(aud, { recursive: true });
  fs.writeFileSync(path.join(aud, "audition.json"), JSON.stringify({ version: 1, lang: "zh", candidates: [
    { id: "a", label: "Julia v4", engine: "elevenlabs", voice: "julia-zh", model: "eleven_v4", rate: "+12%", instructions: "", status: "generated" },
    { id: "b", label: "broken", engine: "openai", voice: "coral", status: "error", error: "x" },
  ] }));
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...process.env }, cwd: tmp });
  const bad = run("voice", "save", aud, "b", "--name", "x", "--json");
  assert.notEqual(bad.status, 0);
  const ok = run("voice", "save", aud, "a", "--name", "julia", "--key-keychain", "elevenlabs", "--json");
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.equal(JSON.parse(ok.stdout).default, "julia");
  assert.deepEqual(getProfile("julia"), { name: "julia", provider: "elevenlabs", voices: { zh: "julia-zh" }, model: "eleven_v4", rate: "+12%", key: { keychain: "elevenlabs" } });
  const list = run("voice", "list");
  assert.match(list.stdout, /\* julia/);
  const init = run("init", path.join(tmp, "newfilm"), "--json");
  assert.equal(init.status, 0, init.stderr + init.stdout);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, "newfilm", "film.json"), "utf8")).voiceover.profile, "julia");
  const none = run("init", path.join(tmp, "newfilm2"), "--voice-profile", "none", "--json");
  assert.equal(none.status, 0, none.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, "newfilm2", "film.json"), "utf8")).voiceover.profile, undefined);
});

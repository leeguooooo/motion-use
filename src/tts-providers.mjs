// Voiceover providers the user has configured on this machine, and the built-in bridges to them.
//
// Credentials are found, in order, in environment variables, the macOS keychain (generic
// passwords, by service name) and the user config file. They are never written into a film,
// a brief, the voiceover manifest or a report: only the *source* ("env AZURE_SPEECH_KEY",
// "keychain motion-use-elevenlabs") is ever shown.
//
// User config: $MOTION_USE_CONFIG, else $XDG_CONFIG_HOME/motion-use/config.json, else
// ~/.config/motion-use/config.json:
//   {"voiceover": {"provider": "elevenlabs", "voices": {"zh": "<voice id>"}, "model": "eleven_multilingual_v2",
//                  "credentials": {"minimax": {"key": "…", "groupId": "…"}}}}
// `provider`/`voices`/`model` are what `motion-use voiceover use` records; `credentials` is an
// optional fallback for machines without a keychain (keep the file private, chmod 600).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const PROVIDERS = {
  azure: {
    label: "Azure AI Speech",
    env: ["AZURE_SPEECH_KEY"],
    keychain: ["motion-use-azure", "azure-speech", "AZURE_SPEECH_KEY"],
    extra: { region: { env: ["AZURE_SPEECH_REGION"], keychain: ["motion-use-azure-region", "AZURE_SPEECH_REGION"] } },
    required: ["region"],
  },
  elevenlabs: {
    label: "ElevenLabs",
    env: ["ELEVENLABS_API_KEY", "ELEVEN_API_KEY", "XI_API_KEY"],
    keychain: ["motion-use-elevenlabs", "elevenlabs", "ElevenLabs", "ELEVENLABS_API_KEY"],
    model: "eleven_multilingual_v2",
  },
  minimax: {
    label: "MiniMax",
    env: ["MINIMAX_API_KEY"],
    keychain: ["motion-use-minimax", "minimax", "MiniMax", "MINIMAX_API_KEY"],
    extra: {
      groupId: { env: ["MINIMAX_GROUP_ID"], keychain: ["motion-use-minimax-group", "MINIMAX_GROUP_ID"] },
      host: { env: ["MINIMAX_API_HOST"], keychain: [] },
    },
    model: "speech-02-hd",
    voices: { zh: "male-qn-qingse", en: "English_Trustworth_Man" },
  },
  openai: {
    label: "OpenAI TTS",
    env: ["OPENAI_API_KEY"],
    keychain: ["motion-use-openai", "openai", "OpenAI", "OPENAI_API_KEY"],
    model: "gpt-4o-mini-tts",
    voices: { zh: "coral", en: "coral" },
  },
};
export const PROVIDER_NAMES = Object.keys(PROVIDERS);
export const PREVIEW_NOTE = "预览声音，不能交付 (edge-tts preview voice: not cleared for delivery)";

export function userConfigPath(env = process.env) {
  return env.MOTION_USE_CONFIG || path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "motion-use", "config.json");
}
export function readUserConfig(env = process.env) {
  try { return JSON.parse(fs.readFileSync(userConfigPath(env), "utf8")); } catch { return {}; }
}
export function writeUserVoice({ provider, voices = {}, model }, env = process.env) {
  if (!PROVIDER_NAMES.includes(provider) && provider !== "edge") throw new Error(`unknown voiceover provider "${provider}"; one of: ${[...PROVIDER_NAMES, "edge"].join(", ")}`);
  const file = userConfigPath(env);
  const cfg = readUserConfig(env);
  const prev = cfg.voiceover ?? {};
  const keep = prev.provider === provider;
  cfg.voiceover = { ...prev, provider, voices: { ...(keep ? prev.voices : {}), ...voices } };
  if (model) cfg.voiceover.model = model; else if (!keep) delete cfg.voiceover.model;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  return { file, voiceover: cfg.voiceover };
}

function keychainRead(service) {
  const r = spawnSync("security", ["find-generic-password", "-s", service, "-w"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
  return r.status === 0 ? r.stdout.trim() || null : null;
}
const keychainEnabled = (env) => process.platform === "darwin" && env.MOTION_USE_KEYCHAIN !== "0";

function find(spec, env, keychain, stored) {
  for (const k of spec.env ?? []) if (env[k]) return { value: env[k], source: `env ${k}` };
  if (keychain) for (const s of spec.keychain ?? []) { const v = keychain(s); if (v) return { value: v, source: `keychain ${s}` }; }
  if (stored) return { value: stored, source: "user config" };
  return null;
}

/**
 * Every provider with a key on this machine. Returns [{ provider, label, source, complete, missing, cred }].
 * `cred` holds the secret and must not be printed or serialized.
 */
let cache = null;
export function discoverProviders({ env = process.env, keychain, config } = {}) {
  const useCache = !keychain && !config && env === process.env;
  if (useCache && cache) return cache;
  keychain ??= keychainEnabled(env) ? keychainRead : null;
  config ??= readUserConfig(env);
  const stored = config.voiceover?.credentials ?? {};
  const out = [];
  for (const [name, spec] of Object.entries(PROVIDERS)) {
    const key = find(spec, env, keychain, stored[name]?.key);
    if (!key) continue;
    const cred = { key: key.value };
    for (const [field, fspec] of Object.entries(spec.extra ?? {})) {
      const v = find(fspec, env, keychain, stored[name]?.[field]);
      if (v) cred[field] = v.value;
    }
    const missing = (spec.required ?? []).filter((f) => !cred[f]);
    out.push({ provider: name, label: spec.label, source: key.source, complete: !missing.length, missing, cred });
  }
  if (useCache) cache = out;
  return out;
}
export function resetProviderCache() { cache = null; }
export function credentialsFor(provider, opts) {
  const p = discoverProviders(opts).find((d) => d.provider === provider);
  if (!p) throw new Error(`${provider} is not configured: ${configureHint(provider)}`);
  if (!p.complete) throw new Error(`${provider} is missing ${p.missing.join(", ")}: ${configureHint(provider)}`);
  return p.cred;
}
export function configureHint(provider) {
  const s = PROVIDERS[provider];
  if (!s) return "";
  const extra = Object.values(s.extra ?? {}).filter((e) => e.env?.length).map((e) => e.env[0]);
  return `set ${[s.env[0], ...(s.required ?? []).map((f) => s.extra[f].env[0])].join(" and ")}${extra.length && !s.required ? ` (optional ${extra.join(", ")})` : ""}, or store the key in the keychain: security add-generic-password -s ${s.keychain[0]} -a motion-use -w`;
}

export class KeyInvalidError extends Error {
  constructor(provider, status) {
    super(`${PROVIDERS[provider]?.label ?? provider} key invalid (HTTP ${status}): the configured key was rejected; replace it (${configureHint(provider)}) and run motion-use doctor`);
    this.keyInvalid = true; this.provider = provider; this.status = status;
  }
}
const authFail = (status) => status === 401 || status === 403;

const minimaxHost = (cred) => (cred.host || "https://api.minimax.io").replace(/\/$/, "");

/** A request that costs nothing, to prove the key works. → { ok, status, detail } */
export async function validateProvider(provider, cred, { fetch: f = fetch, timeout = 8000 } = {}) {
  const signal = AbortSignal.timeout(timeout);
  let res;
  try {
    if (provider === "azure")
      res = await f(`https://${cred.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": cred.key, "Content-Length": "0" }, signal });
    else if (provider === "elevenlabs")
      res = await f("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": cred.key }, signal });
    else if (provider === "openai")
      res = await f("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${cred.key}` }, signal });
    else if (provider === "minimax")
      res = await f(`${minimaxHost(cred)}/v1/get_voice`, { method: "POST", headers: { Authorization: `Bearer ${cred.key}`, "Content-Type": "application/json" }, body: JSON.stringify({ voice_type: "system" }), signal });
    else throw new Error(`unknown provider ${provider}`);
  } catch (e) {
    return { ok: false, status: null, detail: `could not reach ${PROVIDERS[provider]?.label ?? provider} (${e.name === "TimeoutError" ? "timeout" : "network error"}); key not verified` };
  }
  if (authFail(res.status)) return { ok: false, status: res.status, keyInvalid: true, detail: new KeyInvalidError(provider, res.status).message };
  if (!res.ok) return { ok: false, status: res.status, detail: `${PROVIDERS[provider].label} answered HTTP ${res.status}; key not verified` };
  if (provider === "minimax") {
    const body = await res.json().catch(() => ({}));
    const code = body?.base_resp?.status_code;
    if (code === 1004 || code === 2049) return { ok: false, status: res.status, keyInvalid: true, detail: new KeyInvalidError(provider, `${res.status}/${code}`).message };
  }
  let detail = "key accepted";
  if (provider === "elevenlabs") {
    const body = await res.json().catch(() => null);
    if (body?.tier) detail += `; tier ${body.tier}${Number.isFinite(body.character_limit) ? `, ${body.character_count ?? 0}/${body.character_limit} characters used` : ""}`;
  }
  if (provider === "azure") detail += `; region ${cred.region}`;
  return { ok: true, status: res.status, detail };
}

/** "+8%" → 1.08, clamped to what the provider accepts. */
export function rateToSpeed(rate = "+0%", [lo, hi] = [0.5, 2]) {
  const n = 1 + Number(String(rate).replace("%", "")) / 100;
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? +n.toFixed(2) : 1));
}

/** Speak one line through a built-in bridge into `out` (MP3). */
export async function bridgeSpeech(provider, { text, voice, model, instructions = "", rate, out }, { fetch: f = fetch, cred } = {}) {
  cred ??= credentialsFor(provider);
  const signal = AbortSignal.timeout(120000);
  model ||= PROVIDERS[provider].model;
  let res;
  if (provider === "elevenlabs")
    res = await f(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST", signal, headers: { "xi-api-key": cred.key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: model, voice_settings: { speed: rateToSpeed(rate, [0.7, 1.2]) } }),
    });
  else if (provider === "openai")
    res = await f("https://api.openai.com/v1/audio/speech", {
      method: "POST", signal, headers: { Authorization: `Bearer ${cred.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, voice, input: text, response_format: "mp3", speed: rateToSpeed(rate, [0.25, 4]), ...(instructions ? { instructions } : {}) }),
    });
  else if (provider === "minimax")
    res = await f(`${minimaxHost(cred)}/v1/t2a_v2${cred.groupId ? `?GroupId=${encodeURIComponent(cred.groupId)}` : ""}`, {
      method: "POST", signal, headers: { Authorization: `Bearer ${cred.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, text, stream: false, voice_setting: { voice_id: voice, speed: rateToSpeed(rate, [0.5, 2]) }, audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 } }),
    });
  else throw new Error(`no built-in bridge for ${provider}`);
  if (authFail(res.status)) throw new KeyInvalidError(provider, res.status);
  if (!res.ok) throw new Error(`${PROVIDERS[provider].label} returned ${res.status}`);
  if (provider === "minimax") {
    const body = await res.json();
    const code = body?.base_resp?.status_code;
    if (code === 1004 || code === 2049) throw new KeyInvalidError(provider, `${res.status}/${code}`);
    if (code === 1002 || code === 1039) throw new Error(`MiniMax returned 429 (status ${code}); rate limited`);
    if (code) throw new Error(`MiniMax returned status ${code}`);
    if (!body?.data?.audio) throw new Error("MiniMax returned no audio");
    fs.writeFileSync(out, Buffer.from(body.data.audio, "hex"));
  } else fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

/**
 * Which engine to speak with when the film/brief does not name one.
 * user-selected provider → the only configured provider → (several: ask) → edge preview.
 */
export function chooseEngine({ providers = discoverProviders(), config = readUserConfig() } = {}) {
  const chosen = config.voiceover?.provider;
  if (chosen) return { engine: chosen, reason: "user config" };
  const usable = providers.filter((p) => p.complete);
  if (usable.length === 1) return { engine: usable[0].provider, reason: `only configured provider (${usable[0].source})` };
  if (usable.length > 1) {
    const e = new Error(`several voiceover providers are configured (${usable.map((p) => p.provider).join(", ")}); choose one: motion-use voiceover use <${usable.map((p) => p.provider).join("|")}> --voice <id> (remembered for every project), or pass --engine`);
    e.choices = usable.map((p) => p.provider);
    throw e;
  }
  return { engine: "edge", reason: "no voiceover provider configured", preview: true };
}

/** The voice for a language: film/brief → user config (same provider) → provider default. */
export function resolveVoice(engine, vo = {}, lang, config = readUserConfig()) {
  if (vo.voices?.[lang]) return vo.voices[lang];
  const user = config.voiceover;
  if (user?.provider === engine && user.voices?.[lang]) return user.voices[lang];
  if (engine === "command") return null;
  if (engine === "azure" || engine === "edge") return { zh: "zh-CN-YunxiNeural", en: "en-US-AndrewMultilingualNeural" }[lang] ?? null;
  return PROVIDERS[engine]?.voices?.[lang] ?? null;
}
export function resolveModel(engine, vo = {}, config = readUserConfig()) {
  if (vo.model) return vo.model;
  if (config.voiceover?.provider === engine && config.voiceover.model) return config.voiceover.model;
  return PROVIDERS[engine]?.model ?? null;
}

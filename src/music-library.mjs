// Licensed background music for films heard as a person presenting (review meetings, lessons,
// tech reviews): a search plan per setting, a source record for every imported track, an
// audition against the film's own narration, the ducking and phrase-aligned looping the mix uses,
// and a user-level remembered preference. The synthesized score stays for short, beat-synced films.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { readUserConfig, userConfigPath } from "./tts-providers.mjs";
import { mixArgs } from "./mix.mjs";

/** Settings where narration runs from start to end and the music is only a low bed. */
export const EXPLAINER_SETTINGS = new Set(["meeting-explainer", "course", "tech-review"]);
export const isExplainer = (setting) => EXPLAINER_SETTINGS.has(setting);

/**
 * How music ducks under narration. "sentence" (the default) holds the bed down for each
 * narration clip's whole span, start to end: pauses inside a sentence and between close sentences
 * never let it back up, so the voice does not seem to cut out (#130). The ramp starts `attack`
 * seconds before the first word and rises over `release` seconds after the last. "signal" follows
 * the narration's level instead (a sidechain baked into the same envelope): the music rises in every
 * pause quieter than `threshold` dBFS.
 */
export const DUCK_MODES = ["sentence", "signal"];
export const DUCK_DEFAULTS = {
  file: { mode: "sentence", duckTo: -20, attack: 0.5, release: 0.9, hold: 0.8, threshold: -35 },
  score: { mode: "sentence", duckTo: -12, attack: 0.15, release: 0.2, hold: 0.2, threshold: -35 },
  // A sidechain reacts to the voice itself: a fast attack, a 0.6 s release, no hold.
  signal: { attack: 0.05, release: 0.6, hold: 0 },
};
const DUCK_RANGES = { duckTo: [-40, 0, "dB the music drops under narration"], attack: [0, 5, "seconds the music takes to go down before the voice"], release: [0, 10, "seconds the music takes to come back after the voice"], hold: [0, 10, "gaps between narration windows shorter than this stay ducked"], threshold: [-80, -10, "signal mode: dBFS below which the narration counts as a pause"] };
/** Default level of licensed music under narration, and the mix shape around it. */
export const DUCK_DB = { file: DUCK_DEFAULTS.file.duckTo, score: DUCK_DEFAULTS.score.duckTo };
export const FILE_FADE = { in: 1.5, out: 2.5 };
export const LOOP_CROSSFADE = 2;

const EXPLAINER_QUERIES = [
  { style: "cafe jazz", query: "cafe jazz background instrumental no vocals" },
  { style: "lo-fi", query: "lofi calm study instrumental no vocals" },
  { style: "light piano", query: "minimal piano background calm" },
  { style: "light corporate", query: "soft corporate background ambient no drums" },
];
const PLANS = {
  "meeting-explainer": EXPLAINER_QUERIES,
  "tech-review": EXPLAINER_QUERIES,
  course: [
    { style: "light piano", query: "minimal piano background calm" },
    { style: "lo-fi", query: "lofi calm study instrumental no vocals" },
    { style: "acoustic", query: "soft acoustic guitar background instrumental" },
  ],
  launch: [
    { style: "uplifting electronic", query: "uplifting electronic instrumental build" },
    { style: "modern corporate", query: "modern corporate upbeat instrumental" },
  ],
  "feed-short": [
    { style: "punchy electronic", query: "short energetic electronic beat instrumental" },
  ],
};
export const LICENSE_CHECKS = [
  "open the track's detail page, not a search result; record the detail URL and the creator",
  "read the licence on that page: use in a film allowed, credit required or not, no standalone resale",
  "no vocals and no dense drums under continuous narration",
  "Content ID registered tracks: keep the licence certificate with the project",
  "record the file with motion-use music add (URL, creator, licence, SHA-256)",
];

/** The search plan for a setting: styles and queries, the user's remembered style first. */
export function musicPlan(setting, config = readUserConfig()) {
  const pref = config.music ?? {};
  let rows = [...(PLANS[setting] ?? PLANS["feed-short"])];
  if (pref.style) {
    const hit = rows.find((r) => r.style === pref.style);
    rows = [hit ?? { style: pref.style, query: `${pref.style} background instrumental no vocals` }, ...rows.filter((r) => r !== hit)];
  }
  const explainer = isExplainer(setting);
  return {
    setting,
    route: explainer ? "licensed-track" : "score-or-licensed",
    why: explainer
      ? "narration runs end to end: a licensed recorded track sits under it; a synthesized pad held for minutes sounds thin and tiring"
      : "short and cut to picture: an authored score (composition/score.js) can hit picture events; a licensed track also works",
    queries: rows.map((r) => ({ ...r, routes: [`chrome-use site pixabay/music "${r.query}"`, `chrome-use search 'site:pixabay.com/music ${r.query}' --count 5 --json`] })),
    candidates: "pick 3–5 tracks; prefer one long enough to cover the film (no loop)",
    checks: LICENSE_CHECKS,
    preferred: pref.track ?? null,
    next: ["motion-use music add <file> --url <detail-page> --author <name> --license <licence>", "motion-use music audition <film> <a> <b> … --out <fresh-dir>", "motion-use music choose <audition-dir> <id> [film]"],
  };
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "track";
const SOURCES_JSON = path.join("assets", "music", "sources.json");

export function readMusicSources(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, SOURCES_JSON), "utf8"));
  } catch {
    return { version: 1, tracks: [] };
  }
}

/**
 * Copy a downloaded track into assets/music/, hash it and record where it came from in
 * assets/music/sources.json and SOURCES.md. Refuses without a detail URL, creator and licence.
 */
export function addTrack(dir, file, { url, author, license, title, probe } = {}) {
  if (!file || !fs.existsSync(file)) throw new Error(`music add: no such file ${file ?? ""}`);
  const missing = [["--url", url], ["--author", author], ["--license", license]].filter(([, v]) => typeof v !== "string" || !v.trim()).map(([k]) => k);
  if (missing.length) throw new Error(`music add needs ${missing.join(", ")}: a track without a source record cannot be delivered`);
  if (!/^https?:\/\//.test(url)) throw new Error("--url: the track's detail page (http/https)");
  const destDir = path.join(dir, "assets", "music");
  fs.mkdirSync(destDir, { recursive: true });
  const name = slug(path.basename(file));
  const dest = path.join(destDir, name);
  if (path.resolve(file) !== path.resolve(dest)) fs.copyFileSync(file, dest);
  const rel = path.relative(dir, dest).split(path.sep).join("/");
  let seconds = null;
  try { seconds = probe ? probe(dest) : null; } catch { seconds = null; }
  const rec = { file: rel, title: title ?? path.basename(file), url, author, license, sha256: sha256(dest), seconds, added: new Date().toISOString().slice(0, 10), listeningReview: "UNREVIEWED" };
  const src = readMusicSources(dir);
  src.tracks = [...src.tracks.filter((t) => t.file !== rel), rec];
  fs.writeFileSync(path.join(dir, SOURCES_JSON), JSON.stringify(src, null, 2) + "\n");
  const md = path.join(dir, "SOURCES.md");
  const header = "\n## Music tracks (motion-use music add)\n\n| Local file / SHA-256 | Title | Creator / detail-page URL | Licence / date checked | Seconds |\n|---|---|---|---|---|\n";
  let text = fs.existsSync(md) ? fs.readFileSync(md, "utf8") : "# Source selection\n";
  if (!text.includes("## Music tracks (motion-use music add)")) text = text.replace(/\n*$/, "\n") + header;
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  text = text.replace(/\n*$/, "\n") + `| ${cell(rel)} / ${rec.sha256} | ${cell(rec.title)} | ${cell(author)} / ${cell(url)} | ${cell(license)} / ${rec.added} | ${seconds == null ? "?" : seconds.toFixed(1)} |\n`;
  fs.writeFileSync(md, text);
  return rec;
}

/** Problems with a film's music.duck: a dB number, or {mode, duckTo, attack, release, hold, threshold}. */
export function duckProblems(duck, at = "$.music.duck") {
  const fin = (x, lo, hi) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
  if (duck === undefined) return [];
  if (typeof duck === "number")
    return fin(duck, -40, 0) ? [] : [{ path: at, message: "dB the music drops under narration, -40–0 (or an object {mode, duckTo, attack, release})" }];
  if (!duck || typeof duck !== "object" || Array.isArray(duck))
    return [{ path: at, message: "a dB number (-40–0) or an object {mode, duckTo, attack, release, hold, threshold}" }];
  const out = [];
  for (const [k, v] of Object.entries(duck)) {
    if (k === "mode") {
      if (!DUCK_MODES.includes(v)) out.push({ path: `${at}.mode`, message: `${DUCK_MODES.join(" or ")} (sentence: down for each whole narration clip; signal: follows the voice level)` });
    } else if (DUCK_RANGES[k]) {
      const [lo, hi, what] = DUCK_RANGES[k];
      if (!fin(v, lo, hi)) out.push({ path: `${at}.${k}`, message: `${what}, ${lo}–${hi}` });
    } else out.push({ path: `${at}.${k}`, message: `unknown key; use mode, ${Object.keys(DUCK_RANGES).join(", ")}` });
  }
  return out;
}

/**
 * The ducking a film's music gets: defaults for an imported track (`file`) or an authored score,
 * the signal-mode ramps when mode is "signal", then what music.duck sets (a number is duckTo).
 */
export function duckSettings(duck, { file = true } = {}) {
  const given = typeof duck === "number" ? { duckTo: duck } : duck && typeof duck === "object" ? duck : {};
  const set = Object.fromEntries(Object.entries(given).filter(([k, v]) => v !== undefined && (k === "mode" || DUCK_RANGES[k])));
  const base = DUCK_DEFAULTS[file ? "file" : "score"];
  return { ...base, ...(set.mode === "signal" ? DUCK_DEFAULTS.signal : {}), ...set };
}

/**
 * Where narration is speaking within one clip's samples (mono, `rate` Hz), in seconds from the
 * clip's start: frames of `frame` seconds louder than `threshold` dBFS, gaps shorter than
 * `minGap` joined, blips shorter than `minSpeech` dropped. This is what a sidechain listens to.
 */
export function voicedSpans(samples, rate, { threshold = DUCK_DEFAULTS.file.threshold, frame = 0.02, minGap = 0.1, minSpeech = 0.05 } = {}) {
  const n = Math.max(1, Math.round(frame * rate));
  const floor = 10 ** (threshold / 20);
  const spans = [];
  for (let i = 0; i < samples.length; i += n) {
    let sum = 0;
    const end = Math.min(samples.length, i + n);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    if (Math.sqrt(sum / (end - i)) < floor) continue;
    const s = i / rate, e = end / rate, prev = spans.at(-1);
    if (prev && s - prev.end < minGap) prev.end = e;
    else spans.push({ start: s, end: e });
  }
  return spans.filter((w) => w.end - w.start >= minSpeech);
}

/** One narration clip decoded to mono 8 kHz float samples (ffmpeg), for signal-mode ducking. */
export function decodeMono(file, { offset = 0, length, rate = 8000 } = {}) {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-ss", String(offset), ...(length ? ["-t", String(length)] : []), "-i", file, "-ac", "1", "-ar", String(rate), "-f", "f32le", "-"], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30 });
  return { samples: new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)), rate };
}

/**
 * The narration windows the music ducks under, in film time, from voiceover clips
 * ({file, start, offset, length}): each whole clip in sentence mode; in signal mode the spans
 * where the clip is actually voiced (`decode` reads its samples).
 */
export function duckWindows(voices, settings, { decode = decodeMono } = {}) {
  if (settings.mode !== "signal") return voices.map((v) => ({ start: v.start, end: v.start + v.length }));
  const out = [];
  for (const v of voices) {
    const { samples, rate } = decode(v.file, { offset: v.offset ?? 0, length: v.length });
    for (const w of voicedSpans(samples, rate, { threshold: settings.threshold }))
      if (w.start < v.length) out.push({ start: v.start + w.start, end: v.start + Math.min(w.end, v.length) });
  }
  return out;
}

/**
 * The music's volume over film time under narration windows: down to `duckTo` dB below
 * `volume` from each window's start to its end, a straight ramp over `attack` seconds before it
 * and `release` seconds after it. Windows closer than `hold` join. In sentence mode a gap too short
 * for the music to come all the way back (attack + release) also stays down, so the bed never
 * half-rises between sentences; in signal mode it rises as far as the gap allows, as a compressor would.
 */
export function duckPoints(voices, volume, options = {}) {
  const s = { ...DUCK_DEFAULTS.file, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) };
  const db = options.duckTo ?? options.db ?? DUCK_DEFAULTS.file.duckTo;
  const { attack, release, duration } = s;
  const low = volume * 10 ** (db / 20);
  const join = s.mode === "signal" ? s.hold : Math.max(s.hold, attack + release);
  const windows = [];
  for (const a of [...voices].filter((w) => w.end > w.start).sort((x, y) => x.start - y.start)) {
    const prev = windows.at(-1);
    if (prev && a.start <= prev.end + join) prev.end = Math.max(prev.end, a.end);
    else windows.push({ start: a.start, end: a.end });
  }
  if (!windows.length) return [{ t: 0, v: volume }];
  const rise = (dt, over) => (over > 0 ? Math.min(1, dt / over) : 1);
  const points = [];
  windows.forEach((w, i) => {
    const prev = windows[i - 1];
    if (!prev) {
      // Before the first window: full, then the attack ramp (already part-way down at second 0
      // when the narration starts within the attack).
      if (w.start - attack > 0) points.push({ t: 0, v: volume }, { t: w.start - attack, v: volume });
      else points.push({ t: 0, v: low + (volume - low) * rise(w.start, attack) });
    } else {
      const gap = w.start - prev.end;
      if (gap >= attack + release) points.push({ t: prev.end + release, v: volume }, { t: w.start - attack, v: volume });
      else {
        // Release and attack meet before the music is back up (signal mode only): their crossing.
        const k = attack + release > 0 ? gap / (attack + release) : 1;
        points.push({ t: prev.end + gap * (release / Math.max(1e-9, attack + release)), v: low + (volume - low) * k });
      }
    }
    points.push({ t: w.start, v: low }, { t: w.end, v: low });
  });
  const last = windows.at(-1);
  const end = duration ?? last.end + release;
  if (end > last.end) points.push(end >= last.end + release ? { t: last.end + release, v: volume } : { t: end, v: low + (volume - low) * rise(end - last.end, release) });
  const out = [];
  for (const p of points)
    if (out.length && Math.abs(out.at(-1).t - p.t) < 1e-9) out.at(-1).v = p.v;
    else out.push(p);
  return out;
}

/** An envelope in film time moved into a clip that starts at `start` (value at its start interpolated). */
export function shiftEnvelope(points, start) {
  if (!start) return points;
  let v0 = points[0].v;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[i + 1];
    if (a.t <= start) v0 = !b || b.t <= start ? a.v : a.v + ((b.v - a.v) * (start - a.t)) / Math.max(1e-9, b.t - a.t);
  }
  return [{ t: 0, v: v0 }, ...points.filter((q) => q.t > start).map((q) => ({ t: q.t - start, v: q.v }))];
}

/**
 * Pieces that cover `total` seconds of film from a song of `songSeconds` starting at `from`:
 * each repeat is cut on a phrase boundary (4 bars at `bpm`, else 8-second blocks) and overlaps
 * the previous one by `crossfade` seconds. One piece when the song is long enough.
 */
export function loopPlan(songSeconds, total, { from = 0, bpm, crossfade = LOOP_CROSSFADE } = {}) {
  const avail = songSeconds - from;
  if (!(avail > 0)) throw new Error("the song is shorter than its start offset");
  if (avail >= total) return [{ start: 0, mediaStart: from, duration: total, fadeIn: 0, fadeOut: 0 }];
  const phrase = bpm ? (4 * 4 * 60) / bpm : 8;
  let body = Math.floor((avail - crossfade) / phrase) * phrase;
  if (body < phrase) body = Math.max(1, avail - crossfade);
  const len = body + crossfade;
  const pieces = [];
  for (let start = 0, i = 0; start < total; start += body, i++) {
    const duration = Math.min(len, total - start);
    pieces.push({ start, mediaStart: from, duration, fadeIn: i ? crossfade : 0, fadeOut: start + len < total ? crossfade : 0 });
  }
  return pieces;
}

/** Remembered music preference at user level (~/.config/motion-use/config.json "music"). */
export function writeMusicPreference(patch, env = process.env) {
  const file = userConfigPath(env);
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  raw.music = { ...(raw.music ?? {}), ...patch };
  for (const k of Object.keys(raw.music)) if (raw.music[k] == null) delete raw.music[k];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n", { mode: 0o600 });
  return { file, music: raw.music };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Mix the same narration excerpt (`voices`: [{file, start, offset, length}] within `seconds`)
 * with each candidate track, ducked as the film will be (`duck`: the film's music.duck with any
 * audition overrides, the same settings the render resolves), into a fresh directory with a
 * listening page. Nothing is written into film.json: `music choose` does that after someone listens.
 */
export function auditionMusic({ voices, seconds = 40, candidates, out, volume = 0.6, duck, db, run = (args) => execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] }), probe, decode }) {
  if (!out) throw new Error("music audition requires --out <fresh-directory>");
  out = path.resolve(out);
  if (fs.existsSync(out)) throw new Error("audition output exists; choose a fresh directory");
  if (!candidates?.length || candidates.length > 8) throw new Error("music audition needs 1–8 candidate tracks");
  if (!voices?.length) throw new Error("music audition needs narration: generate the voiceover first (motion-use voiceover) or pass --narration <audio>");
  const given = duck ?? db;
  const settings = duckSettings(given, { file: true });
  const windows = duckWindows(voices, settings, decode ? { decode } : {});
  const env = duckPoints(windows, volume, { ...settings, duration: seconds });
  fs.mkdirSync(out, { recursive: true });
  const ids = new Set();
  // duck: what music choose writes into film.json, so the film mixes as it was heard here.
  const report = { version: 1, seconds, volume, duckDb: settings.duckTo, duckSettings: settings, duck: given ?? null, selected: null, listeningReview: "UNREVIEWED", candidates: [] };
  for (const c of candidates) {
    let id = slug(path.basename(c.file).replace(/\.[^.]+$/, ""));
    while (ids.has(id)) id += "-2";
    ids.add(id);
    const file = path.resolve(c.file);
    const entry = { id, file, source: c.source ?? null, from: c.from ?? 0, status: "ok" };
    try {
      const songSeconds = probe ? probe(file) : Infinity;
      const pieces = loopPlan(songSeconds, seconds, { from: c.from ?? 0, bpm: c.bpm });
      const tracks = [
        ...pieces.map((p, i) => ({ file, start: p.start, mediaStart: p.mediaStart, duration: p.duration, volume, fadeIn: i ? p.fadeIn : FILE_FADE.in, fadeOut: i === pieces.length - 1 ? FILE_FADE.out : p.fadeOut, channels: 2, automation: shiftEnvelope(env, p.start) })),
        ...voices.map((v) => ({ file: v.file, start: v.start, mediaStart: v.offset ?? 0, duration: v.length, volume: 1, fadeIn: 0.015, fadeOut: 0.03, channels: v.channels ?? 1 })),
      ];
      const wav = path.join(out, `${id}.wav`);
      run(mixArgs(tracks, seconds, wav));
      entry.sample = path.basename(wav);
      entry.loops = pieces.length - 1;
    } catch (e) {
      entry.status = "error";
      entry.error = e.stderr?.toString().trim().split("\n").at(-1) ?? e.message;
    }
    report.candidates.push(entry);
  }
  report.ok = report.candidates.every((c) => c.status === "ok");
  fs.writeFileSync(path.join(out, "audition.json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Music audition</title>
<style>body{font:18px system-ui;max-width:850px;margin:40px auto;padding:20px;background:#f5f2eb;color:#18231d}article{padding:20px;border-bottom:1px solid #bbb}audio{width:100%}</style>
<h1>Music under the same narration</h1><p>${seconds} s of the film's narration, music ducked ${settings.duckTo} dB under the voice as the film will mix it (${settings.mode === "signal" ? `signal: follows the voice level below ${settings.threshold} dBFS` : "sentence: down for each whole narration clip"}, ${settings.attack} s attack, ${settings.release} s release). Listening UNREVIEWED: no automatic winner. Choose with <code>motion-use music choose ${esc(out)} &lt;id&gt; [film]</code>.</p>
${report.candidates.map((c) => `<article><h2>${esc(c.id)}</h2><p>${esc(c.source?.title ?? path.basename(c.file))}${c.source ? ` — ${esc(c.source.author)}, ${esc(c.source.license)}` : " — no source record yet (motion-use music add)"}</p>${c.sample ? `<audio controls preload="none" src="${esc(c.sample)}"></audio>${c.loops ? `<p>loops ${c.loops}× at a phrase boundary</p>` : ""}` : `<p>${esc(c.error)}</p>`}</article>`).join("\n")}`);
  return { ...report, out, review: path.join(out, "index.html") };
}

/** Write the chosen audition candidate into film.json music (the track must have a source record). */
export function chooseMusic(auditionDir, id, filmFile, { remember = false, volume, env = process.env } = {}) {
  const report = JSON.parse(fs.readFileSync(path.join(auditionDir, "audition.json"), "utf8"));
  const c = report.candidates.find((x) => x.id === id);
  if (!c) throw new Error(`no candidate ${id} in ${auditionDir} (${report.candidates.map((x) => x.id).join(", ")})`);
  if (c.status !== "ok") throw new Error(`candidate ${id} failed in the audition: ${c.error}`);
  const dir = path.dirname(filmFile);
  const rel = path.relative(dir, c.file).split(path.sep).join("/");
  if (rel.startsWith("..")) throw new Error(`${c.file} is outside the project: add it with motion-use music add first`);
  const source = readMusicSources(dir).tracks.find((t) => t.file === rel);
  if (!source) throw new Error(`${rel} has no source record: motion-use music add ${rel} --url … --author … --license …`);
  const data = JSON.parse(fs.readFileSync(filmFile, "utf8"));
  const prev = typeof data.music === "object" && data.music ? data.music : {};
  // The ducking heard in the audition goes with the track; loop is about the film, so it stays.
  const duck = report.duck ?? prev.duck;
  data.music = { file: rel, volume: volume ?? prev.volume ?? report.volume ?? 0.6, ...(c.from ? { from: c.from } : {}), ...(duck !== undefined ? { duck } : {}), ...(prev.loop !== undefined ? { loop: prev.loop } : {}), why: `chosen by listening in ${path.basename(auditionDir)} (${id}); ${source.license}` };
  fs.writeFileSync(filmFile, JSON.stringify(data, null, 2) + "\n");
  report.selected = id;
  fs.writeFileSync(path.join(auditionDir, "audition.json"), JSON.stringify(report, null, 2) + "\n");
  const pref = remember ? writeMusicPreference({ track: { title: source.title, url: source.url, author: source.author, license: source.license, sha256: source.sha256 } }, env) : null;
  return { film: filmFile, music: data.music, source, remembered: pref?.file ?? null };
}

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

/** Default level of licensed music under narration, and the mix shape around it. */
export const DUCK_DB = { file: -20, score: -12 };
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

/**
 * Where the music bed is loud: one window per run of narration (gaps under `hold` seconds stay
 * ducked so the bed does not pump between sentences), ramps of `attack` / `release` seconds.
 */
export function duckPoints(voices, volume, { db = DUCK_DB.file, duration, attack = 0.25, release = 0.6, hold = 0.8 } = {}) {
  const low = volume * 10 ** (db / 20);
  const windows = [];
  for (const a of [...voices].sort((x, y) => x.start - y.start)) {
    const prev = windows.at(-1);
    if (prev && a.start <= prev.end + hold) prev.end = Math.max(prev.end, a.end);
    else windows.push({ start: a.start, end: a.end });
  }
  const points = [{ t: 0, v: volume }];
  for (const w of windows)
    points.push(
      { t: Math.max(0, w.start - attack), v: volume },
      { t: w.start, v: low },
      { t: w.end, v: low },
      { t: Math.min(duration ?? w.end + release, w.end + release), v: volume },
    );
  // A window that starts the film: begin ducked.
  if (windows[0] && windows[0].start - attack <= 0) points[0] = { t: 0, v: low };
  return [...new Map(points.map((p) => [p.t, p])).values()].sort((a, b) => a.t - b.t);
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
 * with each candidate track, ducked as the film will be, into a fresh directory with a listening
 * page. Nothing is written into film.json: `music choose` does that after someone listens.
 */
export function auditionMusic({ voices, seconds = 40, candidates, out, volume = 0.6, db = DUCK_DB.file, run = (args) => execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] }), probe }) {
  if (!out) throw new Error("music audition requires --out <fresh-directory>");
  out = path.resolve(out);
  if (fs.existsSync(out)) throw new Error("audition output exists; choose a fresh directory");
  if (!candidates?.length || candidates.length > 8) throw new Error("music audition needs 1–8 candidate tracks");
  if (!voices?.length) throw new Error("music audition needs narration: generate the voiceover first (motion-use voiceover) or pass --narration <audio>");
  fs.mkdirSync(out, { recursive: true });
  const ids = new Set();
  const report = { version: 1, seconds, duckDb: db, selected: null, listeningReview: "UNREVIEWED", candidates: [] };
  for (const c of candidates) {
    let id = slug(path.basename(c.file).replace(/\.[^.]+$/, ""));
    while (ids.has(id)) id += "-2";
    ids.add(id);
    const file = path.resolve(c.file);
    const entry = { id, file, source: c.source ?? null, from: c.from ?? 0, status: "ok" };
    try {
      const songSeconds = probe ? probe(file) : Infinity;
      const pieces = loopPlan(songSeconds, seconds, { from: c.from ?? 0, bpm: c.bpm });
      const env = duckPoints(voices.map((v) => ({ start: v.start, end: v.start + v.length })), volume, { db, duration: seconds });
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
<h1>Music under the same narration</h1><p>${seconds} s of the film's narration, music ducked ${db} dB under the voice as the film will mix it. Listening UNREVIEWED: no automatic winner. Choose with <code>motion-use music choose ${esc(out)} &lt;id&gt; [film]</code>.</p>
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
  data.music = { file: rel, volume: volume ?? prev.volume ?? 0.6, ...(c.from ? { from: c.from } : {}), why: `chosen by listening in ${path.basename(auditionDir)} (${id}); ${source.license}` };
  fs.writeFileSync(filmFile, JSON.stringify(data, null, 2) + "\n");
  report.selected = id;
  fs.writeFileSync(path.join(auditionDir, "audition.json"), JSON.stringify(report, null, 2) + "\n");
  const pref = remember ? writeMusicPreference({ track: { title: source.title, url: source.url, author: source.author, license: source.license, sha256: source.sha256 } }, env) : null;
  return { film: filmFile, music: data.music, source, remembered: pref?.file ?? null };
}

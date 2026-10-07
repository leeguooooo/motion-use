// A film owns its choreography. The CLI owns assets, exact time, packaging and delivery.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FORMATS, FPS_VALUES, lintCustomHtml } from "./brief.mjs";
import { claimDir, audioSeconds } from "./build.mjs";
import { writeSubsets, missingGlyphs } from "./fonts.mjs";
import { writeMusic } from "./music.mjs";
import { esc } from "./html.mjs";
import { BriefError } from "./brief.mjs";
import { resolveNarration } from "./film-voiceover.mjs";
import { buildNarrationStem } from "./verify.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FILM_FORMATS = { ...FORMATS, square: [1440, 1440] };
const finite = (x, min, max) => Number.isFinite(x) && x >= min && x <= max;
const inside = (base, file) => {
  const r = path.relative(base, file);
  return (
    r !== "" &&
    !r.startsWith(".." + path.sep) &&
    r !== ".." &&
    !path.isAbsolute(r)
  );
};

export function resolveProject(input) {
  if (input) {
    const p = path.resolve(input);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory())
      return path.join(
        p,
        fs.existsSync(path.join(p, "film.json")) ? "film.json" : "brief.json",
      );
    return p;
  }
  return path.resolve(fs.existsSync("film.json") ? "film.json" : "brief.json");
}

export function isFilm(file) {
  try {
    return (
      JSON.parse(fs.readFileSync(resolveProject(file), "utf8")).kind === "film"
    );
  } catch {
    return false;
  }
}

export function validateFilm(
  data,
  dir,
  {
    probe = audioSeconds,
    requireNarration = false,
    skipGeneratedVoiceover = false,
  } = {},
) {
  const errors = [],
    warnings = [];
  const error = (p, message) => errors.push({ path: p, message });
  const text = (v, p, max = 1000) => {
    if (typeof v !== "string" || !v.trim() || v.length > max)
      error(p, `non-empty text, at most ${max} characters`);
    return v;
  };
  if (!data || typeof data !== "object" || Array.isArray(data))
    return { errors: [{ path: "$", message: "a film object" }], warnings };
  if (data.version !== 1 || data.kind !== "film")
    error("$.kind", 'version: 1, kind: "film"');
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(data.name ?? ""))
    error("$.name", "a lowercase slug, 1–40 characters");
  if (!finite(data.duration, 1, 180))
    error(
      "$.duration",
      "seconds, 1–180; authored timing is never silently stretched",
    );
  if (!FPS_VALUES.includes(data.fps)) error("$.fps", "24, 25, 30 or 60");
  for (const [key, allowed] of [
    ["languages", null],
    ["formats", Object.keys(FILM_FORMATS)],
  ]) {
    const v = data[key];
    if (
      !Array.isArray(v) ||
      !v.length ||
      v.length > 4 ||
      new Set(v).size !== v.length ||
      v.some(
        (x) =>
          typeof x !== "string" ||
          (allowed
            ? !allowed.includes(x)
            : !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(x)),
      )
    )
      error(
        `$.${key}`,
        allowed
          ? `unique formats: ${allowed.join(", ")}`
          : "1–4 unique language codes",
      );
  }
  const local = (v, p) => {
    if (
      typeof v !== "string" ||
      !v ||
      path.isAbsolute(v) ||
      /[\\\x00-\x1f]|^[a-z]+:/i.test(v)
    ) {
      error(p, "a relative local path inside this project");
      return null;
    }
    const f = path.resolve(dir, v);
    if (
      !inside(dir, f) ||
      !fs.existsSync(f) ||
      !fs.statSync(f).isFile() ||
      !inside(fs.realpathSync(dir), fs.realpathSync(f))
    ) {
      error(p, "a file inside this project (no escaping symlinks)");
      return null;
    }
    return f;
  };
  const composition = data.composition ?? "composition/draw.js";
  const source = local(composition, "$.composition");
  const libraries = [];
  if (data.libraries !== undefined && !Array.isArray(data.libraries))
    error("$.libraries", "an array of local, bundled browser scripts");
  for (const [i, v] of (Array.isArray(data.libraries)
    ? data.libraries
    : []
  ).entries()) {
    const f = local(v, `$.libraries[${i}]`);
    if (f && path.extname(f) === ".js") libraries.push(f);
    else if (f) error(`$.libraries[${i}]`, "a local .js browser bundle");
  }
  if (source) {
    if (
      path.dirname(source) === path.resolve(dir) ||
      path.extname(source) !== ".js"
    )
      error("$.composition", "a .js file in its own composition folder");
    const src = fs.readFileSync(source, "utf8");
    if (src.length > 500000)
      error(
        "$.composition",
        "keep the drawing code below 500 KB; put assets in files",
      );
    for (const issue of lintCustomHtml(src))
      error(
        "$.composition",
        `${issue.rule}: ${issue.match}; render from time with local assets`,
      );
    if (!/\b(?:window\.)?drawFrame\b/.test(src))
      error(
        "$.composition",
        "define window.drawFrame(ctx, time, film, view, motion)",
      );
  }
  if (!data.copy || typeof data.copy !== "object" || Array.isArray(data.copy))
    error("$.copy", "visible text keyed by language, used for font subsetting");
  for (const lang of Array.isArray(data.languages) ? data.languages : []) {
    const c = data.copy?.[lang];
    if (!c || typeof c !== "object" || Array.isArray(c))
      error(`$.copy.${lang}`, "an object of text strings");
    else
      for (const [k, v] of Object.entries(c))
        text(v, `$.copy.${lang}.${k}`, 2000);
  }
  const shots = Array.isArray(data.shots) ? data.shots : [];
  if (!shots.length || shots.length > 60)
    error("$.shots", "1–60 shots, including a purpose and visible action");
  const ids = new Set();
  let end = 0;
  shots.forEach((s, i) => {
    const p = `$.shots[${i}]`;
    if (!s || typeof s !== "object") return error(p, "a shot object");
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(s.id ?? "") || ids.has(s.id))
      error(`${p}.id`, "a unique lowercase slug");
    ids.add(s.id);
    if (
      !finite(s.start, 0, data.duration) ||
      !finite(s.end, 0, data.duration) ||
      s.end <= s.start
    )
      error(p, "0 <= start < end <= duration");
    if (Math.abs(s.start - end) > 0.001)
      error(
        `${p}.start`,
        "shots must cover the timeline without gaps or overlaps",
      );
    end = s.end;
    text(s.purpose, `${p}.purpose`);
    text(s.action, `${p}.action`);
    if (s.hold !== undefined && !finite(s.hold, 0, s.end - s.start))
      error(`${p}.hold`, "seconds, within the shot");
    if (s.hold > 1 && !s.holdReason)
      warnings.push({
        path: `${p}.hold`,
        message:
          "hold exceeds 1 second; record a reading/pacing reason instead of adding dead time",
      });
    if (s.holdReason !== undefined) text(s.holdReason, `${p}.holdReason`);
    if (s.cut !== undefined && typeof s.cut !== "boolean")
      error(`${p}.cut`, "true marks a deliberate hard cut into this shot");
  });
  if (Math.abs(end - data.duration) > 0.001)
    error("$.shots", "last shot must end at duration");
  const music = data.music ?? "none";
  let musicFile = null;
  if (!["builtin", "none"].includes(music)) {
    if (!music || typeof music !== "object" || Array.isArray(music))
      error("$.music", '"builtin", "none", or {file, volume, bpm}');
    else {
      musicFile = local(music.file, "$.music.file");
      if (music.volume !== undefined && !finite(music.volume, 0, 1))
        error("$.music.volume", "0–1");
    }
  }
  const bpm =
    data.bpm ?? (typeof music === "object" ? music?.bpm : undefined) ?? 100;
  if (!finite(bpm, 40, 240))
    error("$.bpm", "40–240; built-in music and the beat grid use the same BPM");
  const tracks = [];
  if (data.audio !== undefined && !Array.isArray(data.audio))
    error("$.audio", "an array of local audio clips");
  if (data.audio?.length > 64) error("$.audio", "at most 64 clips");
  (Array.isArray(data.audio) ? data.audio.slice(0, 64) : []).forEach((a, i) => {
    const p = `$.audio[${i}]`;
    if (!a || typeof a !== "object") return error(p, "an audio clip");
    if (a.effect !== undefined && a.file !== undefined)
      error(p, "choose a local file or a bundled effect, not both");
    if (
      a.effect !== undefined &&
      !["click", "switch", "whoosh", "ding"].includes(a.effect)
    )
      error(`${p}.effect`, "click, switch, whoosh or ding");
    const file = ["click", "switch", "whoosh", "ding"].includes(a.effect)
        ? path.join(ROOT, "assets", "sfx", `${a.effect}.wav`)
        : local(a.file, `${p}.file`),
      start = a.start ?? 0,
      offset = a.offset ?? 0;
    if (!finite(start, 0, data.duration) || !finite(offset, 0, 86400))
      error(p, "non-negative start and offset");
    if (a.volume !== undefined && !finite(a.volume, 0, 2))
      error(`${p}.volume`, "0–2");
    if (a.role !== undefined && !["voiceover", "music", "sfx"].includes(a.role))
      error(`${p}.role`, "voiceover, music or sfx");
    if (
      a.lang !== undefined &&
      (!Array.isArray(data.languages) || !data.languages.includes(a.lang))
    )
      error(`${p}.lang`, "a language in this film");
    if (file)
      try {
        const sourceSeconds = probe(file),
          length = a.length ?? sourceSeconds - offset;
        if (
          !finite(length, 0.01, 180) ||
          offset + length > sourceSeconds + 0.05 ||
          start + length > data.duration + 0.05
        )
          error(
            p,
            "audio is cut off; trim explicitly or extend the film and its shots",
          );
        tracks.push({
          ...a,
          file,
          start,
          offset,
          length,
          volume: a.volume ?? 1,
        });
      } catch (e) {
        error(p, e.message);
      }
  });
  if (
    data.motionBlur !== undefined &&
    (!data.motionBlur ||
      ![1, 2, 4].includes(data.motionBlur.samples) ||
      !finite(data.motionBlur.shutter, 0, 1))
  )
    error("$.motionBlur", "{samples: 1|2|4, shutter: 0–1}");
  const fileAssets = {};
  if (
    data.assets !== undefined &&
    (!data.assets ||
      typeof data.assets !== "object" ||
      Array.isArray(data.assets))
  )
    error("$.assets", "named local image files");
  for (const [k, v] of Object.entries(data.assets ?? {})) {
    if (
      !/^[a-z][a-z0-9-]{0,39}$/i.test(k) ||
      !/\.(png|jpe?g|webp|svg)$/i.test(v)
    )
      error(`$.assets.${k}`, "named PNG/JPG/WebP/SVG image");
    const f = local(v, `$.assets.${k}`);
    if (f) fileAssets[k] = f;
  }
  const glyphs = missingGlyphs(JSON.stringify(data.copy ?? {}));
  if (glyphs.length)
    error("$.copy", `missing font glyphs: ${glyphs.join(" ")}`);
  const narration = resolveNarration(
    { ...data, dir, tracks },
    {
      error,
      warn: (p, message) => warnings.push({ path: p, message }),
      requireFiles: requireNarration,
      skipGenerated: skipGeneratedVoiceover,
      probe,
    },
  );
  tracks.push(...narration.tracks);
  return {
    errors,
    warnings,
    film: {
      ...data,
      composition,
      source,
      musicFile,
      bpm,
      tracks,
      fileAssets,
      libraries,
      dir,
      fonts: {},
      narrationConfig: narration.config,
      narrationPlans: narration.plans,
      narrationPending: narration.pending,
    },
    shots,
  };
}

export function checkFilm(input, o = {}) {
  const file = resolveProject(input),
    dir = path.dirname(file);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const { film, errors, warnings } = validateFilm(data, dir, o);
  const langs = o.lang
      ? o.lang.split(",")
      : Array.isArray(film.languages)
        ? film.languages
        : [],
    formats = o.format
      ? o.format.split(",")
      : Array.isArray(film.formats)
        ? film.formats
        : [];
  for (const l of langs ?? [])
    if (!film.languages?.includes(l))
      errors.push({ path: "--lang", message: `${l} is not in this film` });
  for (const f of formats ?? [])
    if (!film.formats?.includes(f))
      errors.push({ path: "--format", message: `${f} is not in this film` });
  return {
    ok: errors.length === 0,
    film,
    brief: film,
    dir,
    langs,
    formats,
    report: {
      brief: file,
      errors,
      warnings,
      missing_glyphs: [],
      media: [],
      timelines: errors.length
        ? []
        : langs.flatMap((lang) =>
            formats.map((format) => ({
              lang,
              format,
              seconds: film.duration,
              scenes: film.shots.map((s) => ({
                id: s.id,
                start: s.start,
                seconds: s.end - s.start,
              })),
            })),
          ),
    },
  };
}

export function initFilm(o, dir) {
  dir = path.resolve(dir);
  const target = path.join(dir, "film.json");
  const draw = path.join(dir, "composition", "draw.js"),
    director = path.join(dir, "DIRECTOR.md");
  // Preflight every target before writing any file. Never erase custom drawing code on re-init.
  for (const f of [target, draw, director])
    if (fs.existsSync(f))
      throw new BriefError(
        `${f} already exists; choose a fresh project directory`,
      );
  const data = JSON.parse(
    fs.readFileSync(path.join(ROOT, "templates", "film", "film.json"), "utf8"),
  );
  if (o.name) data.name = o.name;
  if (o.lang) {
    data.languages = o.lang.split(",");
    data.copy = Object.fromEntries(
      data.languages.map((l) => [l, data.copy[l] ?? data.copy.en]),
    );
  }
  if (o.format) data.formats = o.format.split(",");
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(data.name))
    throw new BriefError("--name must be a lowercase slug");
  if (
    !data.formats.length ||
    data.formats.some((f) => !Object.hasOwn(FILM_FORMATS, f))
  )
    throw new BriefError("--format: landscape, vertical or square");
  if (
    !data.languages.length ||
    data.languages.some((l) => !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(l))
  )
    throw new BriefError("--lang: language codes such as zh,en");
  fs.mkdirSync(path.dirname(draw), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(data, null, 2) + "\n");
  fs.copyFileSync(path.join(ROOT, "templates", "film", "draw.js"), draw);
  fs.copyFileSync(
    path.join(ROOT, "templates", "film", "DIRECTOR.md"),
    director,
  );
  return { ok: true, film: target, composition: draw, director, mode: "film" };
}

export async function buildFilm(film, lang, format, outDir) {
  claimDir(outDir);
  const [w, h] = FILM_FORMATS[format],
    fmt = { w, h, vertical: h > w, name: format };
  // Copy declared assets only. Never sweep a project folder containing credentials.
  fs.mkdirSync(path.join(outDir, "composition"));
  fs.copyFileSync(film.source, path.join(outDir, "composition", "draw.js"));
  const scripts = film.libraries
    .map((f, i) => {
      const rel = `composition/library-${i}.js`;
      fs.copyFileSync(f, path.join(outDir, rel));
      return `<script src="${rel}"></script>`;
    })
    .join("");
  fs.mkdirSync(path.join(outDir, "assets", "audio"), { recursive: true });
  const assets = {};
  for (const [key, file] of Object.entries(film.fileAssets)) {
    const rel = `assets/${key}${path.extname(file)}`;
    fs.copyFileSync(file, path.join(outDir, rel));
    assets[key] = rel;
  }
  const fontDir = path.join(outDir, "assets", "fonts");
  const fontSizes = await writeSubsets(
    JSON.stringify(film.copy) + fs.readFileSync(film.source, "utf8"),
    fontDir,
  );
  for (const f of fs
    .readdirSync(path.join(ROOT, "assets", "fonts"))
    .filter((f) => f.startsWith("OFL-")))
    fs.copyFileSync(
      path.join(ROOT, "assets", "fonts", f),
      path.join(fontDir, f),
    );
  const audio = [],
    selectedTracks = film.tracks.filter((a) => !a.lang || a.lang === lang);
  if (film.music !== "none" && film.music !== undefined) {
    let rel = "assets/audio/music.wav";
    if (film.music === "builtin")
      writeMusic(path.join(outDir, rel), "promo", film.duration, {
        bpm: film.bpm,
      });
    else {
      rel = `assets/audio/music${path.extname(film.musicFile)}`;
      fs.copyFileSync(film.musicFile, path.join(outDir, rel));
    }
    const volume =
      typeof film.music === "object" ? (film.music.volume ?? 0.6) : 0.6;
    // Voiceover windows carve the music, with short ramps at both edges.
    const points = [{ t: 0, v: volume }];
    const voices = selectedTracks
      .filter((a) => a.role === "voiceover")
      .sort((a, b) => a.start - b.start);
    const windows = [];
    for (const a of voices) {
      const prev = windows.at(-1);
      if (prev && a.start <= prev.end + 0.2)
        prev.end = Math.max(prev.end, a.start + a.length);
      else windows.push({ start: a.start, end: a.start + a.length });
    }
    for (const a of windows)
      points.push(
        { t: Math.max(0, a.start - 0.15), v: volume },
        { t: a.start, v: volume * 0.25 },
        { t: a.end, v: volume * 0.25 },
        { t: Math.min(film.duration, a.end + 0.2), v: volume },
      );
    const unique = [...new Map(points.map((p) => [p.t, p])).values()].sort(
      (a, b) => a.t - b.t,
    );
    const automation = voices.length
      ? ` data-automation="${esc(JSON.stringify({ version: 1, lanes: [{ target: "volume", points: unique }] }))}"`
      : "";
    audio.push(
      `<audio id="film-music" src="${rel}" data-start="0" data-duration="${film.duration}" data-volume="${volume}" data-fade-out="0.3" data-track-index="10"${automation}></audio>`,
    );
  }
  selectedTracks.forEach((a, i) => {
    const rel = `assets/audio/clip-${i}${path.extname(a.file)}`;
    fs.copyFileSync(a.file, path.join(outDir, rel));
    audio.push(
      `<audio id="film-audio-${i}" src="${rel}" data-start="${a.start}" data-media-start="${a.offset}" data-duration="${a.length}" data-volume="${a.volume}" data-fade-in="0.015" data-fade-out="0.03" data-track-index="${11 + i}"></audio>`,
    );
  });
  const voiceTracks = selectedTracks.filter((a) => a.role === "voiceover");
  const narrationStem = voiceTracks.length
    ? path.join(outDir, "assets", "audio", "narration-stem.wav")
    : null;
  if (narrationStem)
    buildNarrationStem(voiceTracks, film.duration, narrationStem);
  const config = {
    name: film.name,
    duration: film.duration,
    fps: film.fps,
    bpm: film.bpm,
    lang,
    format,
    copy: film.copy[lang],
    shots: film.shots,
    motionBlur: film.motionBlur ?? { samples: 1, shutter: 0 },
    assets,
  };
  fs.writeFileSync(
    path.join(outDir, "runtime.js"),
    fs.readFileSync(path.join(ROOT, "src", "film-runtime.js")),
  );
  fs.writeFileSync(
    path.join(outDir, "index.html"),
    `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'"><title>${esc(film.name)}</title><style>@font-face{font-family:Film Sans;src:url(assets/fonts/sans.woff2);font-weight:100 900}@font-face{font-family:Film Mono;src:url(assets/fonts/mono.woff2);font-weight:100 800}html,body{margin:0;background:#151515}#root{width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%}</style></head><body><div id="root" data-composition-id="main" data-no-timeline data-width="${w}" data-height="${h}" data-duration="${film.duration}"><canvas id="film-canvas" width="${w}" height="${h}"></canvas>${audio.join("")}</div><script id="film-config" type="application/json">${JSON.stringify(config).replace(/</g, "\\u003c")}</script>${scripts}<script src="composition/draw.js"></script><script src="runtime.js"></script></body></html>`,
  );
  return {
    fmt,
    total: film.duration,
    fps: film.fps,
    dir: outDir,
    fontSizes,
    lang,
    format,
    film: true,
    scenes: film.shots.map((s) => ({
      id: s.id,
      start: s.start,
      duration: s.end - s.start,
      vo: null,
    })),
    reviewTimes: film.shots.flatMap((s) => [
      s.start + Math.min(0.2, (s.end - s.start) / 4),
      (s.start + s.end) / 2,
      Math.max(s.start, s.end - 1 / film.fps),
    ]),
    narrationStem,
    narrationTracks: voiceTracks,
    narrationRequired: film.voiceover !== false,
  };
}

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { BriefError, FORMATS, STYLES, collectText, readBrief, validateBrief } from "./brief.mjs";
import { FADE, audioSeconds, buildProject, claimDir, mediaInfo, plan } from "./build.mjs";
import { missingGlyphs } from "./fonts.mjs";
import { hyperframesBin, runHyperframes } from "./hf.mjs";
import { maybeNotify, upgrade } from "./update.mjs";
import { edgeAvailable, edgeGenerated, generateVoiceover, pickEngine } from "./voiceover.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

const HELP = `motion-use ${VERSION} — reproducible promo and explainer videos from a JSON brief

Usage: motion-use <command> [options]

  init [dir]          Write a starter brief.json (--story problem-solution|demo-first|before-after|walkthrough,
                      --style promo|explainer, --name, --lang zh,en, --format landscape,vertical)
  validate [brief]    Check a brief: fields, files, voiceover lengths, characters the fonts cannot draw
  voiceover [brief]   Speak each scene's "narration" into voiceover/<lang>/<scene-id>.mp3 (--engine azure|edge)
  still [brief]       Render keyframes as PNGs plus a contact sheet (--at 1.5,4 for exact seconds)
  render [brief]      Render MP4s for every language and format in the brief
  doctor              Check Node, ffmpeg, Chrome and the bundled engine (--install-browser fetches Chrome)
  upgrade             Update motion-use and its skill (--check only looks)

Options for still/render:
  --lang zh,en        Only these languages (default: all in the brief)
  --format vertical   Only these formats (default: all in the brief)
  --out <dir>         Output directory (default: <brief dir>/out)
  --quality <q>       render only: draft | standard | high (default: standard)
  --max-size <size>   render only: re-encode any MP4 above this size (e.g. 9MB) until it fits
  --target github     render only: same as --max-size 9.5MB (GitHub's inline video limit is 10 MB)
  --force             Overwrite output files motion-use did not write
  --json              Machine-readable result on stdout

brief defaults to ./brief.json. Docs: references/brief.md`;

const fail = (msg, json) => {
  if (json) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  else console.error(`motion-use: ${msg}`);
  return 1;
};

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return console.log(HELP), 0;
  if (cmd === "--version" || cmd === "-v" || cmd === "version") return console.log(VERSION), 0;
  const commands = { init, validate, voiceover, still, render, doctor, upgrade: upgradeCmd };
  if (!Object.hasOwn(commands, cmd)) return fail(`unknown command "${cmd}". Run motion-use --help`);
  let args;
  try {
    args = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        style: { type: "string" },
        story: { type: "string" },
        name: { type: "string" },
        lang: { type: "string" },
        format: { type: "string" },
        out: { type: "string" },
        at: { type: "string" },
        quality: { type: "string" },
        engine: { type: "string" },
        "max-size": { type: "string" },
        target: { type: "string" },
        json: { type: "boolean" },
        check: { type: "boolean" },
        force: { type: "boolean" },
        "install-browser": { type: "boolean" },
      },
    });
  } catch (e) {
    return fail(e.message);
  }
  if (cmd !== "upgrade") await maybeNotify(VERSION);
  try {
    return await commands[cmd](args.values, args.positionals);
  } catch (e) {
    if (e instanceof BriefError) return fail(e.message, args.values.json);
    throw e;
  }
}

const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : null);

const STORIES = ["problem-solution", "demo-first", "before-after", "walkthrough"];

async function init(o, [dir = "."]) {
  if (o.story && !STORIES.includes(o.story)) return fail(`--story must be one of: ${STORIES.join(", ")} (see references/stories.md)`, o.json);
  if (o.style && !STYLES.includes(o.style)) return fail(`--style must be one of: ${STYLES.join(", ")}`, o.json);
  const target = path.resolve(dir, "brief.json");
  if (fs.existsSync(target) && !o.force) return fail(`${target} already exists (use --force to overwrite)`, o.json);
  const tpl = o.story ? path.join(ROOT, "templates", "stories", `${o.story}.json`) : path.join(ROOT, "templates", `${o.style ?? "promo"}.json`);
  const brief = JSON.parse(fs.readFileSync(tpl, "utf8"));
  if (o.style) brief.style = o.style;
  const style = brief.style;
  if (o.name) brief.name = o.name;
  const langs = list(o.lang);
  if (langs) {
    brief.languages = langs;
    // Keep zh/en text where asked for; other languages start from the English text to translate.
    const fix = (v) => {
      if (Array.isArray(v)) return v.map(fix);
      if (v && typeof v === "object") {
        if (typeof v.en === "string" && typeof v.zh === "string" && Object.keys(v).length === 2) return Object.fromEntries(langs.map((l) => [l, v[l] ?? v.en]));
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)]));
      }
      return v;
    };
    brief.scenes = fix(brief.scenes);
  }
  const formats = list(o.format);
  if (formats) brief.formats = formats;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(brief, null, 2) + "\n");
  // Voiceover is optional; the folders show where recordings go.
  for (const l of brief.languages) {
    const d = path.join(path.dirname(target), "voiceover", l);
    fs.mkdirSync(d, { recursive: true });
    const note = path.join(d, "README.txt");
    if (!fs.existsSync(note)) fs.writeFileSync(note, `Optional narration for language "${l}": one audio file per scene, named after the scene id\n(${brief.scenes.map((s) => s.id + ".mp3").join(", ")}). .wav and .m4a work too.\nA scene grows longer when its narration needs more time. Scenes without a file stay silent.\n`);
  }
  const { errors } = validateBrief(brief, path.dirname(target));
  if (o.json) console.log(JSON.stringify({ ok: errors.length === 0, brief: target, style, story: o.story ?? null, errors }, null, 2));
  else {
    console.log(`wrote ${target} (${o.story ? `${o.story} story, ` : ""}${style})`);
    if (errors.length) console.log("fix these before rendering:\n" + errors.map((e) => `  ${e.path}: ${e.message}`).join("\n"));
    const shown = path.relative(process.cwd(), target);
    console.log(`next: edit it, then motion-use validate ${shown.startsWith("..") ? target : shown} && motion-use still ${shown.startsWith("..") ? target : shown}`);
  }
  return errors.length ? 1 : 0;
}

/** Load + validate + font coverage + voiceover probing. Returns { ok, brief, report }. */
function check(briefPath, o) {
  const { data, dir, file } = readBrief(briefPath ?? "brief.json");
  const { brief, errors, warnings } = validateBrief(data, dir);
  const report = { brief: file, errors, warnings, missing_glyphs: [], media: [], timelines: [] };
  if (errors.length) return { ok: false, brief, dir, report };
  // Sizes of images and clips: highlight and zoom boxes are in these pixels.
  brief.scenes.forEach((s, i) => {
    const f = s.image ?? s.video;
    if (!f) return;
    try {
      const m = mediaInfo(f);
      report.media.push({ scene: s.id, file: path.relative(dir, f), width: m.w, height: m.h, seconds: m.duration === null ? null : +m.duration.toFixed(2), audio: m.audio });
    } catch (e) {
      errors.push({ path: `$.scenes[${i}]`, message: e.message });
    }
  });
  if (errors.length) return { ok: false, brief, dir, report };
  const missing = missingGlyphs(collectText(brief), brief.fonts);
  if (missing.length) {
    report.missing_glyphs = missing;
    warnings.push({ path: "$.scenes", message: `the bundled fonts cannot draw ${missing.map((c) => `"${c}" U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(", ")}; they will use a system font or show as boxes` });
  }
  const langs = list(o.lang) ?? brief.languages;
  const formats = list(o.format) ?? brief.formats;
  for (const l of langs) if (!brief.languages.includes(l)) errors.push({ path: "--lang", message: `${l} is not in the brief's languages (${brief.languages.join(", ")})` });
  for (const f of formats) if (!brief.formats.includes(f)) errors.push({ path: "--format", message: `${f} is not in the brief's formats (${brief.formats.join(", ")})` });
  if (errors.length) return { ok: false, brief, dir, report };
  try {
    for (const l of langs)
      for (const f of formats) {
        const p = plan(brief, l, f, { probe: audioSeconds });
        report.timelines.push({ lang: l, format: f, seconds: p.total, scenes: p.scenes.map((s) => ({ id: s.id, start: +s.start.toFixed(2), seconds: +s.duration.toFixed(2), voiceover: s.vo ? +s.vo.seconds.toFixed(2) : null, stretched_for_voiceover: s.stretched })) });
        for (const s of p.scenes)
          if (s.raised && !warnings.some((w) => w.path.endsWith(`${s.id}.duration`)))
            warnings.push({ path: `$.scenes.${s.id}.duration`, message: `too short for its animation; using ${s.raised}s instead` });
      }
  } catch (e) {
    errors.push({ path: e.message.startsWith("$.") ? e.message.split(":")[0] : "media/voiceover", message: e.message.startsWith("$.") ? e.message.slice(e.message.indexOf(":") + 2) : e.message });
  }
  return { ok: errors.length === 0, brief, dir, report, langs, formats };
}

function printReport(r) {
  for (const e of r.errors) console.error(`error   ${e.path}: ${e.message}`);
  for (const w of r.warnings) console.error(`warning ${w.path}: ${w.message}`);
  for (const m of r.media ?? []) console.log(`media ${m.scene}: ${m.file} ${m.width}×${m.height}${m.seconds !== null ? `, ${m.seconds}s${m.audio ? ", has sound" : ""}` : ""}`);
  for (const t of r.timelines) console.log(`${t.lang} ${t.format}: ${t.seconds.toFixed(1)}s, ${t.scenes.length} scenes${t.scenes.some((s) => s.stretched_for_voiceover) ? ` (stretched for voiceover: ${t.scenes.filter((s) => s.stretched_for_voiceover).map((s) => s.id).join(", ")})` : ""}`);
}

async function validate(o, [briefPath]) {
  const { ok, report } = check(briefPath, o);
  if (o.json) console.log(JSON.stringify({ ok, ...report }, null, 2));
  else {
    printReport(report);
    console.log(ok ? "brief OK" : `${report.errors.length} error(s)`);
  }
  return ok ? 0 : 1;
}

async function each(briefPath, o, fn) {
  const c = check(briefPath, o);
  if (!c.ok) {
    if (o.json) console.log(JSON.stringify({ ok: false, ...c.report }, null, 2));
    else printReport(c.report), console.error(`motion-use: ${c.report.errors.length} error(s); nothing rendered`);
    return { code: 1 };
  }
  if (!o.json) for (const w of c.report.warnings) console.error(`warning ${w.path}: ${w.message}`);
  const out = path.resolve(o.out ?? path.join(c.dir, "out"));
  // Outputs go into subfolders motion-use owns; the brief's own folder is never an output folder.
  const rel = path.relative(out, c.dir);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    const msg = `--out ${out} contains the brief; choose a separate folder (default: ${path.join(c.dir, "out")})`;
    if (o.json) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    else console.error(`motion-use: ${msg}`);
    return { code: 1 };
  }
  const results = [];
  for (const l of c.langs)
    for (const f of c.formats) {
      const id = `${c.brief.name}-${l}-${f}`;
      const proj = await buildProject(c.brief, l, f, path.join(out, ".build", id));
      results.push(await fn(proj, id, out, c.brief));
    }
  return { code: results.every((r) => r.ok) ? 0 : 1, results, warnings: c.report.warnings };
}

// Final files (MP4s, contact sheets) are tracked in <out>/.motion-use-outputs.json with
// their hash. An existing file motion-use did not write, or that changed since, is never
// overwritten without --force.
const MANIFEST = ".motion-use-outputs.json";
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const readManifest = (out) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(out, MANIFEST), "utf8"));
  } catch {
    return {};
  }
};
function guardOutput(out, file, force) {
  if (!fs.existsSync(file) || force) return null;
  const rec = readManifest(out)[path.relative(out, file)];
  if (rec && rec === sha(file)) return null;
  return `${file} already exists and ${rec ? "was changed since motion-use wrote it" : "was not written by motion-use"}; move it away or pass --force`;
}
/** Move a freshly written temp file into place and record it. */
function commitOutput(out, tmp, file) {
  fs.renameSync(tmp, file);
  const m = readManifest(out);
  m[path.relative(out, file)] = sha(file);
  fs.writeFileSync(path.join(out, MANIFEST), JSON.stringify(m, null, 2) + "\n");
}

async function render(o, [briefPath]) {
  const QUALITY = { draft: "draft", standard: "looks", high: "delivery" };
  const q = o.quality ?? "standard";
  const quality = Object.hasOwn(QUALITY, q) ? QUALITY[q] : null;
  if (!quality) return fail("--quality must be draft, standard or high", o.json);
  const TARGETS = { github: "9.5MB" };
  if (o.target && !Object.hasOwn(TARGETS, o.target)) return fail(`--target must be one of: ${Object.keys(TARGETS).join(", ")}`, o.json);
  const maxBytes = parseSize(o["max-size"] ?? (o.target ? TARGETS[o.target] : null));
  if (maxBytes === undefined) return fail('--max-size takes a size like 9MB, 9.5M or 9000000', o.json);
  const r = await each(briefPath, o, async (proj, id, out, brief) => {
    const edgeFiles = edgeGenerated(brief, proj.lang);
    if (edgeFiles.length && !o.json) console.error(`motion-use: ${id} uses ${edgeFiles.length} voiceover file(s) made with edge-tts: preview quality, and whether they may be published is not established. For a public video, regenerate with --engine azure.`);
    const file = path.join(out, `${id}.mp4`);
    const blocked = guardOutput(out, file, o.force);
    if (blocked) return { ok: false, id, error: blocked };
    const tmp = path.join(proj.dir, "render.mp4");
    fs.rmSync(tmp, { force: true });
    if (!o.json) console.error(`rendering ${id} (${proj.total.toFixed(1)}s)…`);
    const hf = await runHyperframes([ "render", proj.dir, "--output", tmp, "--fps", String(proj.fps), "--quality", quality, "--quiet" ].filter(Boolean), {});
    const ok = hf.code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0;
    if (!ok) return { ok, id, error: hf.out.trim().split("\n").slice(-15).join("\n") };
    let fitted = null;
    if (maxBytes && fs.statSync(tmp).size > maxBytes) {
      fitted = fitSize(tmp, maxBytes, proj.dir);
      if (!fitted.ok) return { ok: false, id, error: fitted.error };
    }
    const bytes = fs.statSync(tmp).size;
    commitOutput(out, tmp, file);
    if (!o.json && bytes > 10e6) console.error(`motion-use: ${path.basename(file)} is ${mb(bytes)}; GitHub plays videos inline only up to 10 MB (use --target github)`);
    if (!o.json) console.log(`${file}  ${mb(bytes)}${fitted ? ` (re-encoded at CRF ${fitted.crf} to fit)` : ""}`);
    // Frame 0 as a PNG: the cover to upload where a platform asks for one.
    const coverFile = path.join(out, `${id}-cover.png`);
    let cover = null;
    if (!guardOutput(out, coverFile, o.force)) {
      const tmpCover = path.join(proj.dir, "cover.png");
      try {
        execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-frames:v", "1", tmpCover], { stdio: ["ignore", "ignore", "pipe"] });
        commitOutput(out, tmpCover, coverFile);
        cover = coverFile;
      } catch (e) {
        console.error(`motion-use: cover image not created (${e.code === "ENOENT" ? "ffmpeg not found" : e.stderr?.toString().trim()})`);
      }
    } else console.error(`motion-use: cover image skipped: ${guardOutput(out, coverFile, o.force)}`);
    return { ok, id, file, cover, bytes, refit_crf: fitted?.crf ?? null, edge_voiceover: edgeFiles.length, seconds: proj.total, lang: proj.lang, format: proj.format };
  });
  if (o.json && r.results) console.log(JSON.stringify({ ok: r.code === 0, outputs: r.results, warnings: r.warnings }, null, 2));
  else for (const x of r.results ?? []) if (!x.ok) console.error(`motion-use: render failed for ${x.id}:\n${x.error}`);
  return r.code;
}

const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;

/** "9MB" / "9.5M" / "9000000" -> bytes (1 MB = 1,000,000 bytes). null when not given, undefined when invalid. */
export function parseSize(s) {
  if (s === null || s === undefined) return null;
  const m = /^(\d+(?:\.\d+)?)\s*(k|kb|m|mb|g|gb)?$/i.exec(String(s).trim());
  if (!m) return undefined;
  const mult = { k: 1e3, kb: 1e3, m: 1e6, mb: 1e6, g: 1e9, gb: 1e9 }[(m[2] ?? "").toLowerCase()] ?? 1;
  const n = Math.round(Number(m[1]) * mult);
  return n >= 100e3 ? n : undefined;
}

/**
 * Re-encode `file` in place with rising x264 CRF until it is at most `max` bytes.
 * Motion-use frames are mostly flat text and shapes, so this usually shrinks a file
 * severalfold with no visible change.
 */
function fitSize(file, max, workDir) {
  const tmp = path.join(workDir, "fit.mp4");
  for (const crf of [23, 26, 28, 30, 33, 36]) {
    try {
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", tmp], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      return { ok: false, error: `re-encoding failed: ${e.code === "ENOENT" ? "ffmpeg not found" : e.stderr?.toString().trim()}` };
    }
    if (fs.statSync(tmp).size <= max) {
      fs.renameSync(tmp, file);
      return { ok: true, crf };
    }
  }
  return { ok: false, error: `cannot get under ${mb(max)} even at CRF 36 (${mb(fs.statSync(tmp).size)}); shorten the video or raise --max-size` };
}

async function voiceover(o, [briefPath]) {
  // The folder may not exist yet on a first run: create it so validation passes.
  const { data, dir } = readBrief(briefPath ?? "brief.json");
  if (typeof data?.voiceover?.dir === "string") fs.mkdirSync(path.resolve(dir, data.voiceover.dir), { recursive: true });
  const { brief, errors, warnings } = validateBrief(data, dir);
  if (errors.length) {
    if (o.json) console.log(JSON.stringify({ ok: false, errors, warnings }, null, 2));
    else printReport({ errors, warnings, timelines: [] });
    return 1;
  }
  if (o.engine && !["azure", "edge"].includes(o.engine)) return fail("--engine must be azure or edge", o.json);
  const langs = list(o.lang) ?? brief.languages;
  if (!brief.scenes.some((s) => s.narration)) return fail('no scene has "narration" text; add it to the scenes you want spoken', o.json);
  const res = await generateVoiceover(brief, { langs, engine: o.engine, force: o.force, log: o.json ? () => {} : (m) => console.error(m) });
  const failed = res.rows.filter((r) => r.status === "error");
  if (o.json) console.log(JSON.stringify({ ok: failed.length === 0, engine: res.engine, files: res.rows }, null, 2));
  else {
    for (const r of res.rows) console.log(`${r.status.padEnd(9)} ${path.relative(process.cwd(), r.file)}${r.reason ? `  (${r.reason})` : ""}${r.error ? `  ${r.error}` : ""}`);
    if (res.engine === "edge") console.error("note: edge-tts is preview quality and its audio is not cleared for publishing; for a public video use --engine azure (AZURE_SPEECH_KEY, AZURE_SPEECH_REGION).");
  }
  return failed.length ? 1 : 0;
}

async function still(o, [briefPath]) {
  const at = list(o.at)?.map(Number);
  if (at?.some((x) => !Number.isFinite(x) || x < 0)) return fail("--at takes seconds, e.g. --at 1.5,4", o.json);
  const r = await each(briefPath, o, async (proj, id, out) => {
    // Default: one frame per scene, once its content has finished arriving.
    const times = at ?? proj.scenes.map((s) => Math.min(s.start + s.duration - FADE - 0.1, proj.total - 0.05));
    const dir = path.join(out, "stills", id);
    claimDir(dir);
    const hf = await runHyperframes(["snapshot", proj.dir, "--at", times.map((t) => t.toFixed(3)).join(","), "--no-end", "--output", dir], {});
    const pngs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((f) => path.join(dir, f)) : [];
    if (hf.code !== 0 || pngs.length === 0) return { ok: false, id, error: hf.out.trim().split("\n").slice(-15).join("\n") };
    const sheetFile = path.join(out, "stills", `${id}-sheet.png`);
    const blocked = guardOutput(out, sheetFile, o.force);
    if (blocked) return { ok: false, id, error: blocked };
    const tmpSheet = path.join(dir, ".sheet.png");
    const sheet = contactSheet(pngs, tmpSheet, proj.fmt) ? (commitOutput(out, tmpSheet, sheetFile), sheetFile) : null;
    if (!o.json) console.log(sheet ?? `${dir} (contact sheet not created)`);
    return { ok: true, id, frames: pngs, sheet, at: times };
  });
  if (o.json && r.results) console.log(JSON.stringify({ ok: r.code === 0, outputs: r.results, warnings: r.warnings }, null, 2));
  else for (const x of r.results ?? []) if (!x.ok) console.error(`motion-use: still failed for ${x.id}:\n${x.error}`);
  return r.code;
}

function contactSheet(pngs, out, fmt) {
  const cols = fmt.vertical ? Math.min(pngs.length, 5) : Math.min(pngs.length, 3);
  const tw = fmt.vertical ? 360 : 640;
  const th = Math.round((tw * fmt.h) / fmt.w);
  const inputs = pngs.flatMap((p) => ["-i", p]);
  const scaled = pngs.map((_, i) => `[${i}:v]scale=${tw}:${th}[s${i}]`).join(";");
  const layout = pngs.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join("|");
  const filter = pngs.length === 1 ? `[0:v]scale=${tw}:${th}` : `${scaled};${pngs.map((_, i) => `[s${i}]`).join("")}xstack=inputs=${pngs.length}:layout=${layout}:fill=black`;
  fs.rmSync(out, { force: true });
  try {
    execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", filter, "-frames:v", "1", out], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    console.error(`motion-use: contact sheet not created (${e.code === "ENOENT" ? "ffmpeg not found" : e.stderr?.toString().trim()})`);
  }
  return fs.existsSync(out);
}

async function doctor(o) {
  const checks = [];
  const add = (name, ok, detail, fix) => checks.push({ name, ok, detail, ...(ok ? {} : { fix }) });
  const major = Number(process.versions.node.split(".")[0]);
  add("node", major >= 22, `v${process.versions.node}`, "install Node.js 22 or newer: https://nodejs.org");
  for (const bin of ["ffmpeg", "ffprobe"]) {
    try {
      const v = execFileSync(bin, ["-version"], { encoding: "utf8" }).split("\n")[0];
      add(bin, true, v);
    } catch {
      add(bin, false, "not found on PATH", process.platform === "darwin" ? "brew install ffmpeg" : "install ffmpeg with your package manager (e.g. apt install ffmpeg)");
    }
  }
  let engine;
  try {
    engine = hyperframesBin();
    add("engine", true, `hyperframes ${engine.version}`);
  } catch {
    add("engine", false, "hyperframes is not installed next to motion-use", "reinstall: curl -fsSL https://raw.githubusercontent.com/leeguooooo/motion-use/main/install.sh | sh");
  }
  if (engine) {
    if (o["install-browser"]) await runHyperframes(["browser", "ensure"], { echo: !o.json });
    const r = await runHyperframes(["browser", "path"], {});
    const p = r.out.trim().split("\n").pop();
    add("chrome", r.code === 0 && p && fs.existsSync(p), r.code === 0 ? p : "no Chrome found for rendering", "run: motion-use doctor --install-browser (downloads Chrome for rendering), or install Google Chrome");
  }
  for (const f of ["NotoSansSC[wght].ttf", "JetBrainsMono[wght].ttf"]) add(`font ${f}`, fs.existsSync(path.join(ROOT, "assets", "fonts", f)), "bundled", "reinstall motion-use");
  // Voiceover engines are optional: reported, never a failure.
  const azureReady = Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);
  const optional = [
    { name: "voiceover azure", ok: azureReady, detail: azureReady ? `region ${process.env.AZURE_SPEECH_REGION}` : "not configured (optional): set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION" },
    { name: "voiceover edge", ok: edgeAvailable(), detail: edgeAvailable() ? "edge-tts found (preview only)" : "not installed (optional): pip install edge-tts" },
  ];
  const defaultEngine = pickEngine();
  const ok = checks.every((c) => c.ok);
  if (o.json) console.log(JSON.stringify({ ok, version: VERSION, checks, optional, voiceover_default_engine: defaultEngine }, null, 2));
  else {
    for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name.padEnd(28)} ${c.detail}${c.fix ? `\n     fix: ${c.fix}` : ""}`);
    for (const c of optional) console.log(`${c.ok ? "ok  " : "--  "} ${c.name.padEnd(28)} ${c.detail}`);
    console.log(`voiceover default engine: ${defaultEngine}`);
    console.log(ok ? "all good" : "some checks failed");
  }
  return ok ? 0 : 1;
}

async function upgradeCmd(o) {
  return upgrade({ current: VERSION, root: ROOT, check: o.check, json: o.json });
}

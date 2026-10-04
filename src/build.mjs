// Brief -> one HyperFrames project per (language, format), ready to render.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FORMATS, collectText } from "./brief.mjs";
import { writeSubsets } from "./fonts.mjs";
import { esc, sec } from "./html.mjs";
import { writeMusic } from "./music.mjs";
import { renderScene } from "./scenes.mjs";
import { css, padFor } from "./styles.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SFX_DIR = path.join(ROOT, "assets", "sfx");
const FONT_DIR = path.join(ROOT, "assets", "fonts");

export const FADE = 0.4; // scene crossfade, seconds
export const VO_LEAD = 0.3; // silence before a scene's voiceover
export const VO_TAIL = 0.5; // silence after it, before the next scene starts fading in

export function audioSeconds(file) {
  let out;
  try {
    out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  } catch (e) {
    throw new Error(e.code === "ENOENT" ? "ffprobe not found; install ffmpeg (motion-use doctor shows how)" : `cannot read audio ${file}: ${e.stderr || e.message}`);
  }
  const s = Number.parseFloat(out.trim());
  if (!Number.isFinite(s) || s <= 0) throw new Error(`cannot read the duration of ${file}`);
  return s;
}

/**
 * Timeline for one language and format. Scene i+1 starts FADE seconds before
 * scene i ends. Voiceover i ends at least VO_TAIL seconds before scene i ends,
 * and voiceover i+1 starts FADE + VO_LEAD after scene i+1 starts, so two
 * voiceovers never overlap.
 */
export function plan(brief, lang, format, { probe = audioSeconds } = {}) {
  const [w, h] = FORMATS[format];
  const fmt = { w, h, vertical: h > w, name: format };
  const pad = padFor(fmt);
  const assets = new Map();
  const asset = (abs) => {
    if (!assets.has(abs)) assets.set(abs, `assets/media/${assets.size}${path.extname(abs).toLowerCase()}`);
    return assets.get(abs);
  };
  const ctx = { fmt, pad, style: brief.style, asset };
  let start = 0;
  const scenes = brief.scenes.map((scene, i) => {
    const r = renderScene(scene, lang, ctx);
    const voFile = scene.voiceover?.[lang];
    const vo = voFile ? probe(voFile) : 0;
    // An explicit duration never cuts off the scene's own animation.
    const base = Math.max(scene.duration ?? 0, r.content);
    const duration = Math.max(base, vo ? VO_LEAD + vo + VO_TAIL : 0, 1.5) + (i > 0 ? FADE : 0);
    const out = { id: scene.id, type: scene.type, start, duration, html: r.html, cues: r.cues, vo: voFile ? { file: voFile, seconds: vo, at: start + (i > 0 ? FADE : 0) + VO_LEAD } : null, stretched: vo > 0 && VO_LEAD + vo + VO_TAIL > base, raised: scene.duration !== undefined && r.content > scene.duration ? +r.content.toFixed(2) : null };
    start += duration - FADE;
    return out;
  });
  const total = Math.round((start + FADE) * 1000) / 1000;
  return { lang, format, fmt, pad, scenes, total, assets };
}

export const BUILD_MARK = ".motion-use-build";

/** Empty `dir` for reuse, but only if motion-use created it; never touch anything else. */
export function claimDir(dir) {
  if (fs.existsSync(dir)) {
    if (!fs.existsSync(path.join(dir, BUILD_MARK))) throw new Error(`${dir} exists and was not created by motion-use; refusing to overwrite it. Pick another --out.`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, BUILD_MARK), "created by motion-use; safe to delete\n");
}

export async function buildProject(brief, lang, format, outDir, opts = {}) {
  const p = plan(brief, lang, format, opts);
  claimDir(outDir);
  fs.mkdirSync(path.join(outDir, "assets", "media"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "assets", "audio"), { recursive: true });

  for (const [abs, rel] of p.assets) fs.copyFileSync(abs, path.join(outDir, rel));
  const fontSizes = await writeSubsets(collectText(brief, [lang]), path.join(outDir, "assets", "fonts"));
  // The subsets are modified fonts; their license travels with them.
  for (const f of fs.readdirSync(FONT_DIR).filter((f) => f.startsWith("OFL-"))) fs.copyFileSync(path.join(FONT_DIR, f), path.join(outDir, "assets", "fonts", f));

  const audio = [];
  let track = 10;
  const hasVo = p.scenes.some((s) => s.vo);
  if (brief.music.kind !== "none") {
    let src = "assets/audio/music.wav";
    if (brief.music.kind === "builtin") writeMusic(path.join(outDir, src), brief.style, p.total);
    else {
      src = `assets/audio/music${path.extname(brief.music.file).toLowerCase()}`;
      fs.copyFileSync(brief.music.file, path.join(outDir, src));
    }
    const vol = brief.music.volume * (hasVo ? 0.45 : 1);
    audio.push(`<audio id="mu-music" src="${src}" data-start="0" data-duration="${p.total}" data-volume="${vol.toFixed(3)}" data-fade-out="1.5" data-track-index="${track++}"></audio>`);
  }
  p.scenes.forEach((s, i) => {
    if (s.vo) {
      const src = `assets/audio/vo-${i}${path.extname(s.vo.file).toLowerCase()}`;
      fs.copyFileSync(s.vo.file, path.join(outDir, src));
      audio.push(`<audio id="mu-vo-${i}" src="${src}" data-start="${s.vo.at.toFixed(3)}" data-duration="${s.vo.seconds.toFixed(3)}" data-volume="${brief.voiceover?.volume ?? 1}" data-track-index="${track++}"></audio>`);
    }
  });
  if (brief.sfx) {
    const used = new Set();
    let n = 0;
    for (const s of p.scenes) {
      const offset = s.start;
      for (const c of s.cues) {
        const at = offset + c.at;
        if (at >= p.total - 0.3) continue;
        used.add(c.sfx);
        audio.push(`<audio id="mu-sfx-${n++}" src="assets/audio/${c.sfx}.wav" data-start="${at.toFixed(3)}" data-volume="${c.volume}" data-track-index="${track++}"></audio>`);
      }
    }
    for (const name of used) fs.copyFileSync(path.join(SFX_DIR, `${name}.wav`), path.join(outDir, "assets", "audio", `${name}.wav`));
  }

  const sections = p.scenes
    .map((s, i) => {
      const animIn = i > 0 ? `mu-scene-in ${sec(FADE)} linear 0s both` : "";
      const animOut = i < p.scenes.length - 1 ? `mu-scene-out ${sec(FADE)} linear ${sec(s.duration - FADE)} forwards` : "";
      const a = [animIn, animOut].filter(Boolean).join(", ");
      // Content animates from the scene's own start, so entrances overlap the crossfade.
      const inner = s.html;
      return `<section id="scene-${esc(s.id)}" class="clip mu-scene" data-start="${s.start.toFixed(3)}" data-duration="${s.duration.toFixed(3)}" data-track-index="${i % 2}"${a ? ` style="animation:${a}"` : ""}>${inner}</section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${p.fmt.w}, height=${p.fmt.h}">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data: blob:; connect-src 'self' data: blob:">
<title>${esc(brief.name)} ${esc(lang)} ${esc(format)}</title>
<style>${css(brief.style, p.fmt, brief.theme, p.pad)}</style>
</head>
<body>
<div id="root" data-composition-id="main" data-no-timeline data-start="0" data-duration="${p.total}" data-width="${p.fmt.w}" data-height="${p.fmt.h}">
${sections}
${audio.join("\n")}
</div>
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  return { ...p, fps: brief.fps, dir: outDir, fontSizes };
}

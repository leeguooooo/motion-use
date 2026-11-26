// Side-by-side frame comparison of two videos at given times: a left, b right, one row per time.
// compareVideoClip: the same two videos as one side-by-side video (title, labels, own start and speed).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { probeMeta } from "./breakdown.mjs";
import { rasterText } from "./text-raster.mjs";

export function compareVideos(a, b, out, { times, width = 640 } = {}) {
  if (!Array.isArray(times) || !times.length) throw new Error("compare needs at least one time (seconds)");
  if (!Number.isInteger(width) || width < 16) throw new Error(`width must be an integer ≥ 16, got ${width}`);
  const ma = probeMeta(a);
  const mb = probeMeta(b);
  // Last grabbable frame is one frame before the end.
  const limit = Math.min(ma.duration - 1 / ma.fps, mb.duration - 1 / mb.fps);
  for (const t of times) {
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > limit)
      throw new Error(`time ${t} is outside both videos (valid 0–${Math.max(0, limit).toFixed(2)} s; ${a} is ${ma.duration.toFixed(2)} s, ${b} is ${mb.duration.toFixed(2)} s)`);
  }
  const w = width - (width % 2);
  const even = (m) => Math.max(2, Math.round((w * m.height) / m.width / 2) * 2);
  const h = Math.max(even(ma), even(mb));
  const fit = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
  const args = ["-v", "error", "-y"];
  const f = [];
  times.forEach((t, i) => {
    args.push("-ss", String(t), "-i", a, "-ss", String(t), "-i", b);
    f.push(`[${2 * i}:v]trim=end_frame=1,${fit}[a${i}]`, `[${2 * i + 1}:v]trim=end_frame=1,${fit}[b${i}]`, `[a${i}][b${i}]hstack=inputs=2[r${i}]`);
  });
  if (times.length > 1) f.push(`${times.map((_, i) => `[r${i}]`).join("")}vstack=inputs=${times.length}[out]`);
  else f.push("[r0]null[out]");
  args.push("-filter_complex", f.join(";"), "-map", "[out]", "-frames:v", "1", "-update", "1", out);
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.error) throw new Error(r.error.code === "ENOENT" ? "ffmpeg not found; install ffmpeg" : r.error.message);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.trim().slice(-1500)}`);
  return { out, width: 2 * w, height: h * times.length, times };
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
// One value for both sides, or "a,b".
const pair = (v, def, name) => {
  const xs = v === undefined ? [def, def] : Array.isArray(v) ? v : [v, v];
  if (xs.length !== 2) throw new Error(`${name} takes one value or two (a,b), got ${xs.length}`);
  return xs;
};
// atempo takes 0.5–100 per stage; chain stages below 0.5.
const atempo = (k) => {
  const out = [];
  while (k < 0.5) (out.push("atempo=0.5"), (k /= 0.5));
  out.push(`atempo=${+k.toFixed(6)}`);
  return out.join(",");
};
// A text mask as a white RGBA PAM image with the mask as alpha (ffmpeg's pam decoder reads it).
function pam(mask, dir, name) {
  const { width, height, data } = mask;
  const head = new TextEncoder().encode(`P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`);
  const out = new Uint8Array(head.length + width * height * 4);
  out.set(head);
  for (let i = 0; i < data.length; i++) out.set([255, 255, 255, data[i]], head.length + i * 4);
  const file = path.join(dir, name);
  fs.writeFileSync(file, out);
  return file;
}

/**
 * The same comparison as a video: an optional title on top, a on the left and b on the right playing
 * at the same time, each labelled underneath. Each side has its own start (from, seconds into that
 * file) and speed (2 plays twice as fast). The film lasts as long as the longer side; the shorter one
 * holds its last frame. Text is drawn with the bundled font, so ffmpeg needs no drawtext.
 * opts: { labels: [a, b], title, from: n | [a, b], speed: n | [a, b], duration, width (per side),
 *         fps, audio: "none" | "a" | "b" }
 */
export function compareVideoClip(a, b, out, { labels, title = "", from, speed, duration, width = 640, fps = 30, audio = "none" } = {}) {
  if (!Number.isInteger(width) || width < 16) throw new Error(`width must be an integer ≥ 16, got ${width}`);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 120) throw new Error(`fps must be > 0 and ≤ 120, got ${fps}`);
  if (!["none", "a", "b"].includes(audio)) throw new Error(`audio must be none, a or b, got ${audio}`);
  const files = [a, b],
    metas = files.map(probeMeta),
    starts = pair(from, 0, "from"),
    speeds = pair(speed, 1, "speed");
  const names = labels ?? files.map((f) => path.basename(f, path.extname(f)));
  if (names.length !== 2) throw new Error(`labels takes two names (a,b), got ${names.length}`);
  const lengths = files.map((f, i) => {
    const m = metas[i],
      s = starts[i],
      k = speeds[i];
    if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s >= m.duration)
      throw new Error(`from ${s} is outside ${f} (0–${m.duration.toFixed(2)} s)`);
    if (typeof k !== "number" || !Number.isFinite(k) || k < 0.1 || k > 16) throw new Error(`speed must be 0.1–16, got ${k}`);
    return (m.duration - s) / k;
  });
  const total = duration ?? Math.max(...lengths);
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) throw new Error(`duration must be > 0 seconds, got ${duration}`);
  if (audio !== "none" && !hasAudio(files[audio === "a" ? 0 : 1])) throw new Error(`${files[audio === "a" ? 0 : 1]} has no audio track (--audio none)`);

  const w = even(width),
    h = Math.max(...metas.map((m) => even((w * m.height) / m.width)));
  const margin = even(w * 0.04),
    titleH = title ? even(w * 0.13) : 0,
    labelH = even(w * 0.1);
  const W = even(2 * w + 3 * margin),
    H = even(margin + titleH + h + labelH + margin / 2);
  const top = margin + titleH;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-compare-"));
  try {
    const marks = [];
    if (title) marks.push({ mask: rasterText(title, titleH * 0.58, { weight: 700, maxWidth: W - 2 * margin }), cx: W / 2, cy: margin / 2 + titleH / 2 });
    names.forEach((n, i) => {
      if (String(n).trim()) marks.push({ mask: rasterText(String(n), labelH * 0.5, { weight: 600, maxWidth: w }), cx: margin + i * (w + margin) + w / 2, cy: top + h + labelH / 2 });
    });
    const args = ["-v", "error", "-y"];
    files.forEach((f, i) => args.push("-ss", String(starts[i]), "-i", f));
    marks.forEach((m, i) => args.push("-i", pam(m.mask, work, `text${i}.pam`)));
    const fit = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    const f = [`color=c=0x111111:s=${W}x${H}:r=${fps}:d=${total}[bg]`];
    files.forEach((_, i) =>
      f.push(`[${i}:v]setpts=(PTS-STARTPTS)/${speeds[i]},fps=${fps},${fit},tpad=stop_mode=clone:stop_duration=${Math.ceil(total + 1)}[p${i}]`),
    );
    f.push(`[bg][p0]overlay=${margin}:${top}:shortest=1[s0]`, `[s0][p1]overlay=${2 * margin + w}:${top}:shortest=1[s1]`);
    let last = "s1";
    marks.forEach((m, i) => {
      const x = Math.round(m.cx - m.mask.width / 2),
        y = Math.round(m.cy - m.mask.height / 2);
      f.push(`[${last}][${2 + i}:v]overlay=${x}:${y}:eof_action=repeat[t${i}]`);
      last = `t${i}`;
    });
    f.push(`[${last}]format=yuv420p[v]`);
    if (audio !== "none") {
      const i = audio === "a" ? 0 : 1;
      f.push(`[${i}:a]asetpts=PTS-STARTPTS,${atempo(speeds[i])},apad[a]`);
    }
    args.push("-filter_complex", f.join(";"), "-map", "[v]");
    if (audio !== "none") args.push("-map", "[a]", "-c:a", "aac", "-b:a", "192k");
    args.push("-t", String(total), "-r", String(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out);
    const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
    if (r.error) throw new Error(r.error.code === "ENOENT" ? "ffmpeg not found; install ffmpeg" : r.error.message);
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.trim().slice(-1500)}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return {
    out,
    width: W,
    height: H,
    duration: +total.toFixed(3),
    fps,
    title: title || null,
    sides: files.map((file, i) => ({ file, label: names[i], from: starts[i], speed: speeds[i], seconds: +lengths[i].toFixed(3), held: +Math.max(0, total - lengths[i]).toFixed(3) })),
    audio,
  };
}

function hasAudio(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

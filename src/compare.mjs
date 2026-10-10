// Side-by-side frame comparison of two videos at given times: a left, b right, one row per time.
import { spawnSync } from "node:child_process";
import { probeMeta } from "./breakdown.mjs";

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

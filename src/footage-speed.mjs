// Automatic footage speed (issue #128) and footage-time anchors (issue #129).
// A long screen recording is cut into still and moving spans (ffmpeg freezedetect); still
// spans play faster than moving ones, manual ranges keep their own speed, and short spans
// merge into a neighbour so the speed does not jump back and forth. Each span is encoded
// on its own (bounded memory) with an exact frame count, so the "source second → output
// second" map written beside the MP4 describes the real encode. Narration lines can then
// be anchored to source seconds or named marks and land at the right film time.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { mediaInfo } from "./build.mjs";

export const SPEED_DEFAULTS = Object.freeze({ still: 3, motion: 2, noise: "-60dB", freeze: 0.5, minSegment: 1.5 });
export const SPEED_MAP_VERSION = 1;
const EPS = 1e-6;
const r3 = (x) => Math.round(x * 1000) / 1000;

/** Freeze spans from freezedetect's log; a freeze still open at EOF ends at the source end. */
export function parseFreezes(log, duration) {
  const out = [];
  let open = null;
  for (const m of String(log).matchAll(/lavfi\.freezedetect\.freeze_(start|end):\s*(-?[\d.]+(?:e-?\d+)?)/g)) {
    const t = Number(m[2]);
    if (!Number.isFinite(t)) continue;
    if (m[1] === "start") open = Math.max(0, t);
    else if (open !== null) {
      if (t > open) out.push({ from: open, to: Math.min(t, duration ?? t) });
      open = null;
    }
  }
  if (open !== null && duration !== undefined && duration > open) out.push({ from: open, to: duration });
  return out;
}

/** "120-150:1.2" → {from:120, to:150, speed:1.2} */
export function parseSpeedRange(s) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(String(s));
  if (!m) throw new Error('a range is "from-to:speed" in source seconds, e.g. 120-150:1.2');
  return { from: Number(m[1]), to: Number(m[2]), speed: Number(m[3]) };
}

function checkSpeed(v, name) {
  if (!Number.isFinite(v) || v < 0.25 || v > 16) throw new Error(name + " must be a speed from 0.25 to 16");
}

/**
 * Still/moving spans → speed segments covering [0, duration].
 * policy: {still, motion, minSegment, ranges:[{from,to,speed}]}. Manual ranges are never
 * merged away; auto spans shorter than minSegment join their longer auto neighbour.
 */
export function planSpeed({ duration, freezes = [], still = SPEED_DEFAULTS.still, motion = SPEED_DEFAULTS.motion, minSegment = SPEED_DEFAULTS.minSegment, ranges = [] }) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("source duration must be positive");
  checkSpeed(still, "still");
  checkSpeed(motion, "motion");
  if (!Number.isFinite(minSegment) || minSegment < 0 || minSegment > 60) throw new Error("min segment must be 0–60 seconds");
  const manual = [...ranges].map((r) => ({ ...r })).sort((a, b) => a.from - b.from);
  manual.forEach((r, i) => {
    checkSpeed(r.speed, "range speed");
    if (!(r.from >= 0 && r.to > r.from)) throw new Error("range " + r.from + "-" + r.to + ": needs 0 <= from < to");
    if (r.from >= duration - EPS) throw new Error("range " + r.from + "-" + r.to + " starts after the source ends (" + r3(duration) + " s)");
    r.to = Math.min(r.to, duration);
    if (i && r.from < manual[i - 1].to - EPS) throw new Error("ranges " + manual[i - 1].from + "-" + manual[i - 1].to + " and " + r.from + "-" + r.to + " overlap");
  });
  // Still/moving spans over the whole source.
  const base = [];
  let t = 0;
  for (const f of [...freezes].sort((a, b) => a.from - b.from)) {
    const from = Math.max(t, f.from), to = Math.min(duration, f.to);
    if (to <= from + EPS) continue;
    if (from > t + EPS) base.push({ from: t, to: from, kind: "motion" });
    base.push({ from, to, kind: "still" });
    t = to;
  }
  if (t < duration - EPS) base.push({ from: t, to: duration, kind: "motion" });
  // Cut the auto spans out where manual ranges sit; group the remaining pieces by gap.
  const gaps = [];
  let cursor = 0;
  for (const r of [...manual, { from: duration, to: duration }]) {
    if (r.from > cursor + EPS) gaps.push({ from: cursor, to: r.from });
    cursor = r.to;
  }
  const segments = manual.map((r) => ({ from: r.from, to: r.to, kind: "manual", speed: r.speed }));
  for (const g of gaps) {
    let pieces = base
      .map((b) => ({ from: Math.max(b.from, g.from), to: Math.min(b.to, g.to), kind: b.kind }))
      .filter((b) => b.to > b.from + EPS);
    pieces = mergeShort(pieces, minSegment);
    segments.push(...pieces.map((p) => ({ ...p, speed: p.kind === "still" ? still : motion })));
  }
  segments.sort((a, b) => a.from - b.from);
  // Neighbours at the same speed and kind become one segment.
  const out = [];
  for (const s of segments) {
    const last = out.at(-1);
    if (last && last.kind === s.kind && last.speed === s.speed && Math.abs(last.to - s.from) < EPS) last.to = s.to;
    else out.push({ ...s });
  }
  return out;
}

function mergeShort(pieces, minSegment) {
  const list = pieces.map((p) => ({ ...p }));
  const join = () => {
    for (let i = 0; i + 1 < list.length; i++)
      if (list[i].kind === list[i + 1].kind) {
        list[i].to = list[i + 1].to;
        list.splice(i + 1, 1);
        i--;
      }
  };
  join();
  while (list.length > 1) {
    let k = -1;
    for (let i = 0; i < list.length; i++)
      if (list[i].to - list[i].from < minSegment - EPS && (k < 0 || list[i].to - list[i].from < list[k].to - list[k].from)) k = i;
    if (k < 0) break;
    const prev = list[k - 1], next = list[k + 1];
    const into = !prev ? next : !next ? prev : prev.to - prev.from >= next.to - next.from ? prev : next;
    list[k].kind = into.kind;
    join();
  }
  return list;
}

/** Output placement for each segment at the given fps: an exact whole number of frames each. */
export function layoutSpeed(segments, fps) {
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) throw new Error("fps must be > 0 and <= 240");
  let frame = 0;
  return segments.map((s) => {
    const frames = Math.max(1, Math.round((s.to - s.from) / s.speed * fps));
    const start = frame / fps;
    frame += frames;
    return { ...s, frames, start, end: frame / fps };
  });
}

/** Source second → output second through a speed map (piecewise linear, clamped at the ends). */
export function mapSourceTime(map, t) {
  const segs = map?.segments ?? [];
  if (!segs.length) return t;
  if (!Number.isFinite(t)) throw new Error("source time must be a number");
  if (t < segs[0].from - EPS || t > segs.at(-1).to + EPS)
    throw new Error("source second " + t + " is outside the mapped source (" + r3(segs[0].from) + "–" + r3(segs.at(-1).to) + " s)");
  const s = segs.find((x) => t <= x.to + EPS) ?? segs.at(-1);
  const share = s.to > s.from ? (Math.min(Math.max(t, s.from), s.to) - s.from) / (s.to - s.from) : 0;
  return s.start + share * (s.end - s.start);
}

/** atempo accepts 0.5–2 per stage (older ffmpeg); chain stages to keep pitch at any speed. */
export function atempoChain(speed) {
  checkSpeed(speed, "speed");
  const stages = [];
  let left = speed;
  while (left > 2 + EPS) (stages.push(2), (left /= 2));
  while (left < 0.5 - EPS) (stages.push(0.5), (left /= 0.5));
  if (Math.abs(left - 1) > EPS || !stages.length) stages.push(+left.toFixed(6));
  return stages.map((x) => "atempo=" + x).join(",");
}

/** Validate a parsed speed map file; throws with the problem. */
export function checkSpeedMap(map) {
  if (!map || typeof map !== "object" || map.version !== SPEED_MAP_VERSION || !Array.isArray(map.segments) || !map.segments.length)
    throw new Error("not a motion-use speed map (version " + SPEED_MAP_VERSION + ", segments); make it with motion-use footage speed");
  let prev = null;
  for (const s of map.segments) {
    if (![s.from, s.to, s.start, s.end, s.speed].every(Number.isFinite) || s.to <= s.from || s.end <= s.start)
      throw new Error("speed map segment needs from < to and start < end");
    if (prev && (Math.abs(prev.to - s.from) > 1e-3 || Math.abs(prev.end - s.start) > 1e-3)) throw new Error("speed map segments must be contiguous");
    prev = s;
  }
  if (map.marks !== undefined) checkMarks(map.marks, "marks");
  return map;
}

export function checkMarks(marks, where = "marks") {
  if (!marks || typeof marks !== "object" || Array.isArray(marks)) throw new Error(where + ": a map of mark name to source second");
  for (const [k, v] of Object.entries(marks)) {
    if (!/^[a-z][a-z0-9-]{0,39}$/i.test(k)) throw new Error(where + "." + k + ": a name: a letter, then letters, digits or -");
    if (!Number.isFinite(v) || v < 0 || v > 86400) throw new Error(where + "." + k + ": a source second, 0–86400");
  }
  return marks;
}

/**
 * Film second of a footage anchor {footage, t | mark, offset}. clip is the raw film.json
 * videos entry plus its resolved start (clipStart) and optional map; window is
 * {length} in film seconds when known, so anchors outside the played clip fail.
 */
export function footageAnchorTime(anchor, clip, { clipStart, map, length } = {}) {
  const hasT = anchor.t !== undefined, hasMark = anchor.mark !== undefined;
  if (hasT === hasMark) throw new Error("a footage anchor takes t (source second) or mark, not both");
  let t = anchor.t;
  if (hasMark) {
    const marks = { ...(map?.marks ?? {}), ...(clip.marks ?? {}) };
    if (!Object.hasOwn(marks, anchor.mark)) throw new Error("footage " + anchor.footage + " has no mark " + JSON.stringify(anchor.mark) + (Object.keys(marks).length ? " (marks: " + Object.keys(marks).join(", ") + ")" : "; add videos." + anchor.footage + ".marks"));
    t = marks[anchor.mark];
  }
  if (!Number.isFinite(t) || t < 0) throw new Error("t must be a non-negative source second");
  const out = map ? mapSourceTime(map, t) : t;
  const from = clip.from ?? 0, rate = clip.rate ?? 1;
  const into = (out - from) / rate;
  if (into < -EPS || (length !== undefined && into > length + EPS))
    throw new Error("source second " + t + (map ? " (" + r3(out) + " s in the sped-up file)" : "") + " is not in the played part of footage " + anchor.footage + " (from " + from + " s, " + (length !== undefined ? r3(length) + " film s" : "open") + " at rate " + rate + ")");
  return clipStart + Math.max(0, into) + (anchor.offset ?? 0);
}

/**
 * Lay out anchored narration lines for one language.
 * lines: [{id, anchor (film s, null when unknown), gap}] in spoken order; lengths: {id: seconds}.
 * Each line starts at max(anchor, previous end + gap). Returns per-line start, pushed (how
 * far it slid past its anchor) and overflow (seconds past the last usable second).
 */
export function scheduleLines(lines, lengths, { end, gap = 0.4 } = {}) {
  let prevEnd = -Infinity;
  return lines.map((l) => {
    const length = lengths[l.id];
    if (l.anchor === null || l.anchor === undefined || !Number.isFinite(length)) return { id: l.id, anchor: l.anchor ?? null, pending: true };
    const start = Math.max(l.anchor, prevEnd + (l.gap ?? gap));
    prevEnd = start + length;
    return { id: l.id, anchor: l.anchor, start, end: prevEnd, length, pushed: start - l.anchor, overflow: end === undefined ? 0 : Math.max(0, prevEnd - end) };
  });
}

function speedSidecar(out) {
  return out.replace(/\.[^./\\]+$/, "") + ".speed.json";
}

function ffmpegErr(e) {
  if (e.code === "ENOENT") return new Error("ffmpeg not found; install ffmpeg (motion-use doctor shows how)");
  return new Error(String(e.stderr || e.message).trim().split("\n").slice(-4).join("\n"));
}

function probeFps(file) {
  try {
    const r = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate,r_frame_rate", "-of", "json", file], { encoding: "utf8" });
    const s = JSON.parse(r).streams?.[0] ?? {};
    for (const v of [s.avg_frame_rate, s.r_frame_rate]) {
      const [a, b] = String(v ?? "").split("/").map(Number);
      const fps = b ? a / b : a;
      if (Number.isFinite(fps) && fps > 0 && fps <= 240) return fps;
    }
  } catch {}
  return 30;
}

/** Run freezedetect over a file; returns freeze spans in source seconds. */
export function detectFreezes(file, { noise = SPEED_DEFAULTS.noise, freeze = SPEED_DEFAULTS.freeze, duration } = {}) {
  if (!/^(-?\d+(\.\d+)?dB|0?\.\d+|0|1)$/.test(String(noise))) throw new Error('noise is a level such as -60dB or 0.001');
  if (!Number.isFinite(freeze) || freeze < 0.04 || freeze > 600) throw new Error("freeze must be 0.04–600 seconds");
  // freezedetect reports on stderr at info level.
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:v:0", "-vf", "freezedetect=n=" + noise + ":d=" + freeze, "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.error) throw ffmpegErr(r.error);
  if (r.status !== 0) throw ffmpegErr({ stderr: r.stderr });
  return parseFreezes(r.stderr, duration);
}

/**
 * Speed up a recording by its motion: writes out (MP4) and out-without-ext.speed.json.
 * Returns {file, map, segments, duration, source_duration}.
 */
export function speedFootage(input, { out, still, motion, noise, freeze, minSegment, ranges = [], marks, fps: wantFps, force = false } = {}) {
  const src = path.resolve(input);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) throw new Error(input + " does not exist");
  if (!out) throw new Error("--out <new.mp4> is required; the source recording is never changed");
  const target = path.resolve(out);
  if (!/\.mp4$/i.test(target)) throw new Error("--out must be an .mp4 file");
  if (target === src) throw new Error("--out must differ from the source");
  const sidecar = speedSidecar(target);
  for (const f of [target, sidecar]) if (fs.existsSync(f) && !force) throw new Error(f + " already exists; choose a fresh --out or pass --force");
  if (marks !== undefined) checkMarks(marks);
  const info = mediaInfo(src);
  if (!Number.isFinite(info.duration) || info.duration <= 0) throw new Error(input + ": duration unknown");
  const fps = wantFps ?? probeFps(src);
  const policy = { still: still ?? SPEED_DEFAULTS.still, motion: motion ?? SPEED_DEFAULTS.motion, noise: noise ?? SPEED_DEFAULTS.noise, freeze: freeze ?? SPEED_DEFAULTS.freeze, minSegment: minSegment ?? SPEED_DEFAULTS.minSegment, ranges };
  const freezes = detectFreezes(src, { noise: policy.noise, freeze: policy.freeze, duration: info.duration });
  const segments = layoutSpeed(planSpeed({ duration: info.duration, freezes, ...policy }), fps);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-speed-"));
  try {
    const parts = segments.map((s, i) => {
      const part = path.join(work, String(i).padStart(4, "0") + ".mp4");
      const seconds = s.frames / fps;
      const args = ["-v", "error", "-y", "-ss", String(s.from), "-t", String(s.to - s.from), "-i", src,
        ...(info.audio ? [] : ["-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=48000:cl=stereo"]),
        "-map", "0:v:0", "-map", info.audio ? "0:a:0" : "1:a:0",
        "-vf", "setpts=(PTS-STARTPTS)/" + s.speed + ",fps=" + fps + ",format=yuv420p",
        ...(info.audio ? ["-af", "asetpts=PTS-STARTPTS," + atempoChain(s.speed) + ",apad"] : []),
        "-frames:v", String(s.frames), "-t", String(seconds),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", part];
      try {
        execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
      } catch (e) {
        throw ffmpegErr(e);
      }
      return part;
    });
    const list = path.join(work, "list.txt");
    fs.writeFileSync(list, parts.map((p) => "file '" + p.replace(/'/g, "'\\''") + "'").join("\n") + "\n");
    const tmp = target + ".partial.mp4";
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", tmp], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      throw ffmpegErr(e);
    }
    fs.renameSync(tmp, target);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  const outInfo = mediaInfo(target);
  const total = segments.at(-1).end;
  const map = {
    version: SPEED_MAP_VERSION,
    source: { file: path.relative(path.dirname(sidecar), src), duration: r3(info.duration), audio: info.audio },
    output: { file: path.basename(target), duration: r3(total), fps, bytes: fs.statSync(target).size },
    policy,
    ...(marks ? { marks } : {}),
    segments: segments.map((s) => ({ from: r3(s.from), to: r3(s.to), kind: s.kind, speed: s.speed, start: +s.start.toFixed(6), end: +s.end.toFixed(6), frames: s.frames })),
  };
  fs.writeFileSync(sidecar, JSON.stringify(map, null, 2) + "\n");
  return { ok: true, file: target, map: sidecar, source_duration: r3(info.duration), duration: r3(total), measured_duration: outInfo.duration === null ? null : r3(outInfo.duration), segments: map.segments };
}

// Measure the delivered MP4, never the pre-render plan. Visual quality remains a review task.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { claimDir } from "./build.mjs";

const run = (bin, args) =>
  execFileSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
export function probeVideo(file) {
  const j = JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,width,height,avg_frame_rate,nb_frames",
      "-of",
      "json",
      file,
    ]),
  );
  const v = j.streams.find((s) => s.codec_type === "video");
  if (!v) throw new Error("output contains no video stream");
  const rate = String(v.avg_frame_rate).split("/").map(Number);
  return {
    width: v.width,
    height: v.height,
    fps: rate[0] / rate[1],
    seconds: Number(j.format.duration),
    frames: Number(v.nb_frames) || null,
    audio: j.streams.some((s) => s.codec_type === "audio"),
  };
}

export function loudness(file) {
  const r = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-af",
      "loudnorm=I=-14:TP=-1:LRA=11:print_format=json",
      "-vn",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (r.error || r.status !== 0)
    throw new Error(r.error?.message || r.stderr.slice(-1500));
  const json = r.stderr.slice(
      r.stderr.lastIndexOf("{"),
      r.stderr.lastIndexOf("}") + 1,
    ),
    m = JSON.parse(json);
  return m;
}

export function normalizeAudio(file, output) {
  if (!probeVideo(file).audio) return { applied: false, reason: "no audio" };
  const m = loudness(file);
  if (!Number.isFinite(Number(m.input_i)))
    return { applied: false, reason: "silent audio" };
  const filter = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    file,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-c:v",
    "copy",
    "-af",
    filter,
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    output,
  ]);
  return { applied: true, target_lufs: -14, target_peak_dbtp: -1 };
}

export function reviewTimes(seconds, fps, shots = []) {
  const values = [
    0,
    Math.min(0.2, seconds / 2),
    Math.max(0, seconds - 1 / fps),
  ];
  for (const s of shots)
    values.push(
      s.start,
      Math.max(0, s.start - 1 / fps),
      Math.min(seconds - 1 / fps, s.start + 1 / fps),
      (s.start + s.end) / 2,
      Math.max(s.start, s.end - 1 / fps),
    );
  if (!shots.length)
    for (let t = seconds / 8; t < seconds; t += seconds / 8) values.push(t);
  return [
    ...new Set(
      values
        .filter((t) => t >= 0 && t < seconds)
        .map((t) => +(Math.round(t * fps) / fps).toFixed(6)),
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, 160);
}

export function compareDelivery(meta, expected = {}) {
  const errors = [];
  if (!Number.isFinite(meta.seconds) || meta.seconds <= 0)
    errors.push("invalid output duration");
  if (
    expected.duration !== undefined &&
    Math.abs(meta.seconds - expected.duration) >
      Math.max(0.12, 2 / (expected.fps || meta.fps))
  )
    errors.push(
      `duration ${meta.seconds}s differs from planned ${expected.duration}s`,
    );
  if (
    expected.width !== undefined &&
    (meta.width !== expected.width || meta.height !== expected.height)
  )
    errors.push(
      `output is ${meta.width}×${meta.height}, expected ${expected.width}×${expected.height}`,
    );
  if (expected.fps !== undefined && Math.abs(meta.fps - expected.fps) > 0.01)
    errors.push(`output fps ${meta.fps} differs from ${expected.fps}`);
  if (expected.audio === true && !meta.audio)
    errors.push("expected audio is missing");
  return errors;
}

export function verifyVideo(file, outDir, { expected = {}, shots = [] } = {}) {
  file = path.resolve(file);
  const meta = probeVideo(file),
    errors = compareDelivery(meta, expected),
    warnings = [];
  claimDir(outDir);
  const decode = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-xerror",
      "-i",
      file,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (decode.error || decode.status !== 0)
    errors.push(
      `decode failed: ${decode.error?.message || decode.stderr.slice(-800)}`,
    );
  let sound = null;
  if (meta.audio)
    try {
      const m = loudness(file);
      sound = {
        integrated_lufs: Number.isFinite(Number(m.input_i))
          ? Number(m.input_i)
          : null,
        true_peak_dbtp: Number.isFinite(Number(m.input_tp))
          ? Number(m.input_tp)
          : null,
        loudness_range_lu: Number(m.input_lra),
      };
      if (sound.integrated_lufs === null)
        warnings.push("audio stream is silent");
      if (sound.true_peak_dbtp > -0.5)
        warnings.push("audio peak exceeds -0.5 dBTP");
      if (
        sound.integrated_lufs !== null &&
        (sound.integrated_lufs < -20 || sound.integrated_lufs > -10)
      )
        warnings.push(
          "integrated loudness is outside the working -20 to -10 LUFS range",
        );
    } catch (e) {
      errors.push(`audio measurement failed: ${e.message}`);
    }
  const scan = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-vf",
      "blackdetect=d=0.2:pix_th=0.02,freezedetect=n=-50dB:d=0.8",
      "-an",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const black = [
    ...String(scan.stderr).matchAll(
      /black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g,
    ),
  ].map((m) => ({
    start: Number(m[1]),
    end: Number(m[2]),
    seconds: Number(m[3]),
  }));
  const freezes = [];
  for (const m of String(scan.stderr).matchAll(
    /freeze_(start|end): ([\d.]+)/g,
  )) {
    if (m[1] === "start") freezes.push({ start: Number(m[2]) });
    else if (freezes.length) {
      const f = freezes.at(-1);
      f.end = Number(m[2]);
      f.seconds = +(f.end - f.start).toFixed(4);
    }
  }
  for (const f of freezes)
    if (f.end === undefined) {
      f.end = meta.seconds;
      f.seconds = +(f.end - f.start).toFixed(4);
    }
  if (scan.error || scan.status !== 0)
    errors.push("black/freeze analysis failed");
  if (black.length)
    warnings.push(
      `${black.length} dark interval(s): review whether these are intended`,
    );
  if (freezes.length)
    warnings.push(
      `${freezes.length} still interval(s) over 0.8s: review reading holds and dead time`,
    );
  const times = reviewTimes(meta.seconds, meta.fps, shots),
    frames = [];
  for (const [i, t] of times.entries()) {
    const frame = path.join(outDir, `frame-${String(i).padStart(3, "0")}.png`);
    run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-ss",
      String(t),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      "scale=480:-2",
      frame,
    ]);
    frames.push({ at: t, file: frame });
  }
  const sheet = path.join(outDir, "contact.png"),
    cols = meta.height > meta.width ? 5 : 4;
  // Input PNGs are numbered contiguously; no quoting-sensitive concat file.
  run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-framerate",
    "1",
    "-i",
    path.join(outDir, "frame-%03d.png"),
    "-vf",
    `scale=320:-2,tile=${cols}x${Math.ceil(frames.length / cols)}`,
    "-frames:v",
    "1",
    sheet,
  ]);
  const sections = [];
  if (meta.audio)
    for (const [i, s] of shots.entries()) {
      const start = Math.max(0, s.start),
        end = Math.min(meta.seconds, s.end);
      if (end <= start) continue;
      const r = spawnSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-nostats",
          "-ss",
          String(start),
          "-i",
          file,
          "-t",
          String(end - start),
          "-af",
          "astats=metadata=0:reset=0",
          "-vn",
          "-f",
          "null",
          "-",
        ],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      );
      const all = [...String(r.stderr).matchAll(/RMS level dB: ([-\d.inf]+)/g)],
        value = all.at(-1)?.[1];
      if (r.error || r.status !== 0)
        errors.push(`section audio measurement failed at ${start}s`);
      sections.push({
        id: s.id ?? `shot-${i}`,
        start,
        end,
        rms_dbfs: Number.isFinite(Number(value)) ? Number(value) : null,
      });
    }
  const report = {
    version: 1,
    ok: errors.length === 0,
    file,
    observed: meta,
    expected,
    audio: sound,
    section_audio: sections,
    errors,
    warnings,
    black_intervals: black,
    still_intervals: freezes,
    frames,
    sheet,
    visual_review: "pending",
    limitations: [
      "Measurements and sampled frames do not judge design quality, narrative coherence, subtitle readability or listening quality.",
      "Black and still intervals are review signals, not automatic aesthetic failures.",
    ],
  };
  const reportFile = path.join(outDir, "report.json");
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
  return { ...report, report: reportFile };
}

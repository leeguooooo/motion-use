#!/usr/bin/env node
// Builds the bundled UI sound effects (assets/sfx/{type,delete,select,pop,tick,rise}.wav) from
// nothing but ffmpeg's lavfi sources: sine tones written as aevalsrc expressions and seeded white
// noise (anoisesrc), shaped by envelope expressions, then peak-normalised to -3 dBFS. Original
// synthesis, no recorded or third-party material; the same ffmpeg gives the same files.
//   node scripts/make-ui-sfx.mjs [outDir]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, "assets", "sfx"));
fs.mkdirSync(OUT, { recursive: true });
const SR = 44100; // same as the other bundled effects: 44.1 kHz, stereo, 16-bit PCM
const PEAK_DB = -3;

// A 1.5 ms linear attack so no sound starts with a jump; every sound also fades to silence at its end.
const attack = "min(1,t/0.0015)";
const PI2 = "2*PI";

/**
 * dur: seconds. tone: aevalsrc expression in t (or null). noise: {seed, filters, env, gain}: seeded
 * white noise through those filters, multiplied by env (an expression in t). tail: fade-out seconds.
 */
const SOUNDS = {
  // one soft key tap: a short band of noise around 2.6 kHz over a faint low knock
  type: {
    dur: 0.09, tail: 0.02,
    tone: `0.35*sin(${PI2}*190*t)*exp(-t*70)*${attack}`,
    noise: { seed: 11, filters: "highpass=f=900,bandpass=f=2600:width_type=q:w=1.2", env: `exp(-t*95)*${attack}`, gain: 1 },
  },
  // backspace: the same kind of tap, lower and duller (darker band, deeper knock, slightly longer)
  delete: {
    dur: 0.11, tail: 0.025,
    tone: `0.45*sin(${PI2}*120*t)*exp(-t*55)*${attack}`,
    noise: { seed: 23, filters: "highpass=f=300,bandpass=f=1300:width_type=q:w=1.0,lowpass=f=2200", env: `exp(-t*75)*${attack}`, gain: 1 },
  },
  // a light UI click-blip: a soft click and a short 1.32 kHz sine that drops a touch in pitch
  select: {
    dur: 0.13, tail: 0.03,
    tone: `sin(${PI2}*(1320*t-0.5*60*t*t))*exp(-t*38)*${attack}`,
    noise: { seed: 37, filters: "highpass=f=3000", env: `exp(-t*400)*${attack}`, gain: 0.25 },
  },
  // a bubbly pop: a sine whose pitch springs from 320 to ~920 Hz in a few tens of ms
  pop: {
    dur: 0.16, tail: 0.04,
    tone: `sin(${PI2}*(320*t+600*(t-(1-exp(-t*55))/55)))*exp(-t*30)*${attack}`,
    noise: null,
  },
  // a clock tick: a very short bright click with a small 2.2 kHz ring
  tick: {
    dur: 0.06, tail: 0.015,
    tone: `0.5*sin(${PI2}*2200*t)*exp(-t*110)*${attack}`,
    noise: { seed: 41, filters: "highpass=f=2500,bandpass=f=4200:width_type=q:w=1.5", env: `exp(-t*260)*${attack}`, gain: 1 },
  },
  // a 0.8 s riser: a sine sweeping exponentially 200 -> 1600 Hz with an airy noise swell, loudest near the end
  rise: {
    dur: 0.8, tail: 0.06,
    tone: `0.6*sin(${PI2}*200*0.8/log(8)*(pow(8,t/0.8)-1))*pow(t/0.8,1.6)*${attack}`,
    noise: { seed: 53, filters: "highpass=f=1500,lowpass=f=7000", env: `0.5*pow(t/0.8,2.2)*${attack}`, gain: 1 },
  },
};

function graph(s, gain = 1) {
  const fade = `afade=t=out:st=${(s.dur - s.tail).toFixed(4)}:d=${s.tail}`;
  const parts = [];
  const legs = [];
  if (s.tone) {
    parts.push(`aevalsrc='${s.tone}':s=${SR}:d=${s.dur}[tone]`);
    legs.push("[tone]");
  }
  if (s.noise) {
    parts.push(
      `anoisesrc=d=${s.dur}:c=white:r=${SR}:a=0.5:seed=${s.noise.seed},${s.noise.filters},asetnsamples=n=16:p=0,volume='${s.noise.gain}*${s.noise.env}':eval=frame[noise]`,
    );
    legs.push("[noise]");
  }
  const sum = legs.length > 1 ? `${legs.join("")}amix=inputs=${legs.length}:normalize=0,` : `${legs[0]}anull,`;
  parts.push(`${sum}atrim=0:${s.dur},${fade},volume=${gain.toFixed(6)},aformat=channel_layouts=stereo[out]`);
  return parts.join(";");
}

function maxVolume(s) {
  const r = execFileSync(
    "sh",
    ["-c", 'ffmpeg -hide_banner -nostats -filter_complex "$0" -map "[o]" -f null - 2>&1', graph(s) + ";[out]volumedetect[o]"],
    { encoding: "utf8" },
  );
  const m = r.match(/max_volume:\s*(-?[\d.]+) dB/);
  if (!m) throw new Error(`volumedetect failed:\n${r}`);
  return Number(m[1]);
}

for (const [name, s] of Object.entries(SOUNDS)) {
  const gain = 10 ** ((PEAK_DB - maxVolume(s)) / 20);
  const file = path.join(OUT, `${name}.wav`);
  execFileSync(
    "ffmpeg",
    ["-v", "error", "-y", "-filter_complex", graph(s, gain), "-map", "[out]", "-ar", String(SR), "-ac", "2", "-c:a", "pcm_s16le", "-bitexact", "-fflags", "+bitexact", file],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  console.log(`${path.relative(ROOT, file)}  ${s.dur}s  peak ${PEAK_DB} dBFS`);
}

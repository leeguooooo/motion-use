// Built-in background music, synthesized to the exact length of each video.
// Original: no samples, a seeded RNG, so the same length gives the same file.
import fs from "node:fs";

const SR = 44100;

const MOODS = {
  // Upbeat: Am-F-C-G, pad + plucked arpeggio + kick/hat.
  promo: { bpm: 100, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], drums: true, pluck: 0.06, pad: 0.045 },
  // Calm: Cmaj7-Am7-Fmaj7-G, pad + slow arpeggio, no drums.
  explainer: { bpm: 84, chords: [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 53]], drums: false, pluck: 0.045, pad: 0.04 },
  // Pulse explainer: Dm-Bb-F-C, plucked strings on eighths, a soft kick on the downbeat; leaves room for narration.
  pulse: { bpm: 96, chords: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], drums: "downbeat", pluck: 0.05, pad: 0.025, voice: "string" },
  // 8-bit: square-wave arpeggio over a square bass, no pad.
  chiptune: { bpm: 120, chords: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]], drums: true, pluck: 0.035, pad: 0, voice: "square" },
  // Pentatonic plucked string (guzheng-like), D minor pentatonic, no drums.
  pentatonic: { bpm: 80, chords: [[50, 53, 57, 60], [48, 50, 55, 57], [45, 50, 53, 57], [48, 53, 55, 60]], drums: false, pluck: 0.06, pad: 0.018, voice: "string" },
  // Ambient bed: slow pad only, for footage-led or narration-heavy films.
  ambient: { bpm: 70, chords: [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 59]], drums: false, pluck: 0, pad: 0.05 },
};
export const MOOD_NAMES = Object.keys(MOODS);
export const moodBpm = (mood) => MOODS[mood]?.bpm;

// Plucked string after huashu-art-motion's synth (MIT): harmonic k decays faster as k grows,
// slightly inharmonic partials, a short noisy attack.
function stringPluck(f, seconds, gain) {
  const n = Math.floor(seconds * SR),
    out = new Float32Array(n);
  const amps = [1, 0.55, 0.32, 0.2, 0.12, 0.07];
  for (let k = 1; k <= amps.length; k++) {
    const fk = f * k * Math.sqrt(1 + 0.0004 * k * k);
    if (fk > 16000) break;
    const decay = 3 * (1 + 0.6 * (k - 1)),
      attack = Math.min(0.035, 0.01 * (1 + 0.6 * (k - 1)));
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      out[i] += amps[k - 1] * Math.sin(2 * Math.PI * fk * t) * Math.exp(-t * decay) * Math.min(1, t / attack);
    }
  }
  for (let i = 0; i < n; i++) out[i] *= gain;
  return out;
}
const square = (phase) => (phase % 1 < 0.5 ? 1 : -1);

const hz = (m) => 440 * 2 ** ((m - 69) / 12);

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthMusic(mood, seconds, options = {}) {
  const m = { ...(MOODS[mood] ?? MOODS.promo), ...(options.bpm ? { bpm: options.bpm } : {}) };
  const N = Math.ceil(seconds * SR);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const beat = 60 / m.bpm;
  const bar = 4 * beat;
  const rand = mulberry32(7);
  const add = (buf, startSec, sig, gain = 1) => {
    const i0 = Math.floor(startSec * SR);
    for (let k = 0; k < sig.length && i0 + k < N; k++) buf[i0 + k] += sig[k] * gain;
  };
  const env = (n, a, r) => {
    const e = new Float32Array(n).fill(1);
    const ai = Math.floor(a * SR);
    const ri = Math.floor(r * SR);
    for (let k = 0; k < ai && k < n; k++) e[k] = k / ai;
    for (let k = 0; k < ri && k < n; k++) e[n - 1 - k] *= k / ri;
    return e;
  };
  const lowpass = (x, k) => {
    const y = new Float32Array(x.length);
    let acc = 0;
    for (let i = 0; i < x.length; i++) {
      acc += x[i] - (i >= k ? x[i - k] : 0);
      y[i] = acc / k;
    }
    return y;
  };

  for (let b = 0; b * bar < seconds; b++) {
    const chord = m.chords[b % 4];
    const n = Math.floor((bar + 0.3) * SR);
    const pad = new Float32Array(n);
    for (const note of chord) {
      const f = hz(note);
      for (let i = 0; i < n; i++) {
        const tt = i / SR;
        pad[i] += 2 * ((tt * f * 0.997) % 1) - 1 + 2 * ((tt * f * 1.003 + 0.3) % 1) - 1;
      }
    }
    const e = env(n, 0.4, 0.5);
    const lp = lowpass(pad, 60);
    for (let i = 0; i < n; i++) lp[i] *= e[i] * m.pad;
    add(L, b * bar, lp);
    add(R, b * bar, lp, 0.9);
    const root = hz(chord[0] - 12);
    const bn = Math.floor(bar * SR);
    const be = env(bn, 0.02, 0.3);
    const bass = new Float32Array(bn);
    for (let i = 0; i < bn; i++) bass[i] = (Math.sin((2 * Math.PI * root * i) / SR) * 0.8 + (2 * ((i / SR) * root % 1) - 1) * 0.1) * be[i] * 0.09;
    add(L, b * bar, bass);
    add(R, b * bar, bass);
  }

  const pattern = [0, 1, 2, 1, 2, 0, 1, 2];
  const step = m.drums || m.voice === "string" ? beat / 2 : beat;
  for (let s = bar, k = 0; m.pluck && s < seconds - 1; s += step, k++) {
    const chord = m.chords[Math.floor(s / bar) % 4];
    const f = hz(chord[pattern[k % 8] % chord.length] + 12);
    const n = Math.floor(0.6 * SR);
    let pl = new Float32Array(n);
    if (m.voice === "string") pl = stringPluck(f, 0.9, m.pluck);
    else
      for (let i = 0; i < n; i++) {
        const tt = i / SR;
        const tone = m.voice === "square" ? square(tt * f) * 0.5 : Math.sin(2 * Math.PI * f * tt) + 0.3 * Math.sin(4 * Math.PI * f * tt);
        pl[i] = tone * Math.exp(-tt * (m.drums ? 7 : 4.5)) * m.pluck;
      }
    const pan = k % 2 ? 0.35 : -0.35;
    add(L, s, pl, 1 - pan);
    add(R, s, pl, 1 + pan);
  }

  if (m.drums) {
    for (let s = 2 * bar; s < seconds - 1.5; s += m.drums === "downbeat" ? bar : beat) {
      const n = Math.floor(0.35 * SR);
      const kick = new Float32Array(n);
      let phase = 0;
      for (let i = 0; i < n; i++) {
        const tt = i / SR;
        phase += (110 * Math.exp(-tt * 18) + 45) / SR;
        kick[i] = Math.sin(2 * Math.PI * phase) * Math.exp(-tt * 9) * 0.22;
      }
      add(L, s, kick);
      add(R, s, kick);
      const hn = Math.floor(0.06 * SR);
      const hat = new Float32Array(hn);
      let prev = 0;
      for (let i = 0; i < hn; i++) {
        const w = rand() * 2 - 1;
        hat[i] = (w - prev) * Math.exp((-i / SR) * 60) * 0.02;
        prev = w;
      }
      add(L, s + beat / 2, hat, 0.8);
      add(R, s + beat / 2, hat);
    }
  }

  // Accents at authored seconds (camera slams, reveals): a low thump and a bright pluck on the chord.
  for (const at of options.hits ?? []) {
    if (!(at >= 0 && at < seconds)) continue;
    const n = Math.floor(0.5 * SR),
      hit = new Float32Array(n),
      chord = m.chords[Math.floor(at / bar) % 4];
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const tt = i / SR;
      phase += (150 * Math.exp(-tt / 0.025) + 48) / SR;
      hit[i] = Math.sin(2 * Math.PI * phase) * Math.exp(-tt / 0.18) * 0.3;
    }
    const top = stringPluck(hz(chord.at(-1) + 12), 0.5, 0.08);
    for (let i = 0; i < n; i++) hit[i] += top[i] ?? 0;
    add(L, at, hit);
    add(R, at, hit);
  }

  // Master: fade in 1.5 s, fade out 2.5 s, soft clip, normalize to -2 dBFS.
  const fi = Math.floor(1.5 * SR);
  const fo = Math.min(Math.floor(2.5 * SR), N);
  let peak = 1e-9;
  for (let i = 0; i < N; i++) {
    let g = 1;
    if (i < fi) g = i / fi;
    if (i > N - fo) g *= (N - i) / fo;
    L[i] = Math.tanh(L[i] * g * 1.4);
    R[i] = Math.tanh(R[i] * g * 1.4);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const norm = 0.8 / peak;
  const pcm = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    pcm.writeInt16LE(Math.round(L[i] * norm * 32767), i * 4);
    pcm.writeInt16LE(Math.round(R[i] * norm * 32767), i * 4 + 2);
  }
  return wav(pcm, 2);
}

function wav(pcm, channels) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export const writeMusic = (file, mood, seconds, options) => fs.writeFileSync(file, synthMusic(mood, seconds, options));

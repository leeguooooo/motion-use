// Built-in background music, synthesized to the exact length of each video.
// Original: no samples, a seeded RNG, so the same length gives the same file.
import fs from "node:fs";

const SR = 44100;

const MOODS = {
  // Upbeat: Am-F-C-G, pad + plucked arpeggio + kick/hat.
  promo: { bpm: 100, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], drums: true, pluck: 0.06, pad: 0.045 },
  // Calm: Cmaj7-Am7-Fmaj7-G, pad + slow arpeggio, no drums.
  explainer: { bpm: 84, chords: [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 53]], drums: false, pluck: 0.045, pad: 0.04 },
};

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

export function synthMusic(mood, seconds) {
  const m = MOODS[mood];
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
  const step = m.drums ? beat / 2 : beat;
  for (let s = bar, k = 0; s < seconds - 1; s += step, k++) {
    const chord = m.chords[Math.floor(s / bar) % 4];
    const f = hz(chord[pattern[k % 8] % chord.length] + 12);
    const n = Math.floor(0.6 * SR);
    const pl = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const tt = i / SR;
      pl[i] = (Math.sin(2 * Math.PI * f * tt) + 0.3 * Math.sin(4 * Math.PI * f * tt)) * Math.exp(-tt * (m.drums ? 7 : 4.5)) * m.pluck;
    }
    const pan = k % 2 ? 0.35 : -0.35;
    add(L, s, pl, 1 - pan);
    add(R, s, pl, 1 + pan);
  }

  if (m.drums) {
    for (let s = 2 * bar; s < seconds - 1.5; s += beat) {
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

export const writeMusic = (file, mood, seconds) => fs.writeFileSync(file, synthMusic(mood, seconds));

"""Synthesise the whole soundtrack (music + foley) for the 40 s film. 96 BPM, one bar = 2.5 s.

Run: python3 audio/score.py  ->  audio/score.wav (48 kHz stereo)
"""
import numpy as np, wave
from scipy.signal import fftconvolve, butter, sosfilt

SR = 48000
DUR = 102.0
N = int(SR * DUR)
BEAT = 60 / 96
BAR = BEAT * 4
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N or i + len(sig) <= 0:
        return
    s = sig[: max(0, N - i)] * gain
    gl, gr = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(s)] += s * gl * 1.414
    R[i:i + len(s)] += s * gr * 1.414


def env(n, a, d_tau):
    t = np.arange(n) / SR
    e = np.exp(-t / d_tau)
    ai = int(a * SR)
    if ai > 0:
        e[:ai] *= np.linspace(0, 1, ai)
    return e


def lp(x, f, order=2):
    return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


# ---------- instruments ----------
def marimba(m, dur=0.9):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.sin(2 * np.pi * f * t) * env(n, 0.002, 0.32)
    s += 0.35 * np.sin(2 * np.pi * f * 3.98 * t) * env(n, 0.001, 0.05)
    s += 0.12 * np.sin(2 * np.pi * f * 9.2 * t) * env(n, 0.0005, 0.015)
    return s


def pluck_bass(m, dur=0.6):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * 2 * f * t) + 0.15 * np.sin(2 * np.pi * 3 * f * t)
    return lp(s * env(n, 0.004, 0.18), 900)


def celesta(m, dur=1.6):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.sin(2 * np.pi * f * t) * env(n, 0.002, 0.6)
    s += 0.25 * np.sin(2 * np.pi * f * 2 * t) * env(n, 0.001, 0.25)
    s += 0.08 * np.sin(2 * np.pi * f * 5.4 * t) * env(n, 0.001, 0.08)
    return s


def pad(notes, dur, attack=0.6, release=0.8, bright=1800):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    for m in notes:
        for det in (-0.07, 0.0, 0.06):
            f = hz(m + det)
            ph = rng.random() * 2 * np.pi
            s += (2 * ((f * t + ph / (2 * np.pi)) % 1) - 1) * 0.2  # saw
    s = lp(s, bright, 2)
    e = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    e[:a] = np.linspace(0, 1, a) ** 2
    e[-r:] *= np.linspace(1, 0, r) ** 2
    return s * e / max(1, len(notes))


def noise(n):
    return rng.standard_normal(n)


# ---------- foley ----------
def felt_thump(gain=1.0):
    n = int(0.25 * SR); t = np.arange(n) / SR
    f = 140 * np.exp(-t * 18) + 55
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.07)
    s += 0.25 * lp(noise(n), 700) * env(n, 0.001, 0.03)
    return s * gain


def patter(gain=0.25):
    n = int(0.06 * SR)
    return bp(noise(n), 300, 1400) * env(n, 0.001, 0.012) * gain


def boing(m=74):
    n = int(0.45 * SR); t = np.arange(n) / SR
    f = hz(m) * (1 + 0.25 * np.exp(-t * 12) * np.sin(2 * np.pi * 9 * t))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.003, 0.14)


def roll(dur):
    n = int(dur * SR); t = np.arange(n) / SR
    s = lp(noise(n), 260, 2) * (0.6 + 0.4 * np.sin(2 * np.pi * 7 * t))
    e = np.minimum(1, t / 0.2) * np.minimum(1, (dur - t) / 0.3)
    return s * e


def whoosh(dur, f0, f1, gain=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    s = noise(n); out = np.zeros(n); blk = 1024
    for i in range(0, n, blk):
        u = i / n; fc = f0 * (f1 / f0) ** u
        out[i:i + blk] = bp(s[i:i + blk], max(60, fc * 0.6), min(SR / 2 - 100, fc * 1.4), 1)
    return out * np.sin(np.pi * t / dur) ** 1.5 * gain


def pop(m=79):
    n = int(0.18 * SR); t = np.arange(n) / SR
    f = hz(m) * (1 + 1.5 * np.exp(-t * 60))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.05)


def switch_off():
    n = int(1.6 * SR); t = np.arange(n) / SR
    click = hp(noise(int(0.012 * SR)), 2000) * 0.8
    thud = np.sin(2 * np.pi * np.cumsum(70 * np.exp(-t * 3) + 30) / SR) * env(n, 0.002, 0.35)
    s = 0.9 * thud
    s[:len(click)] += click
    return s


def beep(m=81, dur=0.12):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * hz(m) * t) * np.minimum(1, (dur - t) / 0.02) * np.minimum(1, t / 0.005)
    return s


def shutter():
    a = hp(noise(int(0.02 * SR)), 1500) * env(int(0.02 * SR), 0.0005, 0.006)
    b = hp(noise(int(0.03 * SR)), 900) * env(int(0.03 * SR), 0.0005, 0.01)
    s = np.zeros(int(0.12 * SR)); s[:len(a)] += a; s[int(0.055 * SR):int(0.055 * SR) + len(b)] += b * 0.8
    return s


def charge(dur):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 1800 + 6000 * (t / dur) ** 1.4
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / dur) ** 2 * 0.12



# ---------- cue sheet (seconds match film.json / src/scene.js) ----------
import json
film = json.load(open("film.json"))
subs = film["copy"]["zh"]
def click(gain=0.2):
    n = int(0.03 * SR); return hp(noise(n), 2500) * env(n, 0.0005, 0.006) * gain
def thock():
    n = int(0.2 * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * np.cumsum(180 * np.exp(-t * 30) + 60) / SR) * env(n, 0.001, 0.05) + 0.4 * hp(noise(n), 1500) * env(n, 0.0005, 0.01))
def buzz(dur=0.45):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.sign(np.sin(2 * np.pi * 110 * t)) * 0.5 + np.sign(np.sin(2 * np.pi * 116 * t)) * 0.5
    return lp(s, 1800) * np.minimum(1, t / 0.01) * np.minimum(1, (dur - t) / 0.05) * 0.5
def hum(dur, f=70):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * 2 * f * t + 0.3) + 0.15 * np.sin(2 * np.pi * 5.03 * f * t)
    return s * np.minimum(1, t / 0.5) * np.minimum(1, (dur - t) / 0.6) * (0.8 + 0.2 * np.sin(2 * np.pi * 3 * t))

# chord per bar (2.5 s): calm, modern; C major / A minor colours
prog = [[48,55,64,71],[45,52,60,67],[41,48,57,64],[43,50,59,62]]
for bar in range(41):
    t0 = bar * BAR
    if t0 >= DUR: break
    ch = prog[bar % 4]
    bright = 1200 if t0 < 8 else 1700
    place(pad(ch, BAR + 0.5, 0.6 if bar == 0 else 0.2, 0.5, bright), t0, 0.11)
    if 8 <= t0 < 93:
        for b in range(4):
            place(pluck_bass(ch[0] - 12 + (7 if b % 2 else 0)), t0 + b * BEAT, 0.22)
            place(patter(0.05), t0 + b * BEAT + BEAT / 2, 1.0, 0.3 * ((b % 2) * 2 - 1))
# small melodic answers only between narration lines
gaps = []
lines = [tuple(map(float, s.split("~")[:2])) for s in subs["subs"].split("|")]
for (a0, b0), (a1, b1) in zip(lines, lines[1:]):
    if a1 - b0 > 0.9: gaps.append((b0 + 0.1, a1 - 0.1))
mel = [72, 76, 79, 81, 79, 76, 74, 72]
for gi, (g0, g1) in enumerate(gaps):
    for j in range(min(4, int((g1 - g0) / (BEAT / 2)))):
        place(marimba(mel[(gi + j) % len(mel)] + (12 if gi % 3 == 2 else 0)), g0 + j * BEAT / 2, 0.16, -0.3 + 0.2 * j)

# 1 hook: typing, enter, letters fall, timeline whoosh
prompt = "› " + subs["prompt"]
for i in range(len(prompt)):
    place(click(0.25), 0.5 + 2.6 * i / len(prompt), 1.0, 0.2 * np.sin(i))
place(thock(), 4.4, 0.7)
for i in range(len(prompt)):
    place(celesta(84 - (i % 12), 0.6), 4.55 + i * 0.035 + 0.9, 0.05, -0.6 + 1.2 * i / len(prompt))
place(whoosh(3.0, 200, 3000, 0.4), 5.0, 1.0)
# 2 director: cards pop up
for i in range(5): place(pop(76 + i * 2), 8.6 + i * 0.55 + 0.25, 0.22, -0.5 + 0.25 * i)
place(whoosh(1.0, 300, 1500, 0.2), 10.6, 1.0, 0.4)
# 3 time: scrub forward, rewind, jumps
place(whoosh(3.6, 300, 1200, 0.25), 20.5, 1.0, -0.3)
place(whoosh(3.0, 1500, 250, 0.3), 24.5, 1.0, 0.3)
for j in range(5): place(beep(84 + (j % 3) * 3, 0.07), 27.5 + j * 0.75, 0.12, 0)
# 4 render: frames rise, shutter per capture, assembly
for i in range(12): place(pop(79 + i % 5), 32.6 + i * 0.045, 0.08, -0.6 + 0.1 * i)
for i in range(12):
    w, k = i // 3, i % 3
    place(shutter(), 35.0 + w * 0.15 + k * 1.4, 0.35, -0.6 + 0.4 * w)
place(whoosh(2.0, 200, 2500, 0.35), 40.6, 1.0)
place(celesta(91, 2.0), 43.3, 0.14, 0.3)
# 5 local: glyphs fall, plug pulled
for i in range(30): place(celesta(96 - (i % 7), 0.3), 48.6 + i * 0.02 + (i % 5) * 0.11, 0.03, -0.6 + 0.04 * i)
place(switch_off(), 51.6, 0.5)
place(hp(noise(int(0.2 * SR)), 3000) * env(int(0.2 * SR), 0.001, 0.05) * 0.4, 51.85, 1.0, 0.4)
# 6 sound: blocks drop in, overflow buzz, fix chime
for i in range(4): place(felt_thump(0.9), 56.9 + i * 0.7 + 0.6, 1.0, -0.4 + 0.25 * i)
place(buzz(), 60.2, 0.5, 0.4)
for i, m in enumerate([79, 84, 88]): place(celesta(m, 1.2), 62.5 + i * 0.08, 0.14, 0.2)
# 7 verify: scanner hum, readout dings, stamp, approval
place(hum(7.0), 67.0, 0.12)
for i in range(5): place(beep(88 + i, 0.09), 68.6 + i * 1.0, 0.14, 0.4)
place(thock(), 75.4, 0.5)
for i, m in enumerate([72, 76, 79, 84, 88]): place(celesta(m, 1.6), 80.4 + i * 0.06, 0.16, -0.4 + 0.2 * i)
# 8 formats: screens rise
for i in range(3): place(whoosh(0.8, 200, 1800, 0.25), 83.5 + i * 0.5, 1.0, -0.5 + 0.5 * i)
# 9 end: resolve
place(pad([36, 48, 55, 60, 64, 67, 71, 76], 8.5, 0.3, 4.0, 2600), 93.6, 0.22)
place(pluck_bass(36, 3.0), 93.6, 0.4)
for i, m in enumerate([72, 76, 79, 84, 88]): place(celesta(m, 2.6), 94.0 + i * BEAT * 0.5, 0.12, -0.5 + 0.25 * i)
# ---------- room reverb + master ----------
ir_n = int(2.2 * SR); ti = np.arange(ir_n) / SR
irL = rng.standard_normal(ir_n) * np.exp(-ti / 0.45); irR = rng.standard_normal(ir_n) * np.exp(-ti / 0.47)
irL = lp(irL, 5000); irR = lp(irR, 5000)
irL /= np.sqrt(np.sum(irL ** 2)); irR /= np.sqrt(np.sum(irR ** 2))
wetL = fftconvolve(L, irL)[:N]; wetR = fftconvolve(R, irR)[:N]
outL = L + 0.22 * wetL; outR = R + 0.22 * wetR
# gentle fade at the very end
fade = int(1.6 * SR)
outL[-fade:] *= np.linspace(1, 0, fade) ** 1.5; outR[-fade:] *= np.linspace(1, 0, fade) ** 1.5
pk = max(np.abs(outL).max(), np.abs(outR).max())
outL = np.tanh(outL / pk * 1.2) * 0.85; outR = np.tanh(outR / pk * 1.2) * 0.85
pcm = (np.stack([outL, outR], 1) * 32767).astype("<i2")
with wave.open("audio/score.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("wrote audio/score.wav", N / SR, "s")

"""Synthesise the whole soundtrack (music + foley) for the 40 s film. 96 BPM, one bar = 2.5 s.

Run: python3 audio/score.py  ->  audio/score.wav (48 kHz stereo)
"""
import numpy as np, wave
from scipy.signal import fftconvolve, butter, sosfilt

SR = 48000
DUR = 40.0
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


# ---------- music ----------
# bars: 0 intro | 1-6 relay | 7 puff | 8-9 rise | 10 dark | 11-12 light run | 13 pose | 14-15 photo
CH = {  # chord roots/voicings (MIDI) per bar
    0: [48, 55, 64], 1: [48, 55, 64], 2: [45, 52, 60], 3: [41, 48, 57], 4: [43, 50, 59],
    5: [48, 55, 64], 6: [41, 48, 57], 7: [43, 50, 59, 65], 8: [45, 52, 60], 9: [41, 48, 57, 64],
}
MEL = {  # playful marimba lines, (beat, midi)
    1: [(0, 72), (0.5, 76), (1, 79), (1.5, 76), (2, 77), (2.5, 76), (3, 74), (3.5, 72)],
    2: [(0, 69), (0.5, 72), (1, 76), (1.75, 74), (2, 72), (3, 76), (3.5, 79)],
    3: [(0, 77), (0.5, 76), (1, 74), (1.5, 72), (2, 69), (2.5, 72), (3, 77), (3.5, 81)],
    4: [(0, 79), (1, 74), (1.5, 76), (2, 77), (2.5, 79), (3, 83), (3.5, 86)],
    5: [(0, 84), (0.5, 79), (1, 76), (1.5, 79), (2, 84), (2.5, 88), (3, 86), (3.5, 84)],
    6: [(0, 81), (0.5, 77), (1, 81), (1.5, 84), (2, 86), (2.5, 84), (3, 81), (3.25, 79), (3.5, 77)],
}
# intro: quiet felt pulse and a celesta question
for i, m in enumerate([72, 76, 79, 84]):
    place(celesta(m), 0.3 + i * BEAT * 0.5, 0.18, -0.3 + i * 0.2)
place(pad(CH[0], BAR + 0.4, 1.0, 0.4, 900), 0, 0.22)

for bar in range(1, 7):
    t0 = bar * BAR
    place(pad(CH[bar], BAR + 0.2, 0.08, 0.3, 1300), t0, 0.16)
    for b in range(4):
        root = CH[bar][0] - 12
        place(pluck_bass(root if b % 2 == 0 else root + 7), t0 + b * BEAT, 0.42)
        place(patter(0.12), t0 + b * BEAT + BEAT / 2, 1.0, 0.4 * ((b % 2) * 2 - 1))
    for beat, m in MEL[bar]:
        place(marimba(m), t0 + beat * BEAT, 0.38, 0.25 * np.sin(beat + bar))
    # the pushing monster's footsteps
    for s in range(14):
        place(patter(0.07), t0 + 0.08 + s * BAR / 14, 1.0, 0.2 * ((s % 2) * 2 - 1))
    place(felt_thump(0.8), t0 + 0.02, 1.0, 0)  # handoff bump
    place(boing(74 + (bar - 1) * 2), t0 - 0.62, 0.22, 0.4 * (bar % 2 * 2 - 1))  # next monster hops in
    place(roll(BAR), t0, 0.18, 0)
place(roll(2.5), 0.0, 0.14, -0.4)
place(felt_thump(0.6), 0.25, 1.0, -0.3)

# bar 7: ball pops, thread puffs up in a wave
t7 = 7 * BAR
place(pop(84), 17.62, 0.35, 0.1)
place(whoosh(2.6, 120, 1600, 0.6), 17.7, 1.0, -0.2)
for i in range(10):
    place(marimba(60 + [0, 4, 7, 12, 16, 19, 24, 28, 31, 36][i]), 17.75 + i * 0.22, 0.2, -0.6 + i * 0.12)
place(pad(CH[7], BAR + 0.4, 0.8, 0.5, 2200), t7, 0.2)
for k in range(6):
    place(boing(79 + k), 18.0 + k * 0.22, 0.12, -0.5 + k * 0.2)

# bars 8-9: run to front, logo rises, cheer
for bar in (8, 9):
    t0 = bar * BAR
    place(pad(CH[bar], BAR + 0.3, 0.3, 0.4, 2000), t0, 0.2)
    for b in range(4):
        place(pluck_bass(CH[bar][0] - 12 + (7 if b % 2 else 0)), t0 + b * BEAT, 0.36)
for s in range(24):
    place(patter(0.1), 20.0 + s * 0.075, 1.0, 0.5 * np.sin(s))
place(whoosh(2.4, 80, 900, 0.5), 20.7, 1.0, 0)
place(felt_thump(1.2), 23.2, 1.0, 0)
for i, m in enumerate([72, 76, 79, 84, 88]):
    place(marimba(m), 23.25 + i * 0.09, 0.3, -0.4 + i * 0.2)
for k in range(6):
    place(boing(76 + k * 2), 23.3 + k * 0.07, 0.1, -0.6 + k * 0.24)

# bar 10: lights out — music cut, low hum in darkness
place(switch_off(), 25.6, 0.9, 0)
hum_n = int(1.9 * SR); th = np.arange(hum_n) / SR
hum = (np.sin(2 * np.pi * 55 * th) + 0.3 * np.sin(2 * np.pi * 110 * th)) * np.minimum(1, th / 0.6) * 0.08
place(hum, 25.7, 1.0)

# bars 11-12: six lights run, one note each, then all six spread and sum to white
notes6 = [60, 64, 67, 71, 74, 79]  # Cmaj9 stacked — one per colour
for k in range(6):
    place(celesta(notes6[k] + 12, 2.4), 27.5 + k * 0.06, 0.2, -0.75 + k * 0.3)
    place(whoosh(2.3, 400 + k * 150, 3000 + k * 400, 0.12), 27.5, 1.0, -0.75 + k * 0.3)
for i in range(16):
    place(celesta(notes6[i % 6] + 24, 0.9), 27.6 + i * BEAT / 2, 0.08, 0.6 * np.sin(i * 1.3))
place(pad([48, 55, 60, 64, 71], 2.6, 1.6, 0.2, 1400), 27.5, 0.18)
place(pad([48, 55, 60, 64, 67, 71, 74, 79], 3.0, 2.2, 0.1, 3200), 30.0, 0.22)
place(whoosh(2.6, 300, 9000, 0.35), 30.0, 1.0, 0)
for i in range(24):
    place(celesta(notes6[i % 6] + 24 + (12 if i > 12 else 0), 0.7), 30.0 + i * 0.1, 0.06 + 0.002 * i, 0.7 * np.sin(i * 2.1))
# bloom: big warm chord at white
place(pad([36, 48, 55, 60, 64, 67, 71, 76], 3.2, 0.05, 1.2, 4200), 32.5, 0.3)
place(felt_thump(1.6), 32.5, 0.8)
for i, m in enumerate([84, 88, 91, 96]):
    place(celesta(m, 2.0), 32.52 + i * 0.05, 0.14, -0.5 + i * 0.33)

# bar 13: gather, countdown
for s in range(16):
    place(patter(0.08), 33.0 + s * 0.06, 1.0, 0.4 * np.sin(s * 2))
for i, tb in enumerate([33.6, 34.05, 34.5]):
    place(beep(81 if i < 2 else 88), tb, 0.16, 0)
place(charge(0.9), 34.1, 1.0)
# flash
place(shutter(), 35.0, 0.9)
place(whoosh(0.5, 4000, 12000, 0.5), 34.98, 1.0)
place(pop(91), 35.0, 0.2)
# photo: warm resolve that rings out
place(pad([48, 55, 64, 67, 72, 76], 5.0, 0.5, 2.6, 2600), 35.05, 0.26)
place(pluck_bass(36, 2.0), 35.05, 0.5)
for i, m in enumerate([72, 76, 79, 84, 79, 84, 88]):
    place(celesta(m, 2.4), 35.5 + i * BEAT * 0.5, 0.15, -0.5 + i * 0.15)
place(celesta(96, 3.0), 37.5, 0.1, 0.3)

# ---------- room reverb + master ----------
ir_n = int(2.2 * SR); ti = np.arange(ir_n) / SR
irL = rng.standard_normal(ir_n) * np.exp(-ti / 0.45); irR = rng.standard_normal(ir_n) * np.exp(-ti / 0.47)
irL = lp(irL, 5000); irR = lp(irR, 5000)
irL /= np.sqrt(np.sum(irL ** 2)); irR /= np.sqrt(np.sum(irR ** 2))
wetL = fftconvolve(L, irL)[:N]; wetR = fftconvolve(R, irR)[:N]
outL = L + 0.22 * wetL; outR = R + 0.22 * wetR
# gentle fade at the very end
fade = int(1.2 * SR)
outL[-fade:] *= np.linspace(1, 0, fade) ** 1.5; outR[-fade:] *= np.linspace(1, 0, fade) ** 1.5
pk = max(np.abs(outL).max(), np.abs(outR).max())
outL = np.tanh(outL / pk * 1.2) * 0.85; outR = np.tanh(outR / pk * 1.2) * 0.85
pcm = (np.stack([outL, outR], 1) * 32767).astype("<i2")
with wave.open("audio/score.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("wrote audio/score.wav", N / SR, "s")

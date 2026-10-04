"""Synthesize the "message arrived" ding (original, no third-party samples).

A small bell: E6 fundamental with a strong octave and a faint inharmonic
partial, each decaying exponentially, 1.4 s. Peak-normalized to -3 dBFS to
match the other sound effects. Writes assets/sfx/ding.wav (44.1 kHz stereo, 16-bit).
"""
import wave
from pathlib import Path

import numpy as np

SR = 44100
DURATION = 1.4
PEAK_DB = -3.0

t = np.arange(int(SR * DURATION)) / SR
f0 = 1318.5  # E6
# (frequency ratio, amplitude, decay per second)
PARTIALS = [(1.0, 0.55, 3.0), (2.0, 1.0, 3.6), (2.76, 0.18, 9.0), (5.4, 0.05, 16.0)]
x = sum(a * np.sin(2 * np.pi * f0 * r * t) * np.exp(-t * d) for r, a, d in PARTIALS)

attack = int(0.003 * SR)  # 3 ms, avoids a click at the start
x[:attack] *= np.linspace(0, 1, attack)
release = int(0.05 * SR)
x[-release:] *= np.linspace(1, 0, release)

x *= 10 ** (PEAK_DB / 20) / np.max(np.abs(x))
stereo = np.stack([x, x], axis=1)

out = Path(__file__).resolve().parent.parent / "assets" / "sfx" / "ding.wav"
with wave.open(str(out), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((stereo * 32767).astype(np.int16).tobytes())
rms = 20 * np.log10(np.sqrt(np.mean(x**2)))
print(out, f"{DURATION}s, peak {PEAK_DB} dBFS, rms {rms:.1f} dBFS")

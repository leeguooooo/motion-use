# Recording a web page

`motion-use capture <url|file.html> --out <dir> --duration <seconds>` films a web page — canvas,
WebGL (three.js and the like), CSS animation — together with the sound the page makes through
WebAudio, and writes:

| File | |
|---|---|
| `capture.mp4` | H.264 (CRF 16, yuv420p) picture with the page's sound as AAC |
| `audio.wav` | The same sound, 48 kHz 16-bit stereo, exactly `--duration` long |
| `capture.json` | Measured frame count and durations, when each AudioContext started, peak/RMS, first audible second, the keys pressed, page errors, limits |

```bash
# a demo that starts when A is pressed, 60 s at 1920x1080, 30 fps
motion-use capture demo.html --out capture-demo --duration 60 --press a
# a slide deck: A at second 0, then the next slide every 8 seconds
motion-use capture https://example.com/deck --out capture-deck --duration 64 --press a --page-key ArrowRight --page-every 8
```

A local file (or a folder with `index.html`) is served from its own folder over loopback, so
relative scripts, models and audio load as they would on a web server. `--out` is a fresh folder
or one an earlier capture made (it is replaced); any other existing folder is refused.

## How it stays in sync

Nothing runs in real time. Before the page's own scripts, an init script replaces
`requestAnimationFrame`, `setTimeout`/`setInterval`, `performance.now` and `Date` with a virtual
clock, and holds CSS and Web Animations paused at the clock's time. Every `AudioContext` the page
creates is an `OfflineAudioContext` (48 kHz stereo) that starts at the virtual second it was made.
For each frame the clock moves to the frame's time: due timers fire in order, each after the audio
has been rendered up to its time, then the audio is rendered up to the frame, the animation frame
callbacks run, and the page is screenshotted. Sound and picture therefore come from one clock;
code running at time t sees `AudioContext.currentTime` within one render quantum (128 samples,
2.7 ms) of t. The same page and options give the same frames and the same WAV on every run.

This removes the problems of screen recording: no foreground window, no screen numbers, no notch
crop, no virtual sound card, no dropped frames, no estimating the offset between two recorders.
Capturing is slower than real time (the test page took about 2.5 s per second of 1080p30 on an
Apple-silicon laptop); a heavy WebGL scene takes longer, but the result does not change.

## Options

| Option | |
|---|---|
| `--duration <s>` | Virtual seconds to record (required) |
| `--fps <n>` | Frames per second (default 30) |
| `--width`, `--height` | Viewport in CSS pixels (default 1920x1080, device scale 1) |
| `--press <key>[@s]` | Press a key at a virtual second (default 0, right after load); repeatable. Keys are Puppeteer names: `a`, `A`, `Space`, `Enter`, `ArrowRight`, `PageDown` |
| `--page-key <key> --page-every <s>` | Press a key every n seconds (at n, 2n, … before the end) |
| `--wait <s>` | Real seconds to wait after `load` before second 0, for pages that fetch models or decode audio after loading |
| `--gpu` | Draw WebGL on the GPU instead of SwiftShader on the CPU (faster; frames may differ between runs) |
| `--json` | Print the report |

## Limits

- `<video>` and `<audio>` elements, `createMediaElementSource` and MediaStream nodes do not
  follow the virtual clock and their sound is not recorded.
- Network loads, `fetch()`, workers and `decodeAudioData` complete in real time. Load everything
  before second 0 (`--wait`), or the moment they land depends on the machine.
- Only the top document's clock is driven; iframes do not advance.
- Every AudioContext runs at 48 kHz stereo whatever `sampleRate` the page asks for; a closed
  context is cut at the second it was closed.
- A page that checks `AudioContext` features only real-time contexts have (`setSinkId`,
  `createMediaStreamDestination`) fails; its errors are listed in `capture.json`.

# Authored films

`film.json` fixes output timing and assets; `composition/draw.js` owns the entire picture. `DIRECTOR.md` records the directing choices and review. Rendering preserves exact shot times: there is no implicit title entrance, crossfade, cover hold or narration stretch.

```json
{
  "version": 1, "kind": "film", "name": "my-film",
  "duration": 12, "fps": 60, "bpm": 100,
  "languages": ["zh", "en"], "formats": ["landscape", "vertical"],
  "composition": "composition/draw.js",
  "music": "builtin", "motionBlur": {"samples": 4, "shutter": 0.5},
  "copy": {"zh": {"headline": "变化发生。"}, "en": {"headline": "A change happens."}},
  "shots": [
    {"id": "action", "start": 0, "end": 6, "purpose": "Show the cause", "action": "A small dot grows into a message and travels"},
    {"id": "result", "start": 6, "end": 12, "purpose": "Show the consequence", "action": "The message opens into a result and resolves into the wordmark"}
  ]
}
```

Formats: `landscape` 1920×1080, `vertical` 1080×1920, `square` 1440×1440. Frame rates: 24/25/30/60. Duration: 1–180 seconds. Shots cover the whole duration without gaps or overlap. Optional `cut: true` documents a deliberate cut; optional `hold` and `holdReason` document stillness. Shots annotate your code; they do not generate or impose visual scenes.

## Drawing contract

```js
window.drawFrame = function (ctx, seconds, film, view, motion) {
  const {width, height, vertical} = view;
  ctx.fillStyle = "#f4f2ec";
  ctx.fillRect(0, 0, width, height);
  const progress = motion.ramp(seconds, 0, 1);
  motion.text(ctx, film.copy.headline, width/2, height/2 + (1-progress)*100,
    vertical ? 70 : 110, "#172c2a", 800, "center", width-160);
};
```

Paint an opaque background every frame. The caller resets transforms and restores context state. All pose values must derive from the supplied time, not the last rendered frame. The renderer seeks backward and splits capture among workers. Avoid clocks, unseeded random numbers, animation loops and network sourcing.

`film.copy` is already selected for the current language. `view` supplies width, height, format and vertical. `motion` provides `mix`, `clamp`, `ease` (smoothstep), `progress`, `ramp`, analytic `spring`, deterministic `hash`, `beat`, `round`, `line` and font-aware `text`. `text` shrinks a line to an explicit maximum width; it does not wrap paragraphs or enforce platform safe areas. Design the portrait composition rather than cropping landscape.

Declare local PNG/JPG/WebP/SVG images under `assets`, e.g. `{"logo":"images/logo.png"}`. They are decoded before rendering and available as `window.filmAssets.logo`; draw with `ctx.drawImage`. Only named files are copied. Paths must remain inside the project, including symlink targets. Fonts ship as local subset WOFF2s with their licenses; visible copy and drawing-source characters enter the subset. Missing glyphs in `copy` fail validation.

Optional `libraries: ["vendor/library.js"]` loads explicit local classic browser bundles before the drawing code. Bundle ES modules into a browser file first. The film directory is not recursively copied. Optional `window.setupFilm(film, view, motion)` can return a promise to prepare geometry/renderers after fonts and images load; the engine waits for it. A WebGL renderer can draw into its own offscreen canvas and composite it into `ctx` during `drawFrame`. This is an authoring capability, not a built-in 3D scene generator. Use `--gpu` only when the shader/library needs hardware rendering; state the reproducibility tradeoff.

`motionBlur` samples 1/2/4 subframes over a 0–1 frame backward shutter and averages the rendered canvases. The sampling order is deterministic. Default: one sample, no blur. Tune exposure for readable movement; blur does not rescue an unclear layout.

## Narration is required by default

Add `narration` to each narrated shot as a language map, e.g. `{"zh":"发一条消息。","en":"Send a message."}`. A root `narration` map instead makes one continuous track. Optional `voiceover` settings accept `dir`, `engine` (`azure`/`edge`), `voices`, `rate` and `volume`. Defaults: `voiceover/`, configured Azure or the Edge preview provider, and the bundled Chinese/English voice choices. For other languages, set an appropriate voice explicitly.

`motion-use voiceover <project>` supports films and caches one audio file per language/shot. `render` automatically generates missing or outdated narration before frame capture. Generation uses the voice provider's network service; the frame renderer stays local. Imported `audio` tracks with `role: "voiceover"` take precedence. Optional `lang` selects one language; omit it for an intentionally shared track. User recordings are preserved.

Each shot's spoken window starts 80 ms after its start and ends 80 ms before its end. Whole-film narration has 100 ms at each edge. Audio that does not fit fails: shorten the script or retime the authored shots and drawing; words are never trimmed to fit. `voiceover:false` opts into a deliberately unnarrated film, not an automatic fallback after a provider failure.

Final delivery verifies that the voice-only reference actually appears in the MP4's mix, using per-window waveform correlation and non-silence checks. This checks presence and alignment of the expected signal, not speech recognition or listening quality. A music-only MP4 cannot pass required narration, and a failed candidate never replaces the last delivered video. Generated audio and voice manifests are excluded from release packages. Narrated film filenames end in `-VO.mp4`, making them distinct from older unnarrated exports.

## Sound and narration

`music` accepts `"none"`, `"builtin"`, or `{"file":"audio/song.wav","volume":0.6,"bpm":120}`. Root `bpm` wins over music's BPM. Built-in music uses that same tempo, so `motion.beat(seconds)` lines up with it. For imported music, BPM is an authored value; this CLI does not analyze a track's first downbeat. Place a track with an offset through `audio` when needed.

```json
"audio": [
  {"file":"audio/narration.wav","role":"voiceover","start":1.2,"offset":0,"length":4.5,"volume":1},
  {"file":"audio/click.wav","role":"sfx","start":3.6,"volume":0.5}
]
```

Times refer to the output timeline. Omitted `length` uses the remaining source duration. Validation rejects a source overrun or a clip running past the film; trim it explicitly or extend the authored picture. Voiceover windows duck the music with short ramps. HyperFrames owns media playback and the final mix; the drawing code does not play audio. `render` normalizes the final track without re-encoding the video. Imported audio must already have suitable authorization.

For bundled licensed sounds, use `{"effect":"click","role":"sfx","start":3.38,"volume":0.6}` instead of a file. Effects: `click`, `switch`, `whoosh`, `ding`; sources/licenses are in ASSETS.md. `start` is the beginning of the file, not its loudest transient: measure that offset when aligning the hit to an action.

## Delivery review

`render` writes a technical report and contact sheet from the delivered MP4. It checks full-file decoding, measured dimensions/FPS/duration, audio presence, integrated loudness, true peak and per-shot RMS. Black intervals and freeze starts over 0.8 seconds are signals to inspect. Review times include the opening, shot midpoints, the final frame, and both sides of shot boundaries.

`visual_review: "pending"` is intentional: neither a successful encode nor a numeric report proves the film looks good. Canvas typography is invisible to DOM text audits. Read the frames and watch the MP4; record the outcome and remaining concerns in `DIRECTOR.md`. Review files are written only into directories owned by motion-use. Concurrent renders/stills targeting the same output are unsupported.

## Existing briefs

`brief.json` and `--style` / `--story` keep their previous scene behavior. Use `--mode template` explicitly when creating information-card videos. `--allow-code` authorizes film code; `--allow-custom-html` remains the separate opt-in for template HTML scenes. Validation never executes the authored script. Static lint checks are not a security boundary for arbitrary code.

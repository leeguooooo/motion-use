# Brief reference

A brief is one JSON file. Paths inside it are relative to the brief's folder. Run `motion-use validate <brief>` for exact errors with JSON paths.

## Top level

| Field | Default | Meaning |
|---|---|---|
| `version` | required | Always `1` |
| `name` | `"video"` | Lowercase letters, digits, dashes. Used in output file names |
| `style` | `"promo"` | `"promo"` or `"explainer"` |
| `languages` | `["en"]` | Language codes; every text field needs a value for each (`zh`, `en`, `pt-BR`…) |
| `formats` | `["landscape"]` | `"landscape"` (1920×1080) and/or `"vertical"` (1080×1920) |
| `fps` | `30` | 24, 25, 30 or 60 |
| `cover` | `"first-scene"` | `"first-scene"`: the first frame shows the first scene already finished, so players and feeds get a real thumbnail. `"animate"`: the first scene animates in from an empty frame |
| `theme` | style colors | `{ "accent": "#hex", "background": "#hex", "text": "#hex" }` |
| `music` | `"builtin"` | `"builtin"` (original track synthesized to the video's length), `"none"`, or `{ "file": "song.mp3", "volume": 0.5 }` |
| `sfx` | `true` | Small whooshes, clicks and dings on scene beats |
| `voiceover` | none | `{ "dir": "voiceover", "volume": 1 }`: files at `<dir>/<lang>/<scene-id>.mp3` (.wav, .m4a, .aac, .ogg). For generated narration also `"engine": "azure"\|"edge"`, `"voices": { "zh": "zh-CN-YunxiNeural" }`, `"rate": "+8%"` or `{ "zh": "+8%", "en": "+5%" }` (see Voiceover below) |
| `scenes` | required | 1–20 scenes, played in order |

## Text

Any text field takes either one string for every language, or an object per language:

```json
"title": "chrome-use"
"title": { "zh": "三步上手", "en": "Three steps" }
```

`\n` makes a line break in headlines. Text is always drawn literally; HTML in it shows as characters.

## Scenes

Every scene has `type`, and optionally `id` (default `scene-N`; voiceover files are named after it), `narration` (text per language for `motion-use voiceover` to speak; never drawn), `transition` (how the scene comes in: `fade` default, `slide`, `wipe`, `zoom`, `cut`), `layout` (for `title` and `features`, below), `duration` (seconds, 1–60; never shorter than the scene's own animation), and `voiceover` (`{ "zh": "path.mp3" }`, overriding the folder convention).

### `title`
`title` (required), `subtitle`, optional `image`. `layout`:
- `center` (default): centered; an `image` shows above the title
- `left`: left-aligned with an accent rule
- `split`: title on one side, `image` (required) on the other; stacked in vertical

### `terminal`
A typed command-line session in one or two panes.
- `title`: headline above the panes
- `panes`: 1–2 of `{ "label": "Claude Code", "accent": "#d97757", "prompt": ">" }` (default one pane labeled "Terminal"; `prompt` defaults to `$`, use `>` for an agent chat)
- `lines`: 1–14 of `{ "cmd": "…" }` (typed after a `$ ` prompt) or `{ "out": "…", "tone": "ok|warn|dim|error" }` (printed). `"pane": 1` puts a line in the second pane; when the session moves between panes it reads as a message arriving (whoosh, ding, glow).

### `steps`
`title`, `steps`: 2–6 of `{ "title": "…", "body": "…" }` (or plain strings). Promo shows cards; explainer highlights one step at a time along a progress line.

### `diagram`
`title`, `nodes`: 2–5 of `{ "id": "a", "label": "…", "note": "…" }`, `edges`: 0–8 of `{ "from": "a", "to": "b", "label": "…" }`. Nodes are laid out in order (left to right, or top to bottom in vertical); edges between neighbours are straight, others arc around. Edges draw one after another.

### `features`
`title`, `items`: 1–6 short strings, `subtitle`. `layout`: `pills` (promo default), `list` (explainer default) or `grid` (cards).

### `stat`
One big number: `value` (e.g. `"80%"`, `"$1,200"`, `"3x"`), `label`, optional `title` and `note`. A value with a whole number counts up from 0 (`"count": false` to just show it); decimals are shown as written. Use real numbers only.

### `compare`
Two sides: `left` and `right`, each `{ "label": "Before", "points": ["…"], "image": "shot.png" }` (points, image, or both). `verdict`: `"right"` (default) highlights the right side as the better one, `"left"`, or `"none"`. Side by side in landscape, stacked in vertical.

### `kinetic`
Big words, one line at a time: `lines` (1–6, short), `beat` (seconds between lines, default 0.7). Earlier lines dim; the last is in the accent color. Good for a hook or a tagline.

### `code`
A diff: `file` (label), `lines` of `"context"`, `{ "add": "…" }` or `{ "del": "…" }`, revealed line by line with line numbers.

### `image`
`image`: a local PNG, JPG, WebP, GIF or SVG; `title`, `caption`, and optional `highlights` / `zoom` (below). Images from image-use, screenshots or exports all work.

### `video`
Real footage: a screen recording or any local clip.
- `video`: a local MP4, MOV, WebM or M4V
- `start`: seconds into the clip to begin (default 0); `length`: seconds to show (default: to the end); `speed`: 0.25–4 (default 1)
- `audio`: `true` keeps the clip's own sound (default `false`: music and narration only)
- `title`, `caption`, `highlights`, `zoom`

The scene lasts as long as the clip plays (or its narration, if longer). After the clip ends its last frame stays on screen.

### Highlights and zoom (`image` and `video`)
Boxes are `[x, y, width, height]` in the source's own pixels; `motion-use validate` prints each file's size. Times are seconds from when the media appears (for a video: from when it starts playing).
- `highlights`: up to 8 of `{ "box": [...], "at": 1, "until": 3, "label": "…" }`. The box gets an outline and a label, and everything outside it dims. Without `until` it stays to the end of the scene.
- `zoom`: up to 4 of `{ "box": [...], "at": 2, "hold": 2 }`. The view moves in until the box fills the frame, holds, and moves back. Zooms may not overlap.

Pick boxes by looking at the actual frame: for a video, extract it first (`ffmpeg -ss <seconds> -i clip.mp4 -frames:v 1 frame.png`) and read coordinates off that.

### `cta`
End card: `title` (product name, large), `subtitle`, `command` (install line), `url`.

## Reproducibility

Everything is drawn with CSS animation that HyperFrames seeks frame by frame, so the same brief renders the same video, bit for bit. One exception: frames of a `video` scene come from Chrome's video decoder and can differ by invisible amounts between runs (they show the same source frame at the same moment; only pixel noise differs).

## Cover

Players, feeds and GitHub use the first frame as the thumbnail. With the default `cover: "first-scene"`, scene 1 is fully composed at frame 0 and holds for at least 2.5 s, so make it the picture you want people to click: a short hook and the product name. `motion-use render` also writes that frame as `<name>-<lang>-<format>-cover.png` for platforms that ask for a separate cover image.

## Voiceover

Narration can be recorded or generated. Either way it ends up at `<voiceover.dir>/<lang>/<scene-id>.mp3`, and each scene stretches to fit it.

- **Recorded:** put your files there. That's all.
- **Generated:** write `narration` on the scenes, then run `motion-use voiceover <brief>`.
  - `--engine azure` uses Azure AI Speech (`AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`): licensed for publishing. It is the default when those are set.
  - `--engine edge` uses the `edge-tts` CLI (`pip install edge-tts`): the same voices through Microsoft Edge's read-aloud service. Whether its audio may be published is not established, so treat it as a preview; `render` reminds you when a video uses it.
  - Default voices: `zh-CN-YunxiNeural` for `zh`, `en-US-AndrewMultilingualNeural` for `en`; set `voiceover.voices` for other languages or other voices.
  - Generated files are recorded in `<dir>/.motion-use-voiceover.json`. Running again regenerates only lines whose text, voice, rate or engine changed. A file motion-use did not generate (your own recording) is never replaced unless you pass `--force`.

## Timing

- Scenes cross-fade over 0.4 s.
- A scene lasts as long as its animation needs plus a short hold, or its `duration` if longer.
- With a voiceover file, a scene lasts at least 0.3 s + narration + 0.5 s, and its narration starts 0.3 s after it has faded in. Narrations never overlap.
- `motion-use validate` prints every timeline, and which scenes were stretched.

## File size

`render --max-size 9MB` re-encodes any MP4 above the limit (x264, rising CRF) until it fits, and reports the final size. `--target github` is the same with 9.5 MB: GitHub plays videos in a README inline only up to 10 MB. Motion-use frames are mostly flat text and shapes, so this usually costs nothing visible.

## Safe areas

Vertical videos keep text out of the right 150 px (like/comment/share buttons) and the bottom 330 px (caption block) used by Douyin, Reels and Shorts. These are working values from those apps, not published specs; check your platform with `motion-use still`.

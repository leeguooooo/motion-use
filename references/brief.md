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

Every scene has `type`, and optionally `id` (default `scene-N`; voiceover files are named after it), `narration` (text per language for `motion-use voiceover` to speak; never drawn), `duration` (seconds, 1–60; never shorter than the scene's own animation), and `voiceover` (`{ "zh": "path.mp3" }`, overriding the folder convention).

### `title`
`title` (required), `subtitle`.

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
`title`, `items`: 1–6 short strings, `subtitle`.

### `image`
`image`: a local PNG, JPG, WebP, GIF or SVG; `title`, `caption`. Images from image-use, screenshots or exports all work.

### `cta`
End card: `title` (product name, large), `subtitle`, `command` (install line), `url`.

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

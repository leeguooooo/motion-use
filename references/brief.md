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
| `theme` | style colors | `{ "accent": "#hex", "background": "#hex", "text": "#hex" }` |
| `music` | `"builtin"` | `"builtin"` (original track synthesized to the video's length), `"none"`, or `{ "file": "song.mp3", "volume": 0.5 }` |
| `sfx` | `true` | Small whooshes, clicks and dings on scene beats |
| `voiceover` | none | `{ "dir": "voiceover", "volume": 1 }`: files at `<dir>/<lang>/<scene-id>.mp3` (.wav, .m4a, .aac, .ogg) |
| `scenes` | required | 1–20 scenes, played in order |

## Text

Any text field takes either one string for every language, or an object per language:

```json
"title": "chrome-use"
"title": { "zh": "三步上手", "en": "Three steps" }
```

`\n` makes a line break in headlines. Text is always drawn literally; HTML in it shows as characters.

## Scenes

Every scene has `type`, and optionally `id` (default `scene-N`; voiceover files are named after it), `duration` (seconds, 1–60; never shorter than the scene's own animation), and `voiceover` (`{ "zh": "path.mp3" }`, overriding the folder convention).

### `title`
`title` (required), `subtitle`.

### `terminal`
A typed command-line session in one or two panes.
- `title`: headline above the panes
- `panes`: 1–2 of `{ "label": "Claude Code", "accent": "#d97757" }` (default one pane labeled "Terminal")
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

## Timing

- Scenes cross-fade over 0.4 s.
- A scene lasts as long as its animation needs plus a short hold, or its `duration` if longer.
- With a voiceover file, a scene lasts at least 0.3 s + narration + 0.5 s, and its narration starts 0.3 s after it has faded in. Narrations never overlap.
- `motion-use validate` prints every timeline, and which scenes were stretched.

## Safe areas

Vertical videos keep text out of the right 150 px (like/comment/share buttons) and the bottom 330 px (caption block) used by Douyin, Reels and Shorts. These are working values from those apps, not published specs; check your platform with `motion-use still`.

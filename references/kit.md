# Writing a film with the kit

Everything needed to write `composition/draw.js` for most films, on one page. Full contract: [film.md](film.md). Directing method: [directing.md](directing.md). Looks: [grammars.md](grammars.md).

```js
window.drawFrame = function (c, t, film, view, M) {
  const { width: W, height: H, vertical: V } = view, u = M.unit, p = film.copy, k = M.palette();
  M.paper(c);                                             // palette background with paper grain
  M.shoot(c, t, [[1.2, "push", [W * 0.3, H / 2], 0.28], [3, "slam"]], () => {
    M.chart(c, t, { data: "sales", at: 0.3, highlight: "Q3" });
    M.callout(c, t, [W * 0.62, H * 0.3], p.peak, { at: 1.6, sub: p.why });
  });
  M.captions(c, t);                                       // narration subtitles
};
```

Rules: draw from `t` only; paint the background every frame; words go in `film.json` `copy` (per language), numbers and series in `data` (one place to change them), images in `assets`, footage in `videos`. Sizes scale with `u` (1 at 1080p). `k` is the locked palette: `bg`, `surface`, `ink`, `sub`, `accent`, `accent2`.

Every time-based helper is `(c, t, …positional, options)`; points are `[x, y]`; `at` is when it starts.

| helper | does |
|---|---|
| `shoot(c, t, events, drawWorld, base)` | camera: `[at, "push", [x,y]?, k]` · `[at, "pan", [x,y]]` · `[at, "to", [x,y], z]` · `[at, "slam"]` · `[at, "shake", amp]` · `[at, "cut", [x,y], z]`; `base` = `{x, y, z}` at start |
| `captions(c, t)` | narration subtitles from the voice track (sentence cues; estimated when the service gave none) |
| `captions(c, t, [[text, start, end], …])`, `caption(c, t, text, start, end, {x, y, align, size, plate})` | beat titles in a masked slot: rise 0.35 s, hold, leave 0.18 s |
| `words(c, t, text, [x,y], {at, stagger, times, style: rise\|slam\|pop\|type, emphasis: [words], until})` | kinetic words entering in turn |
| `stamp(c, t, text, [x,y], {at, until, box, rotate})` | a word slammed in, 1.55 → 0.94 → 1 |
| `counter(c, t, [x,y], {value, from, at, dur, prefix, suffix, decimals})` | number rolling to `value` (a `data` key or a number) |
| `chart(c, t, {data, type: bar\|line\|dots, at, highlight, x, y, w, h, max})` | bars grow in turn, line draws on; labels may be `{en, zh}` |
| `callout(c, t, [x,y], text, {at, until, sub, dx, dy})` | dot, pulse, leader line, label |
| `card(c, [x,y], {label, fill, icon, scale})`, `pill(c, t, [x,y], text, {from, to})` | a filled object; a message that swells and collapses |
| `stroke(c, t, points, {at, dur, until, pen, rough})`, `node(c, t, a, b, {at})`, `ripple(c, t, [x,y], {at})` | drawn lines with an optional pen; link-and-dot; arrival rings |
| `signature(c, t, text, [x,y], {at, dur, underline})`, `write`, `pen` | handwriting with the marker |
| `cover(c, image, {x, y, w, h, fx, fy, zoom})`, `video(name, t)` | image or current footage frame covering a box, zoomed on a focus |
| `spotlight(c, t, [x,y,w,h], {at, until})`, `cursor(c, t, [[t,x,y], …], {clicks})` | dim all but a region; a pointer that moves and clicks |
| `grade(c, "mono"\|"tint"\|"duotone", …)`, `grain(c, t)`, `vignette(c)` | whole-frame looks, drawn last |
| `tween(t, at, dur, ease)`, `springHz`, `settle`, `lagged`, `step`, `easings.*` | timing building blocks |
| `rough`, `drawOn`, `paragraph`, `wrap`, `ring`, `lerp2`, `add`, `rng`, `noise` | drawing building blocks |

```json
"look": {"style": "one sentence", "palette": "paper", "character": "hands only"},
"data": {"sales": [{"label": {"en": "Q3", "zh": "第三季度"}, "value": 18}]},
"videos": {"demo": {"file": "footage/demo.mp4", "at": 4, "from": 12.5, "rate": 1, "volume": 0}},
"music": {"builtin": "pulse", "hits": [3]},
"shots": [{"id": "peak", "start": 0, "end": 4, "camera": "push", "text": {"en": "Q3 peak"},
           "purpose": "…", "action": "the Q3 bar grows past the others and a callout pins it",
           "narration": {"en": "Sales peaked in the third quarter."}}]
```

Palettes: `paper` `poster` `ink` `navy` `bauhaus` `snow` `wood` `chalk` `whiteboard`, or 3–6 hex colors. Music moods: `promo` `explainer` `pulse` `chiptune` `pentatonic` `ambient`. Footage frames are extracted at build time (≤ 5,400 per film); sound only at rate 1.

## Cheap iteration

```bash
motion-use validate .                                  # plan warnings, glyphs, narration fit
motion-use still . --allow-code --shot peak            # three frames of one shot
motion-use render . --allow-code --from 3 --to 7       # silent draft of a range, no delivery checks
motion-use render . --allow-code --quality draft --json  # compact summary; full report on disk
```

Look at an image only when the numbers do not settle the question. A `demo_similarity` above 0.3 means the film is laid out like the starter: redesign it, do not re-skin it.

## Three examples, three looks

- [examples/data-story](../examples/data-story/): finance chart, data in `film.json`, a bar that shrinks when its value changes.
- [examples/whiteboard](../examples/whiteboard/): marker on a wide board, the camera framing each idea, then the whole.
- [examples/kinetic](../examples/kinetic/): one heavy word per beat, flat colour chapters, a stroke that crosses out the last word.

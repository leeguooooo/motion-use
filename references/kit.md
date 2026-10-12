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

Portrait feeds cover the picture: navigation at the top, the author row, caption and like/comment bar at the bottom, an action column on the right. `view.safe` (`{x, y, w, h}`: 6–86 % across and 10–76 % down in portrait, 5 % margins otherwise) is where text and key action belong; `M.captions(c, t)` already sits at its bottom. Check with `still --guides`, which tints what the platform UI would cover.

Rules: draw from `t` only; paint the background every frame; words go in `film.json` `copy` (per language), numbers and series in `data` (one place to change them), images in `assets`, footage in `videos`. Sizes scale with `u` (1 at 1080p). `k` is the locked palette: `bg`, `surface`, `ink`, `sub`, `accent`, `accent2`.

Every time-based helper is `(c, t, …positional, options)`; points are `[x, y]`; `at` is when it starts.

| helper | does |
|---|---|
| `shoot(c, t, events, drawWorld, base)` | camera: `[at, "push", [x,y]?, k]` · `[at, "pan", [x,y]]` · `[at, "to", [x,y], z]` · `[at, "slam"]` · `[at, "shake", amp]` · `[at, "cut", [x,y], z]`; `base` = `{x, y, z}` at start |
| `captions(c, t)` | narration subtitles from the voice track (sentence cues; estimated when the service gave none); long lines wrap into two balanced lines |
| `captions(c, t, [[text, start, end], …])`, `caption(c, t, text, start, end, {x, y, align, size, plate, lines})` | beat titles in a masked slot: rise 0.35 s, hold, leave 0.18 s |
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
| `follow(t, [[at, value], …], {f, d})` | a number or point that springs to each new target in turn, a pure function of `t` (UI morphs) |
| `tween(t, at, dur, ease)`, `springZeta(t, zeta, hz)`, `springHz`, `settle`, `lagged`, `step`, `easings.*` | timing building blocks; `springZeta` takes seconds since the move and a damping ratio (0.8 premium, 0.5 playful, 1 no bounce) |
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

Palettes: `paper` `poster` `ink` `navy` `bauhaus` `snow` `wood` `chalk` `whiteboard`, or 3–6 hex colors. Music moods: `promo` `explainer` `pulse` `chiptune` `pentatonic` `ambient`, or a song: `{"file": "audio/song.wav", "bpm": 128, "from": 1.3}` from `motion-use beats`. Sound effects take `"align": "peak"` to land their hit on `start`; `"loop": true` checks the last frame leads into the first. Beat-driven briefs and the one-shape morph: [briefing.md](briefing.md). Footage frames are extracted at build time (≤ 5,400 per film); sound only at rate 1.

## Cheap iteration

```bash
motion-use validate .                                  # plan warnings, glyphs, narration fit
motion-use still . --allow-code --shot peak            # three frames of one shot
motion-use still . --allow-code --format vertical --guides   # tint what platform UI covers
motion-use still . --allow-code --beats 4              # one frame per bar of the beat grid
motion-use still . --allow-code --onion 4.4-5.2        # 8 frames of a move in one PNG: is the spacing eased?
motion-use beats audio/song.wav                        # imported song: tempo, downbeat, drop → music line
motion-use render . --allow-code --from 3 --to 7       # silent draft of a range, no delivery checks
motion-use render . --allow-code --quality draft --json  # compact summary; full report on disk
```

Inspect a contact sheet after each new look or staging change, then watch a draft for timing and performance. Numeric checks cannot approve the picture. A `demo_similarity` above 0.3 means the film is laid out like the starter: redesign it, do not re-skin it.

## Three examples, three looks

- [examples/data-story](../examples/data-story/): finance chart, data in `film.json`, a bar that shrinks when its value changes.
- [examples/whiteboard](../examples/whiteboard/): marker on a wide board, the camera framing each idea, then the whole.
- [examples/kinetic](../examples/kinetic/): one heavy word per beat, flat colour chapters, a stroke that crosses out the last word.

## Dynamic comics

These helpers animate layered art and expression variants already declared in `film.json.assets`. Keep a character's body, face, eyes and mouth in the same reference coordinates. They cannot turn a single pose into full character acting; plan expression changes, eyelines, reactions and cuts alongside the dialogue.

| helper | contract |
|---|---|
| `layers(c, t, [{image, depth, x, y, w, h, opacity}], {camera, at})` | Draw back to front in array order. `image` is an asset key or a loaded image. Depth 0 stays fixed; 1 follows the camera; intermediate depths give parallax. Default rectangle is the frame. |
| `sprite(c, t, variants, [[time, name], …], {x, y, w, h, at, fade})` | Select an expression/eye/mouth variant. Times are relative to `at`; the first variant holds until the next cue. Return its name, or null before `at`. Variants are asset keys/images or `{image, dx, dy}` alignment offsets. Default fade 0 gives an instant swap. |
| `mouth(t, cues, {at, rest})` | Select a Rhubarb `mouthCues` value at dialogue-relative time; accepts the JSON object or cue array. Intervals include start, exclude end; gaps return `rest` (default `X`). It reads cues, it does not analyse audio or generate them. |
| `breath(t, {at, period, amp, phase})` | Scale 1…1+amp, default amp 0.012 and period 3 s; 1 before `at`. |
| `sway(t, {at, period, amp, phase})` | Rotation in radians, default ±0.025 over 4 s; 0 before `at`. |
| `shake(t, {at, dur, amp, hz, seed})` | `{x,y}` offset in pixels, default 8 px over 0.2 s; zero outside its window. Each axis stays within ±amp. |

```js
const cam = M.camera(t, [{at: 2, kind: "push", x: W * 0.6, y: H * 0.4}]);
M.layers(c, t, [
  {image: "background", depth: 0.15},
  {image: "foreground", depth: 0.8},
], {camera: cam}); // call outside M.shoot/applyCamera: layers applies its own camera

const jolt = M.shake(t, {at: 3.2, dur: 0.18, amp: 6});
c.save();
c.translate(W * 0.6 + jolt.x, H * 0.8 + jolt.y); // actor's feet are the pivot
c.rotate(M.sway(t, {amp: 0.008, period: 5}));
c.scale(1, M.breath(t, {amp: 0.008, period: 3.8}));
M.sprite(c, t, {
  calm: "actor-calm", reply: {image: "actor-reply", dx: 2, dy: -1},
}, [[0, "calm"], [2, "reply"]], {x: -180, y: -600, w: 360, h: 600, fade: 0.08});
c.restore();

const shape = M.mouth(t, film.data.dialogue, {at: 2}); // {mouthCues:[{start,end,value},…]}
M.sprite(c, t, {A: "mouth-a", B: "mouth-b", X: "mouth-rest"}, [[0, shape]],
  {x: mouthX, y: mouthY, w: 48, h: 24}); // provide every shape present in the cues
```

Expression/eye/mouth PNGs need matching head positions; use `dx`/`dy` for small alignment corrections. Crossfades use an isolated premultiplied blend, so swapping opaque poses does not expose the background at the midpoint. Keep `fade` shorter than the gap between consecutive cues; use instant swaps for speech mouth shapes and brief blinks. Draw each face component separately over the body. Do not fade whole bodies to simulate a blink.

All selection and motion derive from the requested time, including backward seeks and worker renders. Inspect the actual art at full size, then watch a draft: a breathing loop alone does not resolve weak acting, and mouth cues do not certify lip sync.

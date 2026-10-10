# Directing a film

How to plan, pace, check and review an authored film. The failure modes, pulse rhythm, storyboard rules, delivery gates and review protocol are adapted from [huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion) (MIT, alchaincyf) and re-expressed for `film.json` and `composition/draw.js`. The drawing API is in [film.md](film.md); explainer looks are in [grammars.md](grammars.md).

## Before code: lock the look, then plan objects and verbs

Write `look` before the first shot. One style and one palette hold to the last frame; changing scenes is fine, changing style is a collage.

```json
"look": {"style": "Warm paper, flat shapes, one pencil line weight", "palette": "wood", "character": "hands only"}
```

- `palette`: one of `paper`, `poster`, `ink`, `navy`, `bauhaus`, `snow`, `wood`, `chalk`, `whiteboard`, or 3–6 hex colors (`bg`, `ink`, `accent`, optional `accent2`, `sub`, `surface`). Pick light or dark once. Validation rejects a blue-purple color (hue 225–300°, saturation ≥ 0.30) unless `allowBluePurple` records why the subject needs it.
- `character`: `none`, `hands only`, real footage, or generated frames (a path). Code-drawn mascots, chibis, robots and coins with faces read as generic; use hands, silhouettes, objects or real material.

Each shot names **an object you could point at** and **what that object itself does**. Validation warns on presentation verbs (`appear`, `show`, `fade in`, `出现`, `展示`, `逐条`). Add `camera` (`hold`, `push`, `pull`, `pan`, `slam`, `whip`, `follow`, `cut`, `drift`) and `text` (the words planned on screen, ≤ 8 units: one CJK character or one Latin word each). Visible strings still live in `copy`.

```json
{"id": "spore", "start": 6, "end": 10, "camera": "pan", "text": {"zh": "孢子", "en": "A spore"},
 "purpose": "Show where the mould comes from", "action": "A spore tumbles in through the window gap and lands on the bread"}
```

Checks from the plan (warnings unless noted):

1. The first 3 seconds are a concrete small scene: an object or a pair of hands doing something about the subject. Not a title.
2. The last shot is an action on the subject (pocketed, closed, pulled back to the whole), words written on objects in the scene, not a centred quote card.
3. One example carries the film: the same loaf, the same hands, the same machine.
4. Shots of 2–6 s; over 8 s needs a `holdReason`.
5. Text-led shots ≤ 30%.
6. No three shots in a row with the same camera move; at least one push, pan, slam or whip.
7. Adjacent shots change composition (framing, object, distance), not style. Machines cannot check this one.

## Six ways a film goes wrong

Check them before coding and again on the contact sheet.

1. **Page-flip slideshow.** A fixed header or page number, bullets fading in one by one, the same slow push on every shot, ending on a centred card. Remove the page frame; give each shot one picture event; move the camera in pulses.
2. **Copying the demo.** Composition, objects or assets from an example or the starter end up in the film. Learn the method, redesign the picture for the subject.
3. **No concrete object.** An abstract idea shown only as words and icons. If you cannot write the object and its verb for a shot, the shot is not ready.
4. **Dead background, empty frame.** A large flat or starfield area that never changes while a small patch moves; or frames where the subject is gone. Make the subject fill at least half the frame, keep it in every shot, let the background follow the content.
5. **Drawing what you have as footage.** Screenshots, photos, recordings and source text go full frame; code explains, labels and moves the camera over them.
6. **The generic AI look.** Blue-purple gradients, deep-purple starfields, neon cyan-violet glow; a different style per shot; code-drawn mascots. A clean, unified film that is a little slide-like beats a flashy collage.

## Pulse rhythm: hold, move on the event, hold

Explainer and launch films move in pulses, not in continuous drift. A uniform slow push on every shot was judged a slideshow; the same storyboard with pulses was approved, even though fully still frames rose from 16% to 72% (the fast frames went from 0.7% to 10%). Stillness is not the problem; uneventful motion is.

| move | duration | size |
|---|---|---|
| push | 0.28 s | 18–32% closer (default 25%) |
| pan | 0.30 s | same zoom |
| slam | 0.17 s | scale 1.55 → 0.94 → 1.0 |
| shake | 4/30 s | at most twice per film |

```js
const cam = M.camera(t, [
  {at: 1.4, kind: "push", k: 0.28, x: cup.x, y: cup.y},   // world point moves to centre
  {at: 3.5, kind: "pan", x: plate.x, y: plate.y},
  {at: 4.6, kind: "slam"},
  {at: 9.0, kind: "to", z: 0.8, x: W/2, y: H/2, dur: 0.34},
], {z: 1.1});
c.save(); M.applyCamera(c, cam); /* draw the world */ c.restore();
```

Each event starts from wherever earlier events have brought the camera at time `t`, so a move can begin before the last one lands. Zoom interpolates in log space. Redraw the world as vectors every frame; never scale a rendered bitmap.

- Land big numbers and words on objects in the world (a price tag, a phone screen, a blackboard), not on a separate card.
- Enter in 0.3–0.4 s, exit in ~0.18 s, then hold. Keep a sub line ≥ 1.2 s; hold ≥ 0.5 s after a number lands, ≥ 0.9 s after a punchline.
- Sizes: headline : sub line : label ≈ 3.4 : 1 : 0.4. One focus per screen.
- Two frame rates read as hand-made: camera smooth, illustrated elements stepped at 12 fps (`M.step(t - at)`). Under `motionBlur` a step change blends two poses in that one frame; turn blur off for stepped looks.
- Art-style pictures stay alive inside the hold: one main action plus 2–4 small motif loops.
- Reveal on the beat or on the spoken word: a count starts its roll before the word so it lands on it; whiteboard writing lags its phrase by about 0.5 s.

## Sound follows the picture

- One short motif, re-voiced rather than replaced. `music: {"builtin": "pulse"}` (also `promo`, `explainer`, `chiptune`, `pentatonic`, `ambient`) sets the beat grid to the mood's tempo, so `M.beat(t)` lines up.
- `hits: [4.62, 14.52]` adds a thump and a plucked accent at those seconds: put them on slams and reveals.
- Hard attacks at changes; no crossfaded music under cuts. For effects, subtract the measured transient offset (see film.md).
- A multimodal model "listening" to a reference is a guess (it said 120 BPM; it was 128). Measure with `motion-use breakdown`.

## Learning from a reference

```bash
motion-use breakdown reference.mp4          # → breakdown/reference/breakdown.md
motion-use compare reference.mp4 out/my-film-en-landscape-VO.mp4 --times 1.5,4,7.2
```

The breakdown writes cut times, a beat-grid fit (confirm it against the music; few cuts fit any grid), 4 fps contact sheets, a strip of every second frame around each transition (the only place a transition's mechanism is visible), a heatmap of where pixels move inside each segment, the last clean frame of each segment, a palette with blue-purple share, and the same motion lights the delivery check uses. Replication means learning the mechanism (timing, framing, how a transition grows out of an object), then applying it to a new subject; it is never a pixel copy, and borrowed principles are credited in DIRECTOR.md.

For a new character interpretation or style direction, show three options first, with different compositions, not three color grades. A named style is not exempt.

## Delivery lights

`render` measures the delivered MP4 (12 fps, 320 px gray, bottom subtitle band masked) and writes `motion` into `review/<id>/report.json`. For authored films, red fails delivery; for scene templates and `verify` (without `--gate`) it is reported.

| light | measures | yellow | red |
|---|---|---|---|
| `fast_ratio` | share of frame pairs inside shots whose mean gray change is ≥ 9/255 (cuts and dissolves excluded) | < 0.06 | < 0.035 |
| `blank_run_s` | longest mid-film run of frames with almost no edges (< 0.2% pixels above Sobel 24), first/last 0.5 s and transitions excluded | – | ≥ 0.3 s |
| `blue_purple_share` | share of frames where ≥ 30% of pixels are blue-purple | ≥ 0.12 | ≥ 0.30 |
| `worst_window_fast_ratio` | the slackest 30 s window (half the film when shorter than 60 s) | ≤ 0.02 | – |
| `longest_still_s`, `max_event_gap_s` | review hints only | ≥ 6 s, ≥ 15 s | – |

The lines come from the reference author's judgement of 13 films ≥ 45 s (approved films ≥ 0.068, rejected ≤ 0.021) and 88 films for blue-purple. Below 20 s a red `fast_ratio` is downgraded to yellow. Measured here: the OCS film 0.129, the three.js promo 0.096, the yarn film 0.236, the hand-written starter 0.090 (landscape) and 0.117 (portrait), the helper-based starter 0.076 and 0.089, the data-story example 0.054 and 0.072; a calm 138 s reference video 0.026. A pale, sparse composition can pulse correctly and still score low: a fast move must change much of the frame. Fix the composition (bigger, filled subject), not the threshold.

Overrides are recorded in the report: `--allow-static "why"` (or `look.allowStatic`) and `--allow-blue-purple "why"` (or `look.allowBluePurple`; the reference author's own Starry Night speedrun measures 0.41). Cuts are found by a frame-difference spike that also changes the luminance histogram; authored `cut: true` shots are always treated as cuts. Without camera-motion estimation, a very fast whip between similar frames can be counted as a cut.

The lights cannot see a page frame, a collage of styles, a strong start with a slack middle the window misses, or an unclear story. Stillness metrics are hints: a pulse film legitimately holds still for long stretches.

## Independent review

Before delivery, someone who did not make the film watches only the MP4 (and its contact sheet) and writes notes into `<project>/reviews/<round>.md`. `render` lists those files in the report (`independent_reviews`); it never vouches for their content. With an agent, give the reviewer the MP4 path, the contact sheet and the viewer's intended takeaway, nothing else, and ask for:

- each issue with a timecode, what the viewer sees, and the likely cause;
- the six failure modes, checked one by one;
- regressions from the last round listed separately from new findings.

If the same class of issue survives three rounds and two fixes, go back to the assets or the renderer instead of polishing. Once the user picks a version, freeze code, timeline, mix and subtitles together.

## Lessons travel with the project

Keep a `## Lessons` section in DIRECTOR.md. Record what worked as **do / evidence / why / when**, and each new problem as **symptom → cause → fix → verified by**. The next session, another style or another model can then continue from evidence instead of taste.

# Explainer looks

Eight looks common in YouTube and Bilibili explainers, condensed from the grammar cards of [huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion) (MIT, alchaincyf), which measured real examples of each. Pick by what the narration explains, not by taste. They are ways to draw inside one `draw.js`, not templates; use at most two in a film, under one `look.palette`. Directing rules (pulse camera, holds, failure modes) are in [directing.md](directing.md).

| narration is about | look |
|---|---|
| a chain of reasoning, history, cause and effect | whiteboard |
| real documents, screenshots, quotes | collage (Vox) |
| a concept that needs a visual metaphor | flat vector (Kurzgesagt) |
| maths, models, how a formula moves | 3Blue1Brown |
| a software product and its interface | keynote UI |
| numbers over time, comparisons | finance chart |
| a story with a person in it | storytime (needs generated character frames) |
| a short punchy message | kinetic type |

Common to all: the camera is a function of time; a reveal lands on the beat or the spoken word; structure first, then data, then one annotation; one focus per screen (main ≥ 3× the secondary); enter slow, exit fast, then hold; at most 3–4 meaningful colors; real material stays as it is (bars start at zero, axes that do not are marked). Check the logic of the sentence the picture makes, including adjacent cards read together.

## Whiteboard

- Board `#FBFBFB`, line `#0A0503`, one orange (`#EB701F`) covering about a fifth of the ink. `look.palette: "whiteboard"`.
- Line width 0.6–0.7% of the frame height; titles about 5.5%.
- Write a phrase while it is said: about 16 characters/s for body text, 7.5 for titles, roughly 0.5 s behind the voice. Strokes ease in and out; an icon takes 0.5–1 s.
- `M.write(c, text, x, y, progress)` reveals characters in three zigzag rows and returns the pen tip; `M.drawOn(c, points, progress)` draws lines by arc length; `M.pen(c, x, y)` draws the marker on top. The hand enters only while drawing and leaves fast between phrases.
- Camera: small moves shift about a quarter of the width so old and new drawings overlap; far jumps are a 0.3 s whip; pull back to the whole board at the end. Frame each beat on the bounding box of its strokes.
- Line type means something from the first stroke: solid = happened, dashed = planned, dotted = cross-reference. Nothing fades: drawings stay or are erased.

## Collage (Vox)

- Near-black `#171716`, paper `#E0DCDA`–`#EEEDED`, one red (`#B65255` line), highlighter `#DACF08`. No pure white or black.
- Material at least 60% of the frame width; more than two small cards in a row reads as a picture frame layout.
- Camera smooth and never linear (`sineInOut` or `longTail`, around 1.3 s); paper elements step at 12 fps (`M.step`). Photos arrive on the cut with no bounce.
- Static paper texture (`M.paper`), weak shadows. Red underline 0.5–1 s; an ellipse drawn in one stroke in about 1 s with open, slightly crossing ends; typing at about 13 characters/s.
- Text to be read is drawn last, on top.

## Flat vector (Kurzgesagt)

- Write the metaphor first: concept → object. At least one state change per narration line; after it lands, the subject freezes and only the ambient layer moves.
- No outlines; shade with a darker band of the same hue; glowing objects get a radial glow. Five or six parallax layers (move far layers 5–30% of the camera).
- Easing `k75` for actions, `easyEase` for loops. Pops reach 90% in 0.25 s, overshoot to about 108%, settle by 0.5 s (`M.springHz(t, at, 2.5, 9)`). Stagger 10–20 frames (`M.lagged`).
- The famous deep-purple palette is exactly the blue-purple the checks reject: use `ink` or `navy`.

## 3Blue1Brown

- Every shot names who becomes whom. Pure black background; blue `#58C4DD`, red `#FC6255`, yellow `#FFFF00`; at most four meaningful colors. Strokes 4 px, grid 2/1 px at 25% opacity, one unit = H/8.
- `M.easings.smooth` almost everywhere. Animations 1–3 s, then about 1 s perfectly still.
- Transform shapes with equal point counts and aligned start points. At most two bullet points on screen. No bloom.

## Keynote UI

- The look most likely to feel templated: choose at most two of mesh background, glass card, gradient text, blur-in centred title, floating cards.
- Screenshots at least 80% of the width (90% in portrait), with pulse pushes into the part being explained.
- Springs bounce 0–0.15; more looks cheap. Large type tracked tight. Concentric corner radii (inner = outer − padding). Background drift periods 9.5–13 s. Colors come from the product's brand.

## Finance chart

- Each chart says one thing and its title is that sentence. Economist layout: red `#E3120B` rule and flag, series `#006BA2` `#3EBCD2` `#379A8B` `#EBB434` `#758D99`, one highlighted series, the rest `#C6D2D8`.
- Horizontal grid only; the zero line is the only solid black. Bars start at zero; keep the drawn ratio within 5% of the data ratio.
- Each bar grows when its word is spoken; hold ≥ 0.5 s after a number lands (`M.count(t, at, dur, from, to)` rolls with an exponential ease). Label illustrative data as such.
- The chart's background matches the film's world; do not drop in a white card.

## Storytime

- Needs a generated character frame library (full body and bust); code-drawn people are not acceptable here. Without one, tell the story with hands, objects and silhouettes.
- Medium shot, head at 25–35% of the height; background 3–5 low-saturation blocks; character line twice the background line.
- About 70% of frames are fully still. Pose changes in 0.1 s with a small settle, then really hold. Reaction close-ups ≥ 0.8 s, in a silence.
- Transitions: smash (1.22 → 1 on a spring), whip (0.26 s), jump-in (about 2× on the same world).

## Kinetic type

- Main word ≤ 4 characters, sub line ≤ 14; sizes about 340 / 96 / 40 px at 1080p; margins ≥ 130 px; one background color per chapter.
- Main word slams in (1.7 → 1 over about 0.35 s, `M.slam` or `M.springHz(t, at, 2.2, 10)`); sub lines rise from a masked slot in 0.3–0.35 s; pops use `backOut` with s = 2.6–3.0.
- Exit in 0.18 s with a 0.03 s stagger. Stagger entrances by one eighth note. Text does not move after it lands. No more than three identical page types in a row.

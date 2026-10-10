# Data story — the same film, 56% less code

Takeaway: the drawing kit cuts the code an agent writes for the same film by more than half.

Source: byte counts of `draw.js` measured in this repository on 2026-10-10 with `wc -c`: `examples/ocs-film/composition/draw.js` 7,911; `templates/film/draw.js` hand-written 7,008; the same starter rewritten with the kit 3,053 (both starters render green on the motion check). The numbers live in `film.json` → `data.bytes`; change them there and every language and format follows.

Look: Economist-style chart on cool paper, one red rule and flag, one highlighted bar, the title is the sentence the chart says. Palette locked in `look`.

Beats: bars grow in turn (hold) → push onto the hand-written starter bar, a callout pins 7,008 → the bar drops to 3,053 while its number rolls down (slam, shake) → pull back, −56% stamps beside it.

Measured (draft renders): landscape fast_ratio 0.054 (yellow), portrait 0.072 (green); narration present in every mix. The landscape cut stays yellow on purpose: a pale chart on pale paper changes few pixels even when the camera moves, and a busier background would fight the chart. Not watched end to end; music not listened to.

## Lessons

- Do: put the changing number in `data` and animate between two data states. Evidence: the shrink beat is one `mix` of two values. Why: an edit to the data cannot desynchronise the picture. When: any chart whose point is a change.

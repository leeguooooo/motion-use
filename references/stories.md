# Choosing a story

Pick the structure before writing scenes. Two products told with the same five scenes look like the same video; the structure is what makes them different. `motion-use init <dir> --story <name>` writes a starter brief for each.

| Story | Fits | Sequence |
|---|---|---|
| `problem-solution` | Tools that remove a chore people already feel | kinetic pain → title (left) → demo → features (grid) → cta |
| `demo-first` | Products you understand the moment you see them | cover → demo (cut) → stat → cta |
| `before-after` | Speed-ups, simplifications, migrations | cover → compare → code → stat → cta |
| `walkthrough` | "How it works", onboarding, explainers | goal (left) → diagram → steps → result → cta |

## problem-solution

Open on the frustration, in the user's words, as `kinetic` lines. Then name the product as the answer (`title`, `layout: "left"`, `transition: "wipe"`), show it working (a `video` of the real thing when you have one; `terminal` otherwise), give two or three reasons (`features`, `layout: "grid"`), and end on the install line.

Narration: the first line is the problem, never the product name. Keep the demo narration about what the viewer sees happen.

## demo-first

The cover says what the product is in a few words; the next scene is the product already doing its job, with no setup (`transition: "cut"` makes it feel immediate). Follow with one real number (`stat`) and the install line. Best when the demo is short and visual: a screen recording with `highlights` on the result.

Narration: describe the result, not the steps.

## before-after

Set up the same task done two ways. `compare` carries the story: the left side is today's pain, specific and recognizable; the right side is the same task with the product. A `code` diff or a short demo shows how small the change is; a `stat` quantifies the gain.

Narration: name the concrete task; numbers only if they are real.

## walkthrough

Explainer style. State the one task the viewer will see completed, show the parts involved (`diagram`), walk through the `steps` (one sentence each: what, and why), and show the end result. Screenshots with `highlights` and `zoom` work well for steps that happen in a UI.

Narration: one idea per scene; say why as well as what.

## Rules for every story

- Facts come from the product's README, `--help` and real output. Never invent features, numbers or install lines.
- Prefer real footage (`video`, screenshots with `highlights`) over mock-ups wherever the product has something to show.
- Scene 1 is the cover: make it readable at thumbnail size.
- Vary `transition` and `layout` with intent (a `cut` for urgency, a `wipe` for a reveal), not on every scene.

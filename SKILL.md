---
name: motion-use
description: Direct and render local videos with an AI coding agent — launch films, motion graphics, explainers, product demos, Chinese/English and landscape/portrait outputs. Author a shot plan and exact-time drawing code, inspect motion, render MP4s and review the delivered file. Also supports scene templates for quick factual explainers. Use for 宣传片、推广视频、讲解视频、产品视频, launch videos, branded motion and social clips. Does not generate photorealistic footage from text or transcribe raw footage.
---

# motion-use

The agent directs and authors the film; motion-use handles local assets, exact-time rendering, fonts, audio and delivery checks. A list of text slides is not the default creative workflow.

```bash
motion-use --version || curl -fsSL https://raw.githubusercontent.com/leeguooooo/motion-use/main/install.sh | sh
motion-use doctor
```

## Direct the film

Use the user's subject, references and existing project. Verify product claims against its source/README or real behavior. Ask only for missing decisions that materially affect the result.

Write or update `DIRECTOR.md`: the viewer's takeaway, the visual subject, the beat map, decisive frames and source provenance. A beat describes **what changes on screen**, where the eye moves, what makes the action happen, and how it hands off to the next beat. A heading followed by bullets is not a shot description.

Choose motion to fit the story. A UI action can use a cursor and direct manipulation; a process can follow one object; a brand piece can use type, shape, masks and camera motion. Do not force every film into a fixed number of shots, a single style, continuous motion, a particular BPM, or the previous film's sequence. Reading holds and hard cuts are valid when intentional. Record the reason for longer holds.

For films, `motion-use init <dir>` writes `film.json`, `composition/draw.js` and `DIRECTOR.md`. Read [references/film.md](references/film.md) before authoring. The scaffold is a drawing study: replace its choreography and appearance, not just its text. An actual example with a different approach is `examples/ocs-film/`.

## Author and inspect

Narration is required by default. Write `narration` per shot (text per language), or a whole-film narration script, before fixing the shot windows. Run `motion-use voiceover <project>` to generate/cache the audio and check that each sentence fits; retime the picture or shorten the script if it does not. Never truncate words or disable narration to make a short film fit. Use `voiceover:false` only when the user explicitly wants an unnarrated piece. `render` also generates missing/outdated narration automatically; a TTS error stops delivery rather than falling back to music-only output.

Write the drawing as a function of exact time. Fonts and named local images preload; optional local browser bundles and `setupFilm` can prepare complex renderers. Camera movement, shape changes and typography share the film's clock. Put visible localized text in `copy`; frame geometry comes from `view`, so portrait needs its own framing decisions.

Use source images/illustrations from the user, captured evidence, or image-use where appropriate. An invented UI or process illustration must not masquerade as a real recording or real terminal output. For footage-led editing, use a suitable editor or native HyperFrames composition; this drawing API does not automatically understand or cut recordings.

```bash
motion-use validate <project> --json
motion-use still <project> --allow-code --lang zh --format vertical
motion-use still <project> --allow-code --at 2.3,2.4,2.5
```

Inspect the opening, action, handoff and resolution, including intermediate poses and both sides of hard cuts. Fix clipping, crowded framing, unreadable copy, a subject that disappears during a morph, and motion that merely decorates a static slide. Stills cannot prove timing: review a draft movie too.

`--allow-code` is appropriate for a project you authored in this task or the user explicitly trusts. It is not an automatic flag for third-party projects. Local code runs in the renderer; content checks are not a security sandbox. Template custom HTML keeps its separate `--allow-custom-html` gate.

## Render and review the delivered video

```bash
motion-use render <project> --allow-code --quality draft --json
motion-use render <project> --allow-code --quality high --json
motion-use verify <delivered.mp4> --json
```

Render returns MP4s, covers and `review/<id>/report.json` plus a contact sheet extracted from the MP4. Delivery checks decode the whole file, compare actual duration/frame rate/dimensions, measure audio and flag dark or still intervals. Audio is normalized in two passes to working targets of -14 LUFS / -1 dBTP; `--no-normalize` keeps authored levels. These are working targets, not universal platform standards.

The narration check compares a voice-only reference stem with the delivered mix at each spoken window. Music alone, a silent voice track, a missing language, mistimed speech or a voice drowned by the bed fails delivery.

Read the report and examine the actual movie. Technical success is not visual approval: Canvas text is not covered by DOM layout/contrast audits, and freeze detection is only a review signal. Check the narrative, framing, readable timing, movement and payoff yourself. Report any listening limitation instead of claiming the mix sounds good from measurements. Fix problems and repeat; after three substantial review passes, disclose remaining issues instead of claiming they disappeared.

Preserve feedback, changes and remaining issues in `DIRECTOR.md`. Deliver the files and an accurate account of what was measured and what was visually reviewed. Do not upload or publish the video unless requested.

## Scene templates

For quick information cards, or an existing brief, keep the template workflow:

```bash
motion-use init <dir> --mode template --style explainer
motion-use validate <dir>/brief.json
motion-use still <dir>/brief.json
motion-use render <dir>/brief.json
```

`--style` or `--story` also selects templates for compatibility. Read [references/brief.md](references/brief.md) for the schema and [references/stories.md](references/stories.md) when choosing a template narrative. Recordings, custom brand fonts, highlight boxes and `voiceover` generation are available here. When a template declares narration, render generates missing speech and requires its presence in delivery too. `voiceover.required:false` is only for deliberately unnarrated template output. Film narration can be generated or imported and uses explicit shot windows, so authored visual timing is never silently stretched.

## Operational rules

- Assets and fonts are local; rendering does not source assets from the web. CLI update checks run at most daily (`MOTION_USE_NO_UPDATE_CHECK=1` disables them).
- Preserve user files and output ownership checks. Use a fresh output directory for experiments; do not run two jobs on the same project/output combination.
- If Edge is selected but missing, install the known `edge-tts` tool with `uv tool install edge-tts` (or Python/pip) and retry. Do not disable narration as a workaround.
- Public voiceover needs suitable authorization; edge-tts is a preview provider, not an established publication license.
- Install/update through GitHub Releases. `motion-use upgrade` refreshes the CLI and its skill.

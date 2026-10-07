# Alternatives

Checked 2026-10-05. Licenses are as reported by the GitHub API on that date. Only features we read in each project's own README or docs are listed.

| Project | License | What it is | Pick it when |
|---|---|---|---|
| [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) | Apache-2.0 | HTML/CSS compositions rendered frame by frame to MP4, with a CLI (`init`, `lint`, `check`, `render`, `snapshot`, `doctor`) and agent skills, including product-launch and explainer workflows | You want full creative freedom and have an agent write each video's HTML from scratch |
| [Remotion](https://www.remotion.dev) and its [agent skills](https://github.com/remotion-dev/skills) | Remotion License: free for individuals, non-profits and companies up to 3 employees; a Company License above that ([terms](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)). The skills repo had no license file detected by GitHub | Videos written as React components | Your team writes React and is fine with the license terms |
| [memex-lab/product-launch-video-skill](https://github.com/memex-lab/product-launch-video-skill) | MIT | An agent skill: brief → storyboard → Remotion → review, with optional TTS | You want a cinematic launch video and already use Remotion |
| [browser-use/video-use](https://github.com/browser-use/video-use) | MIT | Editing existing footage with a coding agent (transcripts, cuts) | You have recordings to edit, not a video to generate |
| [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage) | AGPL-3.0 | A large agentic video production system with many pipelines | You want one system covering many kinds of production |

## Where motion-use fits

motion-use supports authored films as its default workflow: a directing document, exact shot windows and deterministic drawing code. Scene templates in two looks remain an optional fast path. The CLI manages assets, rendering and measured delivery review; the agent still owns the creative decisions.

- **Exact-time rendering.** Film code is authored and reviewed per video; each pose is a function of the requested time. In template mode, the agent fills a brief. Frames are CSS animations that HyperFrames seeks exactly, so two renders are identical (recorded clips aside, which can differ by invisible pixel noise).
- **The matrix for free.** Chinese and English, 16:9 and 9:16, from one brief, with vertical safe areas.
- **Voiceover drives timing.** Drop in recordings; scenes stretch to fit and narrations never overlap.
- **Local and license-light.** Fonts are bundled and subset per video, music is synthesized, sound effects are CC0 or original; rendering loads nothing from the network and runs the engine with telemetry off. MIT code on an Apache-2.0 engine.

It is not a general video editor, does not generate realistic footage, and has no timeline UI. For those, use the projects above.

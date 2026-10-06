---
name: motion-use
description: Make promo and explainer videos from a JSON brief with the motion-use CLI — product launch clips, feature explainers, "how it works" walkthroughs, Douyin/Reels/Shorts vertical cuts, Chinese and English versions, timed to the user's own voiceover. Renders locally to MP4 with no network and no account. Use whenever the user asks for a promo video, 宣传片, 推广视频, 讲解视频, 产品视频, explainer, launch video, 竖版视频, 抖音/视频号/Reels/Shorts clip, or wants a video for a CLI, app, library or feature, even if they don't name the tool. Not for editing existing footage or generating realistic video from a prompt.
---

# motion-use

`motion-use` turns a brief (JSON) into finished MP4s: one per language × format. Every frame is HTML and CSS rendered by HyperFrames, so the same brief gives the same video every time.

## Before anything

```bash
motion-use --version || curl -fsSL https://raw.githubusercontent.com/leeguooooo/motion-use/main/install.sh | sh
motion-use doctor
```

If `motion-use` is missing, run the installer line above as part of the video task (it verifies a checksum and installs into `~/.local/share/motion-use`); it needs Node.js 22+. Rendering also needs ffmpeg and Chrome: if `doctor` reports one missing, show its `fix:` line; `motion-use doctor --install-browser` downloads a Chrome for rendering.

## Workflow

1. **Pick the story, then pin it down.** Choose a structure from `references/stories.md` (`problem-solution`, `demo-first`, `before-after`, `walkthrough`) to fit this product; don't reuse the last video's sequence. From the user's request, settle: product name, the one problem it solves, 3–6 scenes, `promo` or `explainer` style, languages (`zh`, `en`), formats (`landscape` 16:9, `vertical` 9:16). Only ask about what you cannot infer. Use real commands and real output; never invent features, numbers or install lines. Read the product's README or `--help` if you need them.
2. **Write the brief.** `motion-use init <dir> --story <name> --name <slug> --lang zh,en --format landscape,vertical` writes a starter `brief.json` in that structure (`--style` overrides the look); replace every placeholder. The full schema is in `references/brief.md`. Scene types: `title`, `terminal`, `steps`, `diagram`, `features`, `image`, `video`, `stat`, `compare`, `kinetic`, `code`, `cta`. Vary them: two videos for different products should not share a scene sequence. Set `transition` and `layout` per scene where they help the story.
3. **Assets (optional).**
   - Images: `image` scenes take local PNG/JPG/WebP/GIF/SVG files, by path relative to the brief. If the user wants a generated illustration and the image-use skill is available, generate it with image-use, then copy the file it reports into the brief's folder (e.g. `images/hero.png`) and reference that path. Screenshots work too. URLs are rejected: download first.
   - Voiceover: the user's recordings go in `voiceover/<lang>/<scene-id>.mp3` (or .wav/.m4a). Each scene grows to fit its narration and narration never overlaps. No recordings → the video still renders, with music.
   - Generated voiceover: write a short `narration` line per scene (what a presenter would say, not the on-screen text read aloud), then `motion-use voiceover <brief>`. With `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` set it uses Azure (fine to publish); otherwise edge-tts, which is a preview: tell the user before they publish a video made with it. It never overwrites the user's own recordings.
4. **Validate.** `motion-use validate <brief>` (add `--json` to parse). Fix every error; read the warnings (characters the fonts cannot draw, scenes stretched for voiceover).
5. **Look before rendering.** `motion-use still <brief> --lang zh --format vertical` writes one PNG per scene plus a contact sheet. Open the sheet and check: text fits, nothing hides behind the vertical-video side buttons (right edge) or caption area (bottom), the story reads in order. Fix the brief and repeat.
6. **Render.** For a GitHub README add `--target github` (keeps each file under GitHub's 10 MB inline limit). `motion-use render <brief>` writes `out/<name>-<lang>-<format>.mp4` for every combination (`--lang`, `--format` to narrow, `--quality draft` for a quick look). Report the paths and durations to the user.

## The cover

The first frame is the thumbnail everywhere (feeds, players, GitHub). Scene 1 is shown already finished at frame 0, so write it as a cover: a short hook, readable at thumbnail size. `render` also writes `<name>-<lang>-<format>-cover.png`; give that to platforms that ask for a cover image.

## Real footage

A recording of the actual product beats any mock-up, and it is what makes each video look different. When the product has a UI or visible output:
- Record it (a screen recording, or `chrome-use` screenshots / a recording of a browser flow) and use a `video` scene; trim with `start`/`length`, speed up with `speed`.
- Point at what matters with `highlights` and `zoom`. Boxes are in the source's pixels: run `motion-use validate` for the size, extract the frame you mean (`ffmpeg -ss 3 -i clip.mp4 -frames:v 1 f.png`), look at it, and read the coordinates from it. Never guess boxes without looking.
- Use mock-up scenes (`terminal`, `diagram`) for what cannot be recorded.

## Brand

If the product has a logo, colors or a typeface, use them: `brand.logo` (and `corner: true` for a corner badge), a full `theme` palette, and `fonts` with the license file. Without brand assets and with the user's go-ahead, image-use can make an illustration or background for the cover; save it next to the brief and use it in a `title` scene (`image`, or `layout: "split"`). Heed `validate`'s contrast warnings.

## Choosing a style

- `promo`: dark, glowing, punchy; sound effects on each beat. For launches and social clips.
- `explainer`: light paper, ink, calm; steps highlight one at a time, diagrams draw their arrows. For "how it works".
- `theme.accent` (hex) sets the brand color; `theme.background` and `theme.text` are also allowed.

## Rules

- Text in the brief is drawn as text, never as HTML. Keep headlines short (they shrink to fit, but short reads better): about 16 CJK characters or 32 Latin characters per line, `\n` for a deliberate break.
- Rendering is local: assets and fonts come from disk, and the engine runs with telemetry off. The CLI itself checks GitHub for a newer release at most once a day (`MOTION_USE_NO_UPDATE_CHECK=1` turns it off). Do not upload the video anywhere unless the user asks.
- `out/` folders are owned by motion-use; it refuses to overwrite a folder it did not create.

## Upgrade

When any `motion-use` command prints `motion-use X is available`, tell the user and offer to run `motion-use upgrade` (it updates the CLI and this skill). Check without changing anything: `motion-use upgrade --check`. The user may also just say "升级 motion-use" / "upgrade motion-use".

If the skill came from somewhere `upgrade` can't refresh:
- Claude Code plugin: `claude plugin update motion-use@leeguooooo-plugins`
- Whole family: `curl -fsSL https://raw.githubusercontent.com/leeguooooo/plugins/main/upgrade-use-family.sh | sh`

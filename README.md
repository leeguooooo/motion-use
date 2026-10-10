# motion-use

English | [中文](README.zh-CN.md)

Direct a film with your coding agent: plan the action, author exact-time animation, render locally, then inspect the delivered MP4. Chinese/English, landscape/portrait/square, local fonts and assets. Scene templates remain available for quick explainers.

A directed example: [OCS — a message crosses the gap](examples/ocs-film/film.json), with its [drawing code](examples/ocs-film/composition/draw.js) and [director notes](examples/ocs-film/DIRECTOR.md).

**Showcase: yarn relay (three.js).** Six felt monsters relay a ball of white yarn; the thread it pays out draws the OpenAI blossom, puffs into plush rope and stands up; the lights go out, six coloured lights run along the yarn and sum to white; a flash takes the group photo. 40 s at 60 fps, with the score and sound effects synthesised in code. [Source and director notes](examples/openai-yarn-film/).

https://github.com/user-attachments/assets/5bf4053f-9243-48cc-b8f2-ecd2dccc7e79

```bash
curl -fsSL https://raw.githubusercontent.com/leeguooooo/motion-use/main/install.sh | sh
motion-use doctor
```

Part of the [*-use family](https://github.com/leeguooooo/plugins): tools that give AI agents hands. The bundled skill teaches an agent to go from "make a launch video for X" to a brief, keyframes and finished MP4s.

## Directed films (default)

```bash
motion-use init my-film --name my-product --lang zh,en --format landscape,vertical
# direct the film in DIRECTOR.md, film.json and composition/draw.js
motion-use validate my-film
motion-use voiceover my-film                 # narration per shot; cached
motion-use still my-film --allow-code
motion-use render my-film --allow-code --quality high --json
```

The agent writes the choreography; the CLI does not turn every paragraph into a scene. Shots have a purpose and visible action. The drawing is a pure function of time, so a shape can carry between shots, the camera can follow it, and motion can align with the audio beat grid. Narration is required by default: write it per shot, then generate or import the speech. Render automatically generates missing narration; it fails if speech is missing, overlong or absent from the delivered mix. Use `voiceover:false` only for deliberately unnarrated films. Optional subframe sampling adds motion blur. Fonts and named images preload; local browser bundles can prepare more complex renderers.

The starter is an editable drawing study, not a finished ad. Replace its choreography for the subject. The [OCS film](examples/ocs-film/film.json) demonstrates another approach: large agent names compress into endpoints; one message travels, expands into a wake pulse, then resolves into the wordmark. It is an illustrated workflow, not a recording of actual message delivery.

`--allow-code` is for drawing code you wrote or trust. It executes inside the renderer; static lint is not a security sandbox. Ordinary text remains JSON data. Named files are copied individually, so a composition folder's secrets and unrelated files do not enter the build.

Every render also writes a cover, a contact sheet sampled from the **delivered MP4**, and a technical report: decoding, actual duration/FPS/dimensions, audio presence, loudness/peak, per-shot RMS, dark/still intervals. It never labels an encode as aesthetic approval: `visual_review` remains pending until a person/agent watches and reviews it. Canvas text is not covered by DOM layout audits. Audio uses two-pass normalization to working -14 LUFS / -1 dBTP targets; `--no-normalize` preserves original levels.

Full drawing/audio contract: [references/film.md](references/film.md). For an existing MP4, `motion-use verify file.mp4 --json` creates a review report without re-rendering it.

## Scene templates

```bash
motion-use init my-video --mode template --style promo        # or --style explainer
# edit my-video/brief.json
motion-use validate my-video/brief.json      # errors with JSON paths, timelines, missing glyphs
motion-use still my-video/brief.json         # one PNG per scene + a contact sheet
motion-use render my-video/brief.json        # my-video/out/<name>-<lang>-<format>.mp4
```

A brief is a list of scenes: `title`, `terminal`, `steps`, `diagram`, `features`, `image`, `video` (screen recordings), `stat`, `compare`, `kinetic`, `code` or `cta`, each with its own layout and transition options, and text per language:

```json
{
  "version": 1,
  "name": "my-tool",
  "style": "promo",
  "languages": ["zh", "en"],
  "formats": ["landscape", "vertical"],
  "voiceover": { "dir": "voiceover" },
  "scenes": [
    { "id": "hook", "type": "title", "title": { "zh": "验证码到底在哪个邮箱？", "en": "Which inbox has the code?" } },
    { "id": "demo", "type": "terminal", "lines": [{ "cmd": "mail-use code --since 10m" }] },
    { "id": "cta", "type": "cta", "title": "mail-use", "url": "github.com/leeguooooo/mail-use" }
  ]
}
```

Full schema: [references/brief.md](references/brief.md). Examples: [examples/](examples/) (`ocs` and `mail-use` promos, a `chrome-use` explainer).

## What you get

- **Two looks.** `promo`: dark, glowing, a sound on every beat. `explainer`: light paper, calm, steps that highlight in turn and diagrams that draw their arrows. `theme.accent` sets your brand color.
- **Voiceover.** Put recordings at `voiceover/<lang>/<scene-id>.mp3`, or write `narration` per scene and run `motion-use voiceover` (Azure AI Speech, or edge-tts as a preview). Each scene grows to fit its narration; narrations never overlap. Without any, the video still renders, with music.
- **A real cover.** Frame 0 is the finished first scene, so players and feeds show a thumbnail instead of a black frame; `render` also writes it as a PNG.
- **Real footage.** `video` scenes play your own screen recordings (trimmed, sped up); `image` scenes show screenshots or illustrations made with [image-use](https://github.com/leeguooooo/image-use). Both can highlight a region (everything else dims) and zoom into it.
- **Your brand.** Logo on the cover, end card and (optionally) every scene; a full color palette with contrast checks; your own fonts, subset per video, with their license.
- **Vertical safe areas.** 9:16 keeps text clear of the like/share column and the caption block.
- **Reproducible and local.** Same brief, same video: bit for bit (software rendering), except that frames of a recorded clip can differ by invisible noise. Animations are CSS that [HyperFrames](https://github.com/heygen-com/hyperframes) seeks frame by frame; fonts ship with motion-use and are cut to the characters each video uses; music is synthesized to the video's length. Rendering loads nothing from the network and runs the engine with telemetry off (`HYPERFRAMES_NO_TELEMETRY`, `DO_NOT_TRACK`). The CLI checks GitHub for a newer release at most once a day; `MOTION_USE_NO_UPDATE_CHECK=1` turns that off.
- **Safe with untrusted text.** Brief text is always drawn as text, never HTML. Custom HTML scenes exist for when templates are not enough, but render only with `--allow-custom-html`. motion-use never overwrites output files it did not write (`--force` to override).

## Requirements

motion-use is a Node.js program, not a single native binary: rendering drives Chrome and FFmpeg.

- Node.js 22 or newer (the installer checks)
- FFmpeg (`brew install ffmpeg`, `apt install ffmpeg`)
- Chrome: your installed Chrome, or `motion-use doctor --install-browser`

Verified on macOS (Apple Silicon). The CI workflow runs the tests and a real render on macOS and Ubuntu. Windows is not supported yet.

The installer downloads the release archive and its `.sha256` from GitHub, verifies it, and runs `npm ci` from the bundled lockfile into `~/.local/share/motion-use` (dependencies come from the public npm registry; no account or token). Options are at the top of [install.sh](install.sh).

## Commands

| Command | |
|---|---|
| `init [dir]` | Directed film by default; `--mode template` selects a starter brief: `--style`, `--name`, `--lang zh,en`, `--format landscape,vertical` |
| `validate [brief]` | Check the brief, files, voiceover lengths and glyph coverage; print timelines |
| `voiceover [brief]` | Speak each scene's `narration`: `--engine azure` (licensed) or `edge` (preview) |
| `still [brief]` | Keyframes and a contact sheet; `--at 1.5,4` for exact seconds |
| `render [brief]` | MP4 per language × format, plus a cover PNG; `--quality draft\|standard\|high`, `--target github` / `--max-size 9MB` |
| `verify <mp4>` | Decode and measure a delivered video; create review frames and a report |
| `doctor` | Check Node, FFmpeg, Chrome, the engine and fonts |
| `upgrade` | Update the CLI and its skill; `--check` only looks |

All commands take `--json`. `still` and `render` take `--lang`, `--format` and `--out`.

## Licenses

motion-use is MIT. The engine, HyperFrames, is Apache-2.0. Fonts are SIL OFL; sound effects are CC0 or original; one dependency of the engine (`@img/sharp-libvips`) is LGPL-3.0. Every file and dependency is listed in [ASSETS.md](ASSETS.md). How motion-use compares with HyperFrames, Remotion and others: [docs/alternatives.md](docs/alternatives.md).

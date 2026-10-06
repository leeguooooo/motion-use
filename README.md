# motion-use

Promo and explainer videos from a JSON brief. Chinese and English, 16:9 and 9:16, timed to your own voiceover, rendered locally to MP4. The same brief gives the same video every time.

https://github.com/user-attachments/assets/1e4a150d-2db3-4793-b738-d897751c6d8e

*This video was made by motion-use from [examples/motion-use/brief.json](examples/motion-use/brief.json).*

```bash
curl -fsSL https://raw.githubusercontent.com/leeguooooo/motion-use/main/install.sh | sh
motion-use doctor
```

Part of the [*-use family](https://github.com/leeguooooo/plugins): tools that give AI agents hands. The bundled skill teaches an agent to go from "make a launch video for X" to a brief, keyframes and finished MP4s.

[中文说明](#中文说明)

## Quick start

```bash
motion-use init my-video --style promo        # or --style explainer
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
- **Vertical safe areas.** 9:16 keeps text clear of the like/share column and the caption block.
- **Reproducible and local.** Same brief, same video: bit for bit, except that frames of a recorded clip can differ by invisible noise. Animations are CSS that [HyperFrames](https://github.com/heygen-com/hyperframes) seeks frame by frame; fonts ship with motion-use and are cut to the characters each video uses; music is synthesized to the video's length. Rendering loads nothing from the network and runs the engine with telemetry off (`HYPERFRAMES_NO_TELEMETRY`, `DO_NOT_TRACK`). The CLI checks GitHub for a newer release at most once a day; `MOTION_USE_NO_UPDATE_CHECK=1` turns that off.
- **Safe with untrusted text.** Brief text is always drawn as text, never HTML. motion-use never overwrites output files it did not write (`--force` to override).

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
| `init [dir]` | Starter brief: `--style`, `--name`, `--lang zh,en`, `--format landscape,vertical` |
| `validate [brief]` | Check the brief, files, voiceover lengths and glyph coverage; print timelines |
| `voiceover [brief]` | Speak each scene's `narration`: `--engine azure` (licensed) or `edge` (preview) |
| `still [brief]` | Keyframes and a contact sheet; `--at 1.5,4` for exact seconds |
| `render [brief]` | MP4 per language × format, plus a cover PNG; `--quality draft\|standard\|high`, `--target github` / `--max-size 9MB` |
| `doctor` | Check Node, FFmpeg, Chrome, the engine and fonts |
| `upgrade` | Update the CLI and its skill; `--check` only looks |

All commands take `--json`. `still` and `render` take `--lang`, `--format` and `--out`.

## Licenses

motion-use is MIT. The engine, HyperFrames, is Apache-2.0. Fonts are SIL OFL; sound effects are CC0 or original; one dependency of the engine (`@img/sharp-libvips`) is LGPL-3.0. Every file and dependency is listed in [ASSETS.md](ASSETS.md). How motion-use compares with HyperFrames, Remotion and others: [docs/alternatives.md](docs/alternatives.md).

## 中文说明

https://github.com/user-attachments/assets/b3f0b448-d5b6-4053-834e-89bc9515f37f

*这条视频由 motion-use 根据 [examples/motion-use/brief.json](examples/motion-use/brief.json) 生成。*

motion-use 用一份 JSON brief 生成推广片和讲解片：中英双语、横竖两种画幅，场景时长会跟着你自己录的旁白调整，在本地渲染成 MP4。同一份 brief 每次渲染出的视频都一样。

```bash
curl -fsSL https://raw.githubusercontent.com/leeguooooo/motion-use/main/install.sh | sh
motion-use init my-video --style explainer
motion-use still my-video/brief.json
motion-use render my-video/brief.json
```

- 两种风格：`promo`（深色、带光效、每个节拍有音效）和 `explainer`（浅色、节奏平稳，步骤依次高亮，流程图的箭头逐条画出）。
- 旁白：把录音放进 `voiceover/<语言>/<场景 id>.mp3`，场景会自动拉长，旁白之间不会重叠。没有旁白也能出片。
- 图片：`image` 场景接受本地图片，可以是截图，也可以用 image-use 生成。
- 竖版会给抖音、视频号、Reels 右侧的按钮列和底部的文案区留出空间。
- 渲染过程不从网络加载任何资源，渲染引擎的统计数据上报已关闭。CLI 每天最多访问一次 GitHub 检查新版本，设置 `MOTION_USE_NO_UPDATE_CHECK=1` 可以关闭。

需要 Node.js 22 以上、FFmpeg 和 Chrome；`motion-use doctor` 会逐项检查。许可证：本项目 MIT，渲染引擎 HyperFrames 为 Apache-2.0，所有素材和依赖的许可证见 [ASSETS.md](ASSETS.md)。

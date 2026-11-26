# Cast the narrator before generating the film

“Configured” and “good for this film” are separate decisions. Being configured is not
a quality ranking, but a service the user has paid for and configured must be used
rather than silently replaced by the edge-tts preview voice.

## Services motion-use finds on this machine

`motion-use voiceover providers` (also part of `doctor`) lists every configured service
and verifies each key with a request that costs nothing:

| engine | key (env → macOS keychain service → user config) | extra | key check |
|---|---|---|---|
| `azure` | `AZURE_SPEECH_KEY` → `motion-use-azure`, `azure-speech` | region: `AZURE_SPEECH_REGION` → `motion-use-azure-region` | `issueToken` |
| `elevenlabs` | `ELEVENLABS_API_KEY`, `ELEVEN_API_KEY`, `XI_API_KEY` → `motion-use-elevenlabs`, `elevenlabs`, `ElevenLabs` | none | `GET /v1/user/subscription` |
| `minimax` | `MINIMAX_API_KEY` → `motion-use-minimax`, `minimax`, `MiniMax` | `MINIMAX_GROUP_ID`, `MINIMAX_API_HOST` (default `https://api.minimax.io`; mainland `https://api.minimaxi.com`) | `POST /v1/get_voice` |
| `openai` | `OPENAI_API_KEY` → `motion-use-openai`, `openai`, `OpenAI` | none | `GET /v1/models` |

Store a key in the keychain with `security add-generic-password -s motion-use-elevenlabs -a motion-use -w`
(prompts for the secret). The user config file is `~/.config/motion-use/config.json`
(`$XDG_CONFIG_HOME`, or `$MOTION_USE_CONFIG`); a machine without a keychain may keep keys
under `voiceover.credentials.<engine>.key` there (chmod 600). Keys never go into
film.json, briefs, manifests or reports; only their source is printed. A 401/403 is
reported as `key invalid`: doctor marks it `BAD`, and `voiceover` stops at the first
line instead of failing every scene.

Voice profiles (user level, chosen once per machine). A profile records provider,
model, per-language voices, rate, performance instructions and where the key is read
from (`--key-env NAME` or `--key-keychain SERVICE`; never the key itself):

```sh
motion-use voiceover audition plan.json --out auditions/narrator   # listen, pick
motion-use voice save auditions/narrator a --name julia             # becomes the default
motion-use voice set julia --provider elevenlabs --voice <id> --model eleven_v4 --rate +12%
motion-use voice list | voice show [name] | voice use <name> | voice remove <name>
```

`init` writes `"voiceover": {"dir": "voiceover", "profile": "<default>"}` into
film.json (`--voice-profile <name>|none`). A voiceover block that names no engine,
voices or command also takes the default profile; `"profile": false` opts out. Fields
the project sets (engine, voices, rate, model, instructions, stability, similarity) win over the profile.
The voiceover manifest records the resolved engine, voice, rate and model, and a
render snapshot records the settings the profile resolved to and pins them on
restore, so editing a profile never silently changes a delivered film's voice: its
clips become stale and must be regenerated on purpose. `doctor` shows the default
profile and verifies its key. `motion-use voiceover use <engine> --voice <id>` still
works: it edits the default profile (an older `voiceover` selection in config.json is
read as a profile named `default`).

Engine choice when film.json names none and no profile is set: the only configured
service, else (several configured, none chosen) voiceover stops and lists them so the
agent asks the user. edge-tts is used only when nothing is configured, and every such
output says “预览声音，不能交付”.

Built-in bridge mapping: `voices.<lang>` is the provider voice ID; `model` defaults
to `eleven_multilingual_v2` / `speech-02-hd` / `gpt-4o-mini-tts`; `rate` becomes
the provider's speed (ElevenLabs 0.7–1.2, MiniMax 0.5–2, OpenAI 0.25–4, clamped),
except on ElevenLabs `eleven_v4`, `eleven_v4_turbo` and `eleven_v3` (see below);
`instructions` is accepted only by `openai` (and command bridges); the others reject
it rather than ignore the direction. MiniMax/OpenAI have default voices
(`male-qn-qingse`, `coral`); ElevenLabs needs an explicit voice ID.
### ElevenLabs eleven_v4 / eleven_v4_turbo / eleven_v3

These models take only Stability and Similarity; Style and Speed do nothing, and there
is no SSML. motion-use sends neither `speed` nor `style` to them, and a `rate` other
than `+0%` gives a warning: the speed has to be changed afterwards. The request carries
`language_code` (`zh` for `zh-CN`). Expression comes from audio tags in the text.

- `"stability": 0.5`, `"similarity": 0.8` (0–1) in a voice profile (`voice set …
  --stability 0.5 --similarity 0.8`) or in film.json/brief `voiceover`, passed on as
  `stability` / `similarity_boost`. Lower stability: more ups and downs, follows tags
  more closely. Also sent to other ElevenLabs models.
- `"delivery": "[curious]"` on a shot or scene, or on `voiceover` for every line: audio
  tags in square brackets put in front of the spoken text. They are not part of
  `narration`, so they never reach captions. Only these three models get them; on any
  other model they are dropped with a warning.
- `"take": "one"` on `voiceover`: each language is spoken as one request (lines
  separated by a blank line, `voiceover.delivery` once at the start, each line's own
  `delivery` in front of it) to `/with-timestamps`, then cut into the usual per-shot
  clips by character timing. A clip ends 0.15 s after its last letter or digit and never
  after the next line's first one starts; it starts 0.1 s before its first and never
  before the previous line's last one ends. Punctuation is ignored because ElevenLabs
  stretches a punctuation mark's end up to the next line's first word. Changing one line
  records the whole take again. Recommended for eleven_v4 narration: one request per line
  with a different tag each sounds like a different reading every time; one take with
  one opening tag (`[calm, conversational]`, stability 0.5) stays one voice. Default
  `"line"`: one request per line, as before.
- `"maxPause": 0.3` on `voiceover` (any engine, 0.1–2 s): pauses inside a clip longer
  than this are shortened to it (ffmpeg `silencedetect` at -42 dB, cut in the middle of
  the pause); silence at the start and end of a clip stays. Edge's sentence timing is
  dropped then; it cannot be combined with `--word-timing`.

Do not let available credentials or the starter's Chinese/English voice determine
the final narrator. Keep an explicit user-selected voice unless asked to change it.

## Describe the performance

Record the audience, language/accent, age/timbre impression, delivery and emotional
arc in SOURCES.md. Describe what a listener should hear: a colleague explaining a
bug with short confident phrases; a restrained documentary voice; a bright launch
read with room for the reveal. “Use the best AI” alone is not a casting brief.

Choose candidates by the actual language, pronunciation, controllable pauses and
emotion, consistency across sections, latency/cost and permitted use. Check current
official provider documentation and actual account access rather than maintaining
a permanent model leaderboard. MiniMax, ElevenLabs, Azure, other TTS providers,
local models and a supplied recording can all be candidates; a listed name does
not imply a built-in motion-use integration. Use chrome-use's listed read-only
search adapters to find official model/voice pages, then inspect those pages.
No subscription, clone or paid generation is implied by catalogue discovery.
For example, inspect the current [MiniMax model catalogue](https://platform.minimax.io/docs/guides/models-intro)
before choosing a model ID; this is discovery evidence, not an audio-quality verdict.

## Try the same words

Use a short representative passage containing the opening, a technical/proper name,
a transition and an ending. Compare the promising model/voice combinations on the
same text and comparable loudness. Start with a small useful set, usually 2–3;
do not generate the whole film for every voice. Test a selected candidate on a
second, different passage before committing if long-form consistency is in doubt.

`voiceover audition` creates isolated samples and an offline listening page:

```bash
motion-use voiceover audition voice-plan.json --out auditions/round-1 --allow-code --json
```

Example plan (replace the model/voice with real choices verified for the provider):

```json
{
  "version": 1,
  "lang": "zh",
  "text": "两个项目，还得我来回传话？客户端拿不到用户编号，就直接问服务端：字段叫什么？收到回复，改好，再跑一遍登录。",
  "candidates": [
    {
      "id": "preview",
      "label": "Existing preview baseline",
      "voiceover": {"engine":"edge", "voices":{"zh":"zh-CN-YunxiNeural"}}
    },
    {
      "id": "selected-provider",
      "label": "Candidate from the casting brief",
      "voiceover": {
        "engine":"command",
        "command":["node", "scripts/provider-tts.mjs"],
        "model":"provider-model-id",
        "voices":{"zh":"provider-voice-id"},
        "instructions":"像同事解释问题，短句，停顿自然；不要播音腔，结尾收住。"
      }
    }
  ]
}
```

`azure`, `elevenlabs`, `minimax` and `openai` candidates (e.g. `{"engine":"elevenlabs","voices":{"zh":"<voice id>"}}`)
need no bridge script. The `command` candidate is a plan, not a bundled adapter. The bridge script must exist and
implement the contract below before running the command candidate. Different
voices from one provider can be compared too. Use explicit engines in audition
plans; credentials do not silently choose the candidate. Existing output folders
are refused. Failures remain in audition.json alongside successful samples, with
no fallback to another voice and no automatic winner. Production audio stays intact.

Listen without music first for accent, name pronunciation, phrasing, breath/pauses,
the shape of the ending and whether the delivery sounds like someone addressing
this audience. Then listen against actual picture and BGM for intelligibility,
energy and fatigue. A clear announcer can still be wrong for an office conversation.
Record listener, file/hash, passage, date, selected candidate and rejection reasons
in SOURCES.md. When playback cannot actually be heard, keep listening UNREVIEWED
and present the audio page for review; neither ASR nor waveform analysis can select
the most natural or appropriate voice.

## Use another TTS model through a trusted bridge

`engine:"command"` runs an argv array without a shell, in the project directory.
It requires `--allow-code`, just like authored drawing code. Read credentials from
the bridge's environment; do not put secrets in film.json, argv, stdout or cached
requests. No provider libraries or keys are bundled into motion-use.

The bridge receives one JSON object on stdin:

```json
{"schemaVersion":1,"text":"Words to speak","lang":"zh","voice":"provider-voice-id","model":"provider-model-id","instructions":"Performance direction","rate":"+0%","output":"/absolute/path/sample.partial.mp3"}
```

Translate these settings into the chosen provider's supported controls, write a
real MP3 to `output`, and exit zero only after it is complete. Prefer an appropriate
high-quality output setting; do not turn low-quality source audio into a high
bitrate file and call it better. If that model cannot honor requested style/rate,
report it or choose another candidate rather than silently ignoring the direction.
The CLI checks playable audio before replacing an older generated clip. Use the
existing imported WAV/audio-track path when a lossless deliverable is needed.

The bridge has a 120-second bound and no automatic retry, including 429 errors;
unknown/paid delivery must be checked at the provider before resubmitting. Detailed
provider logs are not echoed into reports. A bridge may use an installed provider
CLI/SDK or HTTP API; use its current official documentation and record tested
capabilities, not an imagined universal text-to-speech interface.

After selection, copy the chosen `voiceover` settings into film.json, set its
production `dir`, and run normal `voiceover`/`render --allow-code`. Model, voice,
instructions, rate and the bridge command/file fingerprint participate in cache
freshness. Changing them regenerates tracked audio; untracked user recordings
remain protected. Bridge files named in argv inside the project are included in
render snapshots; declare additional bridge inputs under `files` when needed.
The remote service's model deployment is external, so retain the accepted audio.

Generate only the selected performance for the full script. Check ASR, then
`retime`, then lock visual/music accents. ASR is a reading check, not acting approval.
Keep the selected settings explicit for the final cut; the edge fallback is a
preview path, not an accepted casting.

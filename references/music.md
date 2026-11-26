# Choosing and writing the film's music

Choose music for this film: a licensed existing track or an authored score. For
search, candidate comparison, licence records and auditioning with narration, read
[asset-sourcing.md](asset-sourcing.md). Do not choose a score merely because init
created one. Imported tracks use `music.file`; `motion-use beats <audio>` estimates
the grid and source offset, and the final mix still needs listening review.

## Which route: decided by where the film is heard

| `brief.setting` | Default route | Why |
|---|---|---|
| `meeting-explainer`, `course`, `tech-review` | **licensed recorded track** | narration runs end to end and the music is a low bed for minutes; a synthesized pad that long is thin, dull and tiring. `init --setting` writes `"music": "none"`, and validation and `--release` report `[high] explainer-synth-music` / `explainer-no-music` until a licensed track is chosen or `music.why` says why synthesized music is right |
| `feed-short`, `launch` | score or licensed track | short and cut to picture: an authored score can hit picture events |

The licensed-track workflow:

```bash
motion-use music plan .                    # styles + search queries for the setting, licence checks (remembered style first)
# search and download 3–5 candidates (no vocals, sparse drums; one long enough to cover the film avoids a loop)
motion-use music add ~/Downloads/track.mp3 --url <detail-page> --author <creator> --license "<licence>" .
motion-use music audition . assets/music/a.mp3 assets/music/b.mp3 --out review/music-1   # ~40 s of the film's own narration over each
motion-use music choose review/music-1 a . --remember   # only after someone listened; writes music.file into film.json
motion-use music prefer --style "cafe jazz"            # remembered in ~/.config/motion-use/config.json
```

`music add` refuses a track without a detail URL, creator and licence; it copies the
file into `assets/music/`, records its SHA-256 in `assets/music/sources.json` and a
row in SOURCES.md. `music choose` refuses a track without that record.

### How an imported track is mixed

- Under narration it drops **-20 dB** (an authored score keeps -12 dB); `music.duck` (dB, -40–0) overrides.
- It ducks by sentence: down for each narration clip from its first word to its last, starting 0.5 s before the clip (attack) and coming back over 0.9 s after it (release). Pauses inside a sentence never let it back up, and gaps between clips shorter than 0.8 s or than attack + release stay down. A level-following sidechain rises in every TTS comma pause and sounds as if the voice cut out (#130).
- To tune it, give `music.duck` as an object (every key optional):

  ```json
  "music": {"file": "assets/music/cafe.mp3", "duck": {"duckTo": -20, "attack": 0.5, "release": 0.9}}
  ```

  `mode: "signal"` follows the narration level instead (a sidechain baked into the same envelope: 0.05 s attack, 0.6 s release, pauses quieter than `threshold` -35 dBFS let the music up). Use it only when the music should breathe between words. `hold` (s) is the gap below which two windows join.
- `music audition` ducks with the film's `music.volume` and `music.duck`; `--duck-mode`, `--duck-to=-24` (a negative value needs the `=`), `--duck-attack`, `--duck-release` try other settings, and `music choose` writes the ducking that was heard into film.json.
- 1.5 s fade in, 2.5 s fade out.
- A song shorter than the film repeats from `music.from` on a 4-bar phrase (`music.bpm`, else 8-second blocks) with a 2 s crossfade; `"loop": false` turns this off. Listen to the join.

For authored music, `composition/score.js` decides the instruments, mode, where
the music is sparse, where it peaks and which picture events it hits. A built-in
mood is the same bed in every film of that mood: validation warns about it, and
`--release` refuses it unless `music.why` records why a generic bed is right.

```json
"music": {"score": "composition/score.js", "volume": 0.6}
```

```bash
motion-use instruments                       # what can play (recorded pack + synthesized voices)
motion-use instruments install               # the recorded CC0 pack, once per machine
motion-use music . --allow-code              # render only the music: why, key, tempo, notes per shot, warnings
```

## Direct it before writing notes

Answer these in `S.why(...)` (one or two sentences; it is checked and kept with every render):

1. **Where and when is the subject from?** A Western Han funeral banner, a 1990s arcade, a fintech dashboard, a mountain village. Pick instruments and a mode that belong there: zither, bells and gong in a five-tone mode for ancient China; glock and pizzicato for a light product reveal; pad, bass and a dry kit for a tech launch; cellos and timpani for weight.
2. **What does the music do to the story?** Quiet under the problem, building as the idea spreads, one peak on the shot that carries the takeaway, a resolution that lands on the last action. Write it as `S.arc([[shot, level], …])`.
3. **Which picture events get a sound?** A stamp, a door opening, a bird hopping, a line finishing. Each accent is a note at the event's second (`S.at(shot, offset)`), not a generic thump.
4. **Where is someone speaking?** Keep melody out of `S.voice` windows (`S.speaking(t)`); pads, drones, bass and soft percussion sit under a voice. The mix already lowers music under narration; busy lines still fight it, and the check warns.

Two films should not share a palette of instruments, mode and tempo: each `--release` is recorded in `~/.local/share/motion-use/music-index.json`, and a release that matches an earlier film's instruments, key and tempo is reported.

## The score

```js
window.scoreFilm = function (film, S) {
  S.why("Han-dynasty banner: zither and bronze bells in D shang, slow; sparse in the underworld, rising through the gate, full when the gold line reaches heaven.");
  S.tempo(66);
  const sc = S.scale("D", "shang", 3);                      // 宫商角徵羽: gong shang jue zhi yu
  S.track("zither", { gain: 0.9, pan: -0.2, reverb: 0.4 });
  S.arc([["hook", 0.5], ["under", 0.4], ["heaven", 0.8], ["map", 1]]);
  const call = S.motif([0, 1, 2, 4, 2], [1, 0.5, 0.5, 1.5, 1]);
  S.phrase("zither", S.at("hook", 0.3), call, sc, { oct: 1 });
  S.phrase("zither", S.at("heaven", 0.2), call.transpose(2), sc, { oct: 1 });
  for (const t of S.grid(S.at("under"), S.end("under"), 2)) S.note("frame-drum", t, "low", { vel: 0.5 });
  S.note("tubular-bells", S.at("map", 3.7), sc(0, 2), { vel: 1 });   // the line reaches heaven
};
```

`film` is `{name, duration, shots: [{id, start, end, purpose, action, camera}], voice, copy, brief, look}` with the final (retimed) shot windows. Write the score after `retime`.

| helper | does |
|---|---|
| `why(text)` | required: what this music is and why it fits this film |
| `tempo(bpm)`, `meter(n)`, `beats(n)`, `bars(n)` | timing; `beats`/`bars` return seconds |
| `has(id)`, `shot(id)`, `at(id, offset)`, `end(id, offset)`, `shots`, `duration` | `has` checks optional shots; missing `shot/at/end` still throws. Offsets scale by actual / `authoredDuration` when declared |
| `rhythmEvent(id)`, `rhythmPhase(id)` | absolute declared event time and phase from film.json.rhythm; same anchors as the drawing kit, unknown IDs throw |
| `voice`, `speaking(t)` | narration windows |
| `scale(root, mode, octave)` | a function `deg → midi`; degrees wrap octaves (`sc(-1)` is below the tonic). Modes: `major minor dorian phrygian lydian mixolydian harmonic-minor gong shang jue zhi yu hirajoshi in blues whole-tone chromatic`, or an array of semitones |
| `chordOf(scale, deg, size, oct)` | stacked thirds within the scale |
| `motif(degrees, beats)` → `.transpose(n) .invert() .retro() .augment(k) .then(m)` | a figure and its variations; `null` is a rest |
| `phrase(instrument, t, motif, scale, {oct, vel, legato, transpose, humanize})` | play a motif; returns the end time |
| `note(instrument, t, pitch, {dur, vel, pan, ring, raw})` | one note; pitch is a midi number, `"D4"`, or a hit name (`"low"`) for unpitched instruments |
| `chord(instrument, t, pitches, {strum, …})` | several notes, optionally strummed |
| `grid(from, to, stepBeats, offsetBeats)` | times on the beat grid |
| `arc([[shot or second, level], …])`, `level(t)` | dynamics over the film; velocities follow it unless `raw` |
| `track(instrument, {gain, pan, reverb})`, `room({size, damp, wet})` | mix and space |
| `rng()`, `pick(list)`, `humanize(t, amount)` | randomness seeded by the film name; the score has no clock |

The score runs at build time in its own context: the same film always gives the same music. Rendered music is cached by the score, the shot windows, the narration windows and the instrument pack, so picture iterations do not re-render it.

## Instruments

The recorded pack (`motion-use instruments install`, CC0, from VCSL and VSCO 2 CE; sources in ASSETS.md) has plucked strings (`zither` — a Dan Tranh, close to a guzheng — `harp`), keys (`piano`), mallets (`glock`, `vibraphone`, `marimba`), bells and metal (`tubular-bells`, `hand-bells`, `gong`), drums and wood (`frame-drum`, `timpani`, `woodblock`), strings (`violins`, `cellos`, their `-pizz` forms, `contrabass-pizz`) and winds and brass (`flute`, `oboe`, `recorder`, `horn`). `motion-use instruments` prints the installed list with ranges, hits and the longest sustain.

Sustained instruments play recorded notes without loops: a note longer than the instrument's `maxDur` is shortened (`report.clamped`). Hold longer chords with `pad` or `drone`, or re-strike.

Synthesized voices are always available: `pad`, `drone`, `bass`, `string-pluck`, `synth-pluck`, `square`, `bell`, `kick`, `hat`, `riser`. They suit electronic and abstract films; for anything with a time and place, use recorded instruments.

## Check

`motion-use music . --allow-code` prints the notes per shot and the score warnings: notes outside an instrument's range and unknown instruments fail; a busy line under narration, notes after the end and an unchanged starter score are warnings. A render writes `assets/audio/score.json` (why, key, tempo, instruments) into its build.

The checks measure the score, not whether it sounds good. Listen to it against the picture before delivering, and ask the person who will publish it to listen too.

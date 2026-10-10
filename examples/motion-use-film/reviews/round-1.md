# Round 1 — independent MP4 review

| Cut | Verdict | Reason |
| --- | --- | --- |
| zh | **Don't ship** | Sample-film text visibly collides; safe-area wording is ambiguous. |
| en | **Don't ship** | Same text collisions; narration-check evidence needs English explanation. |

## Blocking issues

1. **Both, 00:10.25 and 00:47.25:** the outgoing white “Any app…” / Chinese equivalent and incoming green “278 characters…” / Chinese equivalent occupy the same line in the embedded iPhone film. The result is visibly unreadable, including in the large “One source” demonstration. This undermines the later text-check claim. Finish the outgoing text's exit before introducing the new line, or move them to separate positions. Evidence: [zh close-up](full/zh-10.25.png), [en close-up](full/en-10.25.png), [repeat](full/en-47.25.png).

2. **zh, 00:31.5–00:36.5:** the subtitle says the tool marks areas covered by platform buttons, then says subtitles and key content go “里面”. The nearest referent is the covered region, while the image intends the opposite. Say explicitly that text stays in the unobstructed safe area. Evidence: [00:33](full/zh-33.png).

3. **en, 00:40–00:46:** the main script-versus-heard examples remain Chinese. English labels alone do not explain the second error (“重试” versus “重视”), so an English-only muted viewer cannot assess the demonstrated correction. Add short English glosses with the differing words highlighted, or use an English narration-error example. Retaining Chinese as source evidence is fine. Evidence: [00:41.5](full/en-41.5.png).

## Non-blocking notes

- **00:00–00:03, both:** the point is clear immediately: a coding agent directs, writes film as code, renders locally, and checks the result. Burned-in subtitles carry the message when muted.
- **00:07.5–00:16, both:** `drawFrame` and `frame = f(time)` explain the mechanism. “This 55-second film” / “这支 55 秒的片子” refers ambiguously to the inset sample; these supplied promos are 60 seconds. Say “this 55-second example”. The 26 KB / 10.2 MB figures are readable once settled; their factual accuracy is unverified.
- **Throughout:** beige paper texture, black framing, orange rules, felt objects, whiteboard, kinetic type, and charts form a distinct visual vocabulary. This does not look like a generic gradient promo.
- **Throughout:** main titles and subtitles stay inside the outer frame in inspected samples. The orange dashed rule passes directly behind subtitle letters; lower it or use an opaque subtitle background. Tiny inset subtitles and terminal text will be hard to read at README size.
- **00:04.5–00:06.5 and 00:15.5–00:16:** moving panels crop their contents during transitions. They settle again; this reads as intentional camera movement, though it interrupts reading. No fully empty frame was observed in the half-second samples. The end-card hold is useful; the mostly settled safe-area/error panels could be shorter.
- **00:20–00:22:** “No templates” is broader than the accompanying “warns when it copies an example”. Prefer wording about directing a fresh look rather than an unconditional promise.
- **00:23–00:31 and 00:40–00:46:** stylized terminal panels illustrate verification plausibly, but animation cannot establish that these are actual command outputs. Label them as example output if reconstructed. “Caught at render time” would be clearer as “checked after rendering”, consistent with the earlier decoded-MP4 description.
- **00:37–00:42:** the intentionally clipped label is clearly identified as a previous failure, then repaired. It is not an accidental clipping defect in the current outer composition.
- **00:46.5–00:53.5:** both cuts communicate zh/en, landscape/vertical, and platform masters consistently. Chinese examples in the English opening/style reel are acceptable as multilingual portfolio work; the error explanation above needs localization.
- **00:56.5–00:60:** both endings provide the complete, unclipped `curl -fsSL https://raw.githubusercontent.com/leeguooooo/motion-use/main/install.sh | sh` install path and repository address. The command is small at README width; keep a copyable command beside the embed. Open-source wording is present.

## Audio measurements and limits

| Delivered audio | Integrated loudness | Loudness range | True peak |
| --- | --- | --- | --- |
| zh | −14.3 LUFS | 4.6 LU | −0.9 dBFS |
| en | −14.0 LUFS | 4.1 LU | −1.0 dBFS |

Measured with FFmpeg `ebur128=peak=true`; peaks remain below digital full scale. These measurements do not establish listening quality.

Reviewed only the supplied MP4s: both 1920×1080, 60 fps, 60 seconds. Extracted and visually inspected 120 frames per cut at `fps=2`, plus exact full-resolution frames for small text and collisions. Evidence is in `zh/`, `en/`, `sheets/`, and `full/`; extracted audio and measurement logs are under each language directory. Contact-sheet time labels denote the nominal half-second sampling grid; exact timestamps above use separately sought frames.

**Could not verify:** subjective voice/music quality, pronunciation, spoken wording, audio/subtitle synchronization, or a narration transcription match; audio was extracted and measured but not listened to or transcribed. Subtitle changes visually fit the scene topics, but that is not a sync check. Half-second inspection cannot exclude single-frame pops or brief blanks. MP4s alone cannot authenticate terminal/UI provenance, actual tool capabilities, source sizes, license, installer behavior, platform-specific safe margins, or the existence/quality of separate vertical cuts and masters. No source code or external product evidence was used, and nothing outside this directory was edited.

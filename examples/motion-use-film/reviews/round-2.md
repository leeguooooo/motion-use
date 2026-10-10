# Round 2 — independent MP4 review

| Cut | Verdict | Basis |
| --- | --- | --- |
| zh | **Ship** | Round-1 collisions and safe-area wording resolved; no new blocking visual defect found. |
| en | **Ship** | Round-1 collisions resolved; English ASR glosses now explain the errors. |

## Round-1 blockers

| Blocker | Status | Current MP4 evidence |
| --- | --- | --- |
| Both: inset text collisions at 10.25 s and 47.25 s | **Fixed in these cuts.** The revised inset shows “The screen as text” / “屏幕读成文字”, then “Tap by name” / “按名字点”; the former competing white/green lines are absent at the flagged points and in surrounding half-second samples. | [zh 10.25](full/zh-10.25.png), [en 10.25](full/en-10.25.png), [zh 47.25](full/zh-47.25.png), [en 47.25](full/en-47.25.png). A faint incoming English title during the bilingual transition is spatially separate, not an unreadable collision. |
| zh: ambiguous safe-area subtitle, 31–37 s | **Fixed.** It explicitly says “竖版会标出平台按钮挡住的区域，字和重点都避开它。” The red-region legend agrees. | [zh 33](full/zh-33.png); wording holds through the scene. |
| en: Chinese ASR evidence unexplained, 40–46 s | **Fixed.** English glosses explain “AI” read as A-A-I and “重试 (retry) read as 重视 (value)”. Both are visible together once the terminal finishes typing, around 42.5–46 s. | [en 41.5](full/en-41.5.png), [en 44](full/en-44.png). The Chinese fix line is still untranslated, but the error itself is understandable without Chinese. |

## New blockers

**None found.** Main burned-in subtitles remain readable and within the outer frame. The deliberately clipped “before” label at 37–42 s is identified as a defect and visibly repaired; it is not an accidental current-layout failure. The two cuts convey consistent product, rendering, safe-area, multilingual-output and installation messages.

## Non-blocking notes

- **Around 5.0 s, both:** the inset iPhone panel briefly goes black during its internal move, then repopulates. Other montage panels and the main subtitle remain visible. This round-1 empty-print concern persists; it is a polish issue, not a whole-frame blank. [Exact en 5](full/en-5.png), [dense zh sequence](sheets/zh-dense.jpg), [dense en sequence](sheets/en-dense.jpg).
- **4.5–6.5 s and 12–16 s:** camera moves crop panel contents; they settle again. The orange rule still passes behind the lower edge of subtitles in places ([zh 15.75](full/zh-15.75.png)); readability survives, but a stationary subtitle layer would be cleaner.
- **9.5–16 s:** “55-second example” / “55 秒的示例” now distinguishes the sample from these 60-second promos. “No templates” is replaced by “A new look every film” / “每部片重新设计”.
- **40–46 s:** English glosses and inset terminal details are small at README width. **46.5–53.5 s:** bilingual portfolio imagery is clear, though inset copy remains tiny. Main subtitles carry the muted-viewing message.
- **42–46 s:** “Caught at render time” still suggests detection during rendering, whereas 23–31 s describes decoding and checking the completed MP4. Prefer “checked after rendering”. Panels now claim “real output”; the MP4 cannot authenticate that claim.
- **56.5–60 s:** complete install command and repository URL fit ([en 56.75](full/en-56.75.png)); put a copyable command beside the README embed.

## Scope and limits

Read round 1; judged only the supplied MP4s, both 1920×1080, 60 fps, 60 s. Extracted and inspected 120 frames per cut with FFmpeg `fps=2,scale=1280:-1`, plus targeted full-resolution inspection (19 frames extracted per cut) and a 10 fps sequence around 4.25–6.75 s. Contact-sheet labels are nominal sampling-grid times; linked full-resolution frames were separately sought at the named timestamps.

A low-resolution all-frame scan decoded 3,600 frames per cut: no near-black whole frame (mean gray <5/255) or near-uniform whole frame (gray standard deviation <2/255). Largest adjacent changes cluster at scene transitions; this metric does not certify freedom from frame pops or black inset panels. Logs: [zh](zh/scan.json), [en](en/scan.json).

**Could not verify:** audio quality, spoken wording, pronunciation or audio/subtitle synchronization; every single-frame visual detail; terminal provenance, actual capabilities, source-size figures, license/installer behavior, platform-specific safe margins, or separate vertical/master quality. No source or external product evidence used. Nothing outside this directory edited.

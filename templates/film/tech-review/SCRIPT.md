# Script review: technical design walkthrough

State: draft. Review this text before writing drawing code, speech or music.
Setting: tech-review (a colleague walking a design review through the design document).
Read references/narration-writing.md (section "Technical design walkthrough") before writing.

Source document: TODO (path or link; also list it under brief.sources so the fact review can read it)
Audience: TODO (e.g. the developers, product, QA and operations people in the review)
Status facts, verified (deployed where, which branch, what is not merged yet): TODO

Rules for this setting:
- Chapters follow the design document's own sections, in its order. The length follows the content; there is no target duration.
- Each chapter opens by naming itself (「第二部分，整体架构。」) and then says the content. No hook, no
  question to the audience, no outline preview, no 「这里有个细节要注意」, no 「N 件事」 inside a chapter.
- At most two items listed in one sentence; longer lists go on screen.
- Progress and status: only what is verified (源文档 / brief.facts). Unverified status is marked for the author.
- Picture: the document's own diagrams are the base. Animation adds what a still diagram cannot show
  (a message travelling, a timeout counting down, a retry, a box that is not used).

## Chapters

{{CHAPTERS}}

Delete chapters the document does not have; add rows when one chapter needs several shots
(same Ch number, only the first row opens the chapter).

## Workflow

1. Export the document's diagrams (SVG preferred; a Feishu/Lark whiteboard exports SVG) into assets/,
   then `motion-use diagram boxes assets/<name>.svg --into film.json --name <name>`.
2. Fill the table above chapter by chapter: what is said, which diagram, what the animation adds.
3. Self-review; `motion-use script review film.json --focus facts` (brief.sources attaches the document);
   `--focus tone` for the colleague's voice; `motion-use script lint film.json`.
4. Voiceover → retime → check stills per chapter → render.

Review in reviews/01-script.md: pass or revise, exact lines to change, reason.

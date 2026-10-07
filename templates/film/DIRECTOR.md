# Direct the film

This is an editable motion study. Replace the drawing and shot plan for the subject; changing only the text makes another template video.

Before coding, write:

- The viewer's one takeaway, backed by the product/source.
- The visual subject that carries it: a real action, object, recording, illustration or diagram.
- A beat map: time, what changes, where the eye moves, sound, and how the next shot inherits an object or motion.
- The reference and what you are borrowing (timing, framing, typography), with attribution.
- The four decisive frames: opening, action, consequence, resolution.

The default is an 18-second continuous signal study. There is no required shot count, palette or template. The code is `composition/draw.js`; `film.json` contains copy, output formats, authored shot windows and audio placement.

## Review

- Does something meaningful change while narration plays?
- Is motion explaining the idea, or decorating a slide?
- Do objects carry between shots? Does the viewer know where to look?
- Are short holds deliberate, and text readable at phone size?
- Is the first second already interesting? Does the last beat pay off the opening?
- Have source facts and footage provenance been checked?

Run `motion-use still . --allow-code`, examine the frames, then render. Inspect the delivered MP4 and the `out/review/` report. Technical pass is not visual approval. Keep feedback and remaining issues here so another session can continue.

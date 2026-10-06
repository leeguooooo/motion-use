// Brief text is untrusted: everything that reaches the page goes through esc().
// No brief value is ever placed inside <script>, an event handler, or a URL.

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Escaped text with "\n" turned into <br>. */
export const lines = (s) => esc(s).replace(/\r?\n/g, "<br>");

/** Seconds, rounded so generated CSS stays stable across platforms. */
export const sec = (n) => `${Math.round(n * 1000) / 1000}s`;

// Seconds subtracted from every delay generated below. A negative delay starts an
// animation part-way through, so an offset equal to a scene's animation time
// renders that scene fully composed at its first frame (used for the cover).
let OFFSET = 0;
export function withTimeOffset(offset, fn) {
  const prev = OFFSET;
  OFFSET = offset;
  try {
    return fn();
  } finally {
    OFFSET = prev;
  }
}

/**
 * Inline CSS animation; `delay` is relative to the start of the scene.
 * Entrances use fill "both" (hidden until they start). Effects that change an
 * element already on screen (dim, flash, exit) must use "forwards", or their
 * first keyframe would apply before they begin.
 */
export const anim = (name, dur, delay, ease = "cubic-bezier(.16,1,.3,1)", fill = "both") => `${name} ${sec(dur)} ${ease} ${sec(delay - OFFSET)} ${fill}`;

/** One <span> per character, each revealed at its own time: a typing effect that seeks frame-exactly. */
export function typed(text, start, cps = 28) {
  const chars = [...String(text)];
  return {
    html: chars.map((ch, i) => `<span class="mu-ch" style="animation:mu-show .001s linear ${sec(start + i / cps - OFFSET)} both">${esc(ch)}</span>`).join(""),
    end: start + chars.length / cps,
  };
}

export const attr = (s) => esc(s);

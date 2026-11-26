// Text drawn without a browser or ffmpeg's drawtext (often built without fonts): the bundled
// font shaped with HarfBuzz, its outlines filled on a coverage grid. Used by compare --video for
// the title and the two labels, so the comparison renders the same on every machine, offline.
import fs from "node:fs";
import { Blob, Buffer, Face, Font, Variation, shape } from "harfbuzzjs";
import { FONTS } from "./fonts.mjs";

const faces = new Map();
function fontFor(file, weight) {
  if (!faces.has(file)) faces.set(file, new Face(new Blob(fs.readFileSync(file)), 0));
  const face = faces.get(file),
    font = new Font(face);
  font.setVariations([new Variation("wght", weight)]);
  return { face, font };
}

// Outline commands of a string in pixels, y down, baseline at y = 0, pen starting at x = 0.
function outline(text, size, weight, file) {
  const { face, font } = fontFor(file, weight);
  const buf = new Buffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  shape(font, buf);
  const k = size / face.upem,
    polys = [];
  let pen = 0;
  for (const g of buf.getGlyphInfosAndPositions()) {
    const ox = pen + (g.xOffset ?? 0) * k,
      oy = -(g.yOffset ?? 0) * k;
    let poly = null,
      cx = 0,
      cy = 0;
    const P = (x, y) => [ox + x * k, oy - y * k];
    const push = (pt) => {
      poly.push(pt);
      [cx, cy] = pt;
    };
    for (const c of font.glyphToJson(g.codepoint)) {
      const v = c.values;
      if (c.type === "M") {
        if (poly?.length > 2) polys.push(poly);
        poly = [];
        push(P(v[0], v[1]));
      } else if (c.type === "L") push(P(v[0], v[1]));
      else if (c.type === "Q" || c.type === "C") {
        const pts = c.type === "Q" ? [[cx, cy], P(v[0], v[1]), P(v[2], v[3])] : [[cx, cy], P(v[0], v[1]), P(v[2], v[3]), P(v[4], v[5])];
        const n = Math.max(2, Math.min(24, Math.ceil(Math.hypot(pts.at(-1)[0] - cx, pts.at(-1)[1] - cy) / 2)));
        for (let i = 1; i <= n; i++) {
          const t = i / n,
            u = 1 - t;
          const w = c.type === "Q" ? [u * u, 2 * u * t, t * t] : [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
          push([w.reduce((s, wi, j) => s + wi * pts[j][0], 0), w.reduce((s, wi, j) => s + wi * pts[j][1], 0)]);
        }
      } else if (c.type === "Z" && poly?.length > 2) {
        polys.push(poly);
        poly = null;
      }
    }
    if (poly?.length > 2) polys.push(poly);
    pen += (g.xAdvance ?? 0) * k;
  }
  font.destroy?.();
  buf.destroy?.();
  return { polys, advance: pen };
}

/** Width in pixels of `text` at `size` px. */
export function textWidth(text, size, { weight = 700, file = FONTS.sans } = {}) {
  return outline(String(text), size, weight, file).advance;
}

/**
 * A text mask: { width, height, data } with one coverage byte (0–255) per pixel, nonzero winding,
 * 4×4 samples a pixel. The box is the advance width by size × 1.4, baseline at 1.1 × size.
 * Text wider than maxWidth is shrunk to fit.
 */
export function rasterText(text, size, { weight = 700, maxWidth = Infinity, file = FONTS.sans, pad = 0 } = {}) {
  let o = outline(String(text), size, weight, file);
  if (o.advance > maxWidth && o.advance > 0) {
    size = Math.max(1, (size * maxWidth) / o.advance);
    o = outline(String(text), size, weight, file);
  }
  const width = Math.max(2, Math.ceil(o.advance + 2 * pad) + (Math.ceil(o.advance + 2 * pad) % 2)),
    height = Math.max(2, Math.ceil(size * 1.4) + (Math.ceil(size * 1.4) % 2)),
    base = size * 1.1;
  const S = 4,
    acc = new Float32Array(width * height);
  const edges = [];
  for (const poly of o.polys)
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i],
        [x1, y1] = poly[(i + 1) % poly.length];
      if (y0 !== y1) edges.push([x0 + pad, y0 + base, x1 + pad, y1 + base]);
    }
  for (let row = 0; row < height * S; row++) {
    const y = (row + 0.5) / S,
      hits = [];
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) hits.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    let wind = 0;
    for (let i = 0; i < hits.length - 1; i++) {
      wind += hits[i][1];
      if (!wind) continue;
      const a = hits[i][0],
        b = hits[i + 1][0],
        line = Math.floor(row / S) * width;
      for (let sx = Math.max(0, Math.ceil(a * S - 0.5)); sx < Math.min(width * S, b * S - 0.5); sx++) acc[line + (sx >> 2)] += 1 / (S * S);
    }
  }
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.min(1, acc[i]) * 255);
  return { width, height, data, size };
}


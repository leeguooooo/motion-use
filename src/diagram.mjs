// Diagram boxes (#121): read an SVG exported from a whiteboard (Feishu/Lark 画板, draw.io,
// Excalidraw, Figma …) and list where every box sits, so animation can follow the document's own
// diagram: { width, height, boxes: { id: {x, y, w, h, label?} }, paths: { id: [[x, y], …] } }.
// Coordinates are image pixels of the SVG as the film loads it (viewBox mapped onto width/height).
//
// No XML library: a tag scanner with a transform stack is enough for exported diagrams. Shapes
// are rect, circle, ellipse, image, foreignObject, polygon and closed paths; open paths, lines and
// polylines with an id become `paths` (arrows a token can travel along). An element without an id
// takes the text label drawn inside it (「游戏服务」), so ids read like the picture.
import fs from "node:fs";

const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;
const nums = (s) => (String(s ?? "").match(NUM) ?? []).map(Number);
const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function parseTransform(s) {
  let m = I;
  for (const [, fn, args] of String(s ?? "").matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = nums(args);
    let n = I;
    if (fn === "matrix" && a.length === 6) n = a;
    else if (fn === "translate") n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === "scale") n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r), [cx = 0, cy = 0] = a.slice(1);
      n = mul(mul([1, 0, 0, 1, cx, cy], [c, sn, -sn, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === "skewX") n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === "skewY") n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, n);
  }
  return m;
}

const attrsOf = (s) => {
  const out = {};
  for (const [, k, , v1, v2] of s.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[k] = v1 ?? v2 ?? "";
  return out;
};
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");

/** Points of a path's d (absolute positions of every vertex and control point) and whether it closes. */
export function pathPoints(d) {
  const pts = [];
  let x = 0, y = 0, sx = 0, sy = 0, closed = false;
  for (const [, cmd, args] of String(d ?? "").matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
    const a = nums(args), rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === "Z") { closed = true; x = sx; y = sy; continue; }
    const step = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 }[C];
    for (let i = 0; i + step <= a.length; i += step) {
      const g = a.slice(i, i + step);
      if (C === "H") { x = rel ? x + g[0] : g[0]; pts.push([x, y]); continue; }
      if (C === "V") { y = rel ? y + g[0] : g[0]; pts.push([x, y]); continue; }
      if (C === "A") { x = rel ? x + g[5] : g[5]; y = rel ? y + g[6] : g[6]; pts.push([x, y]); continue; }
      for (let j = 0; j < g.length; j += 2) {
        const px = rel ? x + g[j] : g[j], py = rel ? y + g[j + 1] : g[j + 1];
        pts.push([px, py]);
        if (j + 2 >= g.length) { x = px; y = py; }
      }
      if (C === "M" && i === 0) { sx = x; sy = y; }
    }
  }
  return { points: pts, closed };
}

const bbox = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const round = (v) => Math.round(v * 10) / 10;
const slug = (s) => s.trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 40).toLowerCase();

/** Boxes, paths and size of one SVG document. */
export function svgBoxes(svg, { minSize = 8 } = {}) {
  const root = svg.match(/<svg\b([^>]*)>/i);
  if (!root) throw new Error("not an SVG document (no <svg> element)");
  const ra = attrsOf(root[1]);
  const vb = nums(ra.viewBox);
  const width = parseFloat(ra.width) || vb[2] || 0, height = parseFloat(ra.height) || vb[3] || 0;
  if (!(width > 0 && height > 0)) throw new Error("SVG needs width/height or a viewBox");
  // viewBox → image pixels (preserveAspectRatio xMidYMid meet, the SVG default).
  let base = I;
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    const s = Math.min(width / vb[2], height / vb[3]);
    base = [s, 0, 0, s, (width - vb[2] * s) / 2 - vb[0] * s, (height - vb[3] * s) / 2 - vb[1] * s];
  }
  const shapes = [], texts = [], lines = [];
  const stack = [{ m: base, id: null }];
  const body = svg.slice(root.index + root[0].length).replace(/<!--[\s\S]*?-->/g, "").replace(/<(defs|clipPath|mask|marker|symbol|pattern|style|script)\b[\s\S]*?<\/\1>/gi, "");
  const tagRe = /<(\/?)([\w:-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let textAt = null;
  for (const m of body.matchAll(tagRe)) {
    if (m[5] !== undefined) {
      if (textAt && m[5].trim()) textAt.text += unescape(m[5]);
      continue;
    }
    const [, close, rawName, rest, self] = m, name = rawName.toLowerCase();
    const top = stack[stack.length - 1];
    if (close) {
      if ((name === "text" && textAt && !textAt.fo) || (name === "foreignobject" && textAt?.fo)) {
        if (textAt.text.trim()) texts.push(textAt);
        textAt = null;
      }
      if (name === "g" || name === "a" || name === "svg" || name === "foreignobject") stack.pop();
      continue;
    }
    const a = attrsOf(rest), mat = mul(top.m, parseTransform(a.transform));
    const id = a.id || a["data-id"] || a["data-cell-id"] || null;
    if (name === "g" || name === "a" || name === "svg") {
      if (!self) stack.push({ m: mat, id: id ?? top.id, gid: id });
      continue;
    }
    const corners = (x, y, w, h) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map((p) => apply(mat, p));
    const add = (pts, kind) => {
      const b = bbox(pts);
      if (b.w >= minSize && b.h >= minSize) shapes.push({ ...b, id, group: top.gid ?? null, kind, order: shapes.length });
    };
    const f = (k, d = 0) => parseFloat(a[k]) || d;
    if (name === "rect" || name === "image" || name === "foreignobject") {
      if (name === "foreignobject" && !self) stack.push({ m: mat, id: id ?? top.id, gid: top.gid });
      if (name === "foreignobject") { textAt = { text: "", at: apply(mat, [f("x") + f("width") / 2, f("y") + f("height") / 2]), fo: true }; }
      add(corners(f("x"), f("y"), f("width"), f("height")), name);
    } else if (name === "circle") add(corners(f("cx") - f("r"), f("cy") - f("r"), 2 * f("r"), 2 * f("r")), name);
    else if (name === "ellipse") add(corners(f("cx") - f("rx"), f("cy") - f("ry"), 2 * f("rx"), 2 * f("ry")), name);
    else if (name === "polygon") add(chunk(nums(a.points)).map((p) => apply(mat, p)), name);
    else if (name === "polyline" || name === "line") {
      const pts = name === "line" ? [[f("x1"), f("y1")], [f("x2"), f("y2")]] : chunk(nums(a.points));
      lines.push({ id, points: pts.map((p) => apply(mat, p)) });
    } else if (name === "path") {
      const { points, closed } = pathPoints(a.d);
      if (!points.length) continue;
      const pts = points.map((p) => apply(mat, p));
      if (closed) add(pts, name);
      else lines.push({ id, points: pts });
    } else if (name === "text") {
      textAt = { text: "", at: apply(mat, [f("x"), f("y")]) };
      if (self) textAt = null;
    } else if (name === "tspan" && textAt && textAt.text && !/\s$/.test(textAt.text)) textAt.text += " ";
    if (name === "div" || name === "p") { if (textAt?.fo && textAt.text && !/\s$/.test(textAt.text)) textAt.text += " "; }
  }
  if (textAt?.text?.trim()) texts.push(textAt); // an unclosed label at the end of the file
  for (const t of texts) t.text = t.text.replace(/\s+/g, " ").trim();

  // Label each shape with the text drawn inside it (the smallest enclosing shape wins).
  const inside = (b, [x, y]) => x >= b.x - 1 && x <= b.x + b.w + 1 && y >= b.y - 1 - b.h * 0.05 && y <= b.y + b.h + 1;
  for (const t of texts.filter((t) => t.text)) {
    const host = shapes.filter((b) => inside(b, t.at)).sort((p, q) => p.w * p.h - q.w * q.h)[0];
    if (host) host.label = host.label ? `${host.label} ${t.text}` : t.text;
  }
  const boxes = {}, used = new Set();
  const unique = (k) => { let n = k, i = 2; while (used.has(n)) n = `${k}-${i++}`; used.add(n); return n; };
  // Prefer explicit ids; a group's id names its largest shape (exporters wrap shape + text in <g id>).
  const byGroup = new Map();
  for (const s of shapes) if (s.group && !s.id) { const cur = byGroup.get(s.group); if (!cur || s.w * s.h > cur.w * cur.h) byGroup.set(s.group, s); }
  const nameOf = (s) => s.id ?? (byGroup.get(s.group) === s ? s.group : null) ?? (s.label ? slug(s.label) : null);
  const W = width, H = height;
  for (const s of shapes) {
    // The full-canvas background rectangle is not a box.
    if (s.w >= W * 0.98 && s.h >= H * 0.98) continue;
    const k = nameOf(s);
    if (!k) continue;
    boxes[unique(k)] = { x: round(s.x), y: round(s.y), w: round(s.w), h: round(s.h), ...(s.label ? { label: s.label } : {}) };
  }
  const paths = {};
  for (const l of lines) if (l.id && l.points.length >= 2) paths[unique(l.id)] = l.points.map(([x, y]) => [round(x), round(y)]);
  return { width: round(width), height: round(height), boxes, paths };
}

function chunk(a) {
  const out = [];
  for (let i = 0; i + 1 < a.length; i += 2) out.push([a[i], a[i + 1]]);
  return out;
}

export function svgBoxesFile(file, options) {
  return svgBoxes(fs.readFileSync(file, "utf8"), options);
}

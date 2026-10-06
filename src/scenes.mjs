// Scene renderers: brief scene -> { html, content, cues }.
// `content` is how long the scene's own animation needs (seconds); the planner
// stretches the scene further for voiceover. `cues` are sound effects at
// scene-relative times. All timing is CSS animation-delay, which HyperFrames
// seeks frame by frame, so every frame is reproducible.
import { anim, esc, lines, sec, typed, withTimeOffset } from "./html.mjs";
import { fitPx, typeScale } from "./styles.mjs";

const CPS = 28; // typing speed, characters per second
const HOLD = 1.6; // seconds the finished scene stays still before it ends

const t = (v, lang) => (v ? v[lang] : "");

const COVER_HOLD = 2.5; // a cover scene stays on screen at least this long

/**
 * `cover: true` renders the scene already finished at its first frame, so frame 0
 * of the video (the thumbnail players and feeds show) is a composed picture
 * instead of an empty background.
 */
export function renderScene(scene, lang, ctx, { cover = false } = {}) {
  const fn = RENDER[scene.type];
  const out = fn(scene, lang, ctx);
  if (!cover) return { ...out, content: out.content + HOLD };
  const done = withTimeOffset(out.content, () => fn(scene, lang, ctx));
  return { html: done.html, cues: [], content: Math.max(COVER_HOLD, HOLD) };
}

const heading = (text, delay, cls, ctx, width = ctx.fmt.w - ctx.pad.l - ctx.pad.r) => {
  if (!text) return "";
  const ts = typeScale(ctx.fmt);
  const base = cls.includes("mu-hero") ? ts.hero : cls.includes("mu-h-sm") ? ts.hsm : ts.h;
  return `<h1 class="mu-h ${cls}" style="font-size:${fitPx(text, width, base).toFixed(1)}px;animation:${anim("mu-up", 0.7, delay)}">${lines(text)}</h1>`;
};
const sub = (text, delay, cls = "") => (text ? `<p class="mu-sub ${cls}" style="animation:${anim("mu-up", 0.7, delay)}">${lines(text)}</p>` : "");

const pct = (n) => `${Math.round(n * 10000) / 100}%`;

/**
 * An image or video in a frame sized to the source's aspect ratio, with highlight
 * boxes (spotlight: everything else dims) and zooms. `t0` is when the media appears,
 * relative to the scene; annotation times are relative to t0. Each zoom gets its own
 * nested layer so their transforms compose instead of fighting over one property.
 */
function mediaFrame(info, inner, s, lang, ctx, t0) {
  const { fmt, pad } = ctx;
  const maxW = fmt.w - pad.l - pad.r;
  const maxH = (fmt.h - pad.t - pad.b) * (fmt.vertical ? 0.55 : 0.62);
  const scale = Math.min(maxW / info.w, maxH / info.h);
  const w = Math.round(info.w * scale);
  const h = Math.round(info.h * scale);
  const boxStyle = (b) => `left:${pct(b[0] / info.w)};top:${pct(b[1] / info.h)};width:${pct(b[2] / info.w)};height:${pct(b[3] / info.h)}`;
  const marks = s.highlights
    .map((hl) => {
      const fades = [anim("mu-mark-in", 0.45, t0 + hl.at)];
      if (hl.until !== undefined) fades.push(anim("mu-mark-out", 0.35, t0 + hl.until, "linear", "forwards"));
      const label = hl.label ? `<span class="mu-mark-label">${esc(t(hl.label, lang))}</span>` : "";
      return `<div class="mu-mark" style="${boxStyle(hl.box)};animation:${fades.join(", ")}">${label}</div>`;
    })
    .join("");
  let body = `${inner}<div class="mu-marks">${marks}</div>`;
  const zooms = [...s.zoom].sort((a, b) => b.at - a.at); // innermost first
  for (const z of zooms) {
    const [x, y, bw, bh] = z.box;
    const zs = Math.min(4, 0.9 * Math.min(info.w / bw, info.h / bh));
    const clamp = (v) => Math.min(0, Math.max(1 - zs, v));
    const tx = clamp(0.5 - ((x + bw / 2) / info.w) * zs);
    const ty = clamp(0.5 - ((y + bh / 2) / info.h) * zs);
    const vars = `--zx:${pct(tx)};--zy:${pct(ty)};--zs:${zs.toFixed(3)}`;
    const a = [anim("mu-zoom-to", 0.7, t0 + z.at, "cubic-bezier(.65,0,.35,1)", "forwards"), anim("mu-zoom-back", 0.7, t0 + z.at + 0.7 + z.hold, "cubic-bezier(.65,0,.35,1)", "forwards")];
    body = `<div class="mu-zoom" style="${vars};animation:${a.join(", ")}">${body}</div>`;
  }
  const lastMark = Math.max(0, ...s.highlights.map((hl) => (hl.until ?? hl.at) + 0.6), ...s.zoom.map((z) => z.at + z.hold + 1.5));
  return { html: `<div class="mu-media" style="width:${w}px;height:${h}px;animation:${anim("mu-zoom", 1.0, Math.max(0, t0 - 0.3))}">${body}</div>`, end: t0 + lastMark };
}

const RENDER = {
  title(s, lang, ctx) {
    const { style, fmt, pad } = ctx;
    const layout = s.layout ?? "center";
    const cues = style === "promo" ? [{ at: 0.1, sfx: "whoosh", volume: 0.5 }] : [];
    const rule = style === "explainer" || layout === "left" ? `<div class="mu-rule" style="animation:${anim("mu-grow", 0.8, 0.5)}"></div>` : "";
    const full = fmt.w - pad.l - pad.r;
    if (layout === "split") {
      const textW = fmt.vertical ? full : full * 0.48;
      const img = `<figure class="mu-split-img" style="animation:${anim("mu-zoom", 1.0, 0.25)}"><img src="${esc(ctx.asset(s.image))}" alt=""></figure>`;
      return {
        html: `<div class="mu-split">${fmt.vertical ? img : ""}<div class="mu-stack mu-title-left">${heading(t(s.title, lang), 0.05, "mu-hero", ctx, textW)}${rule}${sub(t(s.subtitle, lang), 0.45)}</div>${fmt.vertical ? "" : img}</div>`,
        content: 1.4,
        cues,
      };
    }
    const cls = layout === "left" ? "mu-stack mu-title mu-title-left" : "mu-stack mu-title";
    const titleImg = s.image ? `<figure class="mu-title-img" style="animation:${anim("mu-zoom", 1.0, 0.3)}"><img src="${esc(ctx.asset(s.image))}" alt=""></figure>` : "";
    return {
      html: `<div class="${cls}">${titleImg}${heading(t(s.title, lang), 0.05, "mu-hero", ctx)}${rule}${sub(t(s.subtitle, lang), 0.45)}</div>`,
      content: 1.2,
      cues,
    };
  },

  stat(s, lang, ctx) {
    const value = t(s.value, lang);
    // A value like "80%", "$1,200" or "3x": count the integer part up from 0 with a registered
    // CSS property, so each frame shows the exact number for its time. Anything else pops in.
    const m = /^(\D*?)(\d{1,9})(\D*)$/.exec(value.replace(/,/g, ""));
    const big = typeScale(ctx.fmt).brand * 1.1;
    const size = fitPx(value, ctx.fmt.w - ctx.pad.l - ctx.pad.r, big, 60);
    const at = 0.5;
    const shown = m && s.count
      ? `${esc(m[1])}<span class="mu-count" style="--mu-to:${Number(m[2])};animation:${anim("mu-count", 1.4, at, "cubic-bezier(.16,1,.3,1)")}"></span>${esc(m[3])}`
      : esc(value);
    return {
      html: `<div class="mu-stack mu-stat">${heading(t(s.title, lang), 0.05, "mu-h-sm", ctx)}<div class="mu-stat-value" style="font-size:${size.toFixed(1)}px;animation:${anim("mu-pop", 0.6, at - 0.2)}">${shown}</div><div class="mu-stat-label" style="animation:${anim("mu-up", 0.6, at + 0.6)}">${esc(t(s.label, lang))}</div>${sub(t(s.note, lang), at + 1.0)}</div>`,
      content: at + 1.8,
      cues: ctx.style === "promo" ? [{ at: at - 0.2, sfx: "switch", volume: 0.4 }] : [],
    };
  },

  compare(s, lang, ctx) {
    const side = (k, at) => {
      const v = s[k];
      const win = s.verdict === k;
      const lose = s.verdict !== "none" && !win;
      const pts = v.points.map((pt, i) => `<li style="animation:${anim("mu-up", 0.45, at + 0.35 + i * 0.25)}">${esc(t(pt, lang))}</li>`).join("");
      const img = v.image ? `<img class="mu-compare-img" src="${esc(ctx.asset(v.image))}" alt="">` : "";
      return { html: `<div class="mu-compare-side${win ? " mu-win" : ""}${lose ? " mu-lose" : ""}" style="animation:${anim("mu-up", 0.6, at)}"><div class="mu-compare-label">${esc(t(v.label, lang))}</div>${img}${pts ? `<ul>${pts}</ul>` : ""}</div>`, end: at + 0.35 + v.points.length * 0.25 };
    };
    const a = side("left", 0.5);
    const b = side("right", a.end + 0.5);
    return {
      html: `<div class="mu-stack">${heading(t(s.title, lang), 0.05, "mu-h-sm", ctx)}<div class="mu-compare">${a.html}<div class="mu-compare-vs" style="animation:${anim("mu-pop", 0.4, a.end + 0.2)}">${ctx.fmt.vertical ? "↓" : "→"}</div>${b.html}</div></div>`,
      content: b.end + 0.8,
      cues: ctx.style === "promo" ? [{ at: a.end + 0.5, sfx: "whoosh", volume: 0.4 }] : [],
    };
  },

  kinetic(s, lang, ctx) {
    const width = ctx.fmt.w - ctx.pad.l - ctx.pad.r;
    const base = typeScale(ctx.fmt).hero * 1.15;
    const n = s.lines.length;
    const lines = s.lines.map((ln, i) => {
      const text = t(ln, lang);
      const at = 0.3 + i * s.beat;
      const dim = i < n - 1 ? `, ${anim("mu-dim", 0.4, at + s.beat, "linear", "forwards")}` : "";
      return `<div class="mu-kinetic-line${i === n - 1 ? " mu-kinetic-last" : ""}" style="font-size:${fitPx(text, width, base).toFixed(1)}px;animation:${anim("mu-slam", 0.5, at)}${dim}">${esc(text)}</div>`;
    });
    return {
      html: `<div class="mu-stack mu-kinetic">${lines.join("")}</div>`,
      content: 0.3 + (n - 1) * s.beat + 1.2,
      cues: ctx.style === "promo" ? s.lines.map((_, i) => ({ at: 0.3 + i * s.beat, sfx: "click", volume: 0.3 })) : [],
    };
  },

  code(s, lang, ctx) {
    const first = s.title ? 0.7 : 0.4;
    let num = 0;
    const rows = s.lines.map((ln, i) => {
      const mark = { add: "+", del: "-", ctx: " " }[ln.kind];
      const no = ln.kind === "del" ? "" : ++num;
      return `<div class="mu-code-line mu-code-${ln.kind}" style="animation:${anim("mu-show", 0.25, first + i * 0.14, "linear")}"><span class="mu-code-no">${no}</span><span class="mu-code-mark">${mark}</span><span>${esc(t(ln.text, lang))}</span></div>`;
    });
    const file = s.file ? `<b>${esc(t(s.file, lang))}</b>` : "";
    return {
      html: `<div class="mu-stack">${heading(t(s.title, lang), 0.05, "mu-h-sm", ctx)}<div class="mu-term mu-code"><div class="mu-term-bar"><i></i><i></i><i></i>${file}</div><div class="mu-code-body">${rows.join("")}</div></div></div>`,
      content: first + s.lines.length * 0.14 + 1.0,
      cues: [],
    };
  },

  terminal(s, lang, ctx) {
    let at = s.title ? 0.7 : 0.3;
    const panes = s.panes.map(() => []);
    const cues = [];
    const flashes = s.panes.map(() => []);
    let lastPane = s.lines[0]?.pane ?? 0;
    for (const line of s.lines) {
      const text = t(line.text, lang);
      if (line.pane !== lastPane) {
        // A line landing in the other pane reads as a message arriving.
        at += 0.5;
        flashes[line.pane].push(at);
        cues.push({ at: at - 0.45, sfx: "whoosh", volume: 0.45 }, { at, sfx: "ding", volume: 0.35 });
        lastPane = line.pane;
      }
      if (line.kind === "cmd") {
        const tp = typed(text, at + 0.15, CPS);
        panes[line.pane].push(`<div class="mu-line" style="animation:${anim("mu-show", 0.001, at, "linear")}"><span class="mu-prompt">${esc(s.panes[line.pane].prompt)} </span>${tp.html}</div>`);
        at = tp.end + 0.35;
      } else {
        panes[line.pane].push(`<div class="mu-line mu-tone-${line.tone}" style="animation:${anim("mu-show", 0.2, at, "linear")}">${esc(text)}</div>`);
        at += 0.45;
      }
    }
    const paneHtml = s.panes
      .map((p, i) => {
        const accent = p.accent ? ` style="--pane:${p.accent}"` : "";
        const glow = flashes[i].map((f) => anim("mu-flash", 1.2, f, "ease-out", "forwards")).join(", ");
        return `<div class="mu-term"${accent}><div class="mu-term-bar"><i></i><i></i><i></i><b>${esc(t(p.label, lang))}</b></div><div class="mu-term-body"${glow ? ` style="animation:${glow}"` : ""}>${panes[i].join("")}</div></div>`;
      })
      .join("");
    return {
      html: `<div class="mu-stack">${heading(t(s.title, lang), 0.05, "mu-h-sm", ctx)}<div class="mu-panes mu-panes-${s.panes.length}">${paneHtml}</div></div>`,
      content: at,
      cues,
    };
  },

  steps(s, lang, ctx) {
    const { style } = ctx;
    const n = s.steps.length;
    const first = 0.7;
    const gap = style === "explainer" ? 1.4 : 0.35;
    const items = s.steps
      .map((st, i) => {
        const at = first + i * gap;
        // Explainer: the current step stays bright, earlier ones dim (text only, so the number stays opaque over the track).
        const dim = style === "explainer" && i < n - 1 ? ` style="animation:${anim("mu-dim", 0.4, at + gap, "linear", "forwards")}"` : "";
        return `<li class="mu-step" style="animation:${anim("mu-up", 0.6, at)}"><span class="mu-num">${i + 1}</span><div${dim}><b>${esc(t(st.title, lang))}</b>${st.body ? `<p>${esc(t(st.body, lang))}</p>` : ""}</div></li>`;
      })
      .join("");
    const track = style === "explainer" ? `<div class="mu-track" style="animation:${anim("mu-fill", gap * (n - 1) + 0.6, first, "linear")}"></div>` : "";
    const cues = style === "promo" ? s.steps.map((_, i) => ({ at: first + i * gap, sfx: "click", volume: 0.3 })) : [];
    return {
      html: `<div class="mu-stack">${heading(t(s.title, lang), 0.05, "mu-h-sm", ctx)}<ol class="mu-steps mu-steps-${n}">${track}${items}</ol></div>`,
      content: first + gap * (n - 1) + 0.8,
      cues,
    };
  },

  diagram(s, lang, ctx) {
    const { w, h, vertical } = ctx.fmt;
    const n = s.nodes.length;
    // Fixed layout computed here, not in the browser, so it is the same on every machine.
    const u = Math.min(w, h) / 1080;
    const area = { w: w - ctx.pad.l - ctx.pad.r, h: (h - ctx.pad.t - ctx.pad.b) * (vertical ? 0.7 : 0.5) };
    const box = vertical ? { w: Math.min(640 * u, area.w * 0.72), h: Math.min(170 * u, (area.h / n) * 0.62) } : { w: Math.min(440 * u, (area.w / n) * 0.7), h: 200 * u };
    const pos = s.nodes.map((_, i) => {
      const f = n === 1 ? 0.5 : i / (n - 1);
      return vertical ? { x: area.w / 2, y: box.h / 2 + f * (area.h - box.h) } : { x: box.w / 2 + f * (area.w - box.w), y: area.h / 2 };
    });
    const idx = Object.fromEntries(s.nodes.map((nd, i) => [nd.id, i]));
    const nodeAt = (i) => 0.6 + i * 0.35;
    const edgeStart = nodeAt(n - 1) + 0.5;
    const edgeGap = 0.7;
    const edges = s.edges.map((e, k) => {
      const a = pos[idx[e.from]];
      const b = pos[idx[e.to]];
      const adjacent = Math.abs(idx[e.from] - idx[e.to]) === 1;
      const dir = vertical ? Math.sign(b.y - a.y) : Math.sign(b.x - a.x);
      const p1 = vertical ? { x: a.x, y: a.y + (dir * box.h) / 2 } : { x: a.x + (dir * box.w) / 2, y: a.y };
      const p2 = vertical ? { x: b.x, y: b.y - (dir * box.h) / 2 } : { x: b.x - (dir * box.w) / 2, y: b.y };
      let d;
      let mid;
      if (adjacent) {
        d = `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
        mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      } else {
        // Skip connections arc around the boxes in between.
        const off = vertical ? box.w / 2 + 90 : box.h / 2 + 90;
        const s1 = vertical ? { x: a.x + box.w / 2, y: a.y } : { x: a.x, y: a.y - box.h / 2 };
        const s2 = vertical ? { x: b.x + box.w / 2, y: b.y } : { x: b.x, y: b.y - box.h / 2 };
        const c = vertical ? { x: a.x + off + 60, y: (a.y + b.y) / 2 } : { x: (a.x + b.x) / 2, y: a.y - off - 60 };
        d = `M${s1.x},${s1.y} Q${c.x},${c.y} ${s2.x},${s2.y}`;
        mid = { x: (s1.x + 2 * c.x + s2.x) / 4, y: (s1.y + 2 * c.y + s2.y) / 4 };
      }
      const at = edgeStart + k * edgeGap;
      const label = e.label ? `<div class="mu-edge-label" style="left:${mid.x}px;top:${mid.y}px;animation:${anim("mu-show", 0.3, at + 0.4, "linear")}">${esc(t(e.label, lang))}</div>` : "";
      return { svg: `<path d="${d}" pathLength="1" class="mu-edge" marker-end="url(#mu-arrow)" style="animation:${anim("mu-draw", 0.6, at, "ease-in-out")}"/>`, label, at };
    });
    const nodes = s.nodes
      .map(
        (nd, i) =>
          `<div class="mu-node" style="left:${pos[i].x - box.w / 2}px;top:${pos[i].y - box.h / 2}px;width:${box.w}px;height:${box.h}px;animation:${anim("mu-pop", 0.5, nodeAt(i))}"><b>${esc(t(nd.label, lang))}</b>${nd.note ? `<span>${esc(t(nd.note, lang))}</span>` : ""}</div>`,
      )
      .join("");
    const cues = ctx.style === "promo" ? edges.map((e) => ({ at: e.at, sfx: "whoosh", volume: 0.35 })) : s.nodes.map((_, i) => ({ at: nodeAt(i), sfx: "click", volume: 0.25 }));
    return {
      html: `<div class="mu-stack">${heading(t(s.title, lang), 0.05, "mu-h-sm", ctx)}<div class="mu-diagram" style="width:${area.w}px;height:${area.h}px"><svg width="${area.w}" height="${area.h}" viewBox="0 0 ${area.w} ${area.h}"><defs><marker id="mu-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="mu-arrowhead"/></marker></defs>${edges.map((e) => e.svg).join("")}</svg>${nodes}${edges.map((e) => e.label).join("")}</div></div>`,
      content: (edges.length ? edges[edges.length - 1].at + 1 : nodeAt(n - 1) + 0.6),
      cues,
    };
  },

  features(s, lang, ctx) {
    const { style } = ctx;
    const layout = s.layout ?? (style === "explainer" ? "list" : "pills");
    const first = 0.7;
    const gap = style === "explainer" ? 0.45 : 0.25;
    const items = s.items
      .map((it, i) => `<li class="mu-feature" style="animation:${anim("mu-pop", 0.5, first + i * gap)}"><span class="mu-check"></span>${esc(t(it, lang))}</li>`)
      .join("");
    return {
      html: `<div class="mu-stack">${heading(t(s.title, lang), 0.05, "mu-h-sm", ctx)}<ul class="mu-features mu-features-${layout}">${items}</ul>${sub(t(s.subtitle, lang), first + s.items.length * gap)}</div>`,
      content: first + s.items.length * gap + 0.8,
      cues: s.items.map((_, i) => ({ at: first + i * gap, sfx: "click", volume: style === "promo" ? 0.3 : 0.2 })),
    };
  },

  image(s, lang, ctx) {
    const info = ctx.media(s.image);
    const t0 = 0.6;
    const m = mediaFrame(info, `<img class="mu-media-src" src="${esc(ctx.asset(s.image))}" alt="">`, s, lang, ctx, t0);
    return {
      html: `<div class="mu-stack">${heading(t(s.title, lang), 0.05, "mu-h-sm", ctx)}${m.html}${sub(t(s.caption, lang), 0.9, "mu-caption")}</div>`,
      content: Math.max(1.8, m.end),
      cues: [...(ctx.style === "promo" ? [{ at: 0.3, sfx: "whoosh", volume: 0.35 }] : []), ...s.highlights.map((hl) => ({ at: t0 + hl.at, sfx: "click", volume: 0.3 }))],
    };
  },

  video(s, lang, ctx) {
    const info = ctx.media(s.video);
    const t0 = 0.6;
    const clipLen = s.length ?? Math.max(0.5, (info.duration ?? 5) - s.start);
    const plays = clipLen / s.speed;
    const src = esc(ctx.asset(s.video));
    // <<T+n>> is replaced with the absolute timeline time when the scene is placed. Brief text is
    // escaped, so it can never contain "<<" and collide with this marker.
    const audio = s.audio ? 'data-has-audio="true"' : "muted";
    const video = `<video class="mu-media-src" src="${src}" ${audio} playsinline data-start="<<T+${t0}>>" data-duration="${plays.toFixed(3)}" data-media-start="${s.start}" data-playback-rate="${s.speed}" data-volume="${s.audio ? 1 : 0}"></video>`;
    const poster = `<img class="mu-media-src mu-poster" src="${esc(ctx.poster(s.video, s.start + clipLen - 0.05))}" alt="">`;
    const m = mediaFrame(info, poster + video, s, lang, ctx, t0);
    return {
      html: `<div class="mu-stack">${heading(t(s.title, lang), 0.05, "mu-h-sm", ctx)}${m.html}${sub(t(s.caption, lang), 0.9, "mu-caption")}</div>`,
      content: Math.max(t0 + plays + 0.4, m.end),
      cues: s.highlights.map((hl) => ({ at: t0 + hl.at, sfx: "click", volume: 0.3 })),
    };
  },

  cta(s, lang, ctx) {
    const { style } = ctx;
    const width = ctx.fmt.w - ctx.pad.l - ctx.pad.r;
    const brandPx = fitPx(t(s.title, lang), width, typeScale(ctx.fmt).brand, 40, true);
    // Keep the install line on one line when it can be read that way; very long ones still wrap.
    const u = Math.min(ctx.fmt.w, ctx.fmt.h) / 1080;
    const cmdPx = fitPx(t(s.command, lang), width - 60 * u, (ctx.fmt.vertical ? 30 : 32) * u, 22 * u, true);
    return {
      html: `<div class="mu-stack mu-cta"><div class="mu-brand" style="font-size:${brandPx.toFixed(1)}px;animation:${anim("mu-pop", 0.7, 0)}">${esc(t(s.title, lang))}</div>${sub(t(s.subtitle, lang), 0.35)}${s.command ? `<code class="mu-cmd" style="font-size:${cmdPx.toFixed(1)}px;animation:${anim("mu-up", 0.6, 0.6)}">${esc(t(s.command, lang))}</code>` : ""}${s.url ? `<div class="mu-url" style="animation:${anim("mu-up", 0.6, 0.85)}">${esc(t(s.url, lang))}</div>` : ""}</div>`,
      content: 1.6,
      cues: style === "promo" ? [{ at: 0, sfx: "switch", volume: 0.4 }] : [],
    };
  },
};

export { sec };

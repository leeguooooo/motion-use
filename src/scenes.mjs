// Scene renderers: brief scene -> { html, content, cues }.
// `content` is how long the scene's own animation needs (seconds); the planner
// stretches the scene further for voiceover. `cues` are sound effects at
// scene-relative times. All timing is CSS animation-delay, which HyperFrames
// seeks frame by frame, so every frame is reproducible.
import { anim, esc, lines, sec, typed } from "./html.mjs";
import { fitPx, typeScale } from "./styles.mjs";

const CPS = 28; // typing speed, characters per second
const HOLD = 1.6; // seconds the finished scene stays still before it ends

const t = (v, lang) => (v ? v[lang] : "");

export function renderScene(scene, lang, ctx) {
  const fn = RENDER[scene.type];
  const out = fn(scene, lang, ctx);
  return { ...out, content: out.content + HOLD };
}

const heading = (text, delay, cls, ctx) => {
  if (!text) return "";
  const ts = typeScale(ctx.fmt);
  const base = cls === "mu-hero" ? ts.hero : cls === "mu-h-sm" ? ts.hsm : ts.h;
  const width = ctx.fmt.w - ctx.pad.l - ctx.pad.r;
  return `<h1 class="mu-h ${cls}" style="font-size:${fitPx(text, width, base).toFixed(1)}px;animation:${anim("mu-up", 0.7, delay)}">${lines(text)}</h1>`;
};
const sub = (text, delay, cls = "") => (text ? `<p class="mu-sub ${cls}" style="animation:${anim("mu-up", 0.7, delay)}">${lines(text)}</p>` : "");

const RENDER = {
  title(s, lang, ctx) {
    const { style } = ctx;
    const cues = style === "promo" ? [{ at: 0.1, sfx: "whoosh", volume: 0.5 }] : [];
    const underline = style === "explainer" ? `<div class="mu-rule" style="animation:${anim("mu-grow", 0.8, 0.5)}"></div>` : "";
    return {
      html: `<div class="mu-stack mu-title">${heading(t(s.title, lang), 0.05, "mu-hero", ctx)}${underline}${sub(t(s.subtitle, lang), 0.45)}</div>`,
      content: 1.2,
      cues,
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
        panes[line.pane].push(`<div class="mu-line" style="animation:${anim("mu-show", 0.001, at, "linear")}"><span class="mu-prompt">$ </span>${tp.html}</div>`);
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
    const first = 0.7;
    const gap = style === "explainer" ? 0.45 : 0.25;
    const items = s.items
      .map((it, i) => `<li class="mu-feature" style="animation:${anim("mu-pop", 0.5, first + i * gap)}"><span class="mu-check"></span>${esc(t(it, lang))}</li>`)
      .join("");
    return {
      html: `<div class="mu-stack">${heading(t(s.title, lang), 0.05, "mu-h-sm", ctx)}<ul class="mu-features">${items}</ul>${sub(t(s.subtitle, lang), first + s.items.length * gap)}</div>`,
      content: first + s.items.length * gap + 0.8,
      cues: s.items.map((_, i) => ({ at: first + i * gap, sfx: "click", volume: style === "promo" ? 0.3 : 0.2 })),
    };
  },

  image(s, lang, ctx) {
    return {
      html: `<div class="mu-stack">${heading(t(s.title, lang), 0.05, "mu-h-sm", ctx)}<figure class="mu-figure" style="animation:${anim("mu-zoom", 1.2, 0.3)}"><img src="${esc(ctx.asset(s.image))}" alt=""></figure>${sub(t(s.caption, lang), 0.9, "mu-caption")}</div>`,
      content: 1.8,
      cues: ctx.style === "promo" ? [{ at: 0.3, sfx: "whoosh", volume: 0.35 }] : [],
    };
  },

  cta(s, lang, ctx) {
    const { style } = ctx;
    const brandPx = fitPx(t(s.title, lang), ctx.fmt.w - ctx.pad.l - ctx.pad.r, typeScale(ctx.fmt).brand, 40, true);
    return {
      html: `<div class="mu-stack mu-cta"><div class="mu-brand" style="font-size:${brandPx.toFixed(1)}px;animation:${anim("mu-pop", 0.7, 0)}">${esc(t(s.title, lang))}</div>${sub(t(s.subtitle, lang), 0.35)}${s.command ? `<code class="mu-cmd" style="animation:${anim("mu-up", 0.6, 0.6)}">${esc(t(s.command, lang))}</code>` : ""}${s.url ? `<div class="mu-url" style="animation:${anim("mu-up", 0.6, 0.85)}">${esc(t(s.url, lang))}</div>` : ""}</div>`,
      content: 1.6,
      cues: style === "promo" ? [{ at: 0, sfx: "switch", volume: 0.4 }] : [],
    };
  },
};

export { sec };

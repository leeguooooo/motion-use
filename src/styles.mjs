import { HEX_RE, THEME_KEYS } from "./brief.mjs";

// The two looks. "promo": dark, glowing, punchy. "explainer": light paper, ink, calm.
// Sizes are in px of the output frame and scale with the frame's short side.

export const PALETTES = {
  promo: { background: "#0b0d12", text: "#e8ebf2", dim: "#8a93a6", accent: "#7cf2b0", panel: "#12151d", border: "#262b38", warn: "#ffcf5c", error: "#ff6b6b", glow: "#1b2240" },
  explainer: { background: "#f6f3ec", text: "#1d2330", dim: "#5f6776", accent: "#2f6fec", panel: "#ffffff", border: "#d9d3c6", warn: "#b7791f", error: "#c53030", glow: "#e9e2d3" },
};

/**
 * Padding inside the frame. Vertical leaves room for the like/comment/share column
 * on the right and the caption block at the bottom on Douyin, Reels and Shorts.
 * These are working values from looking at those apps, not published specs.
 */
export const padFor = ({ vertical, w }) => (vertical ? { t: 200, r: 150, b: 330, l: 90 } : { t: Math.round(w * 0.06), r: Math.round(w * 0.06), b: Math.round(w * 0.06), l: Math.round(w * 0.06) });

/** Base type sizes in px for a frame. */
export const typeScale = (fmt) => {
  const u = Math.min(fmt.w, fmt.h) / 1080;
  return fmt.vertical ? { hero: 96 * u, h: 82 * u, hsm: 64 * u, brand: 170 * u } : { hero: 92 * u, h: 76 * u, hsm: 58 * u, brand: 180 * u };
};

// Rough advance width in em: CJK and full-width forms are square, Latin is about half.
const charEm = (ch) => {
  const cp = ch.codePointAt(0);
  if (cp >= 0x2e80 && cp <= 0x9fff) return 1;
  if (cp >= 0xac00 && cp <= 0xd7af) return 1;
  if (cp >= 0xf900 && cp <= 0xfaff) return 1;
  if (cp >= 0xff00 && cp <= 0xffef) return 1;
  if (cp >= 0x20000) return 1;
  if (ch === " ") return 0.28;
  return /[A-Z0-9mwMW@#%&]/.test(ch) ? 0.66 : 0.54;
};

/**
 * Largest size up to `base` at which every hard line of `text` fits `width`.
 * Long lines still wrap in the browser; this keeps short headlines from
 * breaking one character before the end, which looks broken in CJK.
 */
export function fitPx(text, width, base, min = base * 0.55, mono = false) {
  const widest = Math.max(...String(text).split(/\r?\n/).map((l) => [...l].reduce((n, ch) => n + (mono ? (charEm(ch) === 1 ? 1 : 0.6) : charEm(ch)), 0)), 1);
  return Math.max(min, Math.min(base, (width * 0.96) / widest));
}

export function css(style, fmt, theme, pad) {
  // Defense in depth: validateBrief already drops anything else, but never let a
  // non-color value into the stylesheet.
  const p = { ...PALETTES[style] };
  for (const k of THEME_KEYS) if (typeof theme?.[k] === "string" && HEX_RE.test(theme[k])) p[k] = theme[k];
  const u = Math.min(fmt.w, fmt.h) / 1080; // 1 at 1080p
  const px = (n) => `${Math.round(n * u * 10) / 10}px`;
  const common = `
@font-face { font-family: "MU Sans"; src: url(assets/fonts/sans.woff2) format("woff2"); font-weight: 100 900; }
@font-face { font-family: "MU Mono"; src: url(assets/fonts/mono.woff2) format("woff2"); font-weight: 100 800; }
:root { --bg: ${p.background}; --text: ${p.text}; --dim: ${p.dim}; --accent: ${p.accent}; --panel: ${p.panel}; --border: ${p.border}; --warn: ${p.warn}; --error: ${p.error}; --glow: ${p.glow}; }
html, body { margin: 0; background: var(--bg); }
#root { position: relative; width: ${fmt.w}px; height: ${fmt.h}px; overflow: hidden; background: var(--bg); color: var(--text); font-family: "MU Sans", sans-serif; }
.mu-scene { position: absolute; inset: 0; box-sizing: border-box; padding: ${pad.t}px ${pad.r}px ${pad.b}px ${pad.l}px; display: flex; align-items: center; justify-content: center; }
.mu-stack { display: flex; flex-direction: column; align-items: center; gap: ${px(fmt.vertical ? 56 : 44)}; width: 100%; }
.mu-h { margin: 0; font-weight: 900; line-height: 1.18; text-align: center; font-size: ${px(fmt.vertical ? 82 : 76)}; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.mu-h-sm { font-size: ${px(fmt.vertical ? 64 : 58)}; }
.mu-hero { font-size: ${px(fmt.vertical ? 96 : 92)}; }
.mu-sub { margin: 0; color: var(--dim); font-size: ${px(fmt.vertical ? 44 : 38)}; line-height: 1.4; text-align: center; max-width: 100%; overflow-wrap: anywhere; }
.mu-panes { display: flex; gap: ${px(32)}; width: 100%; justify-content: center; flex-direction: ${fmt.vertical ? "column" : "row"}; align-items: ${fmt.vertical ? "stretch" : "flex-start"}; }
.mu-panes-1 .mu-term { width: ${fmt.vertical ? "100%" : "72%"}; }
.mu-panes-2 .mu-term { width: ${fmt.vertical ? "100%" : "48%"}; }
.mu-term { --pane: var(--accent); border-radius: ${px(18)}; overflow: hidden; background: var(--panel); border: 2px solid var(--border); }
.mu-term-bar { display: flex; align-items: center; gap: ${px(9)}; padding: ${px(14)} ${px(20)}; border-bottom: 1px solid var(--border); }
.mu-term-bar i { width: ${px(13)}; height: ${px(13)}; border-radius: 50%; background: var(--border); }
.mu-term-bar b { margin-left: ${px(10)}; color: var(--pane); font-size: ${px(28)}; }
.mu-term-body { padding: ${px(22)} ${px(26)}; min-height: ${px(fmt.vertical ? 300 : 340)}; font-family: "MU Mono", "MU Sans", monospace; font-size: ${px(fmt.vertical ? 30 : 29)}; line-height: 1.5; display: flex; flex-direction: column; gap: ${px(6)}; overflow-wrap: anywhere; }
.mu-prompt { color: var(--dim); }
.mu-tone-ok { color: var(--accent); } .mu-tone-warn { color: var(--warn); } .mu-tone-dim { color: var(--dim); } .mu-tone-error { color: var(--error); }
.mu-steps { list-style: none; margin: 0; padding: 0; position: relative; width: 100%; }
.mu-step b { font-size: ${px(fmt.vertical ? 46 : 44)}; }
.mu-step p { margin: ${px(8)} 0 0; color: var(--dim); font-size: ${px(fmt.vertical ? 32 : 32)}; line-height: 1.4; overflow-wrap: anywhere; }
.mu-num { flex: none; position: relative; z-index: 1; display: grid; place-items: center; width: ${px(64)}; height: ${px(64)}; border-radius: 50%; font-weight: 900; font-size: ${px(32)}; }
.mu-diagram { position: relative; }
.mu-diagram svg { position: absolute; inset: 0; overflow: visible; }
.mu-edge { fill: none; stroke: var(--accent); stroke-width: ${px(4)}; stroke-dasharray: 1; }
.mu-arrowhead { fill: var(--accent); }
.mu-node { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: ${px(6)}; padding: ${px(12)}; border-radius: ${px(18)}; background: var(--panel); border: 3px solid var(--border); }
.mu-node b { font-size: ${px(fmt.vertical ? 42 : 40)}; overflow-wrap: anywhere; }
.mu-node span { color: var(--dim); font-size: ${px(fmt.vertical ? 28 : 28)}; }
.mu-edge-label { position: absolute; transform: translate(-50%, -130%); white-space: nowrap; font-size: ${px(32)}; font-weight: 700; color: var(--accent); background: var(--bg); padding: 0 ${px(8)}; border-radius: ${px(6)}; }
.mu-features { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: ${px(22)}; max-width: 100%; }
.mu-feature { display: flex; align-items: center; gap: ${px(14)}; font-weight: 700; font-size: ${px(fmt.vertical ? 40 : 36)}; }
.mu-check { width: ${px(30)}; height: ${px(30)}; border-radius: 50%; background: var(--accent); flex: none; }
.mu-figure { margin: 0; max-width: 100%; max-height: ${fmt.vertical ? "52%" : "60%"}; display: flex; justify-content: center; }
.mu-figure img { max-width: 100%; max-height: ${Math.round((fmt.h - pad.t - pad.b) * (fmt.vertical ? 0.55 : 0.6))}px; object-fit: contain; border-radius: ${px(18)}; border: 2px solid var(--border); }
.mu-cta { gap: ${px(36)}; }
.mu-brand { font-family: "MU Mono", "MU Sans", monospace; font-weight: 800; font-size: ${px(fmt.vertical ? 170 : 180)}; line-height: 1; overflow-wrap: anywhere; text-align: center; }
.mu-cmd { font-family: "MU Mono", "MU Sans", monospace; font-size: ${px(fmt.vertical ? 30 : 32)}; padding: ${px(18)} ${px(28)}; border-radius: ${px(14)}; background: var(--panel); border: 2px solid var(--border); color: var(--accent); max-width: 100%; box-sizing: border-box; overflow-wrap: anywhere; text-align: center; }
.mu-url { font-family: "MU Mono", "MU Sans", monospace; font-weight: 700; font-size: ${px(fmt.vertical ? 32 : 34)}; overflow-wrap: anywhere; text-align: center; }
.mu-media { position: relative; overflow: hidden; border-radius: ${px(18)}; border: 2px solid var(--border); background: #000; flex: none; }
.mu-media .mu-zoom { position: absolute; inset: 0; transform-origin: 0 0; }
.mu-media-src { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.mu-marks { position: absolute; inset: 0; }
.mu-mark { position: absolute; box-sizing: border-box; border: ${px(4)} solid var(--accent); border-radius: ${px(10)}; box-shadow: 0 0 0 200vmax rgba(0,0,0,.45), 0 0 ${px(24)} var(--accent); }
.mu-mark-label { position: absolute; left: 0; top: 100%; margin-top: ${px(10)}; white-space: nowrap; padding: ${px(6)} ${px(14)}; border-radius: ${px(8)}; background: var(--accent); color: var(--bg); font-weight: 700; font-size: ${px(fmt.vertical ? 30 : 28)}; }
@keyframes mu-mark-in { from { opacity: 0; transform: scale(1.08); } to { opacity: 1; transform: none; } }
@keyframes mu-mark-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes mu-zoom-to { from { transform: none; } to { transform: translate(var(--zx), var(--zy)) scale(var(--zs)); } }
@keyframes mu-zoom-back { from { transform: translate(var(--zx), var(--zy)) scale(var(--zs)); } to { transform: none; } }
@keyframes mu-show { from { opacity: 0; } to { opacity: 1; } }
@keyframes mu-up { from { opacity: 0; transform: translateY(${px(36)}); } to { opacity: 1; transform: none; } }
@keyframes mu-pop { from { opacity: 0; transform: scale(.82); } to { opacity: 1; transform: none; } }
@keyframes mu-zoom { from { opacity: 0; transform: scale(1.06); } to { opacity: 1; transform: none; } }
@keyframes mu-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes mu-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes mu-dim { to { opacity: .38; } }
@keyframes mu-fill { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes mu-flash { from { box-shadow: inset 0 0 0 3px var(--pane), 0 0 ${px(60)} var(--pane); } to { box-shadow: inset 0 0 0 0 transparent, 0 0 0 transparent; } }
@keyframes mu-scene-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes mu-scene-out { from { opacity: 1; } to { opacity: 0; } }
`;
  return common + (style === "promo" ? promo(fmt, px) : explainer(fmt, px));
}

const promo = (fmt, px) => `
#root::before { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at 50% 45%, var(--glow) 0%, transparent 62%); }
#root::after { content: ""; position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px); background-size: ${px(64)} ${px(64)}; }
.mu-scene { z-index: 1; }
.mu-h { text-shadow: 0 0 ${px(40)} rgba(0,0,0,.4); }
.mu-term { box-shadow: 0 ${px(30)} ${px(80)} rgba(0,0,0,.5); }
.mu-steps { display: grid; grid-template-columns: ${fmt.vertical ? "1fr" : "repeat(auto-fit, minmax(0, 1fr))"}; gap: ${px(24)}; }
.mu-step { display: flex; gap: ${px(20)}; align-items: flex-start; padding: ${px(28)}; border-radius: ${px(18)}; background: var(--panel); border: 2px solid var(--border); }
.mu-num { background: var(--accent); color: var(--bg); }
.mu-node { box-shadow: 0 0 ${px(40)} color-mix(in srgb, var(--accent) 25%, transparent); border-color: var(--accent); }
.mu-feature { padding: ${px(16)} ${px(30)}; border-radius: 999px; border: 3px solid var(--accent); color: var(--accent); }
.mu-check { display: none; }
.mu-brand { text-shadow: 0 0 ${px(60)} var(--accent); }
`;

const explainer = (fmt, px) => `
.mu-h { text-align: ${fmt.vertical ? "center" : "left"}; align-self: ${fmt.vertical ? "center" : "flex-start"}; }
.mu-title .mu-h { align-self: center; text-align: center; }
.mu-rule { width: ${px(220)}; height: ${px(10)}; border-radius: ${px(5)}; background: var(--accent); transform-origin: left center; }
.mu-steps { display: flex; flex-direction: column; gap: ${px(fmt.vertical ? 40 : 30)}; padding-left: ${px(4)}; }
.mu-track { position: absolute; left: ${px(35)}; top: ${px(32)}; bottom: ${px(32)}; width: ${px(4)}; background: var(--accent); transform-origin: top center; }
.mu-step { display: flex; gap: ${px(28)}; align-items: flex-start; position: relative; }
.mu-num { background: var(--panel); color: var(--accent); border: 3px solid var(--accent); }
.mu-node { border-width: 3px; border-color: var(--text); }
.mu-edge { stroke: var(--text); stroke-width: ${px(3)}; }
.mu-arrowhead { fill: var(--text); }
.mu-edge-label { color: var(--accent); }
.mu-features { flex-direction: column; align-items: flex-start; align-self: center; }
.mu-feature { font-weight: 400; }
.mu-check { background: transparent; border: 3px solid var(--accent); box-sizing: border-box; }
.mu-figure img { box-shadow: 0 ${px(16)} ${px(40)} rgba(0,0,0,.12); }
.mu-brand { font-family: "MU Sans", sans-serif; font-weight: 900; color: var(--text); }
.mu-cmd { color: var(--text); }
.mu-url { color: var(--accent); }
`;

// The three.js world lives in vendor/scene.js (built from src/); this layer adds subtitles and the fades.
window.setupFilm = function (film, view) {
  window.__promo = new window.PromoFilm(view.width, view.height, film.copy);
  window.__subs = film.copy.subs.split("|").map((s) => { const [a, b, text] = s.split("~"); return { a: +a, b: +b, text }; });
};
window.drawFrame = function (ctx, t, film, view, M) {
  const { width: W, height: H } = view, S = H / 1080;
  ctx.drawImage(window.__promo.render(t), 0, 0, W, H);
  // subtitles: one line, bottom centre, soft plate behind for legibility on bright frames
  const sub = window.__subs.find((s) => t >= s.a - 0.05 && t < s.b + 0.25);
  if (sub) {
    const a = Math.min(M.ramp(t, sub.a - 0.05, 0.12), 1 - M.ramp(t, sub.b + 0.1, 0.15));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `600 ${44 * S}px "Film Sans"`;
    const w = ctx.measureText(sub.text).width + 56 * S, y = H - 92 * S;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    M.round(ctx, W / 2 - w / 2, y - 38 * S, w, 76 * S, 18 * S, "rgba(0,0,0,0.45)");
    M.text(ctx, sub.text, W / 2, y + 2 * S, 44 * S, "#f4f7fa", 600, "center", W - 200 * S);
    ctx.restore();
  }
  const dark = 1 - M.ramp(t, 0, 0.7) * (1 - M.ramp(t, film.duration - 0.9, 0.9));
  if (dark > 0.002) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, W, H); }
};

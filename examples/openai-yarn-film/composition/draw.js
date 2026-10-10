// Three.js renders the world (vendor/scene.js); this layer adds the camera flash and the final polaroid.
window.setupFilm = function (film, view) {
  window.__film = new window.YarnFilm(view.width, view.height);
};
window.drawFrame = function (ctx, t, film, view, M) {
  const { width: W, height: H } = view, S = H / 1080, T = window.YARN_T, F = window.__film;
  const flash = T.flash, shot = flash + 0.06;
  if (t < flash) {
    ctx.drawImage(F.render(t), 0, 0, W, H);
    return;
  }
  // the photo: one frozen, flash-lit instant
  const img = F.render(shot, { photo: 1 });
  const k = M.ramp(t, flash + 0.55, 1.1);
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, W, H);
  // blurred, dimmed copy of the moment behind the print
  ctx.save();
  ctx.globalAlpha = k;
  ctx.filter = `blur(${18 * S}px) brightness(0.32)`;
  ctx.drawImage(img, -40 * S, -40 * S, W + 80 * S, H + 80 * S);
  ctx.restore();
  const scale = M.mix(1, 0.66, k), drift = 1 + 0.015 * M.clamp((t - flash - 1.7) / 3);
  const pw = W * scale * drift, ph = H * scale * drift;
  const border = 26 * S * k * drift, bottom = 120 * S * k * drift;
  const cx = W / 2, cy = H / 2 - M.mix(0, 44 * S, k);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(M.mix(0, -0.035, k));
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 50 * S * k;
  ctx.shadowOffsetY = 18 * S * k;
  ctx.fillStyle = "#f6f3ec";
  ctx.fillRect(-pw / 2 - border, -ph / 2 - border, pw + border * 2, ph + border + bottom);
  ctx.shadowColor = "transparent";
  ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
  // the print develops from white
  const dev = 1 - M.ramp(t, flash + 0.05, 0.9);
  if (dev > 0) { ctx.fillStyle = `rgba(255,255,255,${dev})`; ctx.fillRect(-pw / 2, -ph / 2, pw, ph); }
  const cap = M.ramp(t, flash + 1.5, 0.8);
  if (cap > 0) {
    ctx.globalAlpha = cap;
    M.text(ctx, film.copy.wordmark, 0, ph / 2 + bottom * 0.55, 62 * S, "#141414", 700, "center", pw);
  }
  ctx.restore();
  // the flash itself
  const fl = Math.exp(-Math.max(0, t - flash) / 0.16);
  if (fl > 0.003) { ctx.fillStyle = `rgba(255,255,255,${fl})`; ctx.fillRect(0, 0, W, H); }
};

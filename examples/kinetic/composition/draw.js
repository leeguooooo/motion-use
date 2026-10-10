// Kinetic type: one heavy word per beat, a flat colour per chapter, nothing moves after it lands.
window.drawFrame = function (c, t, film, view, M) {
  const { width: W, height: H, vertical: V } = view,
    u = M.unit,
    p = film.copy,
    k = M.palette(),
    C = [W / 2, H * (V ? 0.42 : 0.47)];
  const navy = t >= 5.6 && t < 8.2;
  c.fillStyle = navy ? k.accent2 : k.bg;
  c.fillRect(0, 0, W, H);
  const big = (V ? 300 : 340) * u,
    sub = (V ? 54 : 60) * u,
    fg = navy ? k.surface : k.ink;
  M.shoot(c, t, [[3.0, "push", C, 0.28], [5.6, "cut", C, 1], [5.6, "slam"], [5.62, "shake", 18 * u], [8.2, "cut", C, 1]], () => {
    if (t < 2.6) {
      M.stamp(c, t, p.hold, C, { at: 0.4, size: big, color: fg, rotate: 0, box: false });
      M.caption(c, t, p.holdSub, 1.0, 2.6, { y: (C[1] + big * 0.75) / H, size: sub, color: k.sub, weight: 700 });
    } else if (t < 5.6) {
      M.words(c, t, p.push, C, { at: 2.75, style: "rise", size: big, color: fg, weight: 900 });
      M.caption(c, t, p.pushSub, 3.4, 5.4, { y: (C[1] + big * 0.75) / H, size: sub, color: k.accent, weight: 800 });
    } else if (t < 8.2) {
      M.stamp(c, t, p.slam, C, { at: 5.6, size: big * 1.1, color: fg, rotate: -0.05, box: true });
      M.caption(c, t, p.slamSub, 6.2, 8.1, { y: (C[1] + big * 0.95) / H, size: sub, color: k.bg, weight: 800 });
    }
  });
  if (t >= 8.2) {
    // Portrait sets the two words on two lines; the pay-off is an action: a red stroke crosses out the last word.
    const size = (V ? 170 : 170) * u,
      lines = V ? [p.not, p.slideshow] : [`${p.not} ${p.slideshow}`],
      y0 = C[1] - ((lines.length - 1) * size * 1.1) / 2;
    lines.forEach((line, i) => M.words(c, t, line, [C[0], y0 + i * size * 1.1], { at: 8.45 + i * 0.36, stagger: 0.18, style: "rise", size, color: k.ink, weight: 900, maxWidth: W * 0.9 }));
    c.font = `900 ${size}px "Film Sans"`;
    const yl = y0 + (lines.length - 1) * size * 1.1,
      total = c.measureText(lines.at(-1)).width,
      last = c.measureText(p.slideshow).width,
      x1 = C[0] + total / 2,
      x0 = x1 - last;
    M.stroke(c, t, [[x0 - 10 * u, yl + 8 * u], [x1 + 10 * u, yl - 8 * u]], { at: 10.9, dur: 0.25, ease: "expoOut", color: k.accent, width: 22 * u, rough: 2 * u });
  }
  M.captions(c, t);
};

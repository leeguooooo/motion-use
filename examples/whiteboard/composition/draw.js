// Whiteboard: one wide board, a pen writing in time with the voice, small camera moves between ideas.
window.drawFrame = function (c, t, film, view, M) {
  const { width: W, height: H, vertical: V } = view,
    u = M.unit,
    p = film.copy,
    k = M.palette();
  M.paper(c, "board", { amount: 4, grain: 4 });
  // The board runs left to right (top to bottom in portrait); stations are its four ideas.
  const at = (i) => (V ? [W / 2, H * 0.24 + i * H * 0.19] : [W * 0.22 + i * W * 0.26, H * 0.5]);
  const S = [0, 1, 2, 3].map(at);
  // How far each idea reaches along the board, before and after its centre (box, label, lights).
  const reach = V ? [[90, 190], [120, 180], [70, 270], [40, 40]] : [[190, 190], [120, 170], [150, 150], [230, 230]];
  const span = V ? S[3][1] + reach[3][1] * u - (S[0][1] - reach[0][0] * u) : S[3][0] + reach[3][1] * u - (S[0][0] - reach[0][0] * u);
  const whole = V ? [W / 2, S[0][1] - reach[0][0] * u + span / 2 + H * 0.05] : [S[0][0] - reach[0][0] * u + span / 2, H * 0.52];
  const fit = ((V ? H * 0.62 : W * 0.86) / span);
  // Portrait keeps the drawing above the subtitle zone: aim the camera a little below each idea.
  const aim = (pt) => (V ? M.add(pt, [0, H * 0.07]) : pt);
  const ink = { color: k.ink, width: 7 * u, rough: 2.5 * u, pen: true };
  // Close on each idea (zoom 1.9), pan as the arrow leaves, pull back to the whole board at the end.
  const z = V ? 1.7 : 1.9;
  M.shoot(c, t, [[3.6, "pan", aim(M.lerp2(S[0], S[1], 0.65))], [7.1, "pan", aim(M.lerp2(S[1], S[2], 0.65))], [11.1, "pan", aim(M.lerp2(S[2], S[3], 0.5))], [13.6, "to", whole, fit, 0.5]], () => {
    // 1 · draw.js in a box, f(time) beside it.
    M.signature(c, t, p.code, S[0], { at: 0.3, dur: 0.9, size: 84 * u, color: k.ink, pen: true });
    M.stroke(c, t, rect(S[0], 360 * u, 170 * u), { at: 1.3, dur: 0.7, ...ink, pen: false, seed: 2 });
    M.signature(c, t, p.fn, M.add(S[0], [0, 150 * u]), { at: 2.1, dur: 0.8, size: 54 * u, color: k.accent, pen: true });
    // 2 · arrow, three stacked frames.
    M.stroke(c, t, arrow(S[0], S[1]), { at: 3.6, dur: 0.6, ...ink, seed: 3 });
    [0, 1, 2].forEach((i) => M.stroke(c, t, rect(M.add(S[1], [i * 22 * u, -i * 22 * u]), 220 * u, 140 * u), { at: 4.3 + i * 0.35, dur: 0.4, ...ink, seed: 5 + i }));
    M.signature(c, t, p.frames, M.add(S[1], [20 * u, 140 * u]), { at: 5.5, dur: 0.7, size: 56 * u, color: k.ink });
    // 3 · arrow, a film strip, three lights; the green one gets circled.
    M.stroke(c, t, arrow(S[1], S[2]), { at: 7.1, dur: 0.6, ...ink, seed: 9 });
    M.stroke(c, t, rect(S[2], 280 * u, 120 * u), { at: 7.7, dur: 0.5, ...ink, seed: 10 });
    M.signature(c, t, p.mp4, S[2], { at: 8.1, dur: 0.5, size: 60 * u, color: k.ink, pen: false });
    ["#3a9d5d", "#e6b729", "#d64545"].forEach((col, i) => {
      const dot = M.add(S[2], [(i - 1) * 90 * u, 150 * u]),
        q = M.tween(t, 8.7 + i * 0.2, 0.25, "backOut");
      if (q > 0) ((c.fillStyle = col), c.beginPath(), c.arc(dot[0], dot[1], 30 * u * q, 0, Math.PI * 2), c.fill());
    });
    M.stroke(c, t, ellipse(M.add(S[2], [-90 * u, 150 * u]), 62 * u, 52 * u), { at: 9.5, dur: 0.7, color: k.accent, width: 8 * u, rough: 3 * u, pen: true, seed: 11 });
    M.signature(c, t, p.lights, M.add(S[2], [0, 240 * u]), { at: 9.9, dur: 0.6, size: 50 * u, color: k.ink, pen: false });
    // 4 · a person watches, underlined.
    M.stroke(c, t, arrow(S[2], S[3]), { at: 11.1, dur: 0.6, ...ink, seed: 13 });
    M.signature(c, t, p.watch, S[3], { at: 11.8, dur: 1.4, underline: 13.3, size: 56 * u, color: k.ink, accent: k.accent });
  }, { x: aim(S[0])[0], y: aim(S[0])[1], z });

  // Small path builders: a box, an arrow between stations, a loose ellipse.
  function rect([x, y], w, h) {
    return [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2], [x - w / 2, y - h / 2 - 4 * u]];
  }
  function arrow(a, b) {
    const i = S.indexOf(a),
      d = V ? [0, 1] : [1, 0],
      s = M.add(a, [d[0] * (reach[i][1] + 30) * u, d[1] * (reach[i][1] + 30) * u]),
      e = M.add(b, [-d[0] * (reach[i + 1][0] + 30) * u, -d[1] * (reach[i + 1][0] + 30) * u]),
      n = [-d[1], d[0]];
    const head = 26 * u;
    return [s, e, [e[0] - d[0] * head + n[0] * head * 0.7, e[1] - d[1] * head + n[1] * head * 0.7], e, [e[0] - d[0] * head - n[0] * head * 0.7, e[1] - d[1] * head - n[1] * head * 0.7]];
  }
  function ellipse([x, y], rx, ry) {
    return Array.from({ length: 34 }, (_, i) => {
      const a = -1.2 + (i / 30) * Math.PI * 2;
      return [x + Math.cos(a) * rx, y + Math.sin(a) * ry];
    });
  }
  M.captions(c, t);
};

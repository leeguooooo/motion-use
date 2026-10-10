// Replace the choreography for your subject. A drawing study of the pulse rhythm:
// hold → a fast push, pan or slam on an event → hold. One object carries the eye to the end.
// Helpers (M.shoot, M.card, M.stroke …) are listed in references/film.md.
window.drawFrame = function (c, t, film, view, M) {
  const { width: W, height: H, vertical: V } = view,
    u = M.unit,
    p = film.copy,
    k = M.palette();
  M.paper(c);

  // World layout: portrait stacks the two objects, landscape spreads them.
  // Portrait keeps everything inside view.safe: platform UI covers the top, bottom and right.
  const gap = (V ? 500 : 820) * u,
    C = [W / 2, H * (V ? 0.44 : 0.55)],
    A = V ? [C[0], C[1] - gap / 2] : [C[0] - gap / 2, C[1]],
    B = V ? [C[0], C[1] + gap / 2] : [C[0] + gap / 2, C[1]],
    mid = M.lerp2(A, B, 0.5);
  const fly = M.tween(t, 3.5, 1.1, "expoInOut"),
    stamp = M.tween(t, 15.2, 0.5, "expoOut");

  // Camera events: [time, move, target, amount]. Each is short and decisive, then holds.
  const camera = [
    [1.4, "push", V ? mid : A, V ? 0.12 : 0.28],
    [3.45, "pan", mid],
    [4.5, "pan", B],
    [4.62, "slam"],
    [7.6, "push", mid, 0.2],
    [10, "to", C, 0.92],
    [14.2, "to", V ? M.add(B, [0, -60 * u]) : B, V ? 1.05 : 1.35],
    [14.52, "slam"],
  ];
  M.shoot(c, t, camera, () => {
    // Five neighbours join after the pull-back, then fold into B.
    const fold = M.tween(t, 13.6, 0.6, "expoIn");
    if (fold < 1)
      M.ring(5, M.add(C, [0, 40 * u]), gap * 0.95, gap * (V ? 0.95 : 0.42)).forEach((n, i) =>
        M.node(c, t, B, M.lerp2(n, B, fold), { at: 10.25 + i * 0.25, color: i % 2 ? k.accent : k.accent2, seed: i + 3 }),
      );
    // The gap is dashed until the message crosses it.
    c.setLineDash(fly < 1 ? [10 * u, 14 * u] : []);
    M.line(c, A[0], A[1], B[0], B[1], k.ink, 6 * u);
    c.setLineDash([]);
    // A strains, then throws; B recoils on arrival, then becomes a surface for the name.
    M.card(c, A, { label: p.a, fill: k.accent, scale: 1 + (t < 3.4 ? M.settle(t, 1.6, 0.06, 4, 2.2) : 0) });
    M.card(c, B, {
      label: stamp > 0 ? "" : p.b,
      fill: stamp > 0 ? k.surface : k.accent2,
      icon: stamp > 0 ? null : "dot",
      scale: (1 + M.settle(t, 4.62, 0.18, 3, 6)) * (1 + (V ? 0.3 : 0.5) * stamp),
    });
    M.pill(c, t, M.lerp2(A, B, fly), p.message, { from: 2.6, to: 4.4, rotate: -0.08 * Math.sin(fly * Math.PI) });
    M.ripple(c, t, B, { at: 4.62 });
    // The reply is drawn back across the gap by a pen.
    const below = V ? [320 * u, 0] : [0, 245 * u];
    M.stroke(c, t, [M.add(B, below), M.add(A, below)], { at: 6.2, until: 9.6, pen: true, width: 12 * u });
    // The ending is an action on B: the name is written onto the object itself.
    if (stamp > 0) M.signature(c, t, p.brand, B, { at: 15.5, underline: 16.8, size: (V ? 96 : 120) * u, maxWidth: (V ? 600 : 690) * u });
  });

  // Beat titles enter in a masked slot and leave fast; no page chrome.
  M.captions(c, t, [
    [p.problem, -1, 3.2], // already landed on frame 0, which is the cover
    [p.send, 3.3, 6],
    [p.result, 6.1, 10],
    [p.network, 10.1, 14],
  ]);
  M.caption(c, t, p.promise, 16.9, Infinity, { y: V ? 0.7 : 0.88, size: 40 * u, color: k.accent2 });
};

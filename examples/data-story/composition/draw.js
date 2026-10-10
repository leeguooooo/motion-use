// A finance-chart data story: one chart, one highlighted bar, numbers that land on the bars.
window.drawFrame = function (c, t, film, view, M) {
  const { width: W, height: H, vertical: V } = view,
    u = M.unit,
    p = film.copy,
    k = M.palette();
  c.fillStyle = k.bg;
  c.fillRect(0, 0, W, H);
  const box = V ? { x: W * 0.1, y: H * 0.27, w: W * 0.72, h: H * 0.26 } : { x: W * 0.08, y: H * 0.3, w: W * 0.56, h: H * 0.44 };
  const bars = film.data.bytes,
    step = box.w / 2,
    top = 7911 * 1.1,
    barTop = (v) => box.y + box.h - (v / top) * box.h,
    barX = (i) => box.x + step * (i + 0.5);
  // The hand-written starter shrinks to the kit version: change the data, the rest stays.
  const drop = M.tween(t, 7.2, 0.6, "expoInOut"),
    data = bars.map((b, i) => (i === 1 ? { ...b, value: M.mix(b.value, bars[2].value, drop), label: drop > 0.5 ? bars[2].label : b.label } : b));
  const pin = [barX(1), barTop(7008)];
  M.shoot(c, t, [[3.6, "push", pin, 0.4], [5.3, "pan", M.add(pin, [140 * u, -60 * u])], [7.2, "pan", [barX(1), barTop(3053) - 80 * u]], [7.3, "slam"], [7.32, "shake", 12 * u], [10.6, "to", [W / 2, H / 2], 1], [10.75, "slam"]], () => {
    M.chart(c, t, { data: data.slice(0, 2), at: 0.3, dur: 0.45, highlight: 1, color: k.accent2, dim: k.sub, x: box.x, y: box.y, w: step * 2, h: box.h, max: top, values: t < 7.2 || t > 8 });
    if (t > 7.2 && t < 8) M.counter(c, t, [barX(1), barTop(data[1].value) - 50 * u], { value: 3053, from: 7008, at: 7.2, dur: 0.6, size: 40 * u, color: k.accent2 });
    M.callout(c, t, [barX(1), barTop(7008)], "7,008", { at: 4.1, until: 7.1, sub: p.hand, dx: 170 * u, dy: -80 * u, bg: k.ink, color: k.accent });
  });
  // Economist frame: red rule and flag, the title is the sentence the chart says.
  const left = box.x / W;
  c.fillStyle = k.accent;
  c.fillRect(box.x, H * 0.08, 96 * u, 22 * u);
  M.caption(c, t, p.title, -1, Infinity, { x: left, align: "left", y: 0.15, size: (V ? 58 : 66) * u, color: k.ink, weight: 900 });
  M.caption(c, t, p.unit, -1, Infinity, { x: left, align: "left", y: 0.21, size: 30 * u, color: k.sub, weight: 600 });
  // The result slams in at full size; it does not count up from zero.
  M.stamp(c, t, "−56%", V ? [W * 0.46, H * 0.61] : [W * 0.81, H * 0.5], { at: 10.75, size: (V ? 170 : 210) * u, color: k.accent, rotate: 0, box: false });
  M.stamp(c, t, p.same, V ? [W * 0.46, H * 0.67] : [W * 0.81, H * 0.64], { at: 11.6, size: 36 * u, color: k.ink, rotate: 0, box: false });
  M.caption(c, t, p.source, -1, Infinity, { x: left, align: "left", y: 0.255, size: 22 * u, color: k.sub, weight: 500 });
  M.captions(c, t); // narration subtitles
};

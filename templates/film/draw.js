// Replace the choreography for your subject. This is a continuous signal study, not a scene renderer.
window.drawFrame = function (c, t, film, view, M) {
  const { width: W, height: H, vertical: V } = view,
    S = Math.min(W, H) / 1080;
  const p = film.copy,
    bg = "#f4f2ec",
    ink = "#172c2a",
    dim = "#64706c",
    green = "#006b56",
    coral = "#ec765d";
  const cx = W / 2,
    cy = H * (V ? 0.53 : 0.57),
    spread = (V ? 290 : 400) * S,
    unit = S;
  const r = (at, d = 0.7) => M.ramp(t, at, d),
    mix = M.mix;
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  // A slow camera push on a persistent world; output framing is designed separately for portrait.
  c.save();
  c.translate(cx, cy);
  const cam = 1 + 0.025 * Math.sin(t * 0.38);
  c.scale(cam, cam);
  c.translate(-cx, -cy);
  const convergence = r(10, 1.1),
    resolution = r(14, 1.2),
    worldAlpha = 1 - r(14.3, 0.8);
  c.globalAlpha = worldAlpha;
  const leftX = mix(cx - spread, cx - spread * 0.64, convergence),
    rightX = mix(cx + spread, cx + spread * 0.64, convergence);
  const panelW = (V ? 250 : 390) * S,
    panelH = 220 * S;
  function agent(x, label, color, side) {
    const shrink = 1 - convergence * 0.38;
    c.save();
    c.translate(x, cy + Math.sin(t * 0.7 + side) * 7 * S);
    c.scale(shrink, shrink);
    c.shadowColor = "#172c2a18";
    c.shadowBlur = 35 * S;
    c.shadowOffsetY = 18 * S;
    M.round(c, -panelW / 2, -panelH / 2, panelW, panelH, 24 * S, "#ffffff");
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    M.text(c, label, 0, -58 * S, 28 * S, dim, 500, "center", panelW - 30 * S);
    c.fillStyle = color;
    c.beginPath();
    c.arc(0, 10 * S, 27 * S, 0, Math.PI * 2);
    c.fill();
    const bars = side === 0 ? 3 : 4;
    for (let i = 0; i < bars; i++)
      M.line(
        c,
        (i - bars / 2) * 16 * S,
        69 * S,
        (i - bars / 2) * 16 * S,
        69 * S - Math.abs(Math.sin(t * 3 + i + side)) * 23 * S,
        color,
        5 * S,
      );
    c.restore();
  }
  agent(leftX, p.a, coral, 0);
  agent(rightX, p.b, green, 1);
  // The connector grows from the same point as the packet. No page replacement.
  const connect = r(3.2, 1.6);
  M.line(
    c,
    leftX,
    cy,
    rightX * connect + leftX * (1 - connect),
    cy,
    green + "70",
    3 * S,
  );
  if (t > 3 && t < 10.8) {
    const travel = r(4.2, 1.6),
      land = r(6, 0.5),
      x = mix(leftX, rightX, travel);
    const inflate = r(3, 0.45) * (1 - r(5.5, 0.45)),
      w = mix(52 * S, (V ? 360 : 440) * S, inflate),
      h = mix(52 * S, 100 * S, inflate);
    c.save();
    c.translate(x, cy);
    c.rotate(-0.055 * Math.sin(travel * Math.PI));
    M.round(c, -w / 2, -h / 2, w, h, h / 2, green);
    c.globalAlpha = worldAlpha * inflate;
    M.text(
      c,
      p.message,
      0,
      0,
      30 * S,
      "#ffffff",
      600,
      "center",
      w - 42 * S,
      true,
    );
    c.globalAlpha = worldAlpha;
    c.restore();
    for (let i = 0; i < 3; i++) {
      const pulse = (t - 6 - i * 0.32) / 1.5;
      if (pulse > 0 && pulse < 1) {
        c.strokeStyle = green;
        c.lineWidth = 3 * S;
        c.globalAlpha = (1 - pulse) * worldAlpha;
        c.beginPath();
        c.arc(rightX, cy, (30 + pulse * 180) * S, 0, Math.PI * 2);
        c.stroke();
      }
    }
    c.globalAlpha = worldAlpha;
    const response = r(7, 0.5) * (1 - r(10, 0.5));
    M.line(
      c,
      rightX,
      cy + 130 * S,
      rightX - (rightX - leftX) * r(7.2, 1.8),
      cy + 130 * S,
      coral,
      3 * S,
    );
    c.globalAlpha = response * worldAlpha;
    M.text(
      c,
      film.lang === "zh" ? "回应" : "REPLY",
      cx,
      cy + 173 * S,
      24 * S,
      dim,
      500,
      "center",
    );
    c.globalAlpha = worldAlpha;
  }
  if (t >= 10) {
    const extra = r(10.3, 0.8),
      yoff = (V ? 280 : 235) * S;
    for (const [y, label, color] of [
      [cy - yoff, p.c, coral],
      [cy + yoff, p.d, green],
    ]) {
      c.globalAlpha = extra * worldAlpha;
      M.line(c, cx, cy, cx, mix(cy, y, extra), green + "50", 3 * S);
      M.round(c, cx - 110 * S, y - 45 * S, 220 * S, 90 * S, 45 * S, "#ffffff");
      M.text(c, label, cx, y, 25 * S, color, 600, "center", 195 * S);
    }
    c.globalAlpha = worldAlpha;
    M.round(c, cx - 64 * S, cy - 64 * S, 128 * S, 128 * S, 38 * S, green);
    M.text(c, "↔", cx, cy, 65 * S, "#ffffff", 500, "center");
    for (let i = 0; i < 5; i++) {
      const a = t * 1.8 + i * 2.4,
        dx = Math.cos(a) * spread * 0.53,
        dy = Math.sin(a) * yoff * 0.7;
      c.fillStyle = i % 2 ? green : coral;
      c.beginPath();
      c.arc(cx + dx, cy + dy, 6 * S, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
  c.globalAlpha = 1;
  // Display typography uses mask reveals. It is not a title sitting above each page.
  const headerY = H * (V ? 0.2 : 0.23),
    size = (V ? 76 : 100) * S,
    max = W - (V ? 150 : 220) * S;
  function title(text, start, end) {
    const enter = r(start, 0.6),
      exit = r(end, 0.45);
    if (enter <= 0 || exit >= 1) return;
    c.save();
    c.beginPath();
    c.rect(60 * S, headerY - 80 * S, W - 120 * S, 160 * S);
    c.clip();
    M.text(
      c,
      text,
      cx + exit * 110 * S,
      headerY + (1 - enter) * 120 * S,
      size,
      ink,
      800,
      "center",
      max,
    );
    c.restore();
  }
  title(p.problem, -0.5, 3);
  title(p.send, 3.05, 6);
  title(p.result, 6.1, 10);
  title(p.network, 10.1, 14);
  if (t < 3.2) {
    c.globalAlpha = 1 - r(2.8, 0.4);
    M.text(
      c,
      p.problemNote,
      cx,
      headerY + 100 * S,
      29 * S,
      dim,
      400,
      "center",
      max,
    );
    c.globalAlpha = 1;
  }
  // The system collapses into one mark, then resolves into a large moving wordmark.
  if (resolution > 0) {
    const mark = (1 - r(15, 0.55)) * resolution;
    c.globalAlpha = mark;
    const rr = (48 + resolution * 14) * S;
    c.fillStyle = green;
    c.beginPath();
    c.arc(cx, cy, rr, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    const brand = r(14.7, 0.9),
      drift = 1 + (t - 15.6) * 0.015;
    c.save();
    c.translate(cx, H * (V ? 0.46 : 0.49));
    c.scale(drift, drift);
    c.globalAlpha = brand;
    M.text(
      c,
      p.brand,
      0,
      (1 - brand) * 130 * S,
      (V ? 170 : 230) * S,
      ink,
      900,
      "center",
      W - 130 * S,
    );
    c.restore();
    c.globalAlpha = r(15.15, 0.6);
    M.text(
      c,
      p.promise,
      cx,
      H * (V ? 0.61 : 0.66),
      44 * S,
      green,
      700,
      "center",
      W - 150 * S,
    );
    c.globalAlpha = r(15.8, 0.6);
    M.text(
      c,
      p.cta,
      cx,
      H * (V ? 0.71 : 0.79),
      25 * S,
      dim,
      500,
      "center",
      W - 150 * S,
      true,
    );
    c.globalAlpha = 1;
  }
  const edge = V ? 74 * S : 80 * S;
  M.text(
    c,
    String(
      Math.min(film.shots.length, film.shots.findIndex((s) => t < s.end) + 1),
    ).padStart(2, "0"),
    edge,
    60 * S,
    22 * S,
    green,
    600,
    "left",
    100 * S,
    true,
  );
  M.text(
    c,
    p.note,
    cx,
    H - (V ? 160 : 55) * S,
    18 * S,
    dim,
    400,
    "center",
    W - 150 * S,
  );
  // Small motion-linked beat marks; the sound and picture share the same clock.
  for (let i = 0; i < Math.ceil((film.duration * film.bpm) / 60); i++) {
    const x =
        edge +
        (i * (W - 2 * edge)) / Math.ceil((film.duration * film.bpm) / 60),
      active = M.beat(t) >= i;
    M.line(
      c,
      x,
      H - 30 * S,
      x,
      H - (active ? 42 : 35) * S,
      active ? green : "#cfd4cf",
      3 * S,
    );
  }
};

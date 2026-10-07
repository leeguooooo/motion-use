// A typographic world becomes a message, a wake pulse, a network, then a wordmark.
window.drawFrame = function (c, t, film, view, M) {
  t *= 12 / film.duration; // retimed picture and narration share the authored timeline
  const W = view.width,
    H = view.height,
    V = view.vertical,
    U = Math.min(W, H) / 1080,
    p = film.copy;
  const paper = "#f3f0e8",
    ink = "#142c27",
    green = "#00745c",
    coral = "#ed795d",
    muted = "#63736b";
  const cx = W / 2,
    cy = H / 2,
    r = (s, d) => M.ramp(t, s, d),
    mix = M.mix;
  const text = (
    v,
    x,
    y,
    size,
    color = ink,
    weight = 850,
    max = W - 150 * U,
    mono = false,
  ) => M.text(c, v, x, y, size * U, color, weight, "center", max, mono);
  const dot = (x, y, rad, color) => {
    if (rad <= 0) return;
    c.fillStyle = color;
    c.beginPath();
    c.arc(x, y, rad, 0, Math.PI * 2);
    c.fill();
  };
  c.fillStyle = paper;
  c.fillRect(0, 0, W, H);
  const compress = r(1.8, 0.75),
    send = r(3.6, 1.65),
    wake = r(5.4, 1.2),
    pull = r(7.2, 0.8),
    resolve = r(9.6, 0.7);
  if (t < 2.7) {
    const slabH = mix(H * 0.43, 52 * U, compress),
      slabW = mix(W, 52 * U, compress),
      spread = (V ? 240 : 590) * U;
    const topX = mix(cx, cx - spread, compress),
      topY = mix(H * 0.24, cy, compress),
      botX = mix(cx, cx + spread, compress),
      botY = mix(H * 0.76, cy, compress);
    M.round(
      c,
      topX - slabW / 2,
      topY - slabH / 2,
      slabW,
      slabH,
      compress * 26 * U,
      ink,
    );
    M.round(
      c,
      botX - slabW / 2,
      botY - slabH / 2,
      slabW,
      slabH,
      compress * 26 * U,
      coral,
    );
    c.globalAlpha = 1 - r(1.8, 0.3);
    text(
      p.a.toUpperCase(),
      cx + (1 - r(0, 0.7)) * (V ? 25 : 80) * U - t * 12 * U,
      H * 0.23,
      V ? 130 : 205,
      paper,
      900,
      W - 160 * U,
    );
    text(
      p.b.toUpperCase(),
      cx - (1 - r(0.15, 0.7)) * (V ? 25 : 75) * U + t * 12 * U,
      H * 0.75,
      V ? 180 : 265,
      ink,
      900,
      W - 160 * U,
    );
    c.globalAlpha = 1;
    if (t < 1.9) {
      const a = r(0.4, 0.5);
      c.save();
      c.beginPath();
      c.rect(0, cy - 60 * U, W, 120 * U);
      c.clip();
      text(
        p.gap,
        cx,
        cy + (1 - a) * 110 * U,
        V ? 49 : 60,
        ink,
        750,
        W - 150 * U,
      );
      c.restore();
    }
  }
  const ax = cx - (V ? 240 : 590) * U,
    bx = cx + (V ? 240 : 590) * U,
    packetX = mix(cx, bx, send),
    packetY = cy - Math.sin(send * Math.PI) * 90 * U;
  if (t >= 1.8 && t < 6.6) {
    const enter = r(1.8, 0.6),
      opened = r(2, 0.65) * (1 - r(3.9, 1.15)),
      w = mix(52 * U, (V ? 730 : 1120) * U, opened),
      h = mix(52 * U, (V ? 170 : 220) * U, opened);
    M.line(c, ax, cy, mix(ax, bx, r(2.15, 1)), cy, green + "65", 4 * U);
    dot(ax, cy, 26 * U, ink);
    dot(bx, cy, 26 * U, coral);
    for (let i = 4; i > 0; i--) {
      c.globalAlpha = 0.07 * Math.sin(send * Math.PI);
      M.round(
        c,
        packetX - w / 2 - i * 35 * U,
        packetY - h / 2,
        w,
        h,
        h / 2,
        green,
      );
    }
    c.globalAlpha = enter;
    M.round(c, packetX - w / 2, packetY - h / 2, w, h, h / 2, green);
    c.globalAlpha = opened;
    const typing = p.message.slice(0, Math.ceil(Math.max(0, t - 2.1) * 17));
    text(typing, packetX, packetY, V ? 49 : 65, paper, 650, w - 80 * U);
    c.globalAlpha = 1;
    const cmd = p.command.slice(0, Math.ceil(Math.max(0, t - 2.2) * 18));
    c.globalAlpha = enter * (1 - r(3.6, 0.35));
    text(cmd, cx, cy + 190 * U, V ? 28 : 36, green, 500, W - 140 * U, true);
    c.globalAlpha = 1;
    c.globalAlpha = r(2.7, 0.5) * (1 - r(4.6, 0.5));
    text(
      p.a,
      ax,
      cy - (V ? 175 : 230) * U,
      V ? 33 : 45,
      ink,
      650,
      V ? 330 * U : 600 * U,
    );
    text(
      p.b,
      bx,
      cy + (V ? 175 : 230) * U,
      V ? 35 : 50,
      coral,
      650,
      V ? 330 * U : 600 * U,
    );
    c.globalAlpha = 1;
  }
  if (t >= 5.4 && t < 7.95) {
    const radius = mix(26 * U, Math.hypot(W, H), (1 - pull) * wake);
    dot(mix(bx, cx, pull), cy, radius, green);
    if (pull < 0.5) {
      const entry = M.spring(t, 5.7, 9, 6),
        exit = r(7.2, 0.45);
      c.save();
      c.beginPath();
      c.rect(0, cy - 240 * U, W, 500 * U);
      c.clip();
      c.globalAlpha = 1 - exit;
      text(
        p.wake,
        cx,
        cy + (1 - entry) * 220 * U,
        V ? 180 : 270,
        paper,
        900,
        W - 140 * U,
      );
      c.restore();
      c.globalAlpha = 1;
      c.globalAlpha = r(6.1, 0.45) * (1 - exit);
      text(p.b, cx, cy + 220 * U, V ? 43 : 55, "#c6eddb", 600);
      c.globalAlpha = 1;
      for (let i = 0; i < 3; i++) {
        const a = M.clamp((t - 5.8 - i * 0.17) / 1.45);
        if (a > 0 && a < 1) {
          c.globalAlpha = (1 - a) * 0.32;
          c.strokeStyle = paper;
          c.lineWidth = 3 * U;
          c.beginPath();
          c.arc(cx, cy, (190 + a * 680) * U, 0, Math.PI * 2);
          c.stroke();
        }
      }
      c.globalAlpha = 1;
    }
  }
  if (t >= 7.2 && t < 10.7) {
    const show = r(7.35, 0.55),
      collapse = 1 - resolve,
      rotation = (t - 7.2) * 0.17,
      rx = (V ? 255 : 540) * U * collapse,
      ry = (V ? 300 : 160) * U * collapse;
    const labels = [p.a, p.c, p.b, p.d],
      colors = [ink, green, coral, green];
    c.save();
    c.translate(cx, cy);
    const scale = 1 + (t - 8) * 0.07;
    c.scale(scale, scale);
    c.globalAlpha = show;
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + rotation,
        x = Math.cos(angle) * rx,
        y = Math.sin(angle) * ry;
      M.line(c, 0, 0, x, y, green + "70", 4 * U);
      dot(x, y, 33 * U, colors[i]);
      c.globalAlpha = show * collapse;
      text(
        labels[i],
        x,
        y + (Math.sin(angle) < -0.5 ? -75 : 75) * U,
        V ? 31 : 42,
        colors[i],
        650,
        V ? 300 * U : 540 * U,
      );
      c.globalAlpha = show;
      const travel = ((t - 7.2) * 1.15 + i * 0.2) % 1;
      dot(x * travel, y * travel, 11 * U, colors[i]);
    }
    M.round(
      c,
      -78 * U * collapse,
      -78 * U * collapse,
      156 * U * collapse,
      156 * U * collapse,
      45 * U * collapse,
      green,
    );
    c.globalAlpha = show * collapse;
    text("ocs", 0, 0, 58, paper, 850, 132 * U);
    c.restore();
    c.globalAlpha = 1;
    c.globalAlpha = show * (1 - r(9.6, 0.4));
    text(p.together, cx, H * 0.16, V ? 75 : 95, ink, 800, W - 160 * U);
    c.globalAlpha = 1;
  }
  if (t >= 9.6) {
    const word = r(9.8, 0.65),
      zoom = mix(1.8, 1.05, word) - (t - 10.45) * 0.085;
    c.save();
    c.beginPath();
    c.rect(0, H * 0.15, W, H * 0.58);
    c.clip();
    c.translate(cx, H * (V ? 0.42 : 0.44));
    c.scale(zoom, zoom);
    c.globalAlpha = word;
    text(
      p.brand,
      0,
      (1 - word) * 180 * U,
      V ? 305 : 420,
      ink,
      900,
      W - 120 * U,
    );
    c.restore();
    c.globalAlpha = 1;
    c.globalAlpha = r(10.45, 0.55);
    text(
      p.promise,
      cx,
      H * (V ? 0.64 : 0.71),
      V ? 38 : 48,
      green,
      700,
      W - 140 * U,
    );
    c.globalAlpha = r(10.9, 0.45);
    text(
      p.cta,
      cx,
      H * (V ? 0.75 : 0.86),
      V ? 32 : 25,
      muted,
      500,
      W - 145 * U,
      true,
    );
    c.globalAlpha = 1;
  }
  if (t >= 1.8) {
    c.globalAlpha = r(1.8, 0.4);
    text(
      "OPEN CROSS-SESSION",
      cx,
      58 * U,
      20,
      t >= 5.8 && t < 7.2 ? paper : green,
      500,
      W - 140 * U,
      true,
    );
    c.globalAlpha = 1;
  }
  if (t >= 1.8)
    text(
      p.note,
      cx,
      H - (V ? 330 : 36) * U,
      V ? 26 : 18,
      t >= 5.8 && t < 7.2 ? "#c6eddb" : muted,
      400,
      W - 140 * U,
    );
};

// Browser-only adapter: exact time in, exact picture out. No free-running animation loop.
(() => {
  const film = JSON.parse(document.getElementById("film-config").textContent);
  const canvas = document.getElementById("film-canvas"),
    ctx = canvas.getContext("2d");
  const view = {
    width: canvas.width,
    height: canvas.height,
    vertical: canvas.height > canvas.width,
    format: film.format,
  };
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const ease = (x) => {
    const t = clamp(x);
    return t * t * (3 - 2 * t);
  };
  const motion = {
    clamp,
    ease,
    mix: (a, b, p) => a + (b - a) * p,
    progress: (time, start, duration) => clamp((time - start) / duration),
    ramp: (time, start, duration) => ease((time - start) / duration),
    spring: (time, start, speed = 12, damping = 8) => {
      const t = Math.max(0, time - start);
      return 1 - Math.exp(-damping * t) * Math.cos(speed * t);
    },
    hash: (n) => {
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    },
    beat: (time) => (time * film.bpm) / 60,
    round(c, x, y, w, h, r, fill, stroke) {
      c.beginPath();
      c.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
      if (fill) {
        c.fillStyle = fill;
        c.fill();
      }
      if (stroke) {
        c.strokeStyle = stroke;
        c.stroke();
      }
    },
    text(
      c,
      text,
      x,
      y,
      size,
      color = "#151515",
      weight = 700,
      align = "left",
      maxWidth = Infinity,
      mono = false,
    ) {
      const family = mono ? '"Film Mono", "Film Sans"' : '"Film Sans"';
      c.font = `${weight} ${size}px ${family}`;
      if (c.measureText(text).width > maxWidth) {
        size *= maxWidth / c.measureText(text).width;
        c.font = `${weight} ${size}px ${family}`;
      }
      c.fillStyle = color;
      c.textAlign = align;
      c.textBaseline = "middle";
      c.fillText(text, x, y);
      return size;
    },
    line(c, x1, y1, x2, y2, color, width = 3) {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      c.stroke();
    },
  };
  const layer = document.createElement("canvas");
  layer.width = canvas.width;
  layer.height = canvas.height;
  const scratch = layer.getContext("2d");
  let ready = false,
    requested = 0;
  function renderAt(time) {
    requested = Math.max(0, Math.min(film.duration, Number(time) || 0));
    if (!ready) return;
    const { samples, shutter } = film.motionBlur;
    ctx.resetTransform();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < samples; i++) {
      const at = Math.max(
        0,
        requested - (((samples - i - 0.5) / samples) * shutter) / film.fps,
      );
      scratch.resetTransform();
      scratch.clearRect(0, 0, layer.width, layer.height);
      scratch.save();
      window.drawFrame(scratch, at, film, view, motion);
      scratch.restore();
      // Running average in premultiplied alpha; every drawFrame must paint an opaque background.
      ctx.globalAlpha = 1 / (i + 1);
      ctx.drawImage(layer, 0, 0);
    }
    ctx.globalAlpha = 1;
  }
  window.addEventListener("hf-seek", (event) => {
    try {
      renderAt(event.detail.time);
    } catch (error) {
      // Surface a failed pose to the renderer instead of encoding the last good frame.
      if (event.detail.waitUntil) event.detail.waitUntil(Promise.reject(error));
      else throw error;
    }
  });
  window.__hf = window.__hf || {};
  window.__hf.buildReady = window.__hf.buildReady || {};
  window.__hf.buildReady["motion-use-film"] = (async () => {
    await Promise.all([
      document.fonts.load('700 80px "Film Sans"'),
      document.fonts.load('500 30px "Film Mono"'),
    ]);
    if (!document.fonts.check('700 80px "Film Sans"'))
      throw new Error("Film Sans did not load");
    if (typeof window.drawFrame !== "function")
      throw new Error("composition must define window.drawFrame");
    window.filmAssets = {};
    await Promise.all(
      Object.entries(film.assets).map(async ([key, src]) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        window.filmAssets[key] = image;
      }),
    );
    // Optional setup: a local library can prepare a renderer or geometry once.
    // A WebGL author can draw its offscreen renderer into ctx on each drawFrame.
    if (typeof window.setupFilm === "function")
      await window.setupFilm(film, view, motion);
    ready = true;
    renderAt(requested);
  })();
})();

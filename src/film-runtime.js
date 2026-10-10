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
  // The drawing kit only adds names; the original helpers above keep their exact behavior.
  if (typeof window.__filmKit === "function")
    for (const [key, value] of Object.entries(window.__filmKit(view, film)))
      if (!Object.hasOwn(motion, key)) motion[key] = value;
  // Footage frames were extracted at build time; each sample time maps to one JPEG.
  const frameCache = new Map();
  const frameSrc = (v, time) => {
    const k = Math.floor((time - v.at) * v.fps + 1e-6);
    if (k < 0 || time >= v.at + v.length) return null;
    return `${v.dir}/${String(Math.min(k, v.frames - 1)).padStart(5, "0")}.jpg`;
  };
  motion.video = (name, time) => {
    const v = film.videos?.[name];
    if (!v) throw new Error(`video "${name}" is not declared under film.json videos`);
    const src = frameSrc(v, time);
    return src ? (frameCache.get(src) ?? null) : null;
  };
  const sampleTimes = (time) => {
    const { samples, shutter } = film.motionBlur;
    return Array.from({ length: samples }, (_, i) =>
      Math.max(0, time - (((samples - i - 0.5) / samples) * shutter) / film.fps),
    );
  };
  const missingFrames = (time) => {
    const at = Math.max(0, Math.min(film.duration, (Number(time) || 0) + (film.offset || 0)));
    const srcs = new Set();
    for (const v of Object.values(film.videos ?? {}))
      for (const s of sampleTimes(at)) {
        const src = frameSrc(v, s);
        if (src && !frameCache.has(src)) srcs.add(src);
      }
    return [...srcs];
  };
  const loadFrames = (srcs) =>
    Promise.all(
      srcs.map(async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        frameCache.set(src, image);
        // Keep a small window: workers seek forward, and blur needs only neighbours.
        if (frameCache.size > 24) frameCache.delete(frameCache.keys().next().value);
      }),
    );
  const layer = document.createElement("canvas");
  layer.width = canvas.width;
  layer.height = canvas.height;
  const scratch = layer.getContext("2d");
  let ready = false,
    requested = 0;
  function renderAt(time) {
    // A range preview renders a window of the film: page time 0 is film time `offset`.
    requested = Math.max(
      0,
      Math.min(film.duration, (Number(time) || 0) + (film.offset || 0)),
    );
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
    const need = ready ? missingFrames(event.detail.time) : [];
    if (need.length) {
      const done = loadFrames(need).then(() => renderAt(event.detail.time));
      if (event.detail.waitUntil) event.detail.waitUntil(done);
      return;
    }
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
    await loadFrames(missingFrames(requested - (film.offset || 0)));
    renderAt(requested - (film.offset || 0));
  })();
})();

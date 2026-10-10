// Text check: find drawn text that runs off the frame (or, in portrait, out of the platform-safe
// area) for long enough to be read as clipped. The iphone-use promo shipped a landscape cut whose
// "Scan to connect" callout lost the end of its second line for five seconds (2026-10); only a
// reviewer looking at full-size frames saw it. This measures every fillText/strokeText instead.
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { runHyperframes } from "./hf.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

/**
 * Group per-sample overflows into runs. A run is the same string over the edge on consecutive
 * samples for at least `minRun` seconds; a whip that carries text through an edge for a frame or
 * two is not a run. Text entirely outside the picture is parked, not clipped, and is ignored.
 * samples: [{ t, boxes: [{ text, x0, y0, x1, y1 }] }], sorted by t.
 */
export function overflowRuns(samples, { width, height, safe = null, vertical = false, step = 0.1, minRun = 0.3 } = {}) {
  const margin = Math.max(2, width * 0.002),
    safeMargin = width * 0.01;
  const offenders = (b) => {
    const out = [];
    const visible = b.x1 > 0 && b.x0 < width && b.y1 > 0 && b.y0 < height;
    if (!visible) return out;
    const sides = [];
    if (b.x0 < -margin) sides.push(["left", -b.x0]);
    if (b.x1 > width + margin) sides.push(["right", b.x1 - width]);
    if (b.y0 < -margin) sides.push(["top", -b.y0]);
    if (b.y1 > height + margin) sides.push(["bottom", b.y1 - height]);
    if (sides.length) out.push({ kind: "frame", sides });
    else if (vertical && safe) {
      const s = [];
      if (b.x0 < safe.x - safeMargin) s.push(["left", safe.x - b.x0]);
      if (b.x1 > safe.x + safe.w + safeMargin) s.push(["right", b.x1 - safe.x - safe.w]);
      if (b.y0 < safe.y - safeMargin) s.push(["top", safe.y - b.y0]);
      if (b.y1 > safe.y + safe.h + safeMargin) s.push(["bottom", b.y1 - safe.y - safe.h]);
      if (s.length) out.push({ kind: "safe", sides: s });
    }
    return out;
  };
  const open = new Map(),
    runs = [];
  const close = (key) => {
    const r = open.get(key);
    open.delete(key);
    if (r.to - r.from + step >= minRun - 1e-6)
      runs.push({ ...r, from: +r.from.toFixed(2), to: +r.to.toFixed(2), overflow_px: Math.round(r.overflow_px), sides: [...r.sides] });
  };
  for (const s of samples) {
    const seen = new Set();
    for (const b of s.boxes)
      for (const o of offenders(b)) {
        const key = `${o.kind}\u0000${b.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const px = Math.max(...o.sides.map((x) => x[1]));
        const r = open.get(key);
        if (r && s.t - r.to <= step * 1.5) {
          r.to = s.t;
          r.overflow_px = Math.max(r.overflow_px, px);
          o.sides.forEach((x) => r.sides.add(x[0]));
        } else {
          if (r) close(key);
          open.set(key, { kind: o.kind, text: b.text, from: s.t, to: s.t, overflow_px: px, sides: new Set(o.sides.map((x) => x[0])) });
        }
      }
    for (const key of [...open.keys()]) if (!seen.has(key)) close(key);
  }
  for (const key of [...open.keys()]) close(key);
  return runs.sort((a, b) => a.from - b.from);
}

function serve(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) && file !== root) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function browser() {
  // puppeteer-core ships with the pinned engine; resolve it from there.
  const require = createRequire(createRequire(import.meta.url).resolve("hyperframes/package.json"));
  const puppeteer = require("puppeteer-core");
  const r = await runHyperframes(["browser", "path"], {});
  const executablePath = r.out.trim().split("\n").pop();
  if (r.code !== 0 || !executablePath || !fs.existsSync(executablePath))
    throw new Error("no Chrome found (motion-use doctor --install-browser)");
  return puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"] });
}

/**
 * Draw a built film project at every `step` seconds and return the text runs that leave the
 * frame (all formats) or the safe area (portrait). Returns { runs, samples } or { skipped }.
 */
export async function probeText(projDir, duration, { step = 0.1, minRun = 0.3 } = {}) {
  const times = [];
  for (let t = 0; t < duration - 1e-6; t += step) times.push(+t.toFixed(3));
  let server, b;
  try {
    server = await serve(projDir);
    b = await browser();
    const page = await b.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => typeof window.__motionUseTextProbe === "function", { timeout: 30000 });
    const all = [];
    let meta = null;
    for (let i = 0; i < times.length; i += 100) {
      const r = await page.evaluate((ts) => window.__motionUseTextProbe(ts), times.slice(i, i + 100));
      meta = r;
      all.push(...r.samples);
    }
    if (!meta) return { runs: [], samples: 0 };
    return {
      samples: all.length,
      step,
      runs: overflowRuns(all, { width: meta.width, height: meta.height, safe: meta.safe, vertical: meta.vertical, step, minRun }),
      page_errors: errors.slice(0, 5),
    };
  } catch (e) {
    return { skipped: `text check did not run: ${e.message.split("\n")[0]}` };
  } finally {
    await b?.close().catch(() => {});
    server?.close();
  }
}

/** Terminal lines for the runs a reviewer must look at. */
export function describeText(check) {
  if (!check) return [];
  if (check.skipped) return [check.skipped];
  return check.runs.map(
    (r) =>
      `text ${r.kind === "frame" ? "runs off the frame" : "leaves the portrait safe area"} (${r.sides.join("/")}, ${r.overflow_px}px) ${r.from}–${r.to}s: "${r.text.length > 60 ? r.text.slice(0, 57) + "…" : r.text}"`,
  );
}

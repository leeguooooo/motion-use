// motion-use capture: record a web page (canvas, WebGL, CSS animation) and its WebAudio output
// as a video and a WAV that share one clock. The page never runs in real time: an init script
// replaces requestAnimationFrame, timers, performance.now and Date with a virtual clock, and every
// AudioContext the page makes is an OfflineAudioContext rendered up to the same instant before the
// page's code at that instant runs. Each frame is then a screenshot. No screen, sound card or
// foreground window is involved, and dropped frames cannot happen.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claimDir } from "./build.mjs";
import { browser } from "./text-probe.mjs";

export const CAPTURE_DEFAULTS = Object.freeze({ fps: 30, width: 1920, height: 1080, sampleRate: 48000 });
/** WebAudio renders in quanta of 128 sample frames; offline suspension happens on their edges. */
export const RENDER_QUANTUM = 128;
const EPOCH = Date.UTC(2026, 0, 1); // Date.now() at virtual second 0: fixed, so every run draws the same
const MAX_CALLBACKS = 100000;

/** "a", "a@1.5", "ArrowRight@3": a key pressed at a virtual second (default 0, right after load). */
export function parsePresses(list = []) {
  return list.map((s) => {
    const m = /^(.+?)(?:@(\d+(?:\.\d+)?))?$/.exec(String(s));
    const key = m?.[1];
    if (!key || !(key.length === 1 || /^[A-Za-z][A-Za-z0-9]*$/.test(key)))
      throw new Error("--press takes a key and an optional second, like a, a@1.5 or ArrowRight@3");
    return { key, at: m[2] === undefined ? 0 : Number(m[2]) };
  });
}

/** Presses of one key every `every` seconds from `every` up to (not including) the end. */
export function pageKeyTimes(key, every, duration) {
  if (!(every > 0)) throw new Error("--page-every takes seconds above 0, like 8");
  const out = [];
  for (let i = 1; i * every < duration - 1e-9; i++) out.push({ key, at: +(i * every).toFixed(6) });
  return out;
}

/** Where to load from: an http(s) URL as given, or a local HTML file / folder served over loopback. */
export function resolveTarget(target) {
  if (!target) throw new Error("capture needs a page: capture <url|file.html> --out <dir> --duration <s>");
  if (/^https?:\/\//i.test(target)) return { url: target };
  const file = path.resolve(/^file:/i.test(target) ? fileURLToPath(target) : target);
  if (!fs.existsSync(file)) throw new Error(target + " not found");
  const html = fs.statSync(file).isDirectory() ? path.join(file, "index.html") : file;
  if (!fs.existsSync(html)) throw new Error(file + " has no index.html");
  return { root: path.dirname(html), page: path.basename(html), file: html };
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "video/webm",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".hdr": "application/octet-stream", ".ktx2": "image/ktx2",
};

function serve(root) {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html"; } catch { return res.writeHead(400).end(); }
    const file = path.resolve(base, rel);
    if (!file.startsWith(base + path.sep) && file !== base) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/**
 * The init script, run in every document before the page's own scripts. Exposes
 * window.__motionUseCapture: advance(ms), finish(), chunk(i, ch, start, n), errors.
 */
export function clockScript({ duration, sampleRate = CAPTURE_DEFAULTS.sampleRate }) {
  const cfg = JSON.stringify({ duration, sampleRate, epoch: EPOCH, quantum: RENDER_QUANTUM, max: MAX_CALLBACKS });
  return "(" + installClock.toString() + ")(" + cfg + ");";
}

// Runs inside the page (serialized by clockScript); keep it self-contained.
function installClock(CFG) {
  if (window.__motionUseCapture) return;
  let now = 0; // virtual milliseconds since the document started
  const errors = [];
  const report = (e) => { if (errors.length < 20) errors.push(String(e && e.stack || e).slice(0, 500)); };

  // Clock: performance.now and Date.
  Object.defineProperty(performance, "now", { value: () => now, configurable: true, writable: true });
  const RealDate = Date;
  function VirtualDate(...a) {
    if (!new.target) return new RealDate(CFG.epoch + now).toString();
    return a.length ? new RealDate(...a) : new RealDate(CFG.epoch + now);
  }
  VirtualDate.prototype = RealDate.prototype;
  VirtualDate.now = () => CFG.epoch + now;
  VirtualDate.parse = RealDate.parse;
  VirtualDate.UTC = RealDate.UTC;
  window.Date = VirtualDate;

  // Timers: fire only when the driver advances the clock, in due order (ties: creation order).
  const timers = new Map();
  let seq = 1, order = 0, level = 0;
  const add = (fn, ms, args, repeat) => {
    const delay = Math.max(Number(ms) || 0, level >= 5 ? 4 : 0, repeat ? 1 : 0);
    const id = seq++;
    timers.set(id, { fn, args, due: now + delay, interval: repeat ? delay : null, order: order++, level: level + 1 });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };

  const rafs = new Map();
  let rafSeq = 1;
  window.requestAnimationFrame = (fn) => { const id = rafSeq++; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };

  // CSS animations and transitions, Web Animations: held paused and seeked to the clock.
  // An animation counts as started at the virtual instant it is first seen (looked for after every
  // timer, key press and animation frame), whatever real time passed before.
  const anims = new Map();
  const discover = () => {
    if (!document.getAnimations) return;
    for (const a of document.getAnimations()) {
      if (anims.has(a)) continue;
      anims.set(a, now);
      try { a.pause(); a.currentTime = 0; } catch (e) { report(e); }
    }
  };
  const syncAnimations = () => {
    discover();
    for (const [a, start] of anims) {
      if (!a.effect || (a.effect.target && !a.effect.target.isConnected)) { anims.delete(a); continue; }
      try { a.currentTime = (now - start) * (a.playbackRate || 1); } catch (e) { report(e); }
    }
  };

  // WebAudio: every AudioContext is an OfflineAudioContext started at the virtual instant it was made.
  const OAC = window.OfflineAudioContext;
  const contexts = [];
  const SR = CFG.sampleRate, Q = CFG.quantum;
  const real = OAC && { suspend: OAC.prototype.suspend, resume: OAC.prototype.resume, start: OAC.prototype.startRendering };
  if (OAC) {
    const VirtualAudioContext = function AudioContext(options) {
      if (!new.target) throw new TypeError("Failed to construct 'AudioContext': Please use the 'new' operator");
      const born = now / 1000;
      const length = Math.max(Q, Math.ceil(Math.max(0, CFG.duration - born) * SR) + Q);
      const ctx = new OAC({ numberOfChannels: 2, length, sampleRate: SR });
      const rec = { ctx, born, length, at: 0, started: false, done: null, closedAt: null, requestedRate: options && options.sampleRate || null, buffer: null };
      contexts.push(rec);
      Object.defineProperties(ctx, {
        resume: { value: () => Promise.resolve(), configurable: true },
        suspend: { value: () => Promise.resolve(), configurable: true },
        close: { value: () => { if (rec.closedAt === null) rec.closedAt = now / 1000; return Promise.resolve(); }, configurable: true },
        state: { get: () => (rec.closedAt === null ? "running" : "closed"), configurable: true },
        baseLatency: { value: 0, configurable: true },
        outputLatency: { value: 0, configurable: true },
        getOutputTimestamp: { value: () => ({ contextTime: ctx.currentTime, performanceTime: now }), configurable: true },
        startRendering: { value: undefined, configurable: true },
      });
      return ctx;
    };
    VirtualAudioContext.prototype = OAC.prototype;
    window.AudioContext = VirtualAudioContext;
    window.webkitAudioContext = VirtualAudioContext;
  }
  // Render every context up to virtual ms (to the render quantum at or before it).
  const audioTo = async (ms) => {
    for (const r of contexts) {
      const frame = Math.floor(((ms / 1000 - r.born) * SR) / Q) * Q;
      if (frame <= r.at || frame >= r.length) continue;
      try {
        const paused = real.suspend.call(r.ctx, (frame + 0.5) / SR);
        if (!r.started) { r.started = true; r.done = real.start.call(r.ctx); }
        else real.resume.call(r.ctx);
        await paused;
      } catch (e) { report(e); }
      r.at = frame;
    }
    await Promise.resolve();
  };

  const advance = async (to) => {
    discover();
    let fired = 0;
    for (;;) {
      let next = null;
      for (const t of timers.entries()) {
        if (t[1].due > to) continue;
        if (!next || t[1].due < next[1].due || (t[1].due === next[1].due && t[1].order < next[1].order)) next = t;
      }
      if (!next) break;
      const [id, t] = next;
      if (++fired > CFG.max) throw new Error("the page keeps scheduling timers without letting time pass (" + CFG.max + " callbacks before " + to + " ms)");
      await audioTo(t.due);
      now = Math.max(now, t.due);
      if (t.interval === null) timers.delete(id);
      else { t.due += t.interval; t.order = order++; }
      level = t.level;
      try { typeof t.fn === "function" ? t.fn(...t.args) : (0, eval)(String(t.fn)); } catch (e) { report(e); }
      level = 0;
      discover();
    }
    await audioTo(to);
    now = Math.max(now, to);
    syncAnimations();
    const due = [...rafs.values()];
    rafs.clear();
    for (const fn of due) { try { fn(now); } catch (e) { report(e); } }
    await Promise.resolve();
    discover();
    return { now, contexts: contexts.length, timers: timers.size, frames: due.length };
  };

  const finish = async () => {
    for (const r of contexts) {
      if (!r.started) { r.started = true; r.done = real.start.call(r.ctx); }
      else real.resume.call(r.ctx);
      r.buffer = await r.done;
    }
    return contexts.map((r) => ({ born: r.born, length: r.buffer.length, channels: r.buffer.numberOfChannels, closedAt: r.closedAt, requestedRate: r.requestedRate }));
  };
  const chunk = (i, ch, start, n) => {
    const d = contexts[i].buffer.getChannelData(ch).subarray(start, start + n);
    const u8 = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    let s = "";
    for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
    return btoa(s);
  };
  window.addEventListener("error", (e) => report(e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => report(e.reason));
  Object.defineProperty(window, "__motionUseCapture", { value: Object.freeze({ advance, finish, chunk, errors, hasAudio: Boolean(OAC) }) });
}

/** Sum the contexts' buffers into one stereo track of `total` frames, each at its start. */
export function mixContexts(recs, total, sampleRate) {
  const out = [new Float32Array(total), new Float32Array(total)];
  for (const r of recs) {
    const at = Math.round(r.born * sampleRate);
    const stop = r.closedAt === null || r.closedAt === undefined ? total : Math.min(total, Math.round(r.closedAt * sampleRate));
    for (let ch = 0; ch < 2; ch++) {
      const src = r.data[Math.min(ch, r.data.length - 1)];
      const dst = out[ch];
      for (let i = 0; i < src.length && at + i < stop; i++) dst[at + i] += src[i];
    }
  }
  return out;
}

/** Peak/RMS in dBFS, first audible second (above -50 dBFS), clipped samples. */
export function audioStats(channels, sampleRate) {
  let peak = 0, sum = 0, n = 0, first = null, clipped = 0;
  const gate = 10 ** (-50 / 20);
  const len = channels[0].length;
  for (let i = 0; i < len; i++) {
    for (const c of channels) {
      const a = Math.abs(c[i]);
      if (a > peak) peak = a;
      if (a >= 1) clipped++;
      sum += c[i] * c[i]; n++;
      if (first === null && a > gate) first = i / sampleRate;
    }
  }
  const db = (x) => (x > 0 ? +(20 * Math.log10(x)).toFixed(2) : null);
  return { peak_db: db(peak), rms_db: db(Math.sqrt(sum / Math.max(1, n))), first_sound_s: first === null ? null : +first.toFixed(4), clipped_samples: clipped, silent: first === null };
}

/** 16-bit PCM WAV of float channels (clamped to ±1). */
export function wavBuffer(channels, sampleRate) {
  const ch = channels.length, len = channels[0].length;
  const buf = Buffer.alloc(44 + len * ch * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + len * ch * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(len * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, channels[c][i]));
    buf.writeInt16LE(Math.round(v < 0 ? v * 32768 : v * 32767), o); o += 2;
  }
  return buf;
}

function probe(file) {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_packets", "-show_entries", "stream=codec_type,nb_read_packets,duration,width,height,r_frame_rate,sample_rate", "-of", "json", file], { encoding: "utf8" }));
  const v = j.streams.find((s) => s.codec_type === "video"), a = j.streams.find((s) => s.codec_type === "audio");
  return {
    frames: v ? Number(v.nb_read_packets) : 0, video_s: v ? Number(v.duration) : null, width: v?.width, height: v?.height,
    audio_s: a ? Number(a.duration) : null, sample_rate: a ? Number(a.sample_rate) : null,
  };
}

function ffmpegRun(args) {
  try { execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] }); }
  catch (e) { throw new Error(e.code === "ENOENT" ? "ffmpeg not found (motion-use doctor)" : "ffmpeg: " + String(e.stderr || e.message).trim()); }
}

export const LIMITS = [
  "<video>/<audio> elements and createMediaElementSource / MediaStream nodes do not follow the virtual clock and are not recorded",
  "network loads, fetch(), workers and decodeAudioData finish in real time: wait for them with --wait before second 0",
  "only the top document's clock is driven; iframes do not advance",
  "every AudioContext runs at 48 kHz stereo whatever sampleRate the page asks for",
];

/**
 * Record `target` for `duration` virtual seconds into outDir: capture.mp4 (H.264 + AAC),
 * audio.wav (48 kHz 16-bit) and capture.json. Returns the report.
 */
export async function capturePage(target, outDir, opts = {}) {
  const fps = opts.fps ?? CAPTURE_DEFAULTS.fps, width = opts.width ?? CAPTURE_DEFAULTS.width, height = opts.height ?? CAPTURE_DEFAULTS.height;
  const sr = CAPTURE_DEFAULTS.sampleRate, duration = opts.duration;
  if (!(duration > 0)) throw new Error("--duration takes seconds above 0, like 30");
  const total = Math.round(duration * fps);
  const presses = [...(opts.presses ?? [])].filter((p) => p.at < duration).sort((a, b) => a.at - b.at);
  const src = resolveTarget(target);
  claimDir(outDir);
  const video = path.join(outDir, "video.mp4"), wav = path.join(outDir, "audio.wav"), mp4 = path.join(outDir, "capture.mp4");
  let server, b, enc;
  try {
    let url = src.url;
    if (!url) { server = await serve(src.root); url = "http://127.0.0.1:" + server.address().port + "/" + encodeURIComponent(src.page); }
    const gl = opts.gpu ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
    b = await browser(["--no-sandbox", "--hide-scrollbars", "--mute-audio", "--autoplay-policy=no-user-gesture-required", ...gl], { protocolTimeout: 600000 });
    const page = await b.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(clockScript({ duration, sampleRate: sr }));
    const pageErrors = [];
    page.on("pageerror", (e) => { if (pageErrors.length < 20) pageErrors.push(String(e?.message ?? e).slice(0, 500)); });
    await page.goto(url, { waitUntil: "load", timeout: 120000 });
    await page.evaluate(() => document.fonts?.ready);
    if (opts.wait) await new Promise((r) => setTimeout(r, opts.wait * 1000));

    enc = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
      "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(fps), video], { stdio: ["pipe", "ignore", "pipe"] });
    let encErr = "";
    enc.stderr.on("data", (d) => { encErr += d; });
    const encoded = new Promise((resolve, reject) => {
      enc.on("error", (e) => reject(e.code === "ENOENT" ? new Error("ffmpeg not found (motion-use doctor)") : e));
      enc.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg: " + encErr.trim()))));
    });
    const advance = (ms) => page.evaluate((t) => window.__motionUseCapture.advance(t), ms);
    let next = 0;
    for (let i = 0; i < total; i++) {
      const t = (i * 1000) / fps;
      while (next < presses.length && presses[next].at * 1000 <= t + 1e-6) {
        await advance(presses[next].at * 1000);
        await page.keyboard.press(presses[next].key);
        next++;
      }
      await advance(t);
      const png = await page.screenshot({ type: "png", optimizeForSpeed: true });
      if (!enc.stdin.write(png)) await new Promise((r) => enc.stdin.once("drain", r));
      opts.onFrame?.(i + 1, total);
    }
    enc.stdin.end();
    await encoded;

    // Sound: finish every context, pull it out in chunks, place each at the second it was made.
    await advance(duration * 1000);
    const info = await page.evaluate(() => window.__motionUseCapture.finish());
    const recs = [];
    for (let i = 0; i < info.length; i++) {
      const data = [];
      for (let ch = 0; ch < info[i].channels; ch++) {
        const f = new Float32Array(info[i].length);
        for (let s = 0; s < f.length; s += 1 << 18) {
          const n = Math.min(1 << 18, f.length - s);
          const bytes = Buffer.from(await page.evaluate((a, c, st, k) => window.__motionUseCapture.chunk(a, c, st, k), i, ch, s, n), "base64");
          f.set(new Float32Array(bytes.buffer, bytes.byteOffset, n), s);
        }
        data.push(f);
      }
      recs.push({ ...info[i], data });
    }
    const samples = Math.round(duration * sr);
    const mix = mixContexts(recs, samples, sr);
    fs.writeFileSync(wav, wavBuffer(mix, sr));
    const pageSide = await page.evaluate(() => [...window.__motionUseCapture.errors]);
    ffmpegRun(["-i", video, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", mp4]);
    fs.rmSync(video, { force: true });
    const measured = probe(mp4);
    const report = {
      ok: true,
      target: src.url ?? src.file,
      method: "deterministic: virtual clock (requestAnimationFrame, timers, performance.now, Date, CSS/Web Animations) and OfflineAudioContext, one screenshot per frame",
      fps, width, height, duration,
      frames: { expected: total, measured: measured.frames },
      video_s: measured.video_s,
      audio: {
        file: wav, sample_rate: sr, seconds: samples / sr, mp4_seconds: measured.audio_s,
        contexts: info.map((c) => ({ started_s: +c.born.toFixed(4), closed_s: c.closedAt, ...(c.requestedRate && c.requestedRate !== sr ? { requested_rate: c.requestedRate } : {}) })),
        ...audioStats(mix, sr),
      },
      alignment: {
        max_error_s: +(RENDER_QUANTUM / sr).toFixed(5),
        note: "picture and sound are rendered against the same virtual clock; page code at time t sees AudioContext.currentTime within one 128-sample render quantum of t (by construction, not measured on this page)",
      },
      presses: presses.map((p) => ({ key: p.key, at: p.at })),
      page_errors: [...new Set([...pageSide, ...pageErrors])].slice(0, 20),
      limits: LIMITS,
      files: { video: mp4, audio: wav, report: path.join(outDir, "capture.json") },
    };
    fs.writeFileSync(report.files.report, JSON.stringify(report, null, 2) + "\n");
    return report;
  } finally {
    if (enc && enc.exitCode === null) enc.kill("SIGKILL");
    await b?.close().catch(() => {});
    server?.close();
  }
}

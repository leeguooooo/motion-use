import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { busyRuns, contrastRuns, describeText, probeText, readingRuns, readingSeconds } from "../src/text-probe.mjs";
import { measureMotion, gradeMotion } from "../src/motion-check.mjs";
import { initFilm, checkFilm, buildFilm, validateFilm } from "../src/film.mjs";
import { runHyperframes } from "../src/hf.mjs";

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mu-read-"));
const box = (text, x0, y0, x1, y1, extra = {}) => ({ text, x0, y0, x1, y1, alpha: 1, ...extra });
const every = (to, f, step = 0.1) => Array.from({ length: Math.round(to / step) + 1 }, (_, i) => +(i * step).toFixed(2)).map((t) => ({ t, boxes: f(t).filter(Boolean) }));

test("reading time: 0.3 s per word, 0.15 s per CJK character, plus 0.5 s", () => {
  assert.equal(readingSeconds("Two things, one gap."), 1.7);
  assert.equal(readingSeconds("任何 App，不需要 API"), 1.85);
  assert.equal(readingSeconds("对面有了回应。"), 1.55);
});

test("reading check: a callout gone after 1 s is flagged with its time and required seconds", () => {
  const line = "scan with an iPhone: no address";
  const runs = readingRuns(every(4, (t) => [t >= 1 && t < 2 && box(line, 100, 100, 900, 140), box("held to the end", 100, 900, 600, 960)]), { width: 1920, height: 1080 });
  assert.deepEqual(runs.map((r) => [r.kind, r.text, r.from, r.to, r.seconds, r.required]), [["reading", line, 1, 2, 1, 2.3]]);
  assert.match(describeText({ runs })[0], /1–2s for 1s, needs 2.3s to read \(0.3 s per word \+ 0.15 s per CJK character \+ 0.5 s\)/);
});

test("reading check: a line held long enough, words arriving one by one and a rolling counter pass", () => {
  const words = ["Hold", "the", "line"];
  const runs = readingRuns(
    every(5, (t) => [
      t >= 0.5 && t < 3 && box("scan with an iPhone: no address", 100, 100, 900, 140),
      // M.words: each word is its own string; the line counts from its first word
      ...words.map((w, k) => t >= 3 + k * 0.3 && t < 4.6 && box(w, 100 + k * 200, 500, 250 + k * 200, 560)),
      // M.count: a different number every sample, next to its label
      t < 4 && box(`${Math.round(t * 997)} users`, 1000, 800, 1400, 860),
    ]),
    { width: 1920, height: 1080 },
  );
  assert.deepEqual(runs, []);
});

test("reading check: a haloed label is one string, and a label the camera carries out of frame is not judged (#42, #43)", () => {
  // strokeText halo + fillText at the same place: one "新疆", never "新疆新疆".
  const halo = (t0, t1, x) => (t) => t >= t0 && t < t1 ? [box("新疆", x, 100, x + 60, 130), box("新疆", x, 100, x + 60, 130)] : [];
  const flashed = readingRuns(every(3, halo(1, 1.2, 300)), { width: 1920, height: 1080 });
  assert.deepEqual(flashed.map((r) => r.text), ["新疆"]);
  // A push carries the label off the left edge after 0.2 s: the film moved on, nothing vanished.
  const pushed = readingRuns(
    every(3, (t) => (t >= 1 ? [box("新疆", t < 1.2 ? 300 : -400, 100, t < 1.2 ? 360 : -340, 130), box("新疆", t < 1.2 ? 300 : -400, 100, t < 1.2 ? 360 : -340, 130)] : [])),
    { width: 1920, height: 1080 },
  );
  assert.deepEqual(pushed, []);
  // Faded out in place after 0.2 s: still flagged.
  const faded = readingRuns(every(3, (t) => (t >= 1 ? [box("新疆", 300, 100, 360, 130, { alpha: t < 1.2 ? 1 : 0.1 })] : [])), { width: 1920, height: 1080 });
  assert.deepEqual(faded.map((r) => [r.text, r.seconds]), [["新疆", 0.2]]);
  // Two different strings side by side still read as one line.
  const two = readingRuns(every(3, (t) => (t >= 1 && t < 1.2 ? [box("北洋", 300, 100, 360, 130), box("政府", 362, 100, 422, 130)] : [])), { width: 1920, height: 1080 });
  assert.deepEqual(two.map((r) => r.text), ["北洋政府"]);
});

test("reading check: a backspaced line is judged once, as the full line, not per erased fragment", () => {
  const typed = (t) => {
    // "Hold the whole line" typed from 0, held to 3, erased one letter per 0.1 s, then a new line typed.
    const full = "Hold the whole line";
    if (t < 3) return full;
    const left = full.length - Math.round((t - 3) / 0.1);
    return left > 0 ? full.slice(0, left) : "Next one stays".slice(0, Math.max(0, Math.round((t - 5) / 0.05)));
  };
  const runs = readingRuns(every(8, (t) => [typed(t) && box(typed(t), 100, 100, 100 + typed(t).length * 30, 140)]), { width: 1920, height: 1080 });
  assert.deepEqual(runs, [], "3 s is enough for the full line, and the erasing fragments are not lines");
  const quick = readingRuns(every(5, (t) => { const s = t < 0.6 ? "Hold the whole line" : t < 1.5 ? "Hold the whole line".slice(0, 19 - Math.round((t - 0.6) / 0.05)) : ""; return [s && box(s, 100, 100, 700, 140)]; }), { width: 1920, height: 1080 });
  assert.deepEqual(quick.map((r) => r.text), ["Hold the whole line"], "the full line up only 0.6 s is still flagged, once");
  // A shorter heading put in place of a line is not an erase: it is judged on its own.
  const swapped = readingRuns(every(4, (t) => [t >= 1 && t < 2 ? box("Revenue grew 40% in Q3", 100, 100, 700, 140) : t >= 2 && t < 2.2 ? box("Revenue", 100, 100, 300, 140) : null]), { width: 1920, height: 1080 });
  assert.ok(swapped.some((r) => r.text === "Revenue"));
});

test("shot text that cannot be read inside its shot window is a validate warning", () => {
  const d = temp();
  initFilm({ lang: "en", format: "landscape" }, d);
  const data = JSON.parse(fs.readFileSync(path.join(d, "film.json"), "utf8"));
  data.voiceover = false;
  const shot = data.shots[1];
  const seconds = shot.end - shot.start;
  shot.text = "one two three four five six seven eight";
  const slow = validateFilm(data, d).warnings.filter((w) => w.path === "$.shots[1].text" && /needs/.test(w.message));
  assert.equal(slow.length, seconds < 2.9 ? 1 : 0, JSON.stringify(slow));
  shot.end = shot.start + 0.9;
  data.shots[2].start = shot.end;
  shot.text = "Short words here";
  const w = validateFilm(data, d).warnings.find((x) => x.path === "$.shots[1].text" && /needs/.test(x.message));
  assert.match(w.message, /0\.9s on screen; reading it needs 1\.4s \(0\.3 s per word/);
  shot.text = "Go";
  assert.equal(validateFilm(data, d).warnings.filter((x) => x.path === "$.shots[1].text" && /needs/.test(x.message)).length, 0);
});

test("contrast check: low contrast held while fully shown is flagged; fades, large text at 3:1 and brief dips pass", () => {
  const low = (t) => box("grey on grey", 100, 100, 500, 140, { contrast: 1.18, large: true, color: "#777777", backdrop: "#888888" });
  const runs = contrastRuns(every(2, (t) => [t >= 0.5 && t <= 1.5 && low(t)]));
  assert.deepEqual(runs.map((r) => [r.kind, r.text, r.from, r.to, r.contrast, r.need]), [["contrast", "grey on grey", 0.5, 1.5, 1.18, 3]]);
  assert.match(describeText({ runs })[0], /low contrast 1.18:1 0.5–1.5s, #777777 on #888888 \(WCAG 3:1 for large text/);
  // small text needs 4.5:1, so 4.0 fails and large text passes at 3.2
  assert.equal(contrastRuns(every(1, () => [box("caption", 0, 0, 10, 10, { contrast: 4, large: false })])).length, 1);
  const pass = contrastRuns(
    every(2, (t) => [
      box("large enough", 0, 0, 10, 10, { contrast: 3.2, large: true }),
      box("fading in", 0, 20, 10, 30, { contrast: 1.2, large: true, alpha: 0.6 }),
      t === 1 && box("one frame", 0, 40, 10, 50, { contrast: 1.2, large: true }),
      box("white on black", 0, 60, 10, 70, { contrast: 18.1, large: false }),
    ]),
  );
  assert.deepEqual(pass, []);
});

const make = (dir, name, filter, seconds = 4) => {
  const file = path.join(dir, name);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", filter, "-t", String(seconds), "-pix_fmt", "yuv420p", file]);
  return file;
};
// A full-frame square wave between black and white, hz full cycles a second.
const strobe = (hz) => `color=black:s=640x360:r=30,format=yuv420p,geq=lum='if(lt(mod(T*${2 * hz}\\,2)\\,1)\\,235\\,16)':cb=128:cr=128`;

test("flash check: a 5 Hz full-frame strobe is red with its window; one flash a second and moving bars are green", () => {
  const dir = temp();
  const bad = measureMotion(make(dir, "strobe.mp4", strobe(5)));
  assert.equal(bad.flashes_per_s, 5);
  assert.ok(bad.flash_windows.length === 1 && bad.flash_windows[0].start < 0.2 && bad.flash_windows[0].end > 3.5, JSON.stringify(bad.flash_windows));
  assert.equal(gradeMotion(bad).rows.find((r) => r.metric === "flashes_per_s").level, "red");
  for (const [name, filter] of [["slow.mp4", strobe(1)], ["bars.mp4", "smptebars=s=640x360:r=30,scroll=h=0.04"]]) {
    const ok = measureMotion(make(dir, name, filter));
    assert.ok(ok.flashes_per_s <= 1, `${name}: ${ok.flashes_per_s}`);
    assert.deepEqual(ok.flash_windows, []);
    assert.equal(gradeMotion(ok).rows.find((r) => r.metric === "flashes_per_s").level, "green");
  }
});

const chrome = async () => {
  const r = await runHyperframes(["browser", "path"], {});
  const p = r.out.trim().split("\n").pop();
  return r.code === 0 && p && fs.existsSync(p);
};

test("text check on a real film: grey on grey and a 1 s callout are flagged; white on near-black is not", { timeout: 180000 }, async (t) => {
  if (!(await chrome())) return t.skip("no Chrome for rendering");
  const dir = temp();
  initFilm({ lang: "en", format: "landscape" }, dir);
  const file = path.join(dir, "film.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  Object.assign(data, { voiceover: false, music: "none", duration: 3, shots: [{ id: "only", start: 0, end: 3, purpose: "probe", action: "two labels and a callout" }] });
  fs.writeFileSync(file, JSON.stringify(data));
  fs.writeFileSync(
    path.join(dir, "composition", "draw.js"),
    `window.drawFrame = function (c, t, film, view, M) {
      c.fillStyle = "#101010"; c.fillRect(0, 0, view.width, view.height);
      M.text(c, "White on near black", view.width / 2, 200, 80, "#ffffff", 700, "center");
      c.fillStyle = "#888888"; c.fillRect(200, 400, 900, 160);
      if (t >= 0.4 && t < 2.6) M.text(c, "grey on grey", 260, 480, 60, "#777777", 700, "left");
      if (t >= 1 && t < 2) M.text(c, "scan with an iPhone: no address", 300, 800, 40, "#ffffff", 600, "left");
    };`,
  );
  const c = checkFilm(file, {});
  assert.deepEqual(c.report.errors, []);
  const proj = await buildFilm(c.film, "en", "landscape", path.join(dir, "out", ".build", "probe"));
  const r = await probeText(proj.dir, proj.total);
  assert.equal(r.skipped, undefined, r.skipped);
  const low = r.runs.filter((x) => x.kind === "contrast");
  assert.deepEqual(low.map((x) => [x.text, x.color, x.backdrop, x.need]), [["grey on grey", "#777777", "#888888", 3]], JSON.stringify(r.runs));
  assert.ok(low[0].contrast < 1.3 && low[0].from <= 0.5 && low[0].to >= 2.4, JSON.stringify(low[0]));
  const slow = r.runs.filter((x) => x.kind === "reading");
  assert.deepEqual(slow.map((x) => x.text), ["scan with an iPhone: no address"], JSON.stringify(r.runs));
  assert.ok(Math.abs(slow[0].seconds - 1) < 0.05 && slow[0].required === 2.3, JSON.stringify(slow[0]));
});

test("contrast check on a real film: a wide halo is judged as the backdrop; a hairline outline is not (#43)", { timeout: 180000 }, async (t) => {
  const { findRenderer } = await import("../src/native.mjs");
  const native = findRenderer();
  const haveChrome = await chrome();
  if (!haveChrome && !native?.bin) return t.skip("no renderer for the probe");
  const dir = temp();
  initFilm({ lang: "en", format: "landscape" }, dir);
  const file = path.join(dir, "film.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  Object.assign(data, { voiceover: false, music: "none", duration: 2, shots: [{ id: "only", start: 0, end: 2, purpose: "probe", action: "map labels" }] });
  fs.writeFileSync(file, JSON.stringify(data));
  // Grey labels on a grey province: one with a wide paper halo (readable), one with a 1 px outline.
  fs.writeFileSync(
    path.join(dir, "composition", "draw.js"),
    `window.drawFrame = function (c, t, film, view, M) {
      c.fillStyle = "#f0e6d0"; c.fillRect(0, 0, view.width, view.height);
      c.fillStyle = "#888888"; c.fillRect(200, 300, 1400, 400);
      c.font = '700 48px "Film Sans"'; c.textBaseline = "middle"; c.lineJoin = "round";
      c.strokeStyle = "#f0e6d0"; c.lineWidth = 6; c.strokeText("haloed label", 260, 420);
      c.fillStyle = "#777777"; c.fillText("haloed label", 260, 420);
      c.strokeStyle = "#f0e6d0"; c.lineWidth = 1; c.strokeText("hairline label", 260, 580);
      c.fillStyle = "#777777"; c.fillText("hairline label", 260, 580);
    };`,
  );
  const c = checkFilm(file, {});
  const proj = await buildFilm(c.film, "en", "landscape", path.join(dir, "out", ".build", "probe"));
  for (const opts of [haveChrome ? {} : null, native?.bin ? { native: { bin: native.bin } } : null].filter(Boolean)) {
    const r = await probeText(proj.dir, proj.total, opts);
    assert.equal(r.skipped, undefined, r.skipped);
    const low = r.runs.filter((x) => x.kind === "contrast").map((x) => x.text);
    assert.deepEqual(low, ["hairline label"], `${opts.native ? "native" : "chrome"}: ${JSON.stringify(r.runs)}`);
  }
});


test("busy check: a large title over a picture full of edges is flagged with its worst moment; calm pictures, fades and flashes pass (#131)", () => {
  const title = (edges, extra = {}) => box("一句话做完", 300, 200, 1600, 360, { busy: { edges, spread: 90 }, ...extra });
  const runs = busyRuns(every(3, (t) => [t >= 1 && t < 2 && title(t < 1.5 ? 0.12 : 0.18), t >= 2 && title(0.02)]));
  assert.deepEqual(runs.map((r) => [r.kind, r.text, r.from, r.to, r.edges, r.at]), [["busy", "一句话做完", 1, 1.9, 0.18, 1.5]]);
  const line = describeText({ runs })[0];
  assert.match(line, /large text over a busy picture 1–1.9s \(18% edge cells under it at 1.5s; the shot may have its own words there\): "一句话做完"/);
  assert.match(line, /pick another shot, move the text, or put a plate or dark band under it \(still --at 1.5\)/);
  // A halo pass and its fill are one title; under 6% is calm; a fade-in and a one-frame flash are not judged.
  const pass = busyRuns(
    every(3, (t) => [
      box("calm", 0, 0, 900, 120, { busy: { edges: 0.05, spread: 30 } }),
      box("fading", 0, 200, 900, 320, { busy: { edges: 0.3, spread: 90 }, alpha: 0.5 }),
      t === 1 && box("flash", 0, 400, 900, 520, { busy: { edges: 0.3, spread: 90 } }),
      box("small, not measured", 0, 600, 100, 620),
    ]),
  );
  assert.deepEqual(pass, []);
});

test("busy check on a real film: a title over a shot with its own big words is flagged; gradient, halo and plate are not (#131)", { timeout: 180000 }, async (t) => {
  if (!(await chrome())) return t.skip("no Chrome for rendering");
  const dir = temp();
  initFilm({ lang: "zh", format: "landscape" }, dir);
  const file = path.join(dir, "film.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  Object.assign(data, { voiceover: false, music: "none", duration: 4, shots: [{ id: "only", start: 0, end: 4, purpose: "probe", action: "hook titles over shots" }] });
  fs.writeFileSync(file, JSON.stringify(data));
  // The shots are pictures (an offscreen canvas, like decoded footage), so their words are pixels.
  fs.writeFileSync(
    path.join(dir, "composition", "draw.js"),
    `const shot = (w, h, words) => {
      const o = document.createElement("canvas"); o.width = w; o.height = h; const g = o.getContext("2d");
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#203040"); gr.addColorStop(1, "#d08040");
      g.fillStyle = words ? "#f4f4f4" : gr; g.fillRect(0, 0, w, h);
      if (words) { g.fillStyle = "#111"; g.font = '700 ' + Math.round(h * 0.22) + 'px "Film Sans"'; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("全选。", w / 2, h * 0.3); }
      return o;
    };
    let shots;
    window.drawFrame = function (c, t, film, view, M) {
      shots = shots || [shot(view.width, view.height, false), shot(view.width, view.height, true)];
      const k = Math.floor(t);
      c.drawImage(shots[k === 1 || k === 3 ? 1 : 0], 0, 0);
      if (k === 3) { c.fillStyle = "rgba(0,0,0,0.9)"; c.fillRect(0, view.height * 0.18, view.width, view.height * 0.24); }
      const title = ["渐变底上的标题", "压在全选两个字上", "描边标题", "压了底板"][k];
      if (k === 2) {
        c.font = '800 108px "Film Sans"'; c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
        c.strokeStyle = "#000000"; c.lineWidth = 16; c.strokeText(title, view.width / 2, view.height * 0.3);
        c.fillStyle = "#ffffff"; c.fillText(title, view.width / 2, view.height * 0.3);
      } else M.text(c, title, view.width / 2, view.height * 0.3, 108, "#ffffff", 800, "center");
    };`,
  );
  const c = checkFilm(file, {});
  assert.deepEqual(c.report.errors, []);
  const proj = await buildFilm(c.film, "zh", "landscape", path.join(dir, "out", ".build", "probe"));
  const r = await probeText(proj.dir, proj.total);
  assert.equal(r.skipped, undefined, r.skipped);
  const busy = r.runs.filter((x) => x.kind === "busy");
  assert.deepEqual(busy.map((x) => x.text), ["压在全选两个字上"], JSON.stringify(r.runs));
  assert.ok(busy[0].from >= 0.9 && busy[0].to <= 2 && busy[0].edges >= 0.1, JSON.stringify(busy[0]));
});

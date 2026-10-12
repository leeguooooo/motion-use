import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runHyperframes } from "../src/hf.mjs";

const source = fs.readFileSync(new URL("../src/film-kit.js", import.meta.url), "utf8");
const kit = () => {
  const context = { window: { filmAssets: { calm: { width: 64, height: 36 }, reply: { width: 64, height: 36 } } } };
  vm.runInNewContext(source, context);
  return context.window.__filmKit({ width: 1920, height: 1080 }, {});
};
const json = x => JSON.parse(JSON.stringify(x));

test("Rhubarb mouth selection respects dialogue offset, cue boundaries and silent gaps in any seek order", () => {
  const M = kit();
  const cues = { mouthCues: [{ start: 0, end: 0.1, value: "A" }, { start: 0.1, end: 0.3, value: "B" }, { start: 0.5, end: 0.8, value: "F" }] };
  for (const [time, expected] of [[2.1, "B"], [2.7, "F"], [1.9, "X"], [2.3, "X"], [2, "A"], [2.8, "X"], [2.1, "B"]])
    assert.equal(M.mouth(time, cues, { at: 2 }), expected);
  assert.equal(M.mouth(2, []), "X");
  assert.equal(M.mouth(0.4, cues.mouthCues, { rest: "closed" }), "closed");
});

test("breath, sway and shake use only absolute time, stay bounded and stop outside the event", () => {
  const M = kit();
  const options = { at: 1, amp: 0.02, period: 2 };
  assert.equal(M.breath(0, options), 1);
  assert.equal(M.breath(1, options), 1);
  assert.equal(M.breath(2, options), 1.02);
  assert.equal(M.sway(0, options), 0);
  assert.ok(Math.abs(M.sway(1.5, options) - 0.02) < 1e-10);
  const event = { at: 1, dur: 0.3, amp: 8, seed: 5 };
  const reference = json(M.shake(1.07, event));
  for (const t of [3, 0, 1.2, 1.07]) {
    const offset = M.shake(t, event);
    assert.ok(Math.abs(offset.x) <= 8 && Math.abs(offset.y) <= 8);
  }
  assert.deepEqual(json(M.shake(1.07, event)), reference);
  for (const time of [0, 1, 1.3, 2]) assert.deepEqual(json(M.shake(time, event)), { x: 0, y: 0 });
});

test("sprite supports alignment offsets, cue-local timing and missing-image errors without mutating inputs", () => {
  const M = kit(), calls = [];
  const c = { drawImage: (...args) => calls.push(args) };
  const keys = [[1, "reply"], [0, "calm"]];
  const variants = { calm: "calm", reply: { image: "reply", dx: 3, dy: -2 } };
  assert.equal(M.sprite(c, 0.5, variants, keys, { at: 2 }), null);
  assert.equal(M.sprite(c, 3, variants, keys, { at: 2, x: 10, y: 20, w: 30, h: 40 }), "reply");
  assert.deepEqual(calls[0].slice(1), [13, 18, 30, 40]);
  assert.deepEqual(keys, [[1, "reply"], [0, "calm"]]);
  assert.throws(() => M.sprite(c, 4, {}, keys), /unknown variant/);
  assert.throws(() => M.sprite(c, 4, { reply: "missing" }, keys), /declare it/);
});

test("real canvas: depth parallax and aligned crossfades preserve pixels and alpha after backward seeks", { timeout: 60000 }, async () => {
  const result = await runHyperframes(["browser", "path"], {});
  const executablePath = result.out.trim().split("\n").pop();
  assert.equal(result.code, 0, result.out);
  assert.ok(fs.existsSync(executablePath), "Chrome is required to verify pixels");
  const require = createRequire(createRequire(import.meta.url).resolve("hyperframes/package.json"));
  const browser = await require("puppeteer-core").launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas width="64" height="36"></canvas>');
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(() => {
      const canvas = document.querySelector("canvas"), c = canvas.getContext("2d");
      const solid = color => { const image = document.createElement("canvas"); image.width = image.height = 8; const ctx = image.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, 8, 8); return image; };
      window.filmAssets = { red: solid("red"), green: solid("lime") };
      const M = window.__filmKit({ width: 64, height: 36 }, {});
      const frame = t => { c.clearRect(0, 0, 64, 36); M.sprite(c, t, { red: "red", green: "green" }, [[0, "red"], [1, "green"]], { x: 10, y: 10, w: 8, h: 8, fade: 0.4 }); return [...c.getImageData(12, 12, 1, 1).data]; };
      const colors = [1.2, 0.5, 1.4, 1.1, 1.2].map(frame);
      c.clearRect(0, 0, 64, 36);
      M.layers(c, 1, [{ image: "red", depth: 0, x: 10, y: 10, w: 4, h: 4 }, { image: "green", depth: 1, x: 40, y: 10, w: 4, h: 4 }], { camera: { x: 40, y: 18, z: 1 } });
      const pixels = [[11, 11], [33, 11], [41, 11]].map(([x,y]) => [...c.getImageData(x,y,1,1).data]);
      return { colors, pixels, alpha: c.globalAlpha, transform: [c.getTransform().a, c.getTransform().b, c.getTransform().c, c.getTransform().d, c.getTransform().e, c.getTransform().f] };
    });
    assert.deepEqual(result.colors[0], result.colors[4], "seek order cannot change the blend");
    assert.ok(result.colors[0][0] >= 127 && result.colors[0][0] <= 128);
    assert.ok(result.colors[0][1] >= 127 && result.colors[0][1] <= 128);
    assert.equal(result.colors[0][3], 255, "opaque crossfades must not dim or expose the background");
    assert.deepEqual(result.colors[1], [255, 0, 0, 255]);
    assert.deepEqual(result.colors[2], [0, 255, 0, 255]);
    assert.deepEqual(result.pixels, [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 0, 0]]);
    assert.equal(result.alpha, 1);
    assert.deepEqual(result.transform, [1, 0, 0, 1, 0, 0]);
  } finally { await browser.close(); }
});

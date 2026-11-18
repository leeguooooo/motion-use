import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { svgBoxes, parseTransform, pathPoints } from "../src/diagram.mjs";
import { initFilm, validateFilm } from "../src/film.mjs";
import { lintNarration, lintScriptAndFilm, scriptTable } from "../src/narration-lint.mjs";
import { scriptReviewPrompt } from "../src/script-review.mjs";
import { resolveNarrationCheckConfig, describeNarration } from "../src/narration-check.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mu-tech-"));

// ---------------------------------------------------------------- diagram boxes
const FEISHU_LIKE = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 1600 800">
  <!-- exported whiteboard -->
  <defs><marker id="arrow"><path d="M0 0 L10 5 L0 10 Z"/></marker></defs>
  <rect x="0" y="0" width="1600" height="800" fill="#fff"/>
  <g transform="translate(100 200)">
    <rect width="300" height="160" rx="12"/>
    <text x="150" y="80">游戏服务</text>
  </g>
  <g id="mq" transform="matrix(1 0 0 1 600 200)">
    <path d="M0 0 h300 v160 h-300 z"/>
    <text x="150" y="70"><tspan>实时</tspan><tspan>消息</tspan></text>
  </g>
  <g transform="scale(2)"><ellipse id="db" cx="600" cy="140" rx="50" ry="30"/></g>
  <polyline id="send" points="400,280 600,280"/>
  <path id="reply" d="M900 280 C 1000 280, 1000 280, 1100 280"/>
  <rect x="1300" y="100" width="4" height="4"/>
  <foreignObject x="100" y="500" width="400" height="120"><div xmlns="http://www.w3.org/1999/xhtml"><p>客户端</p></div></foreignObject>
</svg>`;

test("#121 diagram boxes: transforms, viewBox scale, text labels as ids, arrows as paths", () => {
  const r = svgBoxes(FEISHU_LIKE);
  assert.equal(r.width, 800);
  assert.equal(r.height, 400);
  // viewBox 1600×800 onto 800×400: everything halves.
  assert.deepEqual(r.boxes["游戏服务"], { x: 50, y: 100, w: 150, h: 80, label: "游戏服务" });
  assert.deepEqual(r.boxes.mq, { x: 300, y: 100, w: 150, h: 80, label: "实时 消息" });
  assert.deepEqual(r.boxes.db, { x: 550, y: 110, w: 100, h: 60 });
  assert.deepEqual(r.boxes["客户端"], { x: 50, y: 250, w: 200, h: 60, label: "客户端" });
  assert.deepEqual(r.paths.send, [[200, 140], [300, 140]]);
  assert.deepEqual(r.paths.reply.at(-1), [550, 140]);
  // The background and specks are not boxes; marker paths inside <defs> are ignored.
  assert.equal(Object.keys(r.boxes).length, 4);
  assert.ok(!r.paths.arrow);
});

test("#121 diagram boxes: duplicate labels get suffixes; transform and path parsing", () => {
  const svg = `<svg width="100" height="100"><rect x="0" y="0" width="40" height="20"/><text x="10" y="10">A</text><rect x="50" y="50" width="40" height="20"/><text x="60" y="60">A</text></svg>`;
  assert.deepEqual(Object.keys(svgBoxes(svg).boxes), ["a", "a-2"]);
  const m = parseTransform("translate(10,20) scale(2)");
  assert.deepEqual(m, [2, 0, 0, 2, 10, 20]);
  const p = pathPoints("m10 10 l20 0 l0 20 z");
  assert.equal(p.closed, true);
  assert.deepEqual(p.points, [[10, 10], [30, 10], [30, 30]]);
  assert.throws(() => svgBoxes("<html></html>"), /not an SVG/);
});

// ---------------------------------------------------------------- init --mode tech-review
test("#121 init --mode tech-review: chaptered film, setting, no target length, script matches", () => {
  const dir = path.join(tmp(), "talk");
  const r = initFilm({ mode: "tech-review", voiceProfile: null }, dir);
  assert.equal(r.mode, "tech-review");
  const data = JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8"));
  assert.equal(data.brief.setting, "tech-review");
  assert.equal(data.brief.length, undefined);
  assert.deepEqual(data.languages, ["zh"]);
  assert.equal(data.music, undefined);
  assert.ok(data.shots.every((s, i) => s.chapter.n === i + 1 && s.chapterStart === true));
  assert.match(data.shots[1].narration.zh, /^第二部分，整体架构。/);
  assert.ok(data.data.diagrams.architecture.boxes.client);
  assert.ok(data.data.diagrams.architecture.paths.request);
  assert.ok(fs.existsSync(path.join(dir, "assets", "architecture.svg")));
  const v = validateFilm(data, dir, { skipGeneratedVoiceover: true });
  assert.deepEqual(v.errors, []);
  assert.ok(!v.warnings.some((w) => /chapter/.test(w.path + w.message)), JSON.stringify(v.warnings));
  const script = fs.readFileSync(path.join(dir, "SCRIPT.md"), "utf8");
  assert.equal(scriptTable(script).shots.length, 9);
  const lint = lintScriptAndFilm(script, data);
  assert.ok(lint.every((x) => !x.findings.some((f) => f.rule === "script-drift" || f.rule === "chapter-open")), JSON.stringify(lint));
});

test("#121 shot chapters are validated and checked in order", () => {
  const dir = path.join(tmp(), "talk");
  initFilm({ mode: "tech-review", voiceProfile: null }, dir);
  const data = JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8"));
  const bad = structuredClone(data);
  bad.shots[0].chapter = { n: "1", title: "" };
  bad.shots[1].chapterStart = "yes";
  const v = validateFilm(bad, dir, { skipGeneratedVoiceover: true });
  assert.ok(v.errors.some((e) => e.path === "$.shots[0].chapter"));
  assert.ok(v.errors.some((e) => e.path === "$.shots[1].chapterStart"));
  const span = structuredClone(data);
  span.shots[2].chapter = { ...span.shots[1].chapter }; // chapter 2 spans shots 1–2 but shot 2 restarts it
  const w = validateFilm(span, dir, { skipGeneratedVoiceover: true }).warnings;
  assert.ok(w.some((x) => x.path === "$.shots[2].chapterStart" && /already started/.test(x.message)));
  const missing = structuredClone(data);
  missing.shots[3].chapterStart = false;
  assert.ok(validateFilm(missing, dir, { skipGeneratedVoiceover: true }).warnings.some((x) => x.path === "$.shots[3].chapterStart"));
});

// ---------------------------------------------------------------- spoken rules
test("#121 tech-review lint: a chapter opens by naming itself; setups are high priority", () => {
  const shots = [
    { id: "a", chapter: { n: 1, title: "背景" }, chapterStart: true, narration: "第一部分，背景。人机局整局由客户端在本地算完。" },
    { id: "b", chapter: { n: 2, title: "整体架构" }, chapterStart: true, narration: "这里有个细节要注意。开局时服务端发种子。" },
    { id: "c", chapter: { n: 2, title: "整体架构" }, narration: "打完服务端用同一个种子重算。" },
  ];
  const r = lintNarration(shots, "zh", { setting: "tech-review" });
  const open = r.findings.filter((f) => f.rule === "chapter-open");
  assert.equal(open.length, 1);
  assert.equal(open[0].shot, "b");
  assert.match(open[0].message, /第2部分，整体架构/);
  assert.ok(r.findings.filter((f) => f.rule === "signpost").every((f) => f.priority === "high"));
  assert.ok(!lintNarration(shots, "zh", { setting: "meeting-explainer" }).findings.some((f) => f.rule === "chapter-open"));
  const en = lintNarration([{ id: "x", chapterStart: true, chapter: { n: 3, title: "Flow" }, narration: "Part 3, the flow. The client rolls locally." }], "en", { setting: "tech-review" });
  assert.ok(!en.findings.some((f) => f.rule === "chapter-open"));
});

test("#121 review prompt: tech-review persona and chapter rules, no duration pressure", () => {
  const p = scriptReviewPrompt("| Shot | 旁白 |\n|---|---|\n| a | 第一部分，背景。 |", { setting: "tech-review", facts: ["已部署到测试环境"] });
  assert.match(p, /技术方案评审会/);
  assert.match(p, /第二部分，整体架构。/);
  assert.match(p, /时长不设目标/);
  assert.doesNotMatch(p, /你是短视频编导/);
});

// ---------------------------------------------------------------- speech recognition switch
test("#121 narrationCheck.enabled false: needs a reason and is recorded as disabled", () => {
  assert.throws(() => resolveNarrationCheckConfig({ narrationCheck: { enabled: false } }), /reason/);
  assert.throws(() => resolveNarrationCheckConfig({ narrationCheck: { enabled: "no", reason: "x" } }), /true or false/);
  assert.throws(() => resolveNarrationCheckConfig({ narrationCheck: { reason: "x" } }), /only goes with enabled: false/);
  const c = resolveNarrationCheckConfig({ narrationCheck: { enabled: false, reason: "作者逐条听过，语音识别对这类术语不准" } });
  assert.equal(c.enabled, false);
  assert.match(c.reason, /作者逐条听过/);
  assert.deepEqual(describeNarration({ status: "DISABLED", config: c, lines: [] }), [`narration check disabled in film.json: ${c.reason}`]);
  assert.equal(resolveNarrationCheckConfig({}).enabled, undefined);
});

// ---------------------------------------------------------------- drawing kit
const stubCanvas = () => {
  const calls = [];
  const ctx = new Proxy(
    { calls, measureText: (s) => ({ width: String(s).length * 10 }), roundRect: () => calls.push(["roundRect"]) },
    { get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, ...a])), set: (o, k, v) => ((o[k] = v), true) },
  );
  return ctx;
};
const kit = (film, view = { width: 1920, height: 1080 }) => {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(new URL("../src/film-kit.js", import.meta.url), "utf8"), ctx);
  return { M: ctx.window.__filmKit(view, film), window: ctx.window, view };
};

test("#121 M.when: phrase position in the narration, measured words first, missing phrase never", () => {
  const film = { lang: "zh", shots: [{ id: "a", start: 10, end: 21.3, narration: { zh: "开局时服务端发种子，打完再重算。" } }], words: [] };
  const { M, view } = kit(film);
  view.shot = film.shots[0];
  const text = film.shots[0].narration.zh;
  const est = M.when("重算");
  assert.ok(Math.abs(est - (10 + 0.1 + (10 * text.indexOf("重算")) / text.length)) < 1e-9);
  assert.equal(M.when("回放窗口"), Infinity);
  assert.equal(M.when("发种子", { shot: "a", off: 0.5 }), 10 + 0.1 + (10 * text.indexOf("发种子")) / text.length + 0.5);
  film.words = [{ id: "a", text: "服务端", start: 11.2, end: 11.6 }, { id: "a", text: "发", start: 11.6, end: 11.8 }, { id: "a", text: "种子", start: 11.8, end: 12.2 }];
  assert.equal(M.when("发种子"), 11.6);
});

test("#121 M.diagram crops to the visible source region and fits width and height", () => {
  const film = { data: { diagrams: { arch: { boxes: { svc: { x: 100, y: 100, w: 200, h: 100 } }, paths: {} } } } };
  const { M } = kit(film);
  const img = { naturalWidth: 4000, naturalHeight: 3000 };
  const c = stubCanvas();
  const rect = { x: 0, y: 0, w: 1920, h: 800 };
  // A tall view: the height decides the scale, so it never runs under the subtitles.
  const map = M.diagram(c, img, [2000, 1500, 1000, 2000], { rect });
  assert.equal(map.s, 800 / 2000);
  const draw = c.calls.find((x) => x[0] === "drawImage");
  assert.equal(draw.length, 10); // 9-argument form
  const [, , sx, sy, sw, sh] = draw;
  assert.ok(sx >= 0 && sy >= 0 && sx + sw <= 4000 && sy + sh <= 3000);
  assert.ok(sw * map.s <= 1920 + 1e-6);
  const b = map.box("arch:svc");
  assert.deepEqual([b.w, b.h], [200 * map.s, 100 * map.s]);
  assert.deepEqual(map.p("svc"), map.p([200, 150]));
  assert.throws(() => map.box("nope"), /not in film.data/);
});

test("#121 M.viewAt eases between keyed views; token, glow, dim and chapters draw", () => {
  const film = { lang: "zh", shots: [{ id: "a", start: 0, end: 8, chapter: { n: 2, title: "整体架构" }, chapterStart: true }], data: {} };
  const { M } = kit(film);
  const keys = [[0, [100, 100, 200, 100]], [2, [300, 100, 200, 100]]];
  assert.deepEqual(M.viewAt(1, keys), [100, 100, 200, 100]);
  assert.deepEqual(M.viewAt(5, keys), [300, 100, 200, 100]);
  const mid = M.viewAt(2.35, keys);
  assert.ok(mid[0] > 100 && mid[0] < 300);
  const c = stubCanvas();
  const map = M.diagram(c, { width: 400, height: 200 }, [200, 100, 400, 200], { rect: [0, 0, 1920, 960] });
  assert.equal(M.token(c, map, [[0, 0], [400, 0]], 0, "x"), null);
  assert.deepEqual(M.token(c, map, [[0, 100], [400, 100]], 0.5), map.p([200, 100]));
  M.glow(c, map, [10, 10, 50, 50], 1);
  M.dim(c, map, [10, 10, 50, 50], 1);
  const before = c.calls.length;
  assert.equal(M.chapters(c, 0.5).n, 2); // card
  assert.ok(c.calls.slice(before).some((x) => x[0] === "fillRect"));
  const later = c.calls.length;
  M.chapters(c, 5); // label only
  assert.ok(!c.calls.slice(later).some((x) => x[0] === "fillRect"));
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { lintNarration } from "../src/narration-lint.mjs";
import { scriptReviewPrompt, requestScriptReview, parseScriptReview, reviewScript, readSources } from "../src/script-review.mjs";
import { initFilm, validateFilm } from "../src/film.mjs";

process.env.MOTION_USE_STOP_SLOP = path.join(os.tmpdir(), "mu-no-stop-slop");
const rules = (r) => r.findings.map((f) => f.rule);
const hook = [
  { id: "a", narration: "你看这颗骰子。点下去，点数当场就出。它凭什么知道每一步走得对不对？" },
  { id: "b", narration: "答案在开局那一刻。你信吗？" },
];

test("#112 opening rules follow brief.setting; feed-short stays the default", () => {
  const numberFirst = [{ id: "a", narration: "你每停对一次，三十秒后就多十个积分。" }];
  assert.ok(rules(lintNarration(numberFirst, "zh")).includes("opening-quantity"));
  const meeting = lintNarration(numberFirst, "zh", { setting: "meeting-explainer" });
  assert.ok(!rules(meeting).includes("opening-quantity") && !rules(meeting).includes("opening-rule"));
  const m = rules(lintNarration(hook, "zh", { setting: "meeting-explainer" }));
  assert.ok(m.includes("opening-hook"));
  assert.equal(m.filter((r) => r === "rhetorical-question").length, 2);
  assert.ok(!rules(lintNarration(hook, "zh")).includes("opening-hook"));
  const feed = scriptReviewPrompt("稿", {}, { focus: "voice" });
  assert.match(feed, /^你是短视频编导。/);
  assert.match(feed, /第一句必须能指着画面说出来/);
  const talk = scriptReviewPrompt("稿", { setting: "meeting-explainer" }, { focus: "voice" });
  assert.doesNotMatch(talk, /短视频编导|第一句必须能指着画面/);
  assert.match(talk, /先说今天讲什么/);
  assert.throws(() => scriptReviewPrompt("稿", { setting: "tv" }), /brief\.setting/);
});

test("#112 validate checks brief.setting and init accepts --setting/--speaker", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mu-setting-"));
  initFilm({ lang: "zh", format: "landscape", setting: "meeting-explainer", speaker: "资深同事" }, dir);
  const file = path.join(dir, "film.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(data.brief.setting, "meeting-explainer");
  assert.equal(data.brief.speaker, "资深同事");
  data.brief.setting = "tv";
  assert.ok(validateFilm(data, dir).errors.some((e) => e.path === "$.brief.setting"));
});

test("#110 persona comes from brief.speaker/tone and tone mode locks facts and lengths", () => {
  const p = scriptReviewPrompt("稿", { setting: "meeting-explainer", speaker: "团队里的资深同事", tone: "清楚具体" }, { focus: "tone" });
  assert.match(p, /说话的人：团队里的资深同事/);
  assert.match(p, /语气要求：清楚具体/);
  assert.match(p, /±15%/);
  assert.match(p, /居然/);
  assert.match(p, /"paragraphs"/);
  assert.doesNotMatch(p, /## 事实轮|## 口语轮/);
  const parsed = parseScriptReview(JSON.stringify({ issues: [], rewrite: "x", alternatives: [], paragraphs: [{ shot: "a", before: "一二三四五六七八九十", after: "一二" }] }));
  assert.equal(parsed.paragraphs[0].shot, "a");
});

test("#111 empty facts warn; sources join the prompt; missing vs contradicting are split", async () => {
  const none = scriptReviewPrompt("稿", {}, { focus: "facts" });
  assert.match(none, /只能检查稿子内部/);
  const withFacts = scriptReviewPrompt("稿", { facts: ["存档每天一次"] }, { focus: "facts", sources: [{ name: "doc.txt", text: "接口 /v1/x", truncated: false }] });
  assert.match(withFacts, /【必须改】/);
  assert.match(withFacts, /【请作者核对】/);
  assert.match(withFacts, /<SOURCES>[\s\S]*接口 \/v1\/x/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mu-sources-"));
  initFilm({ lang: "zh", format: "landscape" }, dir);
  const big = path.join(dir, "doc.txt");
  fs.writeFileSync(big, "字".repeat(9000));
  assert.equal(readSources(["doc.txt"], dir)[0].truncated, true);
  const r = await reviewScript(dir, { reviewer: "gemini", plan: true, focus: "facts", out: path.join(dir, "r", "a.md") });
  assert.match(r.warnings.join(), /brief\.facts is empty/);
  const s = await reviewScript(dir, { reviewer: "gemini", plan: true, focus: "facts", factsFrom: [big], out: path.join(dir, "r", "b.md") });
  assert.deepEqual(s.warnings, []);
  assert.match(fs.readFileSync(s.prompt, "utf8"), /<SOURCES>/);
});

test("#109 browser review tells an undelivered prompt from a missing reply", async () => {
  const fake = (readRows) => async (_cmd, args) => {
    if (args.includes("done")) return { stdout: "{}" };
    if (args.some((a) => /\/ask$/.test(a))) { assert.ok(args.includes("--new") && args[args.indexOf("--new") + 1] === "true"); return { stdout: JSON.stringify({ data: [{ response: "" }] }) }; }
    return { stdout: JSON.stringify({ data: readRows }) };
  };
  await assert.rejects(requestScriptReview("PROMPT 你好", { reviewer: "gemini", transport: "browser", promptFile: "/x/r.md.prompt.txt", execImpl: fake([{ Role: "model", Text: "需要我为你做些什么？" }]) }), /not delivered[\s\S]*\/x\/r\.md\.prompt\.txt[\s\S]*--response/);
  await assert.rejects(requestScriptReview("PROMPT 你好", { reviewer: "gemini", transport: "browser", execImpl: fake([{ Role: "user", Text: "PROMPT 你好" }]) }), /delivered but no reply[\s\S]*Do not resend/);
  const ok = async (_c, args) => ({ stdout: JSON.stringify({ data: [{ response: args.some((a) => /\/ask$/.test(a)) ? "{\"issues\":[]}" : "" }] }) });
  assert.equal(await requestScriptReview("P", { reviewer: "gemini", transport: "browser", execImpl: ok }), "{\"issues\":[]}");
});

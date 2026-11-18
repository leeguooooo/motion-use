import assert from "node:assert/strict";
import { test } from "node:test";
import { lintNarration } from "../src/narration-lint.mjs";

const v2 = [
  { id: "a", narration: "今天讲人机局。服务端已经部署到测试环境，文档也发了，但大家问得最多的是同一个问题：一局里服务端基本不参与，最后的名次怎么还能算对。我先把这件事讲清楚，再讲客户端具体要做什么。" },
  { id: "b", narration: "这里有个细节要注意。种子在开局时下发。" },
  { id: "c", narration: "发奖是这样走的。客户端上报结果，服务端重算。" },
  { id: "d", narration: "两处要小心：第一是断线重连，第二是重复上报。最后总结一下客户端要做的：" },
];
const pick = (r, rule) => r.findings.filter((f) => f.rule === rule);
const SETUP = ["setup-question", "outline-preview", "signpost", "count-frame"];

test("#115 flags setup question, outline preview, signpost and count frame", () => {
  const r = lintNarration(v2, "zh", { setting: "meeting-explainer" });
  for (const rule of SETUP) assert.ok(pick(r, rule).length, rule);
  assert.equal(pick(r, "signpost").length, 2);
  assert.equal(pick(r, "outline-preview").length, 2);
  assert.ok(r.findings.filter((f) => SETUP.includes(f.rule)).every((f) => f.priority === "high"));
  const feed = lintNarration(v2, "zh");
  assert.ok(feed.findings.filter((f) => SETUP.includes(f.rule)).every((f) => f.priority === "warn"));
});

test("#115 question then answer counts as a setup", () => {
  const r = lintNarration([{ id: "a", narration: "为什么不用服务端判定？答案是延迟太高。" }], "zh");
  assert.equal(pick(r, "setup-question").length, 1);
});

test("#115 direct explanation and ordinary speech are not flagged", () => {
  const direct = [
    { id: "a", narration: "人机局整局由客户端在本地算完；开局时服务端发种子，打完服务端用同一个种子重算。" },
    { id: "b", narration: "我先打开设置，再点登录。这块屏两块钱一片。他问了一个问题，我没答上来。" },
    { id: "c", narration: "断线重连以后，客户端从最后一步接着走。奖励由服务端发。这是我们的做法。" },
  ];
  const r = lintNarration(direct, "zh", { setting: "meeting-explainer" });
  for (const rule of SETUP) assert.deepEqual(pick(r, rule), [], rule);
});

test("#115 English patterns", () => {
  const r = lintNarration([{ id: "a", narration: "Here's how scoring works. First I'll explain the seed, then the replay. There are two things to watch: first, reconnects, second, duplicates." }], "en", { setting: "course" });
  for (const rule of ["signpost", "outline-preview", "count-frame"]) assert.ok(pick(r, rule).length, rule);
  const ok = lintNarration([{ id: "a", narration: "The client plays the whole match locally. The server replays it with the same seed." }], "en");
  assert.deepEqual(ok.findings.filter((f) => SETUP.includes(f.rule)), []);
});

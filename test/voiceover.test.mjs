import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateBrief } from "../src/brief.mjs";
import { parseSize } from "../src/cli.mjs";
import { MANIFEST, generateVoiceover, pickEngine, ssml } from "../src/voiceover.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-vo-"));
fs.mkdirSync(path.join(tmp, "vo", "en"), { recursive: true });
const brief = (over = {}) => {
  const r = validateBrief({ version: 1, name: "t", languages: ["en"], voiceover: { dir: "vo" }, scenes: [{ id: "a", type: "title", title: "A", narration: "Hello there." }], ...over }, tmp);
  assert.deepEqual(r.errors, []);
  return r.brief;
};

test("narration, voices and rates are validated", () => {
  const bad = validateBrief({ version: 1, languages: ["en"], voiceover: { dir: "vo", engine: "say", voices: { en: "<x>" }, rate: "fast" }, scenes: [{ type: "title", title: "A" }] }, tmp).errors.map((e) => e.path);
  assert.ok(bad.includes("$.voiceover.engine"));
  assert.ok(bad.includes("$.voiceover.voices.en"));
  assert.ok(bad.includes("$.voiceover.rate"));
  const ok = brief({ voiceover: { dir: "vo", voices: { en: "en-US-AndrewMultilingualNeural" }, rate: { en: "+5%" } } });
  assert.equal(ok.voiceover.rates.en, "+5%");
  assert.equal(ok.scenes[0].narration.en, "Hello there.");
  assert.equal(ok.voiceover.required,true);
  assert.equal(brief({voiceover:{dir:"vo",required:false}}).voiceover.required,false);
});

test("SSML keeps narration as text", () => {
  const x = ssml(`a < b & "c" </voice><voice name='evil'>`, "en-US-AndrewMultilingualNeural", "+5%");
  assert.equal((x.match(/<voice /g) ?? []).length, 1);
  assert.ok(x.includes("a &lt; b &amp; &quot;c&quot; &lt;/voice&gt;"));
  assert.ok(x.includes('xml:lang="en-US"'));
});

test("a recording motion-use did not make is never replaced without --force", async () => {
  const f = path.join(tmp, "vo", "en", "a.mp3");
  fs.writeFileSync(f, "my own recording");
  const res = await generateVoiceover(brief(), { engine: "edge" });
  assert.equal(res.rows[0].status, "kept");
  assert.equal(fs.readFileSync(f, "utf8"), "my own recording");
  fs.rmSync(f);
});

test("generated audio whose text did not change is left alone", async () => {
  const f = path.join(tmp, "vo", "en", "a.mp3");
  fs.writeFileSync(f, "generated earlier");
  const sha = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const rec = { text: "Hello there.", engine: "edge", voice: "en-US-AndrewMultilingualNeural", rate: "+0%", sha };
  fs.writeFileSync(path.join(tmp, "vo", MANIFEST), JSON.stringify({ [path.join("en", "a.mp3")]: rec }));
  const res = await generateVoiceover(brief(), { engine: "edge" });
  assert.equal(res.rows[0].status, "unchanged");
});

test("azure is picked only when it is configured", () => {
  const saved = { k: process.env.AZURE_SPEECH_KEY, r: process.env.AZURE_SPEECH_REGION };
  delete process.env.AZURE_SPEECH_KEY;
  assert.equal(pickEngine(), "edge");
  process.env.AZURE_SPEECH_KEY = "k";
  process.env.AZURE_SPEECH_REGION = "eastus";
  assert.equal(pickEngine(), "azure");
  assert.equal(pickEngine("edge"), "edge");
  if (saved.k === undefined) delete process.env.AZURE_SPEECH_KEY; else process.env.AZURE_SPEECH_KEY = saved.k;
  if (saved.r === undefined) delete process.env.AZURE_SPEECH_REGION; else process.env.AZURE_SPEECH_REGION = saved.r;
});

test("sizes parse in decimal megabytes", () => {
  assert.equal(parseSize("9MB"), 9e6);
  assert.equal(parseSize("9.5M"), 9.5e6);
  assert.equal(parseSize("9000000"), 9e6);
  assert.equal(parseSize(null), null);
  assert.equal(parseSize("abc"), undefined);
  assert.equal(parseSize("1kb"), undefined); // below 100 KB is never a sensible video limit
});

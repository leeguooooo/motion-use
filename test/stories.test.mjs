import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateBrief } from "../src/brief.mjs";

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "templates", "stories");

test("every story template is a valid brief with a distinct scene sequence", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-stories-"));
  fs.mkdirSync(path.join(tmp, "voiceover"));
  const seqs = new Set();
  for (const f of fs.readdirSync(dir)) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const { errors, brief } = validateBrief(data, tmp);
    assert.deepEqual(errors, [], f);
    seqs.add(brief.scenes.map((s) => s.type).join(">"));
  }
  assert.equal(seqs.size, fs.readdirSync(dir).length, "two stories share the same scene sequence");
});

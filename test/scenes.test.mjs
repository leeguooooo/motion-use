import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateBrief } from "../src/brief.mjs";
import { buildProject, plan } from "../src/build.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-scenes-"));
const v = (scenes, over = {}) => validateBrief({ version: 1, name: "s", languages: ["en"], formats: ["landscape", "vertical"], music: "none", cover: "animate", scenes, ...over }, tmp);
const errs = (scenes) => v(scenes).errors.map((e) => e.path);

test("new scene types validate", () => {
  assert.deepEqual(v([
    { type: "stat", value: "80%", label: "faster" },
    { type: "compare", left: { label: "Before", points: ["slow"] }, right: { label: "After", points: ["fast"] } },
    { type: "kinetic", lines: ["One", "Two"] },
    { type: "code", lines: ["a", { add: "b" }, { del: "c" }] },
  ]).errors, []);
  assert.ok(errs([{ type: "compare", left: { label: "x" }, right: { label: "y", points: ["z"] } }]).includes("$.scenes[0].left"));
  assert.ok(errs([{ type: "code", lines: [{ add: "a", del: "b" }] }]).includes("$.scenes[0].lines[0]"));
  assert.ok(errs([{ type: "kinetic", lines: ["a"], beat: 9 }]).includes("$.scenes[0].beat"));
});

test("layouts and transitions are checked per scene", () => {
  assert.ok(errs([{ type: "title", title: "x", layout: "diagonal" }]).includes("$.scenes[0].layout"));
  assert.ok(errs([{ type: "stat", value: "1", label: "x", layout: "left" }]).includes("$.scenes[0].layout"));
  assert.ok(errs([{ type: "title", title: "x", layout: "split" }]).includes("$.scenes[0].image"));
  assert.ok(errs([{ type: "title", title: "x", transition: "spin" }]).includes("$.scenes[0].transition"));
});

test("a stat counts its integer up; other values just appear", () => {
  const p = plan(v([{ type: "stat", value: "$1,200", label: "saved" }, { type: "stat", value: "v2", label: "x" }, { type: "stat", value: "3.5x", label: "y" }]).brief, "en", "landscape");
  assert.ok(p.scenes[0].html.includes("--mu-to:1200"));
  assert.ok(!p.scenes[1].html.includes("--mu-to") || p.scenes[1].html.includes("--mu-to:2"));
  assert.ok(!p.scenes[2].html.includes("--mu-to"), "decimals are shown as written, not counted");
});

test("the next scene's transition decides how the current one leaves", async () => {
  const { brief } = v([{ id: "a", type: "title", title: "A" }, { id: "b", type: "title", title: "B", transition: "slide" }, { id: "c", type: "title", title: "C", transition: "cut" }]);
  const dir = path.join(tmp, "t");
  await buildProject(brief, "en", "landscape", dir);
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const anim = (id) => html.match(new RegExp(`id="scene-${id}"[^>]*style="animation:([^"]*)"`))[1];
  assert.match(anim("a"), /mu-out-slide/);
  assert.match(anim("b"), /mu-in-slide/);
  assert.match(anim("b"), /mu-out-hold [^,]*steps\(1, start\)/);
  assert.match(anim("c"), /mu-in-cut/);
});

test("compare marks the better side", () => {
  const p = plan(v([{ type: "compare", left: { label: "A", points: ["x"] }, right: { label: "B", points: ["y"] } }]).brief, "en", "vertical");
  assert.match(p.scenes[0].html, /mu-compare-side mu-lose[\s\S]*↓[\s\S]*mu-compare-side mu-win/);
});

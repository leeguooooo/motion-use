// Run the pinned HyperFrames CLI that ships in motion-use's own node_modules.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export function hyperframesBin() {
  const pkg = require.resolve("hyperframes/package.json");
  const meta = JSON.parse(fs.readFileSync(pkg, "utf8"));
  return { bin: path.join(path.dirname(pkg), meta.bin.hyperframes), version: meta.version };
}

// The pinned engine runs quietly: telemetry off, no update check, no self-update.
// Names checked against hyperframes 0.8.123: commands/telemetry.ts (HYPERFRAMES_NO_TELEMETRY,
// DO_NOT_TRACK) and utils/autoUpdate.ts (HYPERFRAMES_NO_UPDATE_CHECK, HYPERFRAMES_NO_AUTO_INSTALL).
export const HF_ENV = { HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_NO_AUTO_INSTALL: "1" };

/** Run `hyperframes <args>`; resolves with { code, out } and never throws on a non-zero exit. */
export function runHyperframes(args, { cwd, echo = false } = {}) {
  const { bin } = hyperframesBin();
  return new Promise((resolve, reject) => {
    // Multi-worker capture otherwise stores every frame on disk (≈1.7 GB for a 55 s 1080p film)
    // and refuses to start when space is short; streaming encodes as it captures.
    const stream = { HF_CAPTURE_PARALLEL_STREAM: process.env.HF_CAPTURE_PARALLEL_STREAM ?? "true" };
    const child = spawn(process.execPath, [bin, ...args], { cwd, env: { ...process.env, ...HF_ENV, ...stream, FORCE_COLOR: "0", NO_COLOR: "1" } });
    let out = "";
    const take = (d) => {
      out += d;
      if (echo) process.stderr.write(d);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

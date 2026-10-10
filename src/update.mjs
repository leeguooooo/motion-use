// `motion-use upgrade` and the daily "new version" notice, per the *-use family
// convention (leeguooooo/plugins docs/upgrade.md).
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO = "leeguooooo/motion-use";
export const INSTALLER = `https://raw.githubusercontent.com/${REPO}/main/install.sh`;
const CACHE = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "motion-use", "update-check.json");
const DAY = 24 * 3600;

const newer = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

export async function latestRelease(timeoutMs = 2000) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "motion-use" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (res.ok) {
    const { tag_name } = await res.json();
    return String(tag_name).replace(/^v/, "");
  }
  // The anonymous API is rate-limited per IP (403/429 on shared networks). The releases page
  // redirects to the latest tag without that limit.
  const page = await fetch(`https://github.com/${REPO}/releases/latest`, { method: "HEAD", redirect: "manual", headers: { "User-Agent": "motion-use" }, signal: AbortSignal.timeout(timeoutMs) });
  const tag = (page.headers.get("location") ?? "").match(/\/tag\/v?([0-9]+\.[0-9]+\.[0-9]+)$/)?.[1];
  if (!tag) throw new Error(`GitHub API returned ${res.status} and the releases page gave no tag`);
  return tag;
}

/** Print one line to stderr when a newer release exists; at most one network check per day; silent on any failure. */
export async function maybeNotify(current) {
  if (process.env.CI || process.env.MOTION_USE_NO_UPDATE_CHECK || process.env.USE_NO_UPDATE_CHECK) return;
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  } catch {}
  const now = Math.floor(Date.now() / 1000);
  if (!cache.checked_at || now - cache.checked_at > DAY) {
    let latest = cache.latest;
    try {
      latest = await latestRelease();
    } catch {}
    cache = { checked_at: now, latest };
    try {
      fs.mkdirSync(path.dirname(CACHE), { recursive: true });
      fs.writeFileSync(CACHE, JSON.stringify(cache));
    } catch {}
  }
  if (cache.latest && newer(cache.latest, current)) process.stderr.write(`motion-use ${cache.latest} is available (you have ${current}). Upgrade: motion-use upgrade\n`);
}

/** Where the SKILL.md lives, per channel. */
export function findSkills() {
  const found = [];
  const home = os.homedir();
  try {
    const installed = JSON.parse(fs.readFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"), "utf8"));
    const keys = Object.keys(installed.plugins ?? installed).filter((k) => k.startsWith("motion-use@"));
    for (const k of keys) found.push({ channel: "claude-plugin", path: k, update: `claude plugin update ${k}` });
  } catch {}
  for (const dir of [".agents/skills", ".claude/skills", ".codex/skills"]) {
    const p = path.join(home, dir, "motion-use");
    if (!fs.existsSync(path.join(p, "SKILL.md"))) continue;
    const real = fs.realpathSync(p);
    let git = false;
    try {
      execFileSync("git", ["-C", real, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
      git = true;
    } catch {}
    const receipt = findReceipt(real);
    if (receipt) found.push({ channel: "installer", path: p, update: "refreshed by the installer" });
    else if (git) found.push({ channel: "git", path: p, real, update: `git -C "${real}" pull --ff-only` });
    else found.push({ channel: "copied", path: p, update: "npx skills update motion-use" });
  }
  return found;
}

function findReceipt(dir) {
  for (let d = dir, i = 0; i < 4; i++, d = path.dirname(d)) if (fs.existsSync(path.join(d, ".motion-use-install.json"))) return d;
  return null;
}

export async function upgrade({ current, root, check, json }) {
  const skills = findSkills();
  let latest;
  try {
    latest = await latestRelease(5000);
  } catch (e) {
    if (json) console.log(JSON.stringify({ name: "motion-use", current, latest: null, update_available: false, error: e.message, skills }, null, 2));
    else console.error(`motion-use: cannot check for updates: ${e.message}`);
    return 2;
  }
  const available = newer(latest, current);
  if (json || check) {
    if (json) console.log(JSON.stringify({ name: "motion-use", current, latest, update_available: available, skills }, null, 2));
    else console.log(available ? `motion-use ${current} -> ${latest}` : `motion-use ${current} is up to date`);
    return 0;
  }
  if (!available) console.log(`motion-use ${current} is up to date`);
  else if (!findReceipt(root)) {
    console.log(`motion-use ${latest} is available, but this copy was not installed by install.sh (${root}).`);
    console.log(fs.existsSync(path.join(root, ".git")) ? `Update it with: git -C ${root} pull --ff-only && npm ci --omit=dev` : `Install the release with: curl -fsSL ${INSTALLER} | sh`);
  } else {
    console.log(`motion-use ${current} -> ${latest}`);
    // Download first, so a failed download is an error instead of an empty script piped to sh.
    const receiptDir = findReceipt(root);
    const receipt = JSON.parse(fs.readFileSync(path.join(receiptDir, ".motion-use-install.json"), "utf8"));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motion-use-upgrade-"));
    const script = path.join(tmp, "install.sh");
    try {
      const res = await fetch(INSTALLER, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(script, await res.text());
    } catch (e) {
      console.error(`motion-use: cannot download the installer: ${e.message}`);
      return 2;
    }
    // Reinstall into the same places the current install used.
    const env = { ...process.env, MOTION_USE_HOME: receipt.home, MOTION_USE_BIN_DIR: receipt.bin_dir, MOTION_USE_VERSION: latest };
    const r = spawnSync("sh", [script], { stdio: "inherit", env });
    fs.rmSync(tmp, { recursive: true, force: true });
    if (r.status !== 0) return 2;
  }
  for (const s of skills) {
    if (s.channel === "claude-plugin") {
      const r = spawnSync("claude", ["plugin", "update", s.path.replace(/@.*/, "@leeguooooo-plugins")], { stdio: "inherit" });
      if (r.error) console.log(`skill (claude plugin): run ${s.update}`);
    } else if (s.channel === "git") {
      const r = spawnSync("git", ["-C", s.real, "pull", "--ff-only"], { stdio: "inherit" });
      if (r.status !== 0) console.log(`skill (git): could not fast-forward ${s.path}; left as is`);
    } else console.log(`skill (${s.channel}) at ${s.path}: ${s.update}`);
  }
  return 0;
}

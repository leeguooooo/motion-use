// Load and validate a brief. Every problem is reported with a JSON path, so a
// human or an agent can fix the brief without reading this file.
import fs from "node:fs";
import path from "node:path";

export const STYLES = ["promo", "explainer"];
export const FORMATS = { landscape: [1920, 1080], vertical: [1080, 1920] };
export const FPS_VALUES = [24, 25, 30, 60];
export const SCENE_TYPES = ["title", "terminal", "steps", "diagram", "features", "image", "cta"];
const AUDIO_EXT = [".mp3", ".wav", ".m4a", ".aac", ".ogg"];
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const THEME_KEYS = ["accent", "background", "text"];
const TONES = ["ok", "warn", "dim", "error"];

class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }
  error(p, message) {
    this.errors.push({ path: p, message });
  }
  warn(p, message) {
    this.warnings.push({ path: p, message });
  }
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function readBrief(file) {
  const abs = path.resolve(file);
  let raw;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (e) {
    throw new BriefError(`cannot read brief ${file}: ${e.code ?? e.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new BriefError(`${file} is not valid JSON: ${e.message}`);
  }
  return { data, dir: path.dirname(abs), file: abs };
}

export class BriefError extends Error {}

/**
 * Validate and normalize. Returns { brief, errors, warnings }; `brief` is only
 * safe to use when errors is empty.
 */
export function validateBrief(data, baseDir) {
  const r = new Report();
  if (!isObj(data)) {
    r.error("$", "the brief must be a JSON object");
    return { brief: null, errors: r.errors, warnings: r.warnings };
  }
  const known = ["$schema", "version", "name", "style", "languages", "formats", "fps", "theme", "music", "sfx", "voiceover", "product", "scenes"];
  for (const k of Object.keys(data)) if (!known.includes(k)) r.warn(`$.${k}`, `unknown field, ignored (known: ${known.join(", ")})`);

  if (data.version !== 1) r.error("$.version", "must be 1");
  const name = data.name ?? "video";
  if (typeof name !== "string" || !ID_RE.test(name)) r.error("$.name", "lowercase letters, digits and dashes, up to 40 characters (used in output file names)");
  const style = data.style ?? "promo";
  if (!STYLES.includes(style)) r.error("$.style", `must be one of: ${STYLES.join(", ")}`);

  const languages = data.languages ?? ["en"];
  // Plain-object lookups below use Object.hasOwn so "__proto__" or "toString" never pass as a value.
  if (!Array.isArray(languages) || languages.length === 0) r.error("$.languages", 'a non-empty array, e.g. ["zh", "en"]');
  else languages.forEach((l, i) => typeof l === "string" && LANG_RE.test(l) ? null : r.error(`$.languages[${i}]`, "a language code like zh, en or pt-BR"));
  if (Array.isArray(languages) && new Set(languages).size !== languages.length) r.error("$.languages", "contains duplicates");

  const formats = data.formats ?? ["landscape"];
  if (!Array.isArray(formats) || formats.length === 0) r.error("$.formats", `a non-empty array of: ${Object.keys(FORMATS).join(", ")}`);
  else {
    formats.forEach((f, i) => (typeof f === "string" && Object.hasOwn(FORMATS, f) ? null : r.error(`$.formats[${i}]`, `must be one of: ${Object.keys(FORMATS).join(", ")}`)));
    if (new Set(formats).size !== formats.length) r.error("$.formats", "contains duplicates");
  }

  const fps = data.fps ?? 30;
  if (!FPS_VALUES.includes(fps)) r.error("$.fps", `must be one of: ${FPS_VALUES.join(", ")}`);

  const rawTheme = data.theme ?? {};
  const theme = {}; // only validated keys survive; the rest never reaches the CSS
  if (!isObj(rawTheme)) r.error("$.theme", "must be an object");
  else
    for (const [k, v] of Object.entries(rawTheme)) {
      if (!THEME_KEYS.includes(k)) r.error(`$.theme.${k}`, `unknown theme key (known: ${THEME_KEYS.join(", ")})`);
      else if (typeof v !== "string" || !HEX_RE.test(v)) r.error(`$.theme.${k}`, 'a 6-digit hex color like "#7cf2b0"');
      else theme[k] = v;
    }

  const langs = Array.isArray(languages) ? languages.filter((l) => typeof l === "string") : [];
  const text = (v, p, { required = true, max = 400 } = {}) => {
    if (v === undefined || v === null) {
      if (required) r.error(p, "required");
      return undefined;
    }
    const out = {};
    if (typeof v === "string") for (const l of langs) out[l] = v;
    else if (isObj(v)) {
      for (const l of langs) {
        if (!Object.hasOwn(v, l) || typeof v[l] !== "string") r.error(`${p}.${l}`, `missing ${l} text (give a string for every language, or one plain string for all)`);
        else out[l] = v[l];
      }
    } else {
      r.error(p, 'a string, or an object of strings per language like {"zh": "…", "en": "…"}');
      return undefined;
    }
    for (const [l, s] of Object.entries(out)) if (s.length > max) r.error(`${p}.${l}`, `too long (${s.length} characters, max ${max})`);
    return out;
  };
  const file = (v, p, exts, kind) => {
    if (typeof v !== "string" || v.length === 0) {
      r.error(p, `a path to a local ${kind} file`);
      return undefined;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[a-z]:[\\/]/i.test(v)) {
      r.error(p, `must be a local file, not a URL (rendering never touches the network); download it first`);
      return undefined;
    }
    const abs = path.resolve(baseDir, v);
    if (!exts.includes(path.extname(abs).toLowerCase())) r.error(p, `unsupported ${kind} type; use ${exts.join(", ")}`);
    else if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) r.error(p, `file not found: ${abs}`);
    return abs;
  };

  let music = data.music ?? "builtin";
  if (music === "builtin" || music === "none") music = { kind: music, volume: 0.5 };
  else if (isObj(music)) {
    const volume = music.volume ?? 0.5;
    if (!Number.isFinite(volume) || volume < 0 || volume > 2) r.error("$.music.volume", "a number from 0 to 2");
    music = { kind: "file", file: file(music.file, "$.music.file", AUDIO_EXT, "audio"), volume };
  } else r.error("$.music", '"builtin", "none", or {"file": "path", "volume": 0.5}');

  const sfx = data.sfx ?? true;
  if (typeof sfx !== "boolean") r.error("$.sfx", "true or false");

  const vo = data.voiceover ?? null;
  let voiceover = null;
  if (vo !== null) {
    if (!isObj(vo)) r.error("$.voiceover", 'an object like {"dir": "voiceover"}');
    else {
      const volume = vo.volume ?? 1;
      if (!Number.isFinite(volume) || volume < 0 || volume > 3) r.error("$.voiceover.volume", "a number from 0 to 3");
      let dir = null;
      if (vo.dir !== undefined) {
        if (typeof vo.dir !== "string") r.error("$.voiceover.dir", "a directory path");
        else {
          dir = path.resolve(baseDir, vo.dir);
          if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) r.error("$.voiceover.dir", `directory not found: ${dir}`);
        }
      }
      voiceover = { dir, volume };
    }
  }

  const product = data.product ?? {};
  if (!isObj(product)) r.error("$.product", "must be an object");

  const scenes = [];
  if (!Array.isArray(data.scenes) || data.scenes.length === 0) r.error("$.scenes", "a non-empty array of scenes");
  else if (data.scenes.length > 20) r.error("$.scenes", "at most 20 scenes");
  else {
    const ids = new Set();
    data.scenes.forEach((s, i) => {
      const p = `$.scenes[${i}]`;
      if (!isObj(s)) return r.error(p, "must be an object");
      const id = s.id ?? `scene-${i + 1}`;
      if (typeof id !== "string" || !ID_RE.test(id)) r.error(`${p}.id`, "lowercase letters, digits and dashes");
      else if (ids.has(id)) r.error(`${p}.id`, `duplicate id "${id}"`);
      ids.add(id);
      if (!SCENE_TYPES.includes(s.type)) return r.error(`${p}.type`, `must be one of: ${SCENE_TYPES.join(", ")}`);
      const scene = { id, type: s.type };
      if (s.duration !== undefined) {
        if (!Number.isFinite(s.duration) || s.duration < 1 || s.duration > 60) r.error(`${p}.duration`, "seconds, from 1 to 60");
        else scene.duration = s.duration;
      }
      if (s.voiceover !== undefined) {
        if (!isObj(s.voiceover)) r.error(`${p}.voiceover`, 'an object of audio paths per language, like {"zh": "vo/zh/hook.mp3"}');
        else {
          scene.voiceover = {};
          for (const [l, f] of Object.entries(s.voiceover)) {
            if (!langs.includes(l)) r.warn(`${p}.voiceover.${l}`, `language ${l} is not in $.languages, ignored`);
            else scene.voiceover[l] = file(f, `${p}.voiceover.${l}`, AUDIO_EXT, "audio");
          }
        }
      }
      SCENE_FIELDS[s.type](s, scene, p, { r, text, file });
      scenes.push(scene);
    });
  }

  // Find voiceover files by convention: <dir>/<lang>/<scene-id>.<ext>
  if (voiceover?.dir && fs.existsSync(voiceover.dir) && fs.statSync(voiceover.dir).isDirectory()) {
    for (const scene of scenes) {
      for (const l of langs) {
        if (scene.voiceover?.[l]) continue;
        const hit = AUDIO_EXT.map((e) => path.join(voiceover.dir, l, scene.id + e)).find((f) => fs.existsSync(f));
        if (hit) (scene.voiceover ??= {})[l] = hit;
      }
    }
    for (const l of langs) {
      const n = scenes.filter((s) => s.voiceover?.[l]).length;
      if (n === 0) r.warn("$.voiceover.dir", `no voiceover for ${l} yet (optional); to add it, put ${path.join(voiceover.dir, l, "<scene-id>.mp3")}`);
      else if (n < scenes.length) r.warn("$.voiceover.dir", `${l}: ${scenes.length - n} of ${scenes.length} scenes have no voiceover file`);
    }
  }

  const brief = { version: 1, name, style, languages: langs, formats, fps, theme, music, sfx, voiceover, product: isObj(product) ? product : {}, scenes };
  return { brief, errors: r.errors, warnings: r.warnings };
}

const arr = (v, p, r, min, max, what) => {
  if (!Array.isArray(v)) {
    r.error(p, `an array of ${what}`);
    return [];
  }
  if (v.length < min || v.length > max) r.error(p, `${min} to ${max} ${what}`);
  return v.slice(0, max);
};

const SCENE_FIELDS = {
  title(s, out, p, { text }) {
    out.title = text(s.title, `${p}.title`, { max: 120 });
    out.subtitle = text(s.subtitle, `${p}.subtitle`, { required: false, max: 160 });
  },
  terminal(s, out, p, { r, text }) {
    out.title = text(s.title, `${p}.title`, { required: false, max: 120 });
    const panes = arr(s.panes ?? [{ label: "Terminal" }], `${p}.panes`, r, 1, 2, "panes");
    out.panes = panes.map((pane, i) => ({
      label: text(pane?.label, `${p}.panes[${i}].label`, { max: 40 }),
      accent: pane?.accent !== undefined && !HEX_RE.test(pane.accent) ? (r.error(`${p}.panes[${i}].accent`, "a 6-digit hex color"), undefined) : pane?.accent,
    }));
    out.lines = arr(s.lines, `${p}.lines`, r, 1, 14, "lines").map((line, i) => {
      const lp = `${p}.lines[${i}]`;
      if (!isObj(line)) return r.error(lp, '{"cmd": "…"} or {"out": "…"}'), null;
      const pane = line.pane ?? 0;
      if (!Number.isInteger(pane) || pane < 0 || pane >= out.panes.length) r.error(`${lp}.pane`, `0${out.panes.length > 1 ? " or 1" : ""}`);
      if ((line.cmd === undefined) === (line.out === undefined)) return r.error(lp, 'exactly one of "cmd" (typed command) or "out" (printed output)'), null;
      const tone = line.tone ?? (line.cmd !== undefined ? undefined : "ok");
      if (tone !== undefined && !TONES.includes(tone)) r.error(`${lp}.tone`, `one of: ${TONES.join(", ")}`);
      return line.cmd !== undefined
        ? { pane, kind: "cmd", text: text(line.cmd, `${lp}.cmd`, { max: 160 }) }
        : { pane, kind: "out", tone, text: text(line.out, `${lp}.out`, { max: 200 }) };
    }).filter(Boolean);
  },
  steps(s, out, p, { r, text }) {
    out.title = text(s.title, `${p}.title`, { max: 120 });
    out.steps = arr(s.steps, `${p}.steps`, r, 2, 6, "steps").map((st, i) =>
      isObj(st)
        ? { title: text(st.title, `${p}.steps[${i}].title`, { max: 60 }), body: text(st.body, `${p}.steps[${i}].body`, { required: false, max: 140 }) }
        : { title: text(st, `${p}.steps[${i}]`, { max: 60 }) },
    );
  },
  diagram(s, out, p, { r, text }) {
    out.title = text(s.title, `${p}.title`, { max: 120 });
    const ids = new Set();
    out.nodes = arr(s.nodes, `${p}.nodes`, r, 2, 5, "nodes").map((n, i) => {
      const np = `${p}.nodes[${i}]`;
      if (!isObj(n)) return r.error(np, '{"id": "…", "label": "…"}'), null;
      if (typeof n.id !== "string" || !ID_RE.test(n.id)) r.error(`${np}.id`, "lowercase letters, digits and dashes");
      else if (ids.has(n.id)) r.error(`${np}.id`, `duplicate node id "${n.id}"`);
      ids.add(n.id);
      return { id: n.id, label: text(n.label, `${np}.label`, { max: 40 }), note: text(n.note, `${np}.note`, { required: false, max: 60 }) };
    }).filter(Boolean);
    out.edges = arr(s.edges ?? [], `${p}.edges`, r, 0, 8, "edges").map((e, i) => {
      const ep = `${p}.edges[${i}]`;
      if (!isObj(e)) return r.error(ep, '{"from": "<node id>", "to": "<node id>"}'), null;
      for (const k of ["from", "to"]) if (!ids.has(e[k])) r.error(`${ep}.${k}`, `unknown node id "${e[k]}"`);
      if (e.from === e.to) r.error(ep, "an edge needs two different nodes");
      return { from: e.from, to: e.to, label: text(e.label, `${ep}.label`, { required: false, max: 30 }) };
    }).filter(Boolean);
  },
  features(s, out, p, { r, text }) {
    out.title = text(s.title, `${p}.title`, { max: 120 });
    out.subtitle = text(s.subtitle, `${p}.subtitle`, { required: false, max: 160 });
    out.items = arr(s.items, `${p}.items`, r, 1, 6, "items").map((it, i) => text(it, `${p}.items[${i}]`, { max: 40 }));
  },
  image(s, out, p, { text, file }) {
    out.title = text(s.title, `${p}.title`, { required: false, max: 120 });
    out.caption = text(s.caption, `${p}.caption`, { required: false, max: 160 });
    out.image = file(s.image, `${p}.image`, IMAGE_EXT, "image");
  },
  cta(s, out, p, { text }) {
    out.title = text(s.title, `${p}.title`, { max: 40 });
    out.subtitle = text(s.subtitle, `${p}.subtitle`, { required: false, max: 160 });
    out.command = text(s.command, `${p}.command`, { required: false, max: 120 });
    out.url = text(s.url, `${p}.url`, { required: false, max: 80 });
  },
};

/** Every string in the brief that will be drawn for these languages (for font subsetting and coverage checks). */
export function collectText(brief, langs = brief.languages) {
  const out = [];
  const walk = (v) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (isObj(v)) {
      const keys = Object.keys(v);
      if (keys.length && keys.every((k) => brief.languages.includes(k)) && keys.every((k) => typeof v[k] === "string")) {
        for (const l of langs) if (v[l]) out.push(v[l]);
        return;
      }
      for (const [k, val] of Object.entries(v)) if (!["id", "type", "image", "voiceover", "accent", "kind", "tone", "from", "to", "pane"].includes(k)) walk(val);
    }
  };
  walk(brief.scenes);
  return out.join("\n");
}

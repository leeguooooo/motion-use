import { spoken, displayed } from "./caption-plan.mjs";
import fs from "node:fs";
import path from "node:path";
import { DELIVERY_RE, validateBrief } from "./brief.mjs";
import { audioSeconds } from "./build.mjs";
import { generateVoiceover, narrationFreshness } from "./voiceover.mjs";
import { scheduleLines } from "./footage-speed.mjs";

const contained = (base, file) => {
  const r = path.relative(base, file);
  return (
    r !== "" &&
    r !== ".." &&
    !r.startsWith(".." + path.sep) &&
    !path.isAbsolute(r)
  );
};
// A shot's audio tags ("[curious]"): spoken before its narration, never captioned.
function shotDelivery(s, error) {
  if (s.delivery === undefined) return {};
  if (typeof s.delivery !== "string" || (s.delivery.trim() && !DELIVERY_RE.test(s.delivery.trim()))) {
    error(`$.shots.${s.id}.delivery`, 'ElevenLabs audio tags in square brackets, like "[curious]" or "[calm, conversational]" (1–4 tags); spoken, never captioned');
    return {};
  }
  return s.delivery.trim() ? { delivery: s.delivery.trim() } : {};
}
export function resolveNarration(
  film,
  {
    error = () => {},
    warn = () => {},
    requireFiles = false,
    skipGenerated = false,
    probe = audioSeconds,
    anchorTime = null,
  } = {},
) {
  const languages = Array.isArray(film.languages) ? film.languages : [];
  if (film.voiceover === false)
    return { config: null, plans: [], pending: [], tracks: [] };
  const raw = film.voiceover ?? {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    error(
      "$.voiceover",
      "settings object, or false only for an intentionally silent film",
    );
    return { plans: [], pending: [], tracks: [] };
  }
  const checked = validateBrief(
    {
      version: 1,
      name: "voice",
      languages: languages.length ? languages : ["en"],
      voiceover: { ...raw, dir: undefined },
      scenes: [{ id: "voice", type: "title", title: "Voice" }],
    },
    film.dir,
  );
  checked.errors
    .filter((e) => e.path.startsWith("$.voiceover"))
    .forEach((e) => error(e.path, e.message));
  const relative = raw.dir ?? "voiceover",
    dir =
      typeof relative === "string" ? path.resolve(film.dir, relative) : null;
  if (
    !dir ||
    path.isAbsolute(relative) ||
    /[\\\x00-\x1f]|^[a-z]+:/i.test(relative) ||
    !contained(film.dir, dir)
  )
    error("$.voiceover.dir", "a relative directory inside the film project");
  else {
    if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory())
      error("$.voiceover.dir", "must be a directory");
    let parent = dir;
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    const real = fs.realpathSync(parent),
      base = fs.realpathSync(film.dir);
    if (real !== base && !contained(base, real))
      error("$.voiceover.dir", "directory symlink escapes the project");
  }
  // baseRates: before pace, so a pinned snapshot does not apply pace twice.
  const config = { ...checked.brief.voiceover, dir, baseRates: checked.brief.voiceover?.rates ?? {} };
  if (film.pace !== undefined && Number.isFinite(film.pace) && film.pace >= 0.5 && film.pace <= 2) {
    config.rates = Object.fromEntries(languages.map((lang) => {
      const base = parseFloat(config.rates[lang] ?? "+0%");
      const rate = Math.round(((1 + base / 100) * film.pace - 1) * 100);
      if (rate <= -100 || rate > 200) error("$.pace", `effective ${lang} speech rate is outside -99%..+200%; reduce voiceover.rate or pace`);
      return [lang, `${rate >= 0 ? "+" : ""}${rate}%`];
    }));
  }
  const map = (v, p, select = spoken) => {
    const out = {};
    for (const l of languages) {
      const value = typeof v === "string" ? v : v?.[l];
      const text = select(value);
      if (typeof text !== "string" || !text.trim() || text.length > 4000)
        error(
          `${p}.${l}`,
          "non-empty narration text for every language, at most 4000 characters",
        );
      else out[l] = text;
    }
    return out;
  };
  const lines = Array.isArray(film.narration) ? narrationLines(film, { error, warn, map, anchorTime }) : null;
  const plans = lines
    ? lines
    : film.narration !== undefined
      ? [
          {
            id: "narration",
            start: 0.1,
            end: film.duration - 0.1,
            narration: map(film.narration, "$.narration"),
            display: map(film.narration, "$.narration", displayed),
          },
        ]
      : (Array.isArray(film.shots) ? film.shots : [])
          .filter((s) => s?.narration !== undefined)
          .map((s) => ({
            id: s.id,
            start: s.start + 0.08,
            end: s.end - 0.08,
            narration: map(s.narration, `$.shots.${s.id}.narration`),
            display: map(s.narration, `$.shots.${s.id}.narration`, displayed),
            ...shotDelivery(s, error),
          }));
  const tracks = [],
    pending = [];
  for (const l of languages) {
    const imported = (film.tracks ?? []).filter(
      (a) => a.role === "voiceover" && (!a.lang || a.lang === l),
    );
    if (imported.length) continue;
    if (!plans.some((p) => p.narration[l])) {
      error(
        `$.narration.${l}`,
        "voiceover is required: add narration to shots, a film narration script, or a voiceover audio track; set voiceover:false only when silence is intended",
      );
      continue;
    }
    for (const p of plans) {
      if (!p.narration[l]) continue;
      const file =
        dir &&
        [".wav", ".m4a", ".aac", ".ogg", ".mp3"]
          .map((ext) => path.join(dir, l, p.id + ext))
          .find((f) => fs.existsSync(f));
      if (!file || skipGenerated) {
        pending.push({ id: p.id, lang: l });
        if (
          (requireFiles === true ||
            (Array.isArray(requireFiles) && requireFiles.includes(l))) &&
          !skipGenerated
        )
          error(
            `$.voiceover.${l}.${p.id}`,
            "missing narration audio; run motion-use voiceover or render to generate it",
          );
        continue;
      }
      if (!contained(fs.realpathSync(film.dir), fs.realpathSync(file))) {
        error(
          `$.voiceover.${l}.${p.id}`,
          "voiceover file symlink escapes the project",
        );
        continue;
      }
      try {
        const freshness = narrationFreshness(dir, file, p.narration[l], config, l, { delivery: p.delivery });
        if (!freshness.imported && !freshness.current) {
          error(`$.voiceover.${l}.${p.id}`, "stale narration: script, settings or audio hash changed; regenerate voiceover");
          continue;
        }
        const length = probe(file);
        if (!lines && length > p.end - p.start + 0.02)
          error(
            `$.voiceover.${l}.${p.id}`,
            `${length.toFixed(3)}s narration exceeds its ${(p.end - p.start).toFixed(3)}s shot window; retime the shot or shorten the script (never truncate speech)`,
          );
        tracks.push({
          file,
          lang: l,
          id: p.id,
          role: "voiceover",
          start: p.start,
          offset: 0,
          length,
          volume: config.volume ?? 1,
          generated: true,
        });
      } catch (e) {
        error(`$.voiceover.${l}.${p.id}`, e.message);
      }
    }
  }
  const schedule = lines ? scheduleNarrationLines(film, lines, tracks, { error, warn }) : [];
  if (pending.length && !requireFiles)
    warn(
      "$.voiceover",
      `${pending.length} narration clip(s) await generation; render generates them before capture`,
    );
  return { config, plans, pending, tracks, schedule };
}

const LINE_KEYS = new Set(["id", "text", "at", "gap"]);
// Root narration as a list of lines, each placed at a film second or a footage moment.
function narrationLines(film, { error, warn, map, anchorTime }) {
  const seen = new Set(), shotIds = new Set((Array.isArray(film.shots) ? film.shots : []).map((s) => s?.id));
  const end = Number.isFinite(film.duration) ? film.duration - 0.1 : Infinity;
  const out = [];
  film.narration.forEach((line, i) => {
    const p = `$.narration[${i}]`;
    if (!line || typeof line !== "object" || Array.isArray(line)) return error(p, "a narration line {id, text, at, gap?}");
    for (const k of Object.keys(line)) if (!LINE_KEYS.has(k)) error(`${p}.${k}`, "unknown field; a line has id, text, at and gap");
    if (typeof line.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/i.test(line.id) || line.id === "narration")
      return error(`${p}.id`, "a line id: a letter, then letters, digits or - (names the audio file)");
    if (seen.has(line.id) || shotIds.has(line.id)) return error(`${p}.id`, `duplicate id ${line.id}; line ids are unique and differ from shot ids`);
    seen.add(line.id);
    if (line.gap !== undefined && !(Number.isFinite(line.gap) && line.gap >= 0 && line.gap <= 10)) error(`${p}.gap`, "seconds of silence after the previous line, 0–10 (default 0.4)");
    let anchor = null, source = null;
    const at = line.at;
    if (typeof at === "number") {
      if (!(Number.isFinite(at) && at >= 0 && at < end)) error(`${p}.at`, `a film second inside 0–${end.toFixed(3)}`);
      else anchor = at;
    } else if (at && typeof at === "object" && !Array.isArray(at)) {
      for (const k of Object.keys(at)) if (!["footage", "t", "mark", "offset"].includes(k)) error(`${p}.at.${k}`, "unknown field; a footage anchor has footage, t or mark, and offset");
      if (at.offset !== undefined && !(Number.isFinite(at.offset) && Math.abs(at.offset) <= 600)) error(`${p}.at.offset`, "seconds before (negative) or after the moment, at most 600");
      else if (!anchorTime) error(`${p}.at`, "footage anchors need a film with videos");
      else
        try {
          anchor = anchorTime(at, `${p}.at`);
          source = { footage: at.footage, ...(at.t !== undefined ? { t: at.t } : { mark: at.mark }), ...(at.offset ? { offset: at.offset } : {}) };
          if (!(anchor >= 0 && anchor < end)) {
            error(`${p}.at`, `lands at film second ${anchor.toFixed(3)}, outside the film (0–${end.toFixed(3)})`);
            anchor = null;
          }
        } catch (e) {
          error(`${p}.at`, e.message);
        }
    } else error(`${p}.at`, 'a film second, or {"footage": "<videos name>", "t": <source second> | "mark": "<name>", "offset"?: <seconds>}');
    out.push({
      id: line.id,
      start: anchor ?? 0.1,
      end,
      anchor,
      ...(source ? { source } : {}),
      gap: line.gap ?? 0.4,
      narration: map(line.text, `${p}.text`),
      display: map(line.text, `${p}.text`, displayed),
    });
  });
  for (let i = 1; i < out.length; i++)
    if (out[i].anchor !== null && out[i - 1].anchor !== null && out[i].anchor < out[i - 1].anchor - 1e-6)
      warn(`$.narration[${i}].at`, `anchored at film second ${out[i].anchor.toFixed(3)}, before the previous line (${out[i - 1].anchor.toFixed(3)}); lines are spoken in list order`);
  return out;
}

// Place each language's clips: start = max(anchor, previous end + gap). Reports how far each
// line slid past its anchor and which lines run past the film.
function scheduleNarrationLines(film, lines, tracks, { error, warn }) {
  const end = Number.isFinite(film.duration) ? film.duration - 0.1 : undefined;
  const rows = [];
  for (const lang of Array.isArray(film.languages) ? film.languages : []) {
    const own = tracks.filter((t) => t.generated && t.lang === lang);
    if (!own.length) continue;
    const lengths = Object.fromEntries(own.map((t) => [t.id, t.length]));
    const placed = scheduleLines(lines, lengths, { end });
    placed.forEach((r, i) => {
      const p = `$.narration[${film.narration.findIndex((l) => l?.id === r.id)}]`;
      if (r.pending) return;
      const track = own.find((t) => t.id === r.id);
      track.start = r.start;
      rows.push({ lang, id: r.id, anchor: +r.anchor.toFixed(3), start: +r.start.toFixed(3), end: +r.end.toFixed(3), pushed: +r.pushed.toFixed(3), ...(r.overflow > 0 ? { overflow: +r.overflow.toFixed(3) } : {}), ...(lines[i].source ? { source: lines[i].source } : {}) });
      if (r.overflow > 0.02)
        error(`$.voiceover.${lang}.${r.id}`, `does not fit: after the lines before it, it ends at ${r.end.toFixed(3)}s, ${r.overflow.toFixed(3)}s past the film's last spoken second ${end.toFixed(3)}; shorten lines, lower gaps or lengthen the film (never truncate speech)`);
      else if (r.pushed > 0.05)
        warn(`${p}.at`, `${lang}: pushed ${r.pushed.toFixed(3)}s past its anchor (film ${r.anchor.toFixed(3)}s → ${r.start.toFixed(3)}s) because the previous line is still speaking; check the picture with still --at ${r.anchor.toFixed(2)},${r.start.toFixed(2)}`);
    });
  }
  return rows;
}

export async function generateFilmNarration(film, options = {}) {
  if (!film.narrationConfig) return { engine: null, rows: [] };
  const langs = options.langs ?? film.languages;
  // A declared imported voiceover takes precedence over generated narration.
  const wanted = langs.filter(
    (l) =>
      !(film.tracks ?? []).some(
        (a) =>
          a.role === "voiceover" && !a.generated && (!a.lang || a.lang === l),
      ),
  );
  fs.mkdirSync(film.narrationConfig.dir, { recursive: true });
  return generateVoiceover(
    {
      languages: wanted,
      voiceover: film.narrationConfig,
      scenes: film.narrationPlans,
    },
    { ...options, langs: wanted },
  );
}

// Technical design walkthrough (motion-use init --mode tech-review).
// The design document's own diagrams are the picture; film.data.walk says, per shot, what the
// animation adds on top. Every timing is a phrase of that shot's narration (M.when): change the
// words and the action follows; a phrase the narration does not say never appears.
//
// film.data.walk[shotId] = {
//   diagram: "architecture",                    // an asset under film.json assets
//   views:  [["整体架构", [800, 450, 1500]]],     // camera on the diagram: [phrase, [cx, cy, w, h?]]
//   glow:   [["客户端", "client"]],               // outline a box when the phrase is said
//   dim:    ["legacy"],                           // boxes this design does not use, greyed throughout
//   tokens: [["请求", "request", "dice.roll", 1.6]] // [phrase, path id or [box ids], label, seconds]
// }
// Boxes and paths come from `motion-use diagram boxes assets/<name>.svg --into film.json --name <name>`.
window.drawFrame = function (c, t, film, view, M) {
  M.paper(c);
  const shot = view.shot;
  const walk = shot && film.data.walk?.[shot.id];
  if (walk?.diagram) {
    const local = (phrase) => M.when(phrase);
    const keys = (walk.views ?? []).map(([phrase, v], i) => [i === 0 ? shot.start : local(phrase), v]);
    const map = M.diagram(c, walk.diagram, keys.length ? M.viewAt(t, keys) : undefined);
    const paths = film.data.diagrams?.[walk.diagram]?.paths ?? {};
    for (const id of walk.dim ?? []) M.dim(c, map, `${walk.diagram}:${id}`, 1);
    for (const [phrase, id] of walk.glow ?? []) M.glow(c, map, `${walk.diagram}:${id}`, M.tween(t, local(phrase), 0.35));
    for (const [phrase, route, text, seconds = 1.6] of walk.tokens ?? []) {
      const points = Array.isArray(route) ? route.map((id) => `${walk.diagram}:${id}`) : paths[route];
      if (!points) throw new Error(`walk ${shot.id}: no path "${route}" in film.data.diagrams.${walk.diagram}.paths`);
      M.token(c, map, points, (t - local(phrase)) / seconds, text, { hold: true });
    }
  }
  M.chapters(c, t);
  M.captions(c, t);
};

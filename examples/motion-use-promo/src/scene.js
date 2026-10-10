// motion-use promo: one glowing timeline carries the whole film. Every pose is a pure function of t.
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { FELT, buildMonster, feltTexture, furTexture, mottleTexture, feltMat, fuzzShared } from "./felt.js";

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a, b, u) => a + (b - a) * u;
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const ramp = (t, a, d) => smooth((t - a) / d);
const lin = (t, a, d) => clamp((t - a) / d);
const bump = (t, a, d) => { const u = (t - a) / d; return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u); };
const backOut = (x) => { x = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const on = (t, a, b) => t >= a && t < b;

// shot boundaries (seconds) — must match film.json
const S = { hook: 0, director: 8, time: 19.5, render: 32, local: 47, sound: 55.5, verify: 67, formats: 83, end: 93, out: 102 };
const CYAN = new THREE.Color(0.25, 0.9, 1.0), AMBER = new THREE.Color(1.0, 0.68, 0.2), GREEN = new THREE.Color(0.35, 1.0, 0.55), RED = new THREE.Color(1.0, 0.3, 0.28);
const WORKER = [0xff5a4e, 0xffc83a, 0x4fd86a, 0x4a8cff];

// ---------- text on canvas ----------
const SANS = '"Film Sans", "Noto Sans SC", sans-serif', MONO = '"Film Mono", "JetBrains Mono", monospace';
function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function texOf(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter; return t; }
function fitFont(g, text, weight, size, family, maxW) { let s = size; do { g.font = `${weight} ${s}px ${family}`; if (g.measureText(text).width <= maxW) break; s -= 2; } while (s > 8); return s; }
/** A text label: transparent background, crisp glyphs. Returns {tex, aspect}. */
function label(text, { size = 96, weight = 600, color = "#fff", family = SANS, pad = 24, glow = 0 } = {}) {
  const m = canvas(8, 8).getContext("2d"); m.font = `${weight} ${size}px ${family}`;
  const w = Math.ceil(m.measureText(text).width + pad * 2), h = Math.ceil(size * 1.45 + pad * 2);
  const c = canvas(w, h), g = c.getContext("2d");
  g.font = `${weight} ${size}px ${family}`; g.textBaseline = "middle"; g.fillStyle = color;
  if (glow) { g.shadowColor = color; g.shadowBlur = glow; }
  g.fillText(text, pad, h / 2);
  return { tex: texOf(c), aspect: w / h };
}
function textPlane(text, height, opts = {}) {
  const { tex, aspect } = label(text, opts);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: opts.toneMapped ?? true });
  if (opts.tint) mat.color.copy(opts.tint);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(height * aspect, height), mat);
  m.userData.width = height * aspect;
  return m;
}
/** A card painted by a callback onto a WxH canvas, shown at world height h. */
function paintedPlane(W, H, h, paint, opts = {}) {
  const c = canvas(W, H), g = c.getContext("2d"); paint(g, W, H);
  const mat = new THREE.MeshBasicMaterial({ map: texOf(c), transparent: true, depthWrite: opts.depthWrite ?? false, side: THREE.DoubleSide, toneMapped: opts.toneMapped ?? true });
  return new THREE.Mesh(new THREE.PlaneGeometry((h * W) / H, h), mat);
}
function fade(obj, a) {
  obj.visible = a > 0.002;
  obj.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = m.opacity; m.opacity = m.userData.baseOpacity * a; m.transparent = true; } } });
}

// ---------- the film ----------
export class PromoFilm {
  constructor(width, height, copy) {
    this.W = width; this.H = height; this.copy = copy;
    this.canvas = canvas(width, height);
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" }));
    r.setPixelRatio(1); r.setSize(width, height, false);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1; r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x020305);
    scene.fog = new THREE.Fog(0x020305, 9, 24);
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.3;
    this.camera = new THREE.PerspectiveCamera(34, width / height, 0.05, 80);
    this.camera.layers.enable(1);

    // floor: mirror under black lacquer
    const mirror = new Reflector(new THREE.PlaneGeometry(200, 40), { textureWidth: Math.round(width / 1.5), textureHeight: Math.round(height / 1.5), color: 0x707070, multisample: 4 });
    mirror.rotation.x = -Math.PI / 2; mirror.position.x = 40; scene.add(mirror);
    const lacquer = new THREE.Mesh(new THREE.PlaneGeometry(200, 40), new THREE.MeshPhysicalMaterial({ color: 0x040507, roughness: 0.5, specularIntensity: 0.3, transparent: true, opacity: 0.88 }));
    lacquer.rotation.x = -Math.PI / 2; lacquer.position.set(40, 0.002, 0); lacquer.receiveShadow = true; scene.add(lacquer);

    // lights: a key that travels with the camera's subject, soft fill, cool rim
    this.key = new THREE.SpotLight(0xfff1e0, 200, 30, 0.7, 0.8, 1.6);
    this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0004; this.key.shadow.radius = 4;
    scene.add(this.key, this.key.target);
    scene.add(new THREE.HemisphereLight(0xbfd2ff, 0x0a0a0a, 0.35));
    const rim = new THREE.DirectionalLight(0x9fc8ff, 1.0); rim.position.set(-4, 4, -8); scene.add(rim);

    this.buildTimeline();
    this.buildHook();
    this.buildDirector();
    this.buildTime();
    this.buildRender();
    this.buildLocal();
    this.buildSound();
    this.buildVerify();
    this.buildFormats();
    this.buildEnd();

    const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        bool bad(float x){ uint b = floatBitsToUint(x); return (b & 0x7f800000u) == 0x7f800000u; }
        void main(){ vec4 c = texture2D(tDiffuse, vUv);
          if (bad(c.r) || bad(c.g) || bad(c.b) || bad(c.a)) c = vec4(0.0, 0.0, 0.0, 1.0);
          gl_FragColor = clamp(c, 0.0, 64.0); }`,
    }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.45, 0.5, 0.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  // ---- the spine: a glowing timeline along x ----
  buildTimeline() {
    const c = canvas(1024, 64), g = c.getContext("2d");
    g.fillStyle = "rgba(0,0,0,0)"; g.fillRect(0, 0, 1024, 64);
    const grd = g.createLinearGradient(0, 0, 0, 64); grd.addColorStop(0, "rgba(80,220,255,0)"); grd.addColorStop(0.5, "rgba(140,240,255,1)"); grd.addColorStop(1, "rgba(80,220,255,0)");
    g.fillStyle = grd; g.fillRect(0, 26, 1024, 12);
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 4 === 0 ? "rgba(200,250,255,0.95)" : "rgba(140,230,255,0.55)"; g.fillRect(i * 64, i % 4 === 0 ? 6 : 16, 3, i % 4 === 0 ? 52 : 32); }
    const tex = texOf(c); tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(90 / 4, 1);
    this.tlMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(1.6, 1.6, 1.6) });
    this.timeline = new THREE.Mesh(new THREE.PlaneGeometry(90, 0.22), this.tlMat);
    this.timeline.rotation.x = -Math.PI / 2; this.timeline.position.set(39, 0.006, 0);
    this.scene.add(this.timeline);
    // reveal mask: the line grows outward from where the letters land
    this.tlMat.onBeforeCompile = (sh) => {
      sh.uniforms.uReveal = this.tlReveal = { value: 0 };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vX;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvX = position.x;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vX; uniform float uReveal;")
        .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n float d = abs(vX + 39.0); gl_FragColor.a *= smoothstep(uReveal, uReveal - 0.6, d);");
    };
    this.tlReveal = { value: 0 };
    this.pulse = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), new THREE.MeshBasicMaterial({ map: (() => { const c = canvas(256, 64), x = c.getContext("2d"); const gr = x.createRadialGradient(128, 32, 0, 128, 32, 31); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(120,230,255,0.55)"); gr.addColorStop(1, "rgba(80,200,255,0)"); x.fillStyle = gr; x.save(); x.scale(4, 1); x.translate(-96, 0); x.fillRect(0, 0, 256, 64); x.restore(); return texOf(c); })(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: new THREE.Color(2, 2, 2) }));
    this.pulse.rotation.x = -Math.PI / 2; this.scene.add(this.pulse);
  }

  // ---- 1. hook: a sentence typed on glass falls and melts into the timeline ----
  buildHook() {
    const g = (this.hook = new THREE.Group()); this.scene.add(g);
    const panel = paintedPlane(1700, 360, 0.75, (x, W, H) => {
      roundRect(x, 6, 6, W - 12, H - 12, 46); x.fillStyle = "rgba(14,22,30,0.82)"; x.fill();
      x.lineWidth = 4; x.strokeStyle = "rgba(120,220,255,0.55)"; x.stroke();
      x.fillStyle = "rgba(255,255,255,0.08)"; roundRect(x, 6, 6, W - 12, 64, 46); x.fill();
      for (let i = 0; i < 3; i++) { x.fillStyle = ["#ff5f57", "#febc2e", "#28c840"][i]; x.beginPath(); x.arc(52 + i * 40, 38, 11, 0, TAU); x.fill(); }
    });
    panel.position.set(0, 1.3, 0); panel.renderOrder = -1; g.add(panel); this.hookPanel = panel;
    // each character is its own plane so it can fall
    const text = "› " + this.copy.prompt, chars = [...text];
    const size = 0.15, meas = canvas(8, 8).getContext("2d");
    const widthOf = (ch) => { meas.font = `500 120px ${ch.charCodeAt(0) < 128 ? MONO : SANS}`; return (meas.measureText(ch).width / (120 * 1.45 + 12)) * size * 1.45; };
    let x = -[...text].reduce((a, ch) => a + widthOf(ch), 0) / 2;
    this.hookChars = chars.map((ch, i) => {
      const p = textPlane(ch === " " ? " " : ch, size * 1.45, { size: 120, weight: i < 2 ? 700 : 500, color: i < 2 ? "#5fe3ff" : "#f2f6fa", family: ch.charCodeAt(0) < 128 ? MONO : SANS, pad: 6, toneMapped: false });
      const w = widthOf(ch);
      p.userData.home = new THREE.Vector3(x + w / 2, 1.22, 0.01); x += w; p.userData.i = i; p.renderOrder = 2;
      g.add(p); return p;
    });
    this.hookCaret = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.19), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 2.4, 2.8), transparent: true }));
    g.add(this.hookCaret);
  }
  poseHook(t) {
    const vis = t < S.director + 0.5; this.hook.visible = vis; if (!vis) return;
    const n = this.hookChars.length, typed = Math.floor(clamp((t - 0.5) / 2.6) * n), enter = 4.4;
    fade(this.hookPanel, ramp(t, 0, 0.5) * (1 - ramp(t, enter + 0.1, 0.5)));
    this.hookPanel.scale.setScalar(1 + 0.04 * bump(t, enter, 0.3));
    for (const p of this.hookChars) {
      const i = p.userData.i, h = p.userData.home;
      fade(p, i < typed ? 1 : 0);
      const t0 = enter + 0.15 + i * 0.035, u = clamp((t - t0) / 0.9);
      // fall: arc down to the floor, landing in a line along x
      const land = new THREE.Vector3(h.x * 0.9, 0.01, 0.2);
      p.position.set(mix(h.x, land.x, u), h.y + (land.y - h.y) * u * u + 0.25 * Math.sin(Math.PI * u) * (1 - u), mix(h.z, 0.02, u));
      p.rotation.x = -Math.PI / 2 * smooth(u);
      if (u >= 1) fade(p, 1 - ramp(t, t0 + 0.9, 0.3));
    }
    const caretX = typed < n ? this.hookChars[typed].userData.home.x - 0.03 : this.hookChars[n - 1].userData.home.x + 0.05;
    this.hookCaret.position.set(caretX, 1.22, 0.012);
    this.hookCaret.visible = t < enter && Math.floor(t * 2.2) % 2 === 0;
  }

  // ---- 2. director: storyboard cards rise along the line, the director's notes behind ----
  buildDirector() {
    const g = (this.dir = new THREE.Group()); this.scene.add(g);
    const cards = this.copy.cards.split("|").map((s) => s.split("~"));
    this.cards = cards.map(([title, line], i) => {
      const card = paintedPlane(900, 600, 0.95, (x, W, H) => {
        roundRect(x, 8, 8, W - 16, H - 16, 36); x.fillStyle = "#f4f1ea"; x.fill();
        x.fillStyle = "#121417"; x.font = `800 84px ${SANS}`; x.fillText(title, 56, 130);
        x.fillStyle = "#3d4550"; fitFont(x, line, 600, 64, SANS, W - 112); x.fillText(line, 56, 225);
        // a small storyboard sketch
        x.strokeStyle = "#1c2026"; x.lineWidth = 5; roundRect(x, 56, 270, W - 112, 270, 20); x.stroke();
        x.strokeStyle = "#0aa3c2"; x.lineWidth = 8; x.beginPath();
        const k = i; for (let s = 0; s <= 40; s++) { const u = s / 40, px = 90 + u * (W - 180), py = 470 - 140 * Math.abs(Math.sin(u * Math.PI * (k + 1) * 0.5 + k)); s ? x.lineTo(px, py) : x.moveTo(px, py); }
        x.stroke();
        x.fillStyle = FELT[k] ? "#" + FELT[k].toString(16).padStart(6, "0") : "#e8473f";
        x.beginPath(); x.arc(90 + ((k + 1) / 6) * (W - 180), 440, 26, 0, TAU); x.fill();
      }, { depthWrite: true });
      card.scale.set(1.3, 1.3, 1);
      card.position.set(2.2 + i * 2.2, 0.62, -0.25); card.material.color.setScalar(0.8);
      g.add(card); return card;
    });
    const lines = this.copy.docLines.split("|");
    this.doc = paintedPlane(1400, 900, 1.5, (x, W, H) => {
      roundRect(x, 8, 8, W - 16, H - 16, 40); x.fillStyle = "rgba(16,20,26,0.92)"; x.fill();
      x.strokeStyle = "rgba(120,220,255,0.35)"; x.lineWidth = 4; x.stroke();
      x.fillStyle = "#5fe3ff"; x.font = `700 72px ${MONO}`; x.fillText(this.copy.docTitle, 70, 140);
      x.fillStyle = "#e9eef3"; lines.forEach((l, i) => { fitFont(x, l, 600, 76, SANS, W - 140); x.fillText(l, 70, 300 + i * 165); });
      x.fillStyle = "rgba(95,227,255,0.6)"; for (let i = 0; i < 3; i++) x.fillRect(70, 335 + i * 165, 120 + i * 60, 5);
    });
    this.doc.position.set(6.6, 2.15, -1.6); g.add(this.doc);
  }
  poseDirector(t) {
    const vis = t > S.director - 0.5 && t < S.time + 3; this.dir.visible = vis; if (!vis) return;
    this.cards.forEach((c, i) => {
      const u = backOut((t - (S.director + 0.6 + i * 0.55)) / 0.8);
      // fold down into the line when the next shot starts
      const f = ramp(t, S.time + 0.2 + i * 0.12, 0.8);
      c.scale.setScalar(1.3 * Math.max(0.001, clamp(u, 0, 1.2)));
      c.position.y = 0.66 * clamp(u, 0, 1.1) * (1 - f) + 0.02;
      c.rotation.x = -Math.PI / 2 * f;
      c.rotation.y = 0.12 * Math.sin(t * 0.6 + i);
      fade(c, (u > 0 ? 1 : 0) * (1 - ramp(t, S.time + 0.9 + i * 0.12, 0.5)));
    });
    fade(this.doc, ramp(t, S.director + 2.6, 0.9) * (1 - ramp(t, S.time - 0.6, 0.6)));
    this.doc.position.y = 2.15 + 0.05 * Math.sin(t * 0.7);
  }

  // ---- 3. time: a playhead scrubs; the monster's pose is the same function of t, forwards or backwards ----
  buildTime() {
    const g = (this.timeG = new THREE.Group()); this.scene.add(g);
    this.timeX0 = 14.6; this.timeX1 = 19.4;
    this.playhead = new THREE.Group(); g.add(this.playhead);
    const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 1.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 3.0, 3.2), transparent: true, toneMapped: false }));
    blade.position.y = 0.8; this.playhead.add(blade);
    const foot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 2.5, 2.8), transparent: true, toneMapped: false }));
    foot.rotation.x = -Math.PI / 2; foot.position.y = 0.01; this.playhead.add(foot);
    this.code = paintedPlane(1500, 300, 0.5, (x, W, H) => {
      roundRect(x, 6, 6, W - 12, H - 12, 34); x.fillStyle = "rgba(12,16,22,0.9)"; x.fill(); x.strokeStyle = "rgba(120,220,255,0.4)"; x.lineWidth = 4; x.stroke();
      x.font = `600 80px ${MONO}`; x.fillStyle = "#c7a7ff"; x.fillText("window.", 60, 175);
      const w0 = x.measureText("window.").width; x.fillStyle = "#5fe3ff"; x.fillText(this.copy.code, 60 + w0, 175);
    });
    this.code.position.set(17, 2.15, -1.0); g.add(this.code);
    // time readout: digits drawn on the fly from a cached glyph strip
    this.readC = canvas(640, 160); this.readTex = texOf(this.readC);
    this.readout = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshBasicMaterial({ map: this.readTex, transparent: true, depthWrite: false, toneMapped: false }));
    g.add(this.readout);
    const pts = []; for (let i = 0; i <= 240; i++) { const p = this.subjectAt(i / 240); pts.push(new THREE.Vector3(p.x, p.y + 0.24, -0.02)); }
    this.curve = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 480, 0.008, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 1.6, 2.0), transparent: true, toneMapped: false }));
    g.add(this.curve);
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 3, 3.2), toneMapped: false, transparent: true }));
    g.add(this.dot);
  }
  /** The subject's pose as a pure function of film-time T in [0,1]. */
  subjectAt(T) {
    const x = mix(this.timeX0 + 0.4, this.timeX1 - 0.4, T);
    const hop = Math.abs(Math.sin(T * Math.PI * 6));
    return { x, y: 0.32 * hop, yaw: Math.PI / 2 - 0.25 * Math.cos(T * Math.PI * 6), squash: 0.14 * (1 - hop) * (1 - hop) - 0.06 * hop, arm: hop };
  }
  scrub(t) {
    // forward, backward, then three jumps
    const a = S.time + 1.0;
    if (t < a) return 0;
    if (t < a + 3.6) return smooth((t - a) / 3.6);
    if (t < a + 4.0) return 1;
    if (t < a + 7.0) return 1 - smooth((t - a - 4.0) / 3.0) * 0.85;
    const jumps = [0.15, 0.62, 0.33, 0.85, 0.5];
    const j = Math.min(jumps.length - 1, Math.floor((t - a - 7.0) / 0.75));
    return jumps[Math.max(0, j)];
  }
  poseTime(t) {
    const vis = t > S.time - 0.5 && t < S.render + 1.5; this.timeG.visible = vis;
    if (!vis) return;
    const T = this.scrub(t), x = mix(this.timeX0, this.timeX1, T);
    this.playhead.position.set(x, 0, 0);
    fade(this.playhead, ramp(t, S.time + 0.4, 0.5) * (1 - ramp(t, S.render - 0.3, 0.5)));
    fade(this.code, ramp(t, S.time + 1.6, 0.7) * (1 - ramp(t, S.render - 0.4, 0.5)));
    // readout
    const g = this.readC.getContext("2d"); g.clearRect(0, 0, 640, 160);
    g.font = `600 84px ${MONO}`; g.fillStyle = "#9fefff"; g.textBaseline = "middle";
    g.fillText(`${this.copy.timeLabel} ${(T * 12).toFixed(2).padStart(5, "0")} s`, 20, 80);
    this.readTex.needsUpdate = true;
    this.readout.position.set(x + 0.62, 1.72, 0);
    fade(this.curve, 0.55 * ramp(t, S.time + 0.8, 0.8) * (1 - ramp(t, S.render - 0.3, 0.5)));
    const sp = this.subjectAt(T); this.dot.position.set(sp.x, sp.y + 0.24, 0); fade(this.dot, ramp(t, S.time + 0.8, 0.5) * (1 - ramp(t, S.render - 0.3, 0.5)));
    fade(this.readout, ramp(t, S.time + 0.6, 0.5) * (1 - ramp(t, S.render - 0.3, 0.5)));
  }

  // ---- 4. render: frames rise, workers capture them in parallel, frames assemble in order ----
  buildRender() {
    const g = (this.renderG = new THREE.Group()); this.scene.add(g);
    this.NF = 12; this.fx0 = 26.0; this.fdx = 0.73;
    const thumb = (i, captured, color) => {
      const c = canvas(320, 180), x = c.getContext("2d");
      roundRect(x, 4, 4, 312, 172, 16);
      x.fillStyle = captured ? "#18242f" : "rgba(40,90,120,0.45)"; x.fill();
      x.lineWidth = 6; x.strokeStyle = captured ? color : "rgba(120,220,255,0.8)"; x.stroke();
      if (captured) {
        // the same subject, posed for this frame's time
        const T = i / (this.NF - 1), px = 40 + T * 240, hop = Math.abs(Math.sin(T * Math.PI * 6)), py = 128 - 64 * hop;
        x.fillStyle = "rgba(95,227,255,0.6)"; x.fillRect(20, 152, 280, 4);
        x.strokeStyle = "rgba(160,235,255,0.55)"; x.lineWidth = 3; x.beginPath();
        for (let k = 0; k <= 60; k++) { const u = k / 60, qx = 40 + u * 240, qy = 128 - 64 * Math.abs(Math.sin(u * Math.PI * 6)) - 30; k ? x.lineTo(qx, qy) : x.moveTo(qx, qy); }
        x.stroke();
        x.fillStyle = "#ff6a5c"; x.beginPath(); x.ellipse(px, py, 30, 28 - 5 * (1 - hop), 0, 0, TAU); x.fill();
        x.fillStyle = "#fff"; x.beginPath(); x.arc(px + 7, py - 4, 6, 0, TAU); x.arc(px + 17, py - 4, 6, 0, TAU); x.fill();
      }
      x.fillStyle = captured ? "rgba(255,255,255,0.75)" : "rgba(160,230,255,0.85)"; x.font = `600 26px ${MONO}`; x.fillText(String(i).padStart(3, "0"), 18, 36);
      return texOf(c);
    };
    this.slabTex = [];
    this.slabs = [];
    for (let i = 0; i < this.NF; i++) {
      const w = Math.floor(i / 3);
      const empty = thumb(i, false), full = thumb(i, true, "#" + WORKER[w].toString(16).padStart(6, "0"));
      this.slabTex.push(full);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.36), new THREE.MeshBasicMaterial({ map: empty, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.userData = { empty, full, w }; m.renderOrder = 2;
      g.add(m); this.slabs.push(m);
    }
    // four workers: a hovering emitter and a soft beam
    this.workers = WORKER.map((col) => {
      const wg = new THREE.Group();
      const em = new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(3), toneMapped: false }));
      const beamTex = (() => { const c = canvas(64, 256), x = c.getContext("2d"); const gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gr; x.fillRect(0, 0, 64, 256); return texOf(c); })();
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.0, 32, 1, true), new THREE.MeshBasicMaterial({ map: beamTex, color: new THREE.Color(col).multiplyScalar(1.4), transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      beam.position.y = -0.5;
      wg.add(em, beam); g.add(wg); return wg;
    });
    // film strip backing with sprocket holes
    this.strip = paintedPlane(4096, 256, 0.3, (x, W, H) => {
      x.fillStyle = "#0b0d10"; x.fillRect(0, 0, W, H);
      x.fillStyle = "#2b3038"; for (let i = 0; i < 160; i++) { roundRect(x, 10 + i * 25.6, 14, 14, 24, 4); x.fill(); roundRect(x, 10 + i * 25.6, H - 38, 14, 24, 4); x.fill(); }
    }, { depthWrite: false });
        this.strip.renderOrder = -2; g.add(this.strip);
    this.renderLabel = textPlane(this.copy.renderLabel, 0.22, { size: 96, weight: 600, color: "#dff7ff" });
    this.workersLabel = textPlane(this.copy.workersLabel, 0.19, { size: 96, weight: 600, color: "#ffe2a8" });
    this.threeLabel = textPlane(this.copy.threeLabel, 0.2, { size: 96, weight: 700, color: "#c7a7ff", family: MONO });
    g.add(this.renderLabel, this.workersLabel, this.threeLabel);
    // a real three.js object living inside one frame
    this.knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.24, 0.075, 200, 28), new THREE.MeshPhysicalMaterial({ color: 0xb48cff, roughness: 0.25, metalness: 0.2, clearcoat: 1, sheen: 0.4, emissive: 0x2a1450 }));
    this.knot.castShadow = true; g.add(this.knot);
  }
  slabHome(i) { return new THREE.Vector3(this.fx0 + i * this.fdx, 0.3, 0); }
  slabStrip(i) { return new THREE.Vector3(this.fx0 + 0.6 + i * 0.66, 1.05, -0.2); }
  captureTime(i) { const w = Math.floor(i / 3), k = i % 3; return S.render + 3.0 + w * 0.15 + k * 1.4 + hash(i) * 0.12; }
  poseRender(t) {
    const vis = t > S.render - 0.5 && t < S.sound + 12; this.renderG.visible = vis; if (!vis) return;
    const asm0 = S.render + 8.6;
    this.slabs.forEach((m, i) => {
      const rise = backOut((t - (S.render + 0.6 + i * 0.045)) / 0.6);
      const home = this.slabHome(i), st = this.slabStrip(i);
      const u = smooth((t - (asm0 + i * 0.05)) / 1.3);
      const p = home.clone().lerp(st, u);
      p.y = mix(0.02 + 0.3 * clamp(rise, 0, 1.15), st.y, u) + 0.25 * Math.sin(Math.PI * u);
      m.position.copy(p);
      m.scale.setScalar(Math.max(0.001, clamp(rise, 0, 1.2)) * mix(1, 1.05, u));
      m.rotation.y = mix(0.0, 0, u);
      const cap = t >= this.captureTime(i);
      m.material.map = cap ? m.userData.full : m.userData.empty;
      const flash = bump(t, this.captureTime(i), 0.25);
      m.material.color.setScalar(1 + 1.6 * flash);
      fade(m, (rise > 0 ? 1 : 0) * (1 - ramp(t, S.sound + 0.3, 0.5)));
    });
    // workers glide over their segment, frame by frame
    this.workers.forEach((wg, w) => {
      const k = clamp((t - (S.render + 3.0 + w * 0.15)) / 1.4, 0, 2.6);
      const i = w * 3 + Math.min(2, k), p = this.slabHome(Math.floor(i)).lerp(this.slabHome(Math.min(this.NF - 1, Math.floor(i) + 1)), smooth(i - Math.floor(i)));
      wg.position.set(p.x, 1.4 + 0.05 * Math.sin(t * 3 + w), 0.0);
      fade(wg, ramp(t, S.render + 2.4, 0.5) * (1 - ramp(t, asm0 - 0.4, 0.5)));
    });
    const sp = this.slabStrip(this.NF / 2 - 0.5);
    this.strip.position.set(sp.x, sp.y, sp.z - 0.01); this.strip.scale.set((this.NF * 0.66 + 0.2) / (0.3 * 16), 1.55, 1);
    fade(this.strip, ramp(t, asm0 + 1.0, 0.8) * (1 - ramp(t, S.sound + 0.3, 0.5)));
    this.renderLabel.position.set(this.fx0 + 4.0, 2.25, -0.4);
    fade(this.renderLabel, ramp(t, S.render + 1.0, 0.6) * (1 - ramp(t, S.local - 0.5, 0.5)));
    this.workersLabel.position.set(this.fx0 + 4.0, 1.98, -0.4);
    fade(this.workersLabel, ramp(t, S.render + 3.3, 0.6) * (1 - ramp(t, asm0, 0.5)));
    // three.js knot pops out of the middle of the strip
    const kp = ramp(t, S.render + 11.2, 0.8);
    this.knot.position.set(sp.x, 0.55 + 0.04 * Math.sin(t * 2), 1.1);
    this.knot.rotation.set(t * 0.8, t * 1.1, 0);
    this.knot.scale.setScalar(Math.max(0.001, backOut((t - S.render - 11.2) / 0.8)));
    this.knot.visible = kp > 0.001 && t < S.local + 0.5;
    this.threeLabel.position.set(sp.x, 0.08, 1.45); this.threeLabel.rotation.x = -0.45;
    fade(this.threeLabel, ramp(t, S.render + 11.6, 0.5) * (1 - ramp(t, S.local - 0.3, 0.5)));
  }

  // ---- 5. local: a wall of characters keeps only those the film uses; the network cable is pulled ----
  buildLocal() {
    const g = (this.localG = new THREE.Group()); this.scene.add(g);
    const wall = [...this.copy.glyphWall], used = new Set([...this.copy.usedChars]);
    const cols = 26, cell = 128, rows = Math.ceil(wall.length / cols);
    const c = canvas(cols * cell, rows * cell), x = c.getContext("2d");
    x.font = `500 96px ${SANS}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#fff";
    wall.forEach((ch, i) => x.fillText(ch, (i % cols) * cell + cell / 2, Math.floor(i / cols) * cell + cell / 2 + 4));
    const tex = texOf(c);
    this.glyphs = wall.map((ch, i) => {
      const geo = new THREE.PlaneGeometry(0.16, 0.16), uv = geo.attributes.uv, cx = i % cols, cy = Math.floor(i / cols);
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (cx + uv.getX(k)) / cols, 1 - (cy + 1 - uv.getY(k)) / rows);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(0.9, 0.95, 1) }));
      m.userData = { used: used.has(ch), cx, cy, i };
      g.add(m); return m;
    });
    this.glyphCols = cols; this.glyphRows = rows;
    this.glyphLabel = textPlane(this.copy.glyphLabel, 0.2, { size: 96, color: "#dff7ff" });
    this.offlineLabel = textPlane(this.copy.offlineLabel, 0.2, { size: 96, color: "#ffd9a0" });
    g.add(this.glyphLabel, this.offlineLabel);
    // network plug and socket
    const metal = new THREE.MeshPhysicalMaterial({ color: 0xd9dde3, metalness: 1, roughness: 0.25 });
    const body = new THREE.MeshPhysicalMaterial({ color: 0x1a1d22, roughness: 0.4, clearcoat: 0.6 });
    this.socket = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.12), body);
    this.plug = new THREE.Group();
    const pb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.1), new THREE.MeshPhysicalMaterial({ color: 0x5fd3ff, roughness: 0.3, transmission: 0, clearcoat: 1 }));
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.08), metal); tip.position.x = -0.15;
    this.plug.add(pb, tip);
    this.cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.1, 0, 0), new THREE.Vector3(0.6, -0.1, 0), new THREE.Vector3(1.0, -0.5, 0.1), new THREE.Vector3(1.4, -0.9, 0.2)]), 40, 0.025, 12), new THREE.MeshPhysicalMaterial({ color: 0x5fd3ff, roughness: 0.4 }));
    this.plug.add(this.cable);
    g.add(this.socket, this.plug);
    for (const o of [this.socket, pb, tip, this.cable]) o.castShadow = true;
    this.spark = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3, 1.5), toneMapped: false, transparent: true }));
    g.add(this.spark);
  }
  poseLocal(t) {
    const vis = t > S.local - 1 && t < S.sound + 1.5; this.localG.visible = vis; if (!vis) return;
    const cx = 40, cy = 1.45, sp = 0.18;
    const a = ramp(t, S.local - 0.2, 0.8) * (1 - ramp(t, S.sound - 0.2, 0.6));
    const drop0 = S.local + 1.6;
    let kept = 0;
    this.glyphs.forEach((m) => {
      const { used, cx: gx, cy: gy, i } = m.userData;
      const x0 = cx + (gx - this.glyphCols / 2) * sp, y0 = cy + (this.glyphRows / 2 - gy) * sp;
      if (used) {
        // the kept glyphs slide together into a compact block
        const k = kept++, c2 = 14, u = smooth((t - drop0 - 1.2) / 1.2);
        const x1 = cx - 1.9 + (k % c2) * 0.13, y1 = 2.0 - Math.floor(k / c2) * 0.13;
        m.position.set(mix(x0, x1, u), mix(y0, y1, u), -1 + 0.2 * u);
        m.scale.setScalar(mix(1, 0.72, u));
        m.material.color.setRGB(mix(0.9, 0.5, ramp(t, drop0, 0.4)), mix(0.95, 1.6, ramp(t, drop0, 0.4)), mix(1, 1.9, ramp(t, drop0, 0.4)));
        fade(m, a);
      } else {
        const d = drop0 + hash(i) * 0.6, u = clamp((t - d) / 1.0);
        m.position.set(x0 + (hash(i + 7) - 0.5) * 0.3 * u, y0 - 2.5 * u * u, -1 + 0.4 * u);
        m.rotation.z = (hash(i + 3) - 0.5) * 3 * u;
        fade(m, a * (1 - u) * mix(1, 0.35, ramp(t, drop0 - 0.6, 0.5)));
      }
    });
    this.glyphLabel.position.set(cx - 1.05, 2.4, -0.8);
    fade(this.glyphLabel, ramp(t, drop0 + 1.4, 0.5) * (1 - ramp(t, S.sound - 0.2, 0.5)));
    // plug pulled out
    const sx = cx + 1.5, pull = smooth((t - (S.local + 4.6)) / 0.9);
    this.socket.position.set(sx, 1.1, -0.6);
    this.plug.position.set(sx + 0.24 + 0.55 * pull, 1.1 - 0.1 * pull, -0.6);
    this.plug.rotation.z = -0.3 * pull;
    fade(this.socket, a); fade(this.plug, a);
    const spk = bump(t, S.local + 4.85, 0.35);
    this.spark.position.set(sx + 0.14, 1.1, -0.55); this.spark.scale.setScalar(0.3 + 2 * spk); fade(this.spark, spk);
    this.offlineLabel.position.set(sx + 0.45, 1.45, -0.6);
    fade(this.offlineLabel, ramp(t, S.local + 5.0, 0.5) * (1 - ramp(t, S.sound - 0.2, 0.5)));
  }

  // ---- 6. sound: narration blocks must fit their shot windows; music pulses on the beat ----
  buildSound() {
    const g = (this.soundG = new THREE.Group()); this.scene.add(g);
    this.sx0 = 46.2;
    this.winW = [1.1, 1.5, 1.25, 1.5];
    const wave = (w, col, seed) => {
      const c = canvas(Math.round(w * 300), 120), x = c.getContext("2d");
      roundRect(x, 2, 2, c.width - 4, 116, 22); x.fillStyle = col.replace("1)", "0.18)"); x.fill();
      x.strokeStyle = col; x.lineWidth = 3; x.stroke();
      x.fillStyle = col;
      for (let i = 12; i < c.width - 12; i += 6) { const a = (0.2 + 0.8 * Math.abs(Math.sin(i * 0.05 + seed) * Math.sin(i * 0.013 + seed * 2))) * 44; x.fillRect(i, 60 - a, 3, a * 2); }
      return texOf(c);
    };
    this.windows = []; this.blocks = [];
    let x = this.sx0;
    this.winW.forEach((w, i) => {
      const frame = paintedPlane(Math.round(w * 300), 200, 0.66, (c, W, H) => {
        c.strokeStyle = "rgba(220,240,255,0.85)"; c.lineWidth = 5; c.setLineDash([18, 12]); roundRect(c, 4, 4, W - 8, H - 8, 26); c.stroke();
      });
      frame.position.set(x + w / 2, 1.2, 0); frame.userData = { x, w };
      g.add(frame); this.windows.push(frame);
      const bw = i === 3 ? w * 1.35 : w * mix(0.62, 0.86, hash(i));
      const blk = new THREE.Mesh(new THREE.PlaneGeometry(bw, 0.26), new THREE.MeshBasicMaterial({ map: wave(bw, i === 3 ? "rgba(255,120,110,1)" : "rgba(95,227,255,1)", i * 1.7), transparent: true, depthWrite: false, toneMapped: false }));
      blk.userData = { bw, over: i === 3 };
      g.add(blk); this.blocks.push(blk);
      x += w + 0.15;
    });
    this.fixedBlockTex = wave(this.winW[3] * 1.35, "rgba(95,227,255,1)", 3 * 1.7);
    this.music = Array.from({ length: 30 }, (_, i) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.04), new THREE.MeshPhysicalMaterial({ color: 0x111111, emissive: AMBER, emissiveIntensity: 0.9, roughness: 0.4 }));
      m.position.set(this.sx0 + i * 0.22, 0, 0.55); m.castShadow = false; g.add(m); return m;
    });
    this.voLabel = textPlane(this.copy.voLabel, 0.18, { color: "#9fefff" });
    this.musicLabel = textPlane(this.copy.musicLabel, 0.18, { color: "#ffd38a" });
    this.overLabel = textPlane(this.copy.overLabel, 0.18, { color: "#ff8a80" });
    this.fixLabel = textPlane(this.copy.fixLabel, 0.18, { color: "#8dffb0" });
    this.mixLabel = textPlane(this.copy.mixLabel, 0.18, { color: "#8dffb0" });
    g.add(this.voLabel, this.musicLabel, this.overLabel, this.fixLabel, this.mixLabel);
  }
  poseSound(t) {
    const vis = t > S.sound - 1 && t < S.verify + 1; this.soundG.visible = vis; if (!vis) return;
    const a = ramp(t, S.sound - 0.3, 0.6) * (1 - ramp(t, S.verify - 0.3, 0.6));
    const fixT = S.sound + 6.6, grow = smooth((t - fixT) / 0.8);
    // windows: the last one widens when the shot is re-timed
    let x = this.sx0;
    this.windows.forEach((f, i) => {
      const w = i === 3 ? mix(this.winW[3], this.winW[3] * 1.45, grow) : this.winW[i];
      f.scale.x = w / this.winW[i]; f.position.set(x + w / 2, 1.2, 0);
      const pop = backOut((t - (S.sound + 0.2 + i * 0.25)) / 0.6);
      f.scale.y = Math.max(0.001, clamp(pop, 0, 1.2));
      fade(f, a * (pop > 0 ? 1 : 0));
      f.material.color.copy(i === 3 && t > S.sound + 4.6 && t < fixT + 0.4 ? new THREE.Color(1, 0.45, 0.4) : i === 3 && t >= fixT + 0.4 ? new THREE.Color(0.6, 1, 0.7) : new THREE.Color(1, 1, 1));
      // the narration block drops into its window
      const b = this.blocks[i], d = S.sound + 1.4 + i * 0.7, u = smooth((t - d) / 0.7);
      b.position.set(x + 0.08 + b.userData.bw / 2, mix(2.3, 1.2, u), 0.01);
      if (b.userData.over) {
        const shake = t > d + 0.7 && t < fixT ? 0.02 * Math.sin(t * 60) : 0;
        b.position.x += shake;
        b.material.map = t >= fixT + 0.4 ? this.fixedBlockTex : b.material.map;
      }
      fade(b, a * (t > d - 0.1 ? 1 : 0));
      x += w + 0.15;
    });
    const last = this.windows[3];
    this.overLabel.position.set(last.position.x + 0.3, 1.75, 0);
    fade(this.overLabel, a * ramp(t, S.sound + 4.7, 0.3) * (1 - ramp(t, fixT, 0.3)));
    this.fixLabel.position.set(last.position.x + 0.3, 1.75, 0);
    fade(this.fixLabel, a * ramp(t, fixT + 0.4, 0.4) * (1 - ramp(t, fixT + 2.2, 0.4)));
    this.mixLabel.position.set(this.sx0 + 3.0, 2.05, 0);
    fade(this.mixLabel, a * ramp(t, fixT + 2.6, 0.5));
    this.voLabel.position.set(this.sx0 - 0.5, 1.2, 0); fade(this.voLabel, a * ramp(t, S.sound + 1.2, 0.5));
    this.musicLabel.position.set(this.sx0 - 0.5, 0.32, 0.55); fade(this.musicLabel, a * ramp(t, S.sound + 2.5, 0.5));
    // music: bars pulse on the 96 BPM grid
    const beat = (t * 96) / 60;
    this.music.forEach((m, i) => {
      const ph = beat - Math.floor(beat), on1 = Math.exp(-ph * 5);
      const h = 0.06 + 0.32 * on1 * (0.4 + 0.6 * hash(i + Math.floor(beat) * 13)) * ramp(t, S.sound + 2.4 + i * 0.02, 0.4);
      m.scale.y = h; m.position.y = h / 2;
      fade(m, a);
    });
  }

  // ---- 7. verify: the film runs through a scanner; meters pass, but review waits for a viewer ----
  buildVerify() {
    const g = (this.verG = new THREE.Group()); this.scene.add(g);
    this.vx = 60;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.035, 24, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.6, 3.0), toneMapped: false, transparent: true }));
    this.ring.rotation.y = Math.PI / 2; g.add(this.ring);
    this.ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.008, 12, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 1.8), toneMapped: false, transparent: true }));
    this.ring2.rotation.y = Math.PI / 2; g.add(this.ring2);
    // a strip of frames running through the ring
    this.vstrip = [];
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.19), new THREE.MeshBasicMaterial({ map: this.slabTex[i % this.NF], transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      g.add(m); this.vstrip.push(m);
    }
    this.readouts = this.copy.readouts.split("|").map((s) => {
      const p = paintedPlane(900, 170, 0.22, (x, W, H) => {
        roundRect(x, 4, 4, W - 8, H - 8, 40); x.fillStyle = "rgba(10,30,22,0.85)"; x.fill(); x.strokeStyle = "rgba(120,255,170,0.8)"; x.lineWidth = 5; x.stroke();
        x.fillStyle = "#8dffb0"; x.beginPath(); x.arc(85, H / 2, 34, 0, TAU); x.fill();
        x.strokeStyle = "#08130e"; x.lineWidth = 10; x.beginPath(); x.moveTo(68, H / 2); x.lineTo(82, H / 2 + 14); x.lineTo(104, H / 2 - 14); x.stroke();
        x.fillStyle = "#eafff1"; fitFont(x, s, 600, 78, SANS, W - 180); x.textBaseline = "middle"; x.fillText(s, 150, H / 2 + 4);
      });
      g.add(p); return p;
    });
    this.sheet = new THREE.Group();
    for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.17), new THREE.MeshBasicMaterial({ map: this.slabTex[(i * 3) % this.NF], transparent: true, depthWrite: false })); m.position.set((i % 4) * 0.33 - 0.5, -Math.floor(i / 4) * 0.2 + 0.2, 0); this.sheet.add(m); }
    g.add(this.sheet);
    const stamp = (txt, stroke, fill) => paintedPlane(1300, 220, 0.24, (x, W, H) => {
      roundRect(x, 6, 6, W - 12, H - 12, 50); x.fillStyle = fill; x.fill(); x.strokeStyle = stroke; x.lineWidth = 8; x.stroke();
      x.fillStyle = stroke; fitFont(x, txt, 700, 92, MONO, W - 100); x.textBaseline = "middle"; x.textAlign = "center"; x.fillText(txt, W / 2, H / 2 + 4);
    });
    this.pending = stamp(this.copy.pending, "#ffc35a", "rgba(40,28,6,0.9)");
    this.approved = stamp(this.copy.approved, "#8dffb0", "rgba(6,34,18,0.9)");
    g.add(this.pending, this.approved);
  }
  poseVerify(t) {
    const vis = t > S.verify - 1 && t < S.formats + 1.5; this.verG.visible = vis; if (!vis) return;
    const vx = this.vx, a = ramp(t, S.verify - 0.4, 0.6) * (1 - ramp(t, S.formats - 0.2, 0.6));
    this.ring.position.set(vx, 0.95, 0); this.ring2.position.copy(this.ring.position);
    this.ring2.rotation.x = t * 1.5;
    const scanGlow = 1 + 0.6 * Math.sin(t * 9) * (t < S.verify + 7 ? 1 : 0);
    this.ring.material.color.setRGB(1.2 * scanGlow, 2.6 * scanGlow, 3.0 * scanGlow);
    fade(this.ring, a); fade(this.ring2, a * 0.8);
    // frames travel through the ring
    const flow = (t - S.verify) * 0.9;
    this.vstrip.forEach((m, i) => {
      const x = vx - 4.6 + ((i * 0.36 + flow) % 9.36);
      m.position.set(x, 0.95, 0);
      const inside = Math.exp(-Math.pow((x - vx) / 0.25, 2));
      m.material.color.setScalar(1 + 1.4 * inside * (t < S.verify + 7 ? 1 : 0));
      fade(m, a * clamp(1 - Math.abs(x - vx) / 4.6) * (1 - ramp(t, S.verify + 7.2, 0.8) * 0.75));
    });
    // readouts pop up one by one around the ring
    this.readouts.forEach((p, i) => {
      const d = S.verify + 1.6 + i * 1.0, u = backOut((t - d) / 0.5);
      const ang = 2.3 - i * 0.55;
      p.position.set(vx - 0.3 + 0.1 * i, 0.95 + Math.sin(ang) * 1.25, Math.cos(ang) * 0.3 + 0.2);
      p.position.set(vx + 1.05 + (i % 2) * 0.15, 1.75 - i * 0.27, 0.35);
      p.scale.setScalar(Math.max(0.001, clamp(u, 0, 1.15)));
      fade(p, a * (u > 0 ? 1 : 0));
    });
    // contact sheet, then the honest stamp
    const sh = backOut((t - (S.verify + 6.8)) / 0.7);
    this.sheet.position.set(vx - 1.55, 1.55, -0.3); this.sheet.scale.setScalar(Math.max(0.001, clamp(sh, 0, 1.1)));
    fade(this.sheet, a * (sh > 0 ? 1 : 0));
    const st = backOut((t - (S.verify + 8.4)) / 0.5), ok = t >= S.verify + 13.4;
    for (const s of [this.pending, this.approved]) { s.position.set(vx - 1.55, 0.95, -0.25); s.scale.setScalar(Math.max(0.001, clamp(st, 0, 1.12)) * (1 + 0.12 * bump(t, S.verify + 13.4, 0.35))); s.rotation.z = -0.05; }
    fade(this.pending, a * (st > 0 && !ok ? 1 : 0) * (0.75 + 0.25 * Math.sin(t * 5)));
    fade(this.approved, a * (ok ? 1 : 0));
  }

  // ---- 8. formats: three screens rise — landscape, vertical, square ----
  buildFormats() {
    const g = (this.fmtG = new THREE.Group()); this.scene.add(g);
    const names = this.copy.formats.split("|");
    const spec = [[16, 9, 1.25, this.copy.tagline], [9, 16, 1.95, this.copy.taglineEn], [1, 1, 1.3, this.copy.tagline]];
    this.screens = spec.map(([w, h, H, line], i) => {
      const W = (H * w) / h, px = 900;
      const scr = paintedPlane(Math.round((px * w) / Math.max(w, h)), Math.round((px * h) / Math.max(w, h)), H, (x, Wc, Hc) => {
        const gr = x.createLinearGradient(0, 0, Wc, Hc); gr.addColorStop(0, "#0d1a24"); gr.addColorStop(1, "#05080c");
        roundRect(x, 4, 4, Wc - 8, Hc - 8, 26); x.fillStyle = gr; x.fill(); x.strokeStyle = "rgba(120,220,255,0.7)"; x.lineWidth = 6; x.stroke();
        x.textAlign = "center"; x.textBaseline = "middle";
        x.fillStyle = "#ffffff"; fitFont(x, this.copy.wordmark, 800, 120, SANS, Wc * 0.8); x.fillText(this.copy.wordmark, Wc / 2, Hc * 0.45);
        x.fillStyle = "#5fe3ff"; fitFont(x, line, 600, 64, SANS, Wc * 0.82); x.fillText(line, Wc / 2, Hc * 0.45 + 110);
        x.fillStyle = "rgba(95,227,255,0.8)"; x.fillRect(Wc * 0.2, Hc * 0.82, Wc * 0.6, 6);
        x.fillStyle = "#e8473f"; x.beginPath(); x.arc(Wc * 0.2 + Wc * 0.6 * 0.4, Hc * 0.82 - 26, 22, 0, TAU); x.fill();
      });
      scr.userData = { W, H };
      const lab = textPlane(names[i], 0.2, { color: "#cfe9f5" });
      g.add(scr, lab); return { scr, lab };
    });
  }
  poseFormats(t) {
    const vis = t > S.formats - 1 && t < S.end + 2; this.fmtG.visible = vis; if (!vis) return;
    const xs = [66.4, 68.75, 70.75], a = 1 - ramp(t, S.end - 0.6, 0.8);
    this.screens.forEach(({ scr, lab }, i) => {
      const u = backOut((t - (S.formats + 0.6 + i * 0.5)) / 0.8), H = scr.userData.H;
      const merge = 0;
      scr.position.set(mix(xs[i], 76, merge), mix(0.08 + H / 2, 1.5, merge) * clamp(u, 0, 1.05), -0.2);
      scr.scale.setScalar(Math.max(0.001, clamp(u, 0, 1.1)) * (1 - 0.6 * merge));
      scr.rotation.y = (1 - i) * 0.22 * (1 - merge) + 0.04 * Math.sin(t * 0.8 + i);
      fade(scr, a * (u > 0 ? 1 : 0));
      lab.position.set(xs[i], 0.08, 0.45); lab.rotation.x = -0.5;
      fade(lab, a * ramp(t, S.formats + 1.4 + i * 0.5, 0.5) * (1 - ramp(t, S.end - 0.3, 0.4)));
    });
  }

  // ---- 9. end: wordmark, install line, repo ----
  buildEnd() {
    const g = (this.endG = new THREE.Group()); this.scene.add(g);
    this.word = textPlane(this.copy.wordmark, 0.62, { size: 220, weight: 800, color: "#ffffff", pad: 60 });
    this.tag = textPlane(this.copy.tagline, 0.2, { size: 120, weight: 600, color: "#5fe3ff" });
    this.install = paintedPlane(2600, 170, 0.21, (x, W, H) => {
      roundRect(x, 4, 4, W - 8, H - 8, 40); x.fillStyle = "rgba(12,16,22,0.92)"; x.fill(); x.strokeStyle = "rgba(120,220,255,0.45)"; x.lineWidth = 4; x.stroke();
      x.textBaseline = "middle"; x.fillStyle = "#5fe3ff"; x.font = `600 62px ${MONO}`; x.fillText("$", 50, H / 2 + 3);
      x.fillStyle = "#e9eef3"; fitFont(x, this.copy.install, 500, 62, MONO, W - 160); x.fillText(this.copy.install, 110, H / 2 + 3);
    });
    this.repo = textPlane(this.copy.repo, 0.16, { size: 96, weight: 500, color: "#9fb3c2", family: MONO });
    g.add(this.word, this.tag, this.install, this.repo);
  }
  poseEnd(t) {
    const vis = t > S.end - 0.5; this.endG.visible = vis; if (!vis) return;
    const u = smooth((t - S.end - 0.8) / 1.0);
    this.word.position.set(76, 1.75 + 0.1 * (1 - u), 0); this.word.scale.setScalar(mix(0.9, 1, u)); fade(this.word, u);
    this.tag.position.set(76, 1.3, 0); fade(this.tag, ramp(t, S.end + 1.6, 0.7));
    this.install.position.set(76, 0.92, 0.05); fade(this.install, ramp(t, S.end + 2.6, 0.7));
    this.repo.position.set(76, 0.62, 0.05); fade(this.repo, ramp(t, S.end + 3.2, 0.7));
  }

  // ---- the guide: one felt monster walks the timeline with the viewer ----
  buildGuide() {
    if (this.guide) return;
    const tex = { felt: feltTexture(3), fur: furTexture(5, 60000) };
    tex.felt.repeat.set(4, 3);
    feltMat.mottle = mottleTexture(21); feltMat.mottle.colorSpace = THREE.SRGBColorSpace; feltMat.mottle.repeat.set(2, 2);
    this.guide = buildMonster(0, tex);
    this.guide.g.traverse((o) => { if (o.material && o.material.type === "ShaderMaterial") o.layers.set(1); });
    this.scene.add(this.guide.g);
  }
  poseGuide(t) {
    const m = this.guide;
    let x, y = 0, yaw = 0, arm = 0, squash = 0, mouth = 0.2, look = [0, 0.2], step = 0, vis = true;
    if (t < S.time) {
      // watches the sentence fall, then strolls past the cards
      const u = smooth((t - S.director) / 11), enter = smooth((t - 5.9) / 2.0);
      x = t < S.director ? mix(-1.6, 0.6, enter) : mix(0.6, 11.2, u);
      yaw = t < S.director ? Math.PI / 2 - 0.2 : Math.PI / 2 - 0.3 * Math.sin(t);
      step = (t > 5.9 && t < 7.9) || (t > S.director && t < S.time - 0.5) ? t * 9 : 0; y = step ? 0.025 * Math.abs(Math.sin(t * 9)) : 0;
      y += 0.22 * bump(t, 5.9, 0.5) + 0.16 * bump(t, 6.5, 0.45);
      arm = Math.max(bump(t, 5.9, 0.6), 0.6 * bump(t, 7.9, 0.5)); look = t < S.director ? [0.5, 0.25] : look;
      vis = t > 5.85;
    } else if (t < S.render) {
      const p = this.subjectAt(this.scrub(t)); x = p.x; y = p.y; yaw = p.yaw; squash = p.squash; arm = p.arm * 0.8; mouth = 0.3 + 0.4 * p.arm;
      if (t < S.time + 1) { x = mix(10.8, p.x, smooth((t - S.time) / 1)); y = 0.3 * bump(t, S.time, 1); }
    } else if (t < S.verify + 11) {
      // rides along, then waits beside the scanner
      const u = smooth((t - S.render) / (S.verify + 10.4 - S.render));
      x = mix(this.timeX1 - 0.4, this.vx - 2.6, u);
      const pace = t < S.verify + 10.4 ? 1 : 0; step = pace ? t * 8 : 0;
      y = pace ? 0.02 * Math.abs(Math.sin(t * 8)) : 0; yaw = Math.PI / 2;
      // keep it out of the busy shots: hide while frames and glyphs fill the stage
      vis = !(t > S.render + 0.8 && t < S.verify + 8.6);
      if (!vis) x = this.vx - 2.6;
      const arrive = ramp(t, S.verify + 8.6, 0.8);
      x = t > S.verify + 8.4 ? mix(this.vx - 3.6, this.vx - 2.35, arrive) : x;
      vis = vis || t > S.verify + 8.4;
      if (t > S.verify + 9.4) { yaw = -0.3; look = [Math.sin(t * 2.4) * 0.5, 0.3]; step = 0; y = 0; }
      if (t > S.verify + 12.6) { const c = bump(t, S.verify + 13.4, 0.5); y = 0.2 * c; arm = c; mouth = 0.8; look = [0, 0.4]; }
    } else {
      // joins the screens and bows at the end
      const u = smooth((t - S.verify - 11) / (S.end + 1 - S.verify - 11));
      x = mix(this.vx - 2.35, 74.5, u); yaw = u < 1 ? Math.PI / 2 : 0.25; step = u > 0 && u < 1 ? t * 9 : 0;
      y = step ? 0.025 * Math.abs(Math.sin(t * 9)) : 0;
      const bow = bump(t, S.end + 4.0, 1.4); m.body.rotation.x = 0.5 * bow; arm = 0.3;
      const wave = bump(t, S.end + 1.6, 1.6); arm = Math.max(arm, wave);
      vis = t < S.formats - 0.5 || t > S.end + 0.4;
    }
    m.g.visible = vis;
    m.g.position.set(x, y, t < S.time ? 0.75 : t > S.end ? -0.35 : t > S.verify ? 0.55 : 0.0);
    m.g.rotation.y = yaw;
    if (!(t > S.end)) m.body.rotation.x = 0;
    m.body.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6);
    for (const a of m.arms) { a.piv.rotation.z = a.sgn * (0.25 + 2.3 * arm); a.piv.rotation.x = 0; }
    m.feet.forEach((f, i) => { const ph = step + i * Math.PI; f.position.z = 0.02 + (step ? 0.05 * Math.sin(ph) : 0); f.position.y = 0.035 + (step ? 0.025 * Math.max(0, Math.cos(ph)) : 0); });
    m.mouth.scale.set(0.03 + 0.012 * mouth, 0.008 + 0.035 * mouth, 0.012);
    for (const e of m.eyes) { e.pupil.position.x = look[0] * m.spec.er * 0.3; e.pupil.position.y = (look[1] - 0.2) * m.spec.er * 0.3; e.g.scale.y = Math.sin(t * 0.9) > 0.985 ? 0.15 : 1; }
  }

  camAt(t) {
    // [t, tx,ty,tz, dist, yaw, pitch, fov]
    const K = [
      [0, 0, 1.3, 0, 3.9, 0.0, 0.03, 34],
      [4.2, 0, 1.28, 0, 4.1, 0.06, 0.05, 34],
      [7.0, 1.4, 0.5, 0, 5.2, 0.24, 0.3, 34],
      [9.6, 4.6, 1.0, -0.4, 7.2, 0.18, 0.2, 34],
      [17.0, 8.6, 1.05, -0.5, 7.4, 0.06, 0.18, 34],
      [20.6, 17.0, 0.95, 0, 5.9, 0.16, 0.16, 34],
      [30.8, 17.0, 0.95, 0, 5.7, -0.1, 0.16, 34],
      [33.6, 30.0, 0.95, 0, 7.0, 0.22, 0.24, 34],
      [39.8, 30.0, 1.0, 0, 6.9, 0.06, 0.2, 34],
      [43.4, 30.0, 0.95, 0.2, 6.8, -0.06, 0.12, 34],
      [46.4, 30.4, 0.9, 0.3, 6.4, -0.18, 0.14, 34],
      [48.6, 40.2, 1.45, -0.7, 5.7, 0.0, 0.06, 34],
      [54.8, 40.4, 1.4, -0.6, 5.4, -0.1, 0.08, 34],
      [57.0, 49.0, 1.0, 0.2, 6.4, 0.1, 0.14, 34],
      [66.2, 49.4, 1.0, 0.2, 6.4, -0.08, 0.14, 34],
      [68.6, 60.0, 1.15, 0, 6.2, 0.3, 0.12, 34],
      [74.8, 60.0, 1.2, -0.2, 5.9, 0.06, 0.1, 34],
      [81.8, 59.7, 1.0, 0, 5.0, -0.08, 0.1, 34],
      [84.8, 68.6, 1.2, 0, 6.6, 0.16, 0.08, 34],
      [92.2, 68.6, 1.25, 0, 6.3, -0.08, 0.08, 34],
      [95.0, 76.0, 1.3, 0, 4.8, 0.03, 0.05, 34],
      [102, 76.0, 1.3, 0, 4.5, 0.0, 0.04, 34],
    ];
    let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const a = K[Math.max(0, i - 1)], b = K[i], c = K[i + 1], d = K[Math.min(K.length - 1, i + 2)];
    const uu = clamp((t - b[0]) / (c[0] - b[0]));
    const cr = (p0, p1, p2, p3, x) => 0.5 * (2 * p1 + (-p0 + p2) * x + (2 * p0 - 5 * p1 + 4 * p2 - p3) * x * x + (-p0 + 3 * p1 - 3 * p2 + p3) * x * x * x);
    const v = []; for (let j = 1; j < 8; j++) v.push(cr(a[j], b[j], c[j], d[j], uu));
    return v;
  }

  render(t) {
    this.buildGuide();
    // the timeline grows out from where the letters land, then stays
    this.tlReveal.value = 0.3 + 60 * Math.pow(ramp(t, 5.0, 3.5), 1.6) + (t > 8.5 ? 40 : 0);
    this.tlMat.color.setScalar(1.6 * ramp(t, 4.9, 0.6) + 1.2 * bump(t, 5.3, 1.2));
    const pu = clamp((t - 5.6) / 3.2); this.pulse.position.set(-0.5 + 16 * Math.pow(pu, 1.4), 0.01, 0); fade(this.pulse, bump(t, 5.6, 3.2));
    this.poseHook(t); this.poseDirector(t); this.poseTime(t); this.poseRender(t);
    this.poseLocal(t); this.poseSound(t); this.poseVerify(t); this.poseFormats(t); this.poseEnd(t); this.poseGuide(t);
    const [tx, ty, tz, dist, yaw, pitch, fov] = this.camAt(t);
    const cp = new THREE.Vector3(tx + dist * Math.sin(yaw) * Math.cos(pitch), ty + dist * Math.sin(pitch), tz + dist * Math.cos(yaw) * Math.cos(pitch));
    this.camera.position.copy(cp); this.camera.fov = fov; this.camera.updateProjectionMatrix(); this.camera.lookAt(tx, ty, tz);
    this.key.position.set(tx + 1.2, 7.5, tz + 3); this.key.target.position.set(tx, 0, tz); this.key.target.updateMatrixWorld();
    this.bloom.strength = 0.4;
    // fade in from black, out at the very end
    this.composer.render();
    return this.canvas;
  }
}
window.PromoFilm = PromoFilm;

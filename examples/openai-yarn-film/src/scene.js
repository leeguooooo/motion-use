// Three.js scene for the felt-monster relay film. Every pose is a pure function of time t.
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a, b, u) => a + (b - a) * u;
const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const ramp = (t, a, d) => smooth((t - a) / d);
const bump = (t, a, d) => { const u = (t - a) / d; return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u); };
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lerpAngle = (a, b, u) => { let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * u; };

// ---------- timeline ----------
export const T = {
  relay0: 2.5, seg: 2.5, relayEnd: 17.5,
  inflate0: 17.7, inflateDur: 2.4,
  run0: 20.0, lift0: 20.7, liftDur: 2.5,
  out: 25.6, runA: 27.5, runB: 30.0, white: 32.5,
  gather0: 33.0, flash: 35.0,
};
// hue-even felt colours: their light adds to white
const FELT = [0xe8473f, 0xf3c433, 0x4cbf57, 0x2fc3cf, 0x4a6ef0, 0xd04fd6];
const LIGHT = [[1, 0.12, 0.1], [1, 0.85, 0.05], [0.1, 1, 0.2], [0.05, 0.9, 1], [0.15, 0.3, 1], [1, 0.15, 1]];

// ---------- logo path ----------
// Unit stroke of the OpenAI symbol, measured on its official SVG (800 px frame, y down) and refined to
// silhouette IoU 0.926: inner bar → 120° corner → diagonal → outer arc; six copies at 60°.
const UNIT = { bx: -115.59, y0: 6.98, y1: -208.24, td: -28.91, Ld: 198.94, r: 172.9, sg: 138.2, sw: 54.17 };
const R0W = 1.38, KPX = R0W / 381.8; // world units per SVG px (centreline radius 1.38)
export const STROKE_R = (UNIT.sw / 2) * KPX;
function unitStroke() {
  const u = UNIT, pts = [];
  for (let i = 0; i <= 40; i++) pts.push([u.bx, mix(u.y0 + 16, u.y1, i / 40)]);
  const d = [Math.cos((u.td * Math.PI) / 180), Math.sin((u.td * Math.PI) / 180)];
  // rounded 120° corner between bar and diagonal
  const P1 = [u.bx, u.y1];
  for (let i = 1; i <= 40; i++) pts.push([P1[0] + d[0] * u.Ld * (i / 40), P1[1] + d[1] * u.Ld * (i / 40)]);
  const P2 = [P1[0] + d[0] * u.Ld, P1[1] + d[1] * u.Ld], n = [-d[1], d[0]];
  const c = [P2[0] + n[0] * u.r, P2[1] + n[1] * u.r], a0 = Math.atan2(P2[1] - c[1], P2[0] - c[0]);
  for (let i = 1; i <= 90; i++) { const a = a0 + (((u.sg + 5) * Math.PI) / 180) * (i / 90); pts.push([c[0] + u.r * Math.cos(a), c[1] + u.r * Math.sin(a)]); }
  return pts;
}
function chaikin(pts, iters = 2) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    q.push(p[p.length - 1]); p = q;
  }
  return p;
}
function resample(pts, step) {
  const out = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = out[out.length - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (acc + d >= step) {
      const t = (step - acc) / d; const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(p); a = p; d = Math.hypot(b[0] - a[0], b[1] - a[1]); acc = 0;
    }
    acc += d;
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last);
  return out;
}
export function buildPath() {
  const base = chaikin(unitStroke(), 2);
  // to world logo plane: x right, y up
  const strands = [];
  for (let k = 0; k < 6; k++) {
    const ph = (k * TAU) / 6, c = Math.cos(ph), sn = Math.sin(ph);
    strands.push(base.map(([x, y]) => [KPX * (x * c - y * sn), -KPX * (x * sn + y * c)]));
  }
  // order: forward, hop along the rim to the neighbour's outer end, back inward, hop along the inner hexagon ...
  const pts = [], dup = [], loopId = [], segStart = [], segEnd = [], strandEnd = [], bodyRange = [];
  const step = 0.012;
  const push = (arr, isDup, k) => { for (const q of arr) { pts.push(q); dup.push(isDup); loopId.push(k); } };
  for (let k = 0; k < 6; k++) {
    const st = k % 2 === 0 ? strands[k] : strands[k].slice().reverse();
    segStart.push(pts.length);
    const body = resample(st, step);
    const b0 = pts.length;
    push(pts.length ? body.slice(1) : body, 0, k);
    strandEnd.push(pts.length - 1); bodyRange.push([b0, pts.length - 1]);
    if (k < 5) {
      const a = pts[pts.length - 1], nxt = (k + 1) % 2 === 0 ? strands[k + 1][0] : strands[k + 1][strands[k + 1].length - 1];
      let conn;
      if (k % 2 === 0) {
        // outer hop: arc around the rim
        const ra = Math.hypot(a[0], a[1]), rb = Math.hypot(nxt[0], nxt[1]);
        let a0 = Math.atan2(a[1], a[0]), a1 = Math.atan2(nxt[1], nxt[0]);
        let da = ((a1 - a0 + Math.PI * 3) % TAU) - Math.PI;
        conn = []; for (let i = 0; i <= 30; i++) { const u = i / 30, rr = mix(ra, rb, u) + 0.12 * Math.sin(Math.PI * u); conn.push([rr * Math.cos(a0 + da * u), rr * Math.sin(a0 + da * u)]); }
      } else conn = [a, nxt];
      push(resample(conn, step).slice(1), 1, k);
    }
    segEnd.push(pts.length - 1);
  }
  const S = [0];
  for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  // tucks: each strand end dips under the strand it meets; that strand rides over it there
  const ends = [];
  for (let k = 0; k < 6; k++) { const q = strands[k]; ends.push({ p: q[0], k }, { p: q[q.length - 1], k }); }
  const lift = pts.map((p, i) => {
    if (dup[i]) return 0;
    let h = 0;
    for (const e of ends) {
      const d = Math.hypot(p[0] - e.p[0], p[1] - e.p[1]);
      if (e.k === loopId[i]) h = Math.min(h, -0.55 * Math.exp(-((d / 0.1) ** 2)));
      else h = Math.max(h, 0.85 * Math.exp(-((d / 0.13) ** 2)));
    }
    return h;
  });
  const cap = pts.map(() => 1);
  for (const [i0, i1] of bodyRange) for (let i = i0; i <= i1; i++) {
    const d = Math.min(S[i] - S[i0], S[i1] - S[i]), u = clamp(d / 0.07);
    cap[i] = Math.sqrt(1 - (1 - u) * (1 - u));
  }
  let R0 = 0; for (const p of pts) R0 = Math.max(R0, Math.hypot(p[0], p[1]));
  const centers = strands.map((L) => { let x = 0, y = 0; L.forEach((p) => { x += p[0]; y += p[1]; }); return [x / L.length, y / L.length]; });
  return {
    pts, dup, loopId, S, L: S[S.length - 1], segStart, segEnd, segS0: segStart.map((i) => S[i]), segS1: segEnd.map((i) => S[i]),
    strandS1: strandEnd.map((i) => S[i]), lift, cap, R0, centers,
  };
}

// ---------- textures ----------
function canvasTex(w, h, paint, repeat = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  paint(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function feltTexture(seed) {
  return canvasTex(1024, 1024, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = "#808080"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70000; i++) {
      const x = r() * w, y = r() * h, a = r() * TAU, l = 2 + r() * 6, v = Math.floor(95 + r() * 70);
      g.strokeStyle = `rgba(${v},${v},${v},0.35)`; g.lineWidth = 0.5 + r() * 0.7;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  });
}
function mottleTexture(seed) {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = "#f0f0f0"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = r() * w, y = r() * h, rad = 6 + r() * 30, v = Math.floor(200 + r() * 55);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${v},${v},${v},0.35)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 40000; i++) {
      const x = r() * w, y = r() * h, a = r() * TAU, l = 1 + r() * 4, v = Math.floor(185 + r() * 70);
      g.strokeStyle = `rgba(${v},${v},${v},0.5)`; g.lineWidth = 0.5;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  });
}
function furTexture(seed, density) {
  // short soft fibres; blurred so shells read as haze, not specks
  return canvasTex(512, 512, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < density; i++) {
      const x = r() * w, y = r() * h, a = r() * TAU, l = 1.5 + r() * 4, v = Math.floor(60 + r() * 195);
      g.strokeStyle = `rgba(${v},${v},${v},0.9)`; g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }

  });
}
function plyTexture() {
  // three plies twisting along the strand (u along yarn, v around); soft rounded ridges, fine fibres on top
  return canvasTex(512, 512, (g, w, h) => {
    const r = rng(7), img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ph = ((x / w) * 5 + (y / h) * 3) % 1; // 3 plies per turn, one tile per twist
      const ridge = Math.pow(Math.sin(ph * Math.PI), 0.45);
      const v = Math.floor(60 + 160 * ridge);
      const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 9000; i++) {
      const x = r() * w, y = r() * h, a = -1.25 + (r() - 0.5) * 0.5, l = 3 + r() * 10, v = Math.floor(120 + r() * 135);
      g.strokeStyle = `rgba(${v},${v},${v},0.35)`; g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  });
}
function woundTexture() {
  // equirect map of a hand-wound ball: wide bands of strands crossing at many angles
  return canvasTex(1024, 512, (g, w, h) => {
    const r = rng(11);
    g.fillStyle = "#9a9a9a"; g.fillRect(0, 0, w, h);
    for (let b = 0; b < 16; b++) {
      const ph = r() * TAU, amp = h * (0.12 + r() * 0.3), y0 = h * (0.2 + r() * 0.6);
      for (let s = 0; s < 6; s++) {
        const off = (s - 2.5) * 9;
        g.lineCap = "round";
        g.strokeStyle = "#6a6a6a"; g.lineWidth = 10;
        g.beginPath();
        for (let x = -8; x <= w + 8; x += 8) { const y = y0 + off + Math.sin((x / w) * TAU + ph) * amp; x < 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
        g.stroke();
        g.strokeStyle = "#e6e6e6"; g.lineWidth = 6; g.stroke();
      }
    }
  });
}

// ---------- yarn tube material ----------
const yarnUniforms = {
  uLaid: { value: 0 }, uInfl: { value: 0 }, uL: { value: 1 }, uRthin: { value: 0.026 }, uRfat: { value: 0.092 },
  uSeg0: { value: new Array(6).fill(0) }, uSeg1: { value: new Array(6).fill(0) },
  uCol: { value: LIGHT.map((c) => new THREE.Vector3(...c)) },
  uPA: { value: 0 }, uPB: { value: 0 }, uWhite: { value: 0 }, uEmis: { value: 0 }, uHeadGlow: { value: 0 },
};
const YARN_HEAD = /* glsl */ `
uniform float uLaid, uInfl, uL, uRthin, uRfat, uShell;
attribute vec3 aCenter; attribute vec3 aDir; attribute vec3 aUp; attribute float aArc; attribute float aDup; attribute float aLift; attribute float aCap;
varying float vArc; varying float vDup;
float yarnRadius(){
  float w = clamp((uInfl * 1.6 - aArc / uL * 0.6) , 0.0, 1.0);
  w = w*w*(3.0-2.0*w);
  // overshoot as the yarn puffs up
  float pop = sin(clamp(w,0.0,1.0)*3.14159)*0.18;
  if (aDup > 0.5) return uRthin * (1.0 - clamp(uInfl * 3.0, 0.0, 1.0));
  return mix(uRthin, uRfat, w) * (1.0 + pop) * max(aCap, 0.02);
}`;
const YARN_FRAG_HEAD = /* glsl */ `
uniform float uLaid, uL, uPA, uPB, uWhite, uEmis, uHeadGlow, uShell, uInfl;
uniform float uSeg0[6]; uniform float uSeg1[6]; uniform vec3 uCol[6];
varying float vArc; varying float vDup;
float cdist(float s, float a, float b){
  if (s >= a && s <= b) return 0.0;
  float d1 = min(abs(s-a), abs(s-b));
  float d2 = min(abs(s+uL-b), abs(s-uL-a));
  return min(d1, d2);
}
vec3 yarnLight(){
  vec3 sum = vec3(0.0);
  for (int k=0;k<6;k++){
    float a = uSeg0[k], b = uSeg1[k];
    float head = a + (b-a)*uPA;
    float covA = (1.0 - smoothstep(head-0.02, head+0.02, vArc)) * step(a, vArc) * step(vArc, b) * step(0.0005, uPA);
    float covB = 1.0 - smoothstep(uPB*0.5*uL - 0.15, uPB*0.5*uL + 0.05, cdist(vArc, a, b));
    covB *= step(0.0005, uPB);
    float cov = max(covA, covB);
    float g = exp(-pow((vArc-head)/0.06, 2.0)) * uHeadGlow * step(a, vArc) * step(vArc, b + 0.01);
    sum += uCol[k] * (cov + g*2.5);
  }
  vec3 tm = vec3(1.0) - exp(-sum*1.25);
  tm = mix(tm, vec3(1.0), uWhite);
  return tm * uEmis;
}`;
function patchYarn(mat, shell) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, yarnUniforms, { uShell: { value: shell } });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\n" + YARN_HEAD)
      .replace("#include <beginnormal_vertex>", "float infW = clamp((uInfl * 1.6 - aArc / uL * 0.6), 0.0, 1.0); vec3 nMix = mix(aUp * 0.75 + aDir * 0.5, aDir, smoothstep(0.0, 0.3, infW)); vec3 objectNormal = dot(nMix, nMix) > 1e-6 ? normalize(nMix) : aDir;")
      .replace("#include <begin_vertex>", `float yr = yarnRadius(); vec3 transformed = aCenter + aUp * (yr * (1.0 + 0.9*aLift)) + aDir * yr * uShell; vArc = aArc; vDup = aDup;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + YARN_FRAG_HEAD)
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n if ((vDup > 0.5 && uInfl > 0.34) || vArc > uLaid) discard;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += yarnLight() * (1.0 + 0.6*(uShell-1.0));");
  };
  mat.customProgramCacheKey = () => "yarn" + shell;
}
function yarnGeometry(P) {
  const RS = 14, n = P.pts.length;
  const pos = [], cen = [], dir = [], up = [], arc = [], dup = [], lift = [], capA = [], uv = [], idx = [];
  for (let i = 0; i < n; i++) {
    const p = P.pts[i], a = P.pts[Math.max(0, i - 1)], b = P.pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    // logo plane local: (x, 0, -y); plane normal is +y
    const T3 = new THREE.Vector3(tx, 0, -ty), Up = new THREE.Vector3(0, 1, 0), Nn = new THREE.Vector3().crossVectors(T3, Up).normalize();
    for (let j = 0; j <= RS; j++) {
      const ang = (j / RS) * TAU, d = Up.clone().multiplyScalar(Math.cos(ang)).addScaledVector(Nn, Math.sin(ang));
      cen.push(p[0], 0, -p[1]); dir.push(d.x, d.y, d.z); up.push(0, 1, 0);
      pos.push(p[0] + d.x * 0.07, d.y * 0.07, -p[1] + d.z * 0.07);
      arc.push(P.S[i]); dup.push(P.dup[i]); lift.push(P.lift[i]); capA.push(P.cap[i]);
      uv.push(P.S[i] / 0.32, j / RS);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < RS; j++) {
    const a = i * (RS + 1) + j, b = a + RS + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aCenter", new THREE.Float32BufferAttribute(cen, 3));
  g.setAttribute("aDir", new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute("aUp", new THREE.Float32BufferAttribute(up, 3));
  g.setAttribute("aArc", new THREE.Float32BufferAttribute(arc, 1));
  g.setAttribute("aDup", new THREE.Float32BufferAttribute(dup, 1));
  g.setAttribute("aLift", new THREE.Float32BufferAttribute(lift, 1));
  g.setAttribute("aCap", new THREE.Float32BufferAttribute(capA, 1));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere(); g.boundingSphere.radius += 1;
  return g;
}

// ---------- monsters ----------
const SPEC = [
  { rx: 0.25, ry: 0.24, rz: 0.23, eyes: [[-0.075, 0.05], [0.075, 0.05]], er: 0.052, extra: "horns" },
  { rx: 0.2, ry: 0.3, rz: 0.2, eyes: [[-0.062, 0.1], [0.062, 0.1]], er: 0.048, extra: "antenna" },
  { rx: 0.29, ry: 0.2, rz: 0.25, eyes: [[-0.09, 0.03], [0.09, 0.03]], er: 0.05, extra: "ears" },
  { rx: 0.24, ry: 0.25, rz: 0.23, eyes: [[0, 0.06]], er: 0.095, extra: "tuft" },
  { rx: 0.22, ry: 0.22, rz: 0.21, eyes: [[-0.068, 0.04], [0.068, 0.04]], er: 0.046, extra: "bunny" },
  { rx: 0.25, ry: 0.23, rz: 0.23, eyes: [[-0.08, 0.04], [0.08, 0.04]], er: 0.056, extra: "spikes" },
];
function feltMat(color, bumpTex, sheenBoost = 1) {
  const c = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: 1, sheen: 1, sheenRoughness: 0.8, map: feltMat.mottle,
    sheenColor: c.clone().lerp(new THREE.Color(1, 1, 1), 0.2).multiplyScalar(0.7 * sheenBoost),
    bumpMap: bumpTex, bumpScale: 9,
  });
}
// soft felt fuzz: translucent shells, dense at the silhouette, lit by a shared ambient level
export const fuzzShared = { uAmb: { value: 1 }, uRim: { value: new THREE.Color(0, 0, 0) } };
const FUZZ_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vWN;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = -mv.xyz;
  vWN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * mv;
}`;
const FUZZ_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAmb; uniform vec3 uRim; uniform sampler2D uTex; uniform vec2 uRep; uniform float uAlpha;
varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vWN;
void main(){
  vec3 N = normalize(vN), V = normalize(vV);
  float fres = 1.0 - abs(dot(N, V));
  float n = texture2D(uTex, vUv * uRep).r;
  float a = clamp(n * (0.45 + 2.2 * pow(fres, 2.0)) * uAlpha, 0.0, 1.0);
  float key = 0.45 + 0.55 * clamp(dot(normalize(vWN), normalize(vec3(0.2, 1.0, 0.45))), 0.0, 1.0);
  vec3 col = uColor * key * uAmb + uRim * pow(fres, 1.5) * 1.6;
  gl_FragColor = vec4(col, a);
}`;
function fuzzMat(color, tex, alpha, rep = [3, 2]) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTex: { value: tex }, uRep: { value: new THREE.Vector2(...rep) }, uAlpha: { value: alpha }, uAmb: fuzzShared.uAmb, uRim: fuzzShared.uRim },
    vertexShader: FUZZ_VERT, fragmentShader: FUZZ_FRAG, transparent: true, depthWrite: false,
  });
}
function furShells(geo, color, furTex, layers, scaleStep) {
  const group = new THREE.Group();
  const c = new THREE.Color(color).lerp(new THREE.Color(1, 1, 1), 0.18);
  for (let i = 1; i <= layers; i++) {
    const mesh = new THREE.Mesh(geo, fuzzMat(c.clone().lerp(new THREE.Color(1, 1, 1), 0.03 * i), furTex, 1.0 - (i / (layers + 1)) * 0.85, [4 + i * 0.37, 3 + i * 0.29]));
    mesh.scale.setScalar(1 + scaleStep * i);
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  return group;
}
function buildMonster(k, tex) {
  const s = SPEC[k], g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const color = FELT[k], mat = feltMat(color, tex.felt), dark = feltMat(new THREE.Color(color).multiplyScalar(0.62), tex.felt);
  const sph = new THREE.SphereGeometry(1, 64, 40);
  const torso = new THREE.Mesh(sph, mat); torso.castShadow = true;
  const torsoWrap = new THREE.Group(); torsoWrap.scale.set(s.rx, s.ry, s.rz); torsoWrap.position.y = s.ry + 0.035;
  torsoWrap.add(torso); torsoWrap.add(furShells(sph, color, tex.fur, 8, 0.016));
  body.add(torsoWrap);
  const cy = s.ry + 0.035;
  const cream = feltMat(0xf1e6cf, tex.felt);
  const add = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(rx, ry, rz); o.castShadow = true; body.add(o); return o;
  };
  const top = cy + s.ry;
  if (s.extra === "horns") for (const sgn of [-1, 1]) add(new THREE.ConeGeometry(0.045, 0.13, 24), cream, sgn * 0.11, top - 0.04, 0, 1, 1, 1, 0, 0, -sgn * 0.45);
  if (s.extra === "antenna") {
    add(new THREE.CylinderGeometry(0.008, 0.01, 0.16, 12), dark, 0, top + 0.06, 0, 1, 1, 1, 0, 0, 0.15);
    add(sph, feltMat(0xfff1a8, tex.felt), -0.012, top + 0.15, 0, 0.035, 0.035, 0.035);
  }
  if (s.extra === "ears") for (const sgn of [-1, 1]) add(sph, dark, sgn * 0.29, cy + 0.06, 0, 0.11, 0.05, 0.07, 0, 0, sgn * 0.55);
  if (s.extra === "tuft") for (let i = 0; i < 3; i++) add(sph, dark, (i - 1) * 0.05, top + 0.01 + (i === 1 ? 0.03 : 0), 0, 0.035, 0.07, 0.035, 0, 0, (i - 1) * -0.5);
  if (s.extra === "bunny") for (const sgn of [-1, 1]) {
    add(sph, mat, sgn * 0.085, top + 0.12, -0.02, 0.05, 0.16, 0.035, 0, 0, -sgn * 0.18);
  }
  if (s.extra === "spikes") for (let i = 0; i < 4; i++) add(new THREE.ConeGeometry(0.04, 0.12, 20), dark, (i - 1.5) * 0.08, top - 0.02 - Math.abs(i - 1.5) * 0.04, 0.0, 1, 1, 1, 0, 0, (i - 1.5) * -0.35);
  // eyes
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.15, metalness: 0 });
  const eyes = [];
  s.er *= 1.22;
  const blush = new THREE.MeshStandardMaterial({ color: 0xff8f9a, roughness: 1, transparent: true, opacity: 0.55 });
  if (s.eyes.length === 2) for (const sgn of [-1, 1]) {
    const bx = sgn * (Math.abs(s.eyes[0][0]) + s.er * 0.9), by = s.eyes[0][1] - s.er * 1.3, nx = bx / s.rx, ny = by / s.ry;
    const bz = s.rz * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const b = new THREE.Mesh(sph, blush); b.scale.set(s.er * 0.55, s.er * 0.32, 0.006); b.position.set(bx, cy + by, bz + 0.004); b.lookAt(bx * 2, cy + by * 2, bz * 2 + 1); body.add(b);
  }
  for (const [ex, ey] of s.eyes) {
    const ny = ey / s.ry, nx = ex / s.rx, z = s.rz * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const eg = new THREE.Group(); eg.position.set(ex, cy + ey, z - s.er * 0.35);
    const w = new THREE.Mesh(sph, eyeWhite); w.scale.set(s.er, s.er, s.er * 0.7); eg.add(w);
    const p = new THREE.Mesh(sph, pupilMat); p.scale.set(s.er * 0.5, s.er * 0.5, s.er * 0.3); p.position.z = s.er * 0.55; eg.add(p);
    const hl = new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ color: 0xffffff })); hl.scale.setScalar(s.er * 0.13); hl.position.set(s.er * 0.18, s.er * 0.2, s.er * 0.82); eg.add(hl);
    body.add(eg); eyes.push({ g: eg, pupil: p });
  }
  // mouth
  const mouth = new THREE.Mesh(sph, new THREE.MeshStandardMaterial({ color: 0x2a0d10, roughness: 0.6 }));
  const my = cy - s.ry * 0.25, mz = s.rz * Math.sqrt(1 - (my - cy) ** 2 / s.ry ** 2) - 0.01;
  mouth.position.set(0, my, mz); body.add(mouth);
  // feet
  const feet = [];
  for (const sgn of [-1, 1]) {
    const f = new THREE.Mesh(sph, dark); f.scale.set(0.065, 0.035, 0.085); f.castShadow = true; f.position.set(sgn * s.rx * 0.45, 0.035, 0.02);
    g.add(f); feet.push(f);
  }
  // arms (pivot at shoulder)
  const arms = [];
  for (const sgn of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(sgn * s.rx * 0.92, cy - s.ry * 0.05, 0);
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.09, 8, 16), mat); a.castShadow = true; a.position.y = -0.07;
    piv.add(a); body.add(piv); arms.push({ piv, sgn });
  }
  return { g, body, eyes, mouth, feet, arms, eyeWhite, spec: s, mouthBase: { y: my, z: mz } };
}

// ---------- world ----------
export class YarnFilm {
  constructor(width, height) {
    this.W = width; this.H = height;
    this.canvas = document.createElement("canvas"); this.canvas.width = width; this.canvas.height = height;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" }));
    r.setPixelRatio(1); r.setSize(width, height, false);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.12;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 11, 22);
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    this.camera = new THREE.PerspectiveCamera(32, width / height, 0.05, 60);
    this.camera.layers.enable(1); // fuzz shells: seen directly, kept out of the mirror

    this.P = buildPath();
    const P = this.P;
    yarnUniforms.uL.value = P.L;
    yarnUniforms.uSeg0.value = P.segS0.slice(); yarnUniforms.uSeg1.value = P.strandS1.slice();

    const tex = { felt: feltTexture(3), fur: furTexture(5, 60000), ply: plyTexture(), wound: woundTexture(), yfur: furTexture(9, 22000) };
    tex.felt.repeat.set(4, 3);
    feltMat.mottle = mottleTexture(21); feltMat.mottle.colorSpace = THREE.SRGBColorSpace; feltMat.mottle.repeat.set(2, 2);
    tex.ply.repeat.set(1, 1);
    this.tex = tex;

    // floor: mirror under a translucent black lacquer
    const mirror = new Reflector(new THREE.PlaneGeometry(60, 60), { textureWidth: Math.round(width / 1.5), textureHeight: Math.round(height / 1.5), multisample: 4, color: 0x7a7a7a, clipBias: 0.002 });
    mirror.rotation.x = -Math.PI / 2; scene.add(mirror); this.mirror = mirror;
    const lacquer = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.55, metalness: 0, clearcoat: 0, specularIntensity: 0.3, transparent: true, opacity: 0.9 }));
    lacquer.rotation.x = -Math.PI / 2; lacquer.position.y = 0.002; lacquer.receiveShadow = true; scene.add(lacquer);
    this.lacquer = lacquer;

    // lights
    this.key = new THREE.SpotLight(0xfff3e2, 260, 30, 0.62, 0.75, 1.6);
    this.key.position.set(0.6, 8.5, 2.2); this.key.target.position.set(0, 0, 0);
    this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0004; this.key.shadow.radius = 4;
    scene.add(this.key, this.key.target);
    this.fill = new THREE.HemisphereLight(0xbfd2ff, 0x101010, 0.35); scene.add(this.fill);
    this.rim = new THREE.DirectionalLight(0xc8dcff, 1.2); this.rim.position.set(-3, 3, -6); scene.add(this.rim);
    this.flashLight = new THREE.PointLight(0xffffff, 0, 30, 1.2); scene.add(this.flashLight);

    // logo
    this.logo = new THREE.Group(); scene.add(this.logo);
    const yg = yarnGeometry(P);
    const yarnMat = new THREE.MeshPhysicalMaterial({ color: 0xe9e5de, roughness: 1.0, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.8, 0.8, 0.8), bumpMap: tex.ply, bumpScale: 3, emissive: 0x0b0a09 });
    patchYarn(yarnMat, 1.0);
    this.yarnMat = yarnMat;
    this.yarn = new THREE.Mesh(yg, yarnMat); this.yarn.frustumCulled = false; this.logo.add(this.yarn);
    for (const [shell, al] of [[1.035, 0.5], [1.075, 0.3]]) {
      const m = new THREE.ShaderMaterial({
        uniforms: { ...yarnUniforms, uShell: { value: shell }, uTex: { value: tex.yfur }, uAlpha: { value: al }, uAmb: fuzzShared.uAmb, uRim: fuzzShared.uRim },
        vertexShader: YARN_HEAD + `
varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vWN;
void main(){
  float yr = yarnRadius();
  vec3 p = aCenter + aUp * (yr * (1.0 + 0.9*aLift)) + aDir * yr * uShell;
  vArc = aArc; vDup = aDup; vUv = uv;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * aDir); vV = -mv.xyz; vWN = normalize(mat3(modelMatrix) * aDir);
  gl_Position = projectionMatrix * mv;
}`,
        fragmentShader: YARN_FRAG_HEAD + `
uniform sampler2D uTex; uniform float uAlpha; uniform float uAmb; uniform vec3 uRim;
varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vWN;
void main(){
  if ((vDup > 0.5 && uInfl > 0.34) || vArc > uLaid) discard;
  vec3 N = normalize(vN), V = normalize(vV);
  float fres = 1.0 - abs(dot(N, V));
  float n = texture2D(uTex, vUv * vec2(0.35, 1.0)).r;
  float a = n * (0.6 - 0.45 * pow(fres, 1.5)) * uAlpha;
  float key = 0.5 + 0.5 * clamp(dot(normalize(vWN), normalize(vec3(0.2, 1.0, 0.45))), 0.0, 1.0);
  vec3 col = vec3(0.92, 0.9, 0.86) * key * uAmb + yarnLight() * 1.1;
  gl_FragColor = vec4(col, a);
}`,
        transparent: true, depthWrite: false,
      });
      const mesh = new THREE.Mesh(yg, m); mesh.frustumCulled = false; mesh.renderOrder = 3; this.logo.add(mesh); (this.yarnShells ||= []).push(mesh); mesh.layers.set(1);
    }
    // caps at the open ends of the laid strand
    this.capMat = yarnMat.clone(); this.capMat.onBeforeCompile = () => {};
    this.capA = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0xf2eee6, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(1, 1, 1) }));
    this.logo.add(this.capA);
    // per-loop coloured lights for the light run
    this.loopLights = P.centers.map((c, k) => { const l = new THREE.PointLight(0xffffff, 0, 6, 1.5); l.position.set(c[0], 0.35, -c[1]); this.logo.add(l); return l; });

    // ball
    this.ball = new THREE.Group(); scene.add(this.ball);
    const bs = new THREE.SphereGeometry(1, 64, 40);
    const ballMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f0e8, roughness: 0.85, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(1, 1, 1), map: tex.wound, bumpMap: tex.wound, bumpScale: 6 });
    this.ballSpin = new THREE.Group(); this.ball.add(this.ballSpin);
    const bm = new THREE.Mesh(bs, ballMat); bm.castShadow = true; this.ballSpin.add(bm);
    this.ballSpin.add(furShells(bs, 0xf4f0e8, tex.yfur, 6, 0.012));

    // monsters
    this.mons = [];
    for (let k = 0; k < 6; k++) { const m = buildMonster(k, tex); scene.add(m.g); this.mons.push(m); }

    // park spots outside each loop
    this.park = P.centers.map((c, k) => {
      const a = Math.atan2(c[1], c[0]) + (k === 4 ? -0.2 : 0); const R = P.R0 + (k === 4 ? 1.05 : 0.62);
      return new THREE.Vector3(Math.cos(a) * R, 0, -Math.sin(a) * R);
    });

    // post
    const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(scene, this.camera));
    // NaN/Inf guard: one bad pixel would otherwise be smeared into a black block by the bloom blur
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        bool bad(float x){ uint b = floatBitsToUint(x); return (b & 0x7f800000u) == 0x7f800000u; }
        void main(){ vec4 c = texture2D(tDiffuse, vUv);
          if (bad(c.r) || bad(c.g) || bad(c.b) || bad(c.a)) c = vec4(0.0, 0.0, 0.0, 1.0);
          gl_FragColor = clamp(c, 0.0, 64.0); }`,
    }));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.2, 0.35, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  // path sample in logo plane
  at(s) {
    const P = this.P, S = P.S; s = clamp(s, 0, P.L);
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const u = S[hi] > S[lo] ? (s - S[lo]) / (S[hi] - S[lo]) : 0;
    const a = P.pts[lo], b = P.pts[hi];
    const i0 = Math.max(0, lo - 3), i1 = Math.min(S.length - 1, hi + 3);
    let tx = P.pts[i1][0] - P.pts[i0][0], ty = P.pts[i1][1] - P.pts[i0][1]; const l = Math.hypot(tx, ty) || 1;
    return { x: mix(a[0], b[0], u), y: mix(a[1], b[1], u), tx: tx / l, ty: ty / l };
  }
  laidAt(t) {
    const P = this.P;
    if (t < T.relay0) return 0;
    if (t >= T.relayEnd) return P.L;
    const k = Math.min(5, Math.floor((t - T.relay0) / T.seg)), u = (t - T.relay0 - k * T.seg) / T.seg;
    const e = mix(u, smooth(u), 0.45);
    return mix(P.segS0[k], P.segS1[k], e);
  }
  ballRadius(s) { return 0.055 + 0.15 * Math.sqrt(clamp(1 - s / this.P.L)); }
  ballPose(t) {
    const P = this.P;
    if (t < T.relay0) {
      const p0 = this.at(0), u = smooth(t / T.relay0) * 0.85 + (t / T.relay0) * 0.15, back = (1 - u) * 2.4;
      return { x: p0.x - p0.tx * back, y: p0.y - p0.ty * back, tx: p0.tx, ty: p0.ty, s: 0, roll: -back };
    }
    const s = this.laidAt(t), p = this.at(s);
    return { ...p, s, roll: s };
  }
  monsterState(k, t) {
    const P = this.P, park = this.park[k];
    const st = { x: park.x, z: park.z, h: 0, yaw: 0, lean: 0, armUp: 0, armFwd: 0, mouth: 0.15, step: 0, look: null, squash: 0 };
    const ball = this.ballPose(Math.min(t, T.relayEnd));
    const bw = (bp) => new THREE.Vector3(bp.x, 0, -bp.y);
    const faceTo = (x, z) => Math.atan2(x - st.x, z - st.z);
    const Tk = T.relay0 + k * T.seg;
    const behind = (bp) => { const r = this.ballRadius(bp.s) + 0.2; return new THREE.Vector3(bp.x - bp.tx * r, 0, -(bp.y - bp.ty * r)); };
    const ballW = bw(ball);
    // idle default: face the ball, gentle bob
    st.yaw = faceTo(ballW.x, ballW.z);
    st.h = 0.012 * Math.max(0, Math.sin(t * 5 + k * 1.7));
    const pushing = (k === 0 && t < T.relay0) || (t >= Tk && t < Tk + T.seg);
    if (t < T.run0) {
      if (pushing) {
        const bp = this.ballPose(t), p = behind(bp);
        st.x = p.x; st.z = p.z; st.yaw = Math.atan2(bp.tx, -bp.ty);
        st.lean = 0.32; st.armFwd = 1; st.step = t * 9; st.mouth = 0.35; st.h = 0.01 * Math.abs(Math.sin(t * 9));
      } else if (k > 0 && t >= Tk - 0.7 && t < Tk) {
        const u = (t - (Tk - 0.7)) / 0.7, bp = this.ballPose(Tk), p = behind(bp);
        st.x = mix(park.x, p.x, smooth(u)); st.z = mix(park.z, p.z, smooth(u));
        st.h = 0.32 * Math.sin(Math.PI * u);
        st.yaw = lerpAngle(Math.atan2(p.x - park.x, p.z - park.z), Math.atan2(bp.tx, -bp.ty), smooth((u - 0.5) * 2));
        st.armUp = 0.6 * Math.sin(Math.PI * u); st.squash = -0.15 * Math.sin(Math.PI * u); st.mouth = 0.5;
      } else if (t >= Tk + T.seg && t < Tk + T.seg + 0.75) {
        const u = (t - Tk - T.seg) / 0.75, bp = this.ballPose(Tk + T.seg), p = behind(bp);
        st.x = mix(p.x, park.x, smooth(u)); st.z = mix(p.z, park.z, smooth(u));
        st.h = 0.3 * Math.sin(Math.PI * u); st.yaw = Math.atan2(park.x - p.x, park.z - p.z);
        st.armUp = 1; st.mouth = 0.8;
      } else if (t >= Tk + T.seg + 0.75) {
        // cheer once back home
        const c = bump(t, Tk + T.seg + 0.8, 0.4) + bump(t, Tk + T.seg + 1.25, 0.4);
        st.h += 0.1 * c; st.armUp = Math.min(1, c * 1.5); st.mouth = 0.2 + 0.6 * c;
      }
      // surprise hop as the yarn puffs past
      const surprise = bump(t, T.inflate0 + 0.3 + k * 0.22, 0.45);
      st.h += 0.2 * surprise; st.armUp = Math.max(st.armUp, surprise); st.mouth = Math.max(st.mouth, surprise);
      if (t > T.inflate0) st.yaw = lerpAngle(st.yaw, faceTo(0, 0), ramp(t, T.inflate0, 0.5));
    } else {
      // front row, then photo spots
      const row = new THREE.Vector3(-1.95 + 0.78 * k, 0, 2.4);
      const photo = new THREE.Vector3(-1.4 + 0.56 * k, 0, 1.55 + (k % 2) * 0.22);
      const from = this.park[k];
      const u = clamp((t - T.run0 - k * 0.08) / 1.6);
      let px = mix(from.x, row.x, smooth(u)), pz = mix(from.z, row.z, smooth(u));
      const v = clamp((t - T.gather0 - (5 - k) * 0.06) / 0.9);
      px = mix(px, photo.x, smooth(v)); pz = mix(pz, photo.z, smooth(v));
      st.x = px; st.z = pz;
      const moving = (u > 0 && u < 1) || (v > 0 && v < 1);
      st.h = moving ? 0.14 * Math.abs(Math.sin(t * 11 + k)) : 0.008 * Math.max(0, Math.sin(t * 4 + k));
      st.step = moving ? t * 12 : 0;
      st.yaw = u < 1 ? Math.atan2(row.x - from.x, row.z - from.z) : 0;
      // turn to watch the logo stand up, then face camera
      const watch = ramp(t, T.lift0, 0.4) * (1 - ramp(t, T.lift0 + T.liftDur + 0.6, 0.6));
      st.yaw = lerpAngle(lerpAngle(st.yaw, 0, ramp(t, T.run0 + 1.4, 0.4)), Math.PI, watch);
      st.look = [0, 0.5];
      const standCheer = bump(t, T.lift0 + T.liftDur + 0.05 + k * 0.07, 0.45);
      st.h += 0.18 * standCheer; st.armUp = standCheer; st.mouth = 0.2 + 0.7 * standCheer;
      // lights out: startle
      const startle = bump(t, T.out + 0.05, 0.25);
      st.h += 0.05 * startle; st.squash = 0.1 * startle;
      if (t > T.out) st.mouth = 0.45;
      // white burst: arms up
      const wow = bump(t, T.white + 0.1 + k * 0.05, 0.6);
      st.h += 0.16 * wow; st.armUp = Math.max(st.armUp, wow); st.mouth = Math.max(st.mouth, 0.3 + 0.6 * wow);
      if (t > T.gather0 + 1) { st.armUp = Math.max(st.armUp, 0.25); st.mouth = 0.55; }
      // anticipation squat then the photo jump
      const squat = ramp(t, T.flash - 0.55, 0.3) * (1 - ramp(t, T.flash - 0.22, 0.08));
      st.squash = Math.max(st.squash, 0.18 * squat);
      const j = clamp((t - (T.flash - 0.22 + (k % 3) * 0.02)) / 0.6);
      if (j > 0 && j < 1) { st.h += (0.28 + 0.06 * (k % 2)) * Math.sin(Math.PI * j); st.armUp = 1; st.mouth = 1; st.squash = -0.12 * Math.sin(Math.PI * j); }
      st.yaw += (k - 2.5) * -0.06 * ramp(t, T.gather0 + 0.8, 0.4);
    }
    return st;
  }

  camAt(t) {
    // [t, tx,ty,tz, dist, yaw, pitch, fov]
    const K = [
      [0, 0.3, 0.15, 1.2, 4.9, 0.55, 0.4, 34],
      [2.5, 0.0, 0.05, 0.9, 4.9, 0.45, 0.48, 34],
      [7, 0, 0, 0.1, 5.4, 0.12, 0.55, 34],
      [12, 0, 0, 0, 5.6, -0.28, 0.6, 34],
      [15.5, 0, 0, 0, 6.4, -0.38, 0.85, 34],
      [18.6, 0, 0, 0, 6.9, -0.18, 1.18, 34],
      [20.3, 0, 0.2, 0.2, 7.4, -0.08, 1.02, 34],
      [23.6, 0, 1.45, 0.6, 8.9, 0.0, 0.12, 34],
      [25.6, 0, 1.45, 0.6, 8.5, 0.03, 0.1, 34],
      [32.5, 0, 1.4, 0.6, 7.9, -0.04, 0.1, 34],
      [35, 0, 1.2, 1.1, 6.3, 0.0, 0.08, 36],
      [40, 0, 1.2, 1.1, 6.3, 0.0, 0.08, 36],
    ];
    let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const a = K[Math.max(0, i - 1)], b = K[i], c = K[i + 1], d = K[Math.min(K.length - 1, i + 2)];
    const u = smooth(clamp((t - b[0]) / (c[0] - b[0])) * 0.5 + 0.25) * 2 - 0.5; // gentle ease
    const uu = clamp((t - b[0]) / (c[0] - b[0]));
    const cr = (p0, p1, p2, p3, x) => 0.5 * (2 * p1 + (-p0 + p2) * x + (2 * p0 - 5 * p1 + 4 * p2 - p3) * x * x + (-p0 + 3 * p1 - 3 * p2 + p3) * x * x * x);
    const v = []; for (let j = 1; j < 8; j++) v.push(cr(a[j], b[j], c[j], d[j], uu));
    return v;
  }

  render(t, opts = {}) {
    const P = this.P, U = yarnUniforms;
    // ---- yarn
    const laid = this.laidAt(t);
    U.uLaid.value = t >= T.relayEnd ? P.L + 1 : laid;
    U.uInfl.value = clamp((t - T.inflate0) / T.inflateDur) * 1.0;
    this.yarnMat.bumpScale = mix(0.25, 3, ramp(t, T.inflate0 + 0.3, 1.8));
    U.uPA.value = smooth(clamp((t - T.runA) / (T.runB - T.runA - 0.2)));
    U.uPB.value = smooth(clamp((t - T.runB) / (T.white - T.runB - 0.1)));
    U.uHeadGlow.value = ramp(t, T.runA, 0.2) * (1 - ramp(t, T.runB, 0.6));
    const whiteBurst = ramp(t, T.white - 0.2, 0.4);
    U.uWhite.value = whiteBurst;
    U.uEmis.value = ramp(t, T.runA - 0.1, 0.25) * (0.9 + 0.35 * whiteBurst + 0.8 * Math.exp(-Math.max(0, t - T.white) * 3) * whiteBurst);
    const photo = opts.photo || 0;
    U.uEmis.value *= 1 - 0.5 * photo;
    // ---- logo lift
    const lift = smooth(clamp((t - T.lift0) / T.liftDur));
    const th = (Math.PI / 2) * mix(lift, 1 - Math.pow(1 - lift, 3) * (1 + 0.0), 0.5);
    const overshoot = 0.06 * Math.sin(Math.PI * clamp((t - T.lift0 - T.liftDur + 0.25) / 0.6)) * (t > T.lift0 + T.liftDur - 0.25 ? 1 : 0);
    this.logo.rotation.x = th + overshoot;
    this.logo.position.set(0, (P.R0 + 0.42) * Math.sin(th), -0.3 * lift);
    // ---- caps (start end of strand)
    const r = mix(U.uRthin.value, U.uRfat.value, smooth(clamp(U.uInfl.value * 1.6)));
    const p0 = this.at(0);
    this.capA.position.set(p0.x, r * (1 + 0.9 * P.lift[0]), -p0.y); this.capA.scale.setScalar(r * 1.02);
    this.capA.visible = t >= T.relay0 && t < T.relayEnd;
    // ---- ball
    const bp = this.ballPose(Math.min(t, T.relayEnd));
    const br = this.ballRadius(bp.s) * (1 - ramp(t, T.relayEnd - 0.05, 0.3));
    this.ball.visible = br > 0.002;
    this.ball.position.set(bp.x, br, -bp.y);
    this.ball.scale.setScalar(Math.max(br, 0.001));
    const axis = new THREE.Vector3(-bp.ty, 0, -bp.tx).normalize();
    this.ballSpin.quaternion.setFromAxisAngle(axis, bp.roll / 0.14);
    // ---- monsters
    const lightsOut = ramp(t, T.out, 0.12) * (1 - (t > T.out && t < T.out + 0.35 ? 0.5 * bump(t, T.out + 0.12, 0.12) : 0));
    for (let k = 0; k < 6; k++) {
      const m = this.mons[k], st = this.monsterState(k, t);
      m.g.position.set(st.x, st.h, st.z); m.g.rotation.y = st.yaw;
      m.body.rotation.x = st.lean;
      m.body.scale.set(1 + st.squash * 0.6, 1 - st.squash, 1 + st.squash * 0.6);
      for (const a of m.arms) { a.piv.rotation.z = a.sgn * (0.25 + 2.3 * st.armUp); a.piv.rotation.x = -1.3 * st.armFwd; }
      m.feet.forEach((f, i) => { const ph = st.step + i * Math.PI; f.position.z = 0.02 + (st.step ? 0.05 * Math.sin(ph) : 0); f.position.y = 0.035 + (st.step ? 0.025 * Math.max(0, Math.cos(ph)) : 0); });
      m.mouth.scale.set(0.03 + 0.012 * st.mouth, 0.008 + 0.035 * st.mouth, 0.012);
      const blink = (Math.sin(t * 0.9 + k * 2.1) > 0.985) ? 0.15 : 1;
      // pupils: watch the ball, or look at camera
      for (const e of m.eyes) {
        e.g.scale.y = blink;
        let lx = 0, ly = 0.15;
        if (st.look) { lx = st.look[0]; ly = st.look[1]; }
        e.pupil.position.x = lx * m.spec.er * 0.3; e.pupil.position.y = (ly - 0.2) * m.spec.er * 0.3;
      }
      m.eyeWhite.emissiveIntensity = 0.9 * lightsOut * (1 - photo);
    }
    // ---- lights
    const amb = 1 - lightsOut;
    this.key.intensity = 260 * amb * (1 - 0.3 * bump(t, 16.5, 6)) + 140 * photo;
    this.fill.intensity = 0.35 * amb + 0.25 * photo;
    this.rim.intensity = 1.2 * amb;
    this.scene.environmentIntensity = 0.35 * amb + 0.04 + 0.3 * photo;
    const emis = U.uEmis.value;
    fuzzShared.uAmb.value = 0.06 + 0.94 * amb + 0.6 * photo;
    { // rim light on fuzz from the glowing logo
      const pa = U.uPA.value > 0 ? 1 : 0, w = clamp(U.uPB.value * 1.2 + whiteBurst);
      const avg = new THREE.Color(0.55, 0.55, 0.55);
      fuzzShared.uRim.value.copy(avg).multiplyScalar(0.14 * emis * pa * (0.6 + 0.4 * w));
    }
    P.centers.forEach((c, k) => {
      const l = this.loopLights[k];
      const colA = new THREE.Color(...LIGHT[k]);
      l.color.copy(colA.lerp(new THREE.Color(1, 1, 1), clamp(U.uPB.value * 1.2 + whiteBurst)));
      l.intensity = 0.5 * emis * (U.uPA.value > 0 ? 1 : 0);
    });
    this.bloom.strength = 0.06 + 0.4 * ramp(t, T.runA - 0.2, 0.4) + 0.35 * whiteBurst * Math.exp(-Math.max(0, t - T.white) * 1.5);
    this.bloom.threshold = t > T.out ? 0.72 : 0.92;
    if (photo) { this.bloom.strength = 0.22; this.bloom.threshold = 0.85; }
    // ---- camera
    const [tx, ty, tz, dist, yaw, pitch, fov] = this.camAt(t);
    let ctx2 = tx, ctz = tz;
    if (t > 1.5 && t < T.relayEnd + 2) { const w = 0.42 * ramp(t, 1.5, 1) * (1 - ramp(t, 14.5, 3)); ctx2 += bp.x * w; ctz += -bp.y * w; }
    const cp = new THREE.Vector3(ctx2 + dist * Math.sin(yaw) * Math.cos(pitch), ty + dist * Math.sin(pitch), ctz + dist * Math.cos(yaw) * Math.cos(pitch));
    this.camera.position.copy(cp); this.camera.fov = fov; this.camera.updateProjectionMatrix();
    this.camera.lookAt(ctx2, ty, ctz);
    this.flashLight.position.copy(cp).add(new THREE.Vector3(0.6, 0.5, 0));
    this.flashLight.intensity = 22 * photo;

    this.composer.render();
    return this.canvas;
  }
}

window.YarnFilm = YarnFilm;
window.YARN_T = T;

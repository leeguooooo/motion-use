// Felt monsters shared with the yarn-relay film: materials, soft fuzz shells and the six characters.
import * as THREE from "three";
const TAU = Math.PI * 2;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const FELT = [0xe8473f, 0xf3c433, 0x4cbf57, 0x2fc3cf, 0x4a6ef0, 0xd04fd6];
export function canvasTex(w, h, paint, repeat = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  paint(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
export function feltTexture(seed) {
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
export function mottleTexture(seed) {
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
export function furTexture(seed, density) {
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
// ---------- monsters ----------
const SPEC = [
  { rx: 0.25, ry: 0.24, rz: 0.23, eyes: [[-0.075, 0.05], [0.075, 0.05]], er: 0.052, extra: "horns" },
  { rx: 0.2, ry: 0.3, rz: 0.2, eyes: [[-0.062, 0.1], [0.062, 0.1]], er: 0.048, extra: "antenna" },
  { rx: 0.29, ry: 0.2, rz: 0.25, eyes: [[-0.09, 0.03], [0.09, 0.03]], er: 0.05, extra: "ears" },
  { rx: 0.24, ry: 0.25, rz: 0.23, eyes: [[0, 0.06]], er: 0.095, extra: "tuft" },
  { rx: 0.22, ry: 0.22, rz: 0.21, eyes: [[-0.068, 0.04], [0.068, 0.04]], er: 0.046, extra: "bunny" },
  { rx: 0.25, ry: 0.23, rz: 0.23, eyes: [[-0.08, 0.04], [0.08, 0.04]], er: 0.056, extra: "spikes" },
];
export function feltMat(color, bumpTex, sheenBoost = 1) {
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
export function buildMonster(k, tex) {
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


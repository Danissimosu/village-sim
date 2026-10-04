// Villager rendering: two InstancedMeshes (animated near LOD with shadows, static far LOD) sharing one material.
// Limb swing / stoop / bending-over-work is done in the vertex shader from per-instance attributes, so animating
// 300 people costs 2–3 draw calls and no CPU skinning. Instances are compacted every frame (distance + frustum culling).
import * as THREE from 'three';
import { mulberry32 } from '../util.js';

const MAX = 320;

// ---------------------------------------------------------------------------------------------------------------
// geometry: low-poly articulated humanoid (parts: 0 torso, 1 head, 2/3 arms, 4/5 legs) – metres, 1.78 m adult male
class MB {
  constructor() { this.p = []; this.n = []; this.m = []; }
  _tri(a, b, c, meta, hint) {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return; nx /= l; ny /= l; nz /= l;
    const cx = (a[0] + b[0] + c[0]) / 3 - hint[0], cy = (a[1] + b[1] + c[1]) / 3 - hint[1], cz = (a[2] + b[2] + c[2]) / 3 - hint[2];
    if (nx * cx + ny * cy + nz * cz < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    for (const v of [a, b, c]) { this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz); this.m.push(meta[0], meta[1], meta[2]); }
  }
  quad(a, b, c, d, meta, hint) { this._tri(a, b, c, meta, hint); this._tri(a, c, d, meta, hint); }
  // rings: [{y, rx, rz, cx, cz}] bottom -> top
  tube(rings, sides, meta, capTop, capBot, axisX = 0) {
    const R = rings.map((r) => { const o = []; for (let k = 0; k < sides; k++) { const t = ((k + 0.5) / sides) * Math.PI * 2; o.push([(r.cx || 0) + Math.cos(t) * r.rx, r.y, (r.cz || 0) + Math.sin(t) * r.rz]); } return o; });
    for (let i = 0; i + 1 < R.length; i++) for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides; const hint = [rings[i].cx || 0, (rings[i].y + rings[i + 1].y) / 2, rings[i].cz || 0];
      this.quad(R[i][k], R[i][k2], R[i + 1][k2], R[i + 1][k], meta, hint);
    }
    const cap = (ri, up) => { const r = rings[ri], c = [r.cx || 0, r.y, r.cz || 0]; const h = [c[0], c[1] + (up ? -1 : 1), c[2]]; for (let k = 0; k < sides; k++) this._tri(c, R[ri][k], R[ri][(k + 1) % sides], meta, h); };
    if (capTop) cap(R.length - 1, true); if (capBot) cap(0, false);
  }
  ellipsoid(cx, cy, cz, rx, ry, rz, sides, rings, thetaMax, meta) {
    const rs = []; for (let j = 0; j <= rings; j++) { const f = (j / rings) * thetaMax; rs.push({ y: cy + ry * Math.cos(f), rx: Math.max(1e-4, rx * Math.sin(f)), rz: Math.max(1e-4, rz * Math.sin(f)), cx, cz }); }
    rs.reverse(); // bottom -> top
    const R = rs.map((r) => { const o = []; for (let k = 0; k < sides; k++) { const t = ((k + 0.5) / sides) * Math.PI * 2; o.push([r.cx + Math.cos(t) * r.rx, r.y, r.cz + Math.sin(t) * r.rz]); } return o; });
    const hint = [cx, cy, cz];
    for (let i = 0; i + 1 < R.length; i++) for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; this.quad(R[i][k], R[i][k2], R[i + 1][k2], R[i + 1][k], meta, hint); }
  }
  box(cx, cy, cz, hx, hy, hz, meta) {
    const v = (sx, sy, sz) => [cx + sx * hx, cy + sy * hy, cz + sz * hz], h = [cx, cy, cz];
    this.quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1), meta, h); this.quad(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), meta, h);
    this.quad(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1), meta, h); this.quad(v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), meta, h);
    this.quad(v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1), meta, h); this.quad(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1), meta, h);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('aMeta', new THREE.Float32BufferAttribute(this.m, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.2); g.boundingBox = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    return g;
  }
}

export function buildHumanGeometry(lod) {
  const mb = new MB(), hi = lod === 0, S = hi ? 8 : 5, LS = hi ? 6 : 4;
  const T = (y, rx, rz, cz = 0, cx = 0) => ({ y, rx, rz, cx, cz });
  // torso: hips (trousers colour), chest (jacket colour), neck
  mb.tube([T(0.86, 0.165, 0.1), T(1.02, 0.155, 0.095)], S, [0, 3, 0], false, true);
  mb.tube(hi ? [T(1.02, 0.155, 0.095), T(1.15, 0.145, 0.09), T(1.32, 0.19, 0.11), T(1.47, 0.2, 0.1)] : [T(1.02, 0.155, 0.095), T(1.32, 0.19, 0.11), T(1.47, 0.2, 0.1)], S, [0, 2, 0], true, false);
  if (hi) mb.tube([T(1.46, 0.052, 0.05), T(1.58, 0.046, 0.045)], 6, [0, 0, 0], false, false);
  // head group (part 1)
  const hs = hi ? 8 : 5;
  mb.ellipsoid(0, 1.66, 0, 0.085, 0.11, 0.1, hs, hi ? 5 : 3, Math.PI, [1, 0, 0]);
  if (hi) mb.box(0, 1.645, 0.103, 0.011, 0.016, 0.014, [1, 0, 0]);
  mb.ellipsoid(0, 1.675, -0.012, 0.093, 0.108, 0.107, hs, hi ? 3 : 2, 1.8, [1, 1, 1]);                                  // short hair (acc 1)
  mb.tube(hi ? [T(1.68, 0.1, 0.035, -0.07), T(1.5, 0.105, 0.04, -0.095), T(1.3, 0.09, 0.03, -0.1)] : [T(1.68, 0.1, 0.035, -0.07), T(1.3, 0.095, 0.035, -0.1)], hi ? 6 : 4, [1, 1, 2], false, false);   // long hair (acc 2)
  mb.ellipsoid(0, 1.665, -0.015, 0.1, 0.118, 0.114, hs, hi ? 4 : 2, 2.25, [1, 6, 3]);                                    // head scarf (acc 3)
  mb.ellipsoid(0, 1.715, 0, 0.099, 0.075, 0.106, hs, 2, 1.5, [1, 6, 4]);                                                   // cap crown (acc 4)
  mb.box(0, 1.712, 0.135, 0.05, 0.005, 0.04, [1, 6, 4]);                                                                   // cap brim
  // skirt / dress (acc 5, torso part)
  mb.tube([T(0.62, 0.25, 0.19), T(0.98, 0.17, 0.105)], hi ? 8 : 5, [0, 2, 5], false, false);
  // limbs
  for (const sd of [-1, 1]) {
    const part = sd < 0 ? 4 : 5, lx = sd * 0.095, ap = sd < 0 ? 2 : 3, ax = sd * 0.245;
    mb.tube(hi ? [T(0.085, 0.045, 0.05, 0.02, lx), T(0.5, 0.058, 0.062, 0, lx), T(0.93, 0.075, 0.08, 0, lx)] : [T(0.085, 0.045, 0.05, 0.02, lx), T(0.93, 0.07, 0.075, 0, lx)], LS, [part, 5, 0], true, true);
    mb.box(lx, 0.037, 0.05, 0.05, 0.037, 0.115, [part, 4, 0]);
    mb.tube(hi ? [T(0.95, 0.036, 0.036, 0, ax), T(1.17, 0.043, 0.043, 0, ax), T(1.44, 0.052, 0.052, 0, ax)] : [T(0.95, 0.036, 0.036, 0, ax), T(1.44, 0.05, 0.05, 0, ax)], LS, [ap, 2, 0], true, false);
    if (hi) mb.tube([T(0.8, 0.026, 0.03, 0, ax), T(0.96, 0.034, 0.034, 0, ax)], 5, [ap, 0, 0], false, true);
  }
  return mb.build();
}

// ---------------------------------------------------------------------------------------------------------------
// shader injection
const DECL = /* glsl */`
attribute vec3 aMeta;
attribute vec4 iSkin; attribute vec4 iHair; attribute vec4 iTop; attribute vec4 iBot; attribute vec4 iAcc; attribute vec4 iAnim;
uniform float uTime;
void npcRotX(inout vec3 p, inout vec3 n, vec3 c, float a){ float s = sin(a), co = cos(a); vec3 d = p - c; p = c + vec3(d.x, d.y * co - d.z * s, d.y * s + d.z * co); n = vec3(n.x, n.y * co - n.z * s, n.y * s + n.z * co); }
bool npcShow(){ float acc = aMeta.z, hs = iSkin.w; if (acc < 0.5) return true; if (acc < 1.5) return hs > 0.5 && hs < 2.5; if (acc < 2.5) return hs > 1.5 && hs < 2.5; if (acc < 3.5) return hs > 2.5; if (acc < 4.5) return iTop.w > 0.5 && hs < 2.5; return iHair.w > 0.5; }
void npcPose(inout vec3 p, inout vec3 n){
  if (!npcShow()) { p = vec3(0.0); return; }
  float part = aMeta.x, ph = iAnim.x, amp = iAnim.y, stoop = iAnim.z, work = iAnim.w, sw = sin(ph) * amp;
  if (part > 3.5) { npcRotX(p, n, vec3(part < 4.5 ? -0.095 : 0.095, 0.93, 0.0), (part < 4.5 ? sw : -sw) * 0.65); }
  else if (part > 1.5) { npcRotX(p, n, vec3(part < 2.5 ? -0.245 : 0.245, 1.43, 0.0), (part < 2.5 ? -sw : sw) * 0.6 - work * 0.5); }
  if (part > 0.5 && part < 1.5) { vec3 nk = vec3(0.0, 1.52, 0.0); p = nk + (p - nk) * iBot.w; }
  if (part < 3.5) { float lean = stoop + work * (0.5 + 0.28 * sin(uTime * 2.3 + iAcc.w)); npcRotX(p, n, vec3(0.0, 0.93, 0.0), lean); }
  p.y += abs(cos(ph)) * 0.022 * amp;
}`;
const VCOL = /* glsl */`
varying vec3 vNpcCol;
void npcColor(){ float r = aMeta.y; vec3 c;
  if (r < 0.5) c = iSkin.rgb; else if (r < 1.5) c = iHair.rgb; else if (r < 2.5) c = iTop.rgb; else if (r < 3.5) c = iBot.rgb;
  else if (r < 4.5) c = vec3(0.045, 0.04, 0.036); else if (r < 5.5) c = iHair.w > 0.5 ? iSkin.rgb * 0.8 : iBot.rgb; else c = iAcc.rgb;
  vNpcCol = c; }`;

const shared = { uTime: { value: 0 } };
function makeMaterials() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + DECL + VCOL)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(normal); vec3 npcP = position; npcPose(npcP, objectNormal); npcColor();')
      .replace('#include <begin_vertex>', 'vec3 transformed = npcP;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vNpcCol;').replace('#include <color_fragment>', 'diffuseColor.rgb *= vNpcCol;');
  };
  mat.customProgramCacheKey = () => 'npc-human-v1';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + DECL).replace('#include <begin_vertex>', 'vec3 transformed = position; vec3 npcN = vec3(0.0, 1.0, 0.0); npcPose(transformed, npcN);');
  };
  depth.customProgramCacheKey = () => 'npc-human-depth-v1';
  return { mat, depth };
}

// ---------------------------------------------------------------------------------------------------------------
// appearance
const SKIN = [0xf0c8a4, 0xe5b48b, 0xd8a176, 0xc58e66, 0xb88260];
const HAIR_Y = [0x17120f, 0x2c1c12, 0x3d2616, 0x5a3a22, 0x7a5632, 0xb99552, 0x9a4a22, 0x24201c];
const HAIR_O = [0x8d8d8a, 0xa8a8a4, 0xd6d4cd, 0x6e6c68];
const TOP_M = [0x4b5a3c, 0x2b3a55, 0x5b4630, 0x6b6f72, 0x8a3a30, 0x3f6a96, 0x2f4a38, 0x232323, 0x8a7f5a, 0x55503f];
const TOP_F = [0x7a2f3f, 0xc77d8e, 0x2f6b6b, 0xc9a13a, 0x8d78a8, 0x7b7e82, 0x2f3f66, 0x4f7a4a, 0xdedad0, 0xb0392e, 0x6a8fb0];
const TOP_K = [0xe0762c, 0xe8c93c, 0x4fa3d9, 0xe58aa8, 0xd04040, 0x4faa5a, 0x8a5ac0, 0x3f78c8];
const BOT = [0x3a4f78, 0x1e1e20, 0x3c3d40, 0x4a3a2c, 0x7a6f4f, 0x24304a, 0x4a5236, 0x59544a];
const CAP = [0x2b2b2b, 0x4a5236, 0x4a3a2c, 0x24304a, 0x6b6f72, 0x8a3a30];
const SCARF = [0xb5322c, 0x3b5fa0, 0x4e8a55, 0xc9a13a, 0xe8e4d8, 0x6b4a90, 0x7a5a3a, 0x2f3f66];
const col = (hex) => new THREE.Color(hex);

export function makeLook(r, scale) {
  const rng = mulberry32(r.seed ^ 0x9e3779b9), pick = (a) => a[Math.floor(rng() * a.length)];
  const age = r.age, f = r.female, kid = age < 14;
  const skin = col(pick(SKIN)); const grey = age >= 62 ? 0.88 : age >= 50 ? 0.3 : age >= 40 ? 0.08 : 0;
  const hair = col(rng() < grey ? pick(HAIR_O) : pick(HAIR_Y));
  let style = f ? (rng() < (kid ? 0.6 : 0.42) ? 2 : 1) : (age >= 55 && rng() < 0.3 ? 0 : 1);
  if (f && age >= 62 && rng() < 0.6) style = 3; else if (f && age >= 45 && rng() < 0.15) style = 3;
  const dress = f && rng() < (kid ? 0.55 : age >= 45 ? 0.4 : 0.35) ? 1 : 0;
  const hat = !f && !kid ? (rng() < (age >= 50 ? 0.4 : 0.22) ? 1 : 0) : (!f && kid && rng() < 0.25 ? 1 : 0);
  const top = col(kid ? pick(TOP_K) : f ? pick(TOP_F) : pick(TOP_M));
  const bot = col(kid ? pick(BOT) : pick(BOT));
  const acc = col(style === 3 ? pick(SCARF) : pick(CAP));
  const headScale = Math.min(1.5, 1 + (1 - scale) * 0.75);
  const w = (f ? 0.96 : 1.02) * (0.9 + rng() * 0.2) * (kid ? 1.04 : 1);
  return { skin, hair, top, bot, acc, style, dress, hat, headScale, w, swayPh: rng() * 6.28 };
}

// ---------------------------------------------------------------------------------------------------------------
class Layer {
  constructor(geo, mat, depth, shadows) {
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.castShadow = shadows; this.mesh.receiveShadow = true; this.mesh.count = 0; this.mesh.visible = false;
    if (shadows) this.mesh.customDepthMaterial = depth;
    this.A = {};
    for (const k of ['iSkin', 'iHair', 'iTop', 'iBot', 'iAcc', 'iAnim']) { const at = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); at.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, at); this.A[k] = at; }
    this.n = 0;
  }
  put(a, look, anim) {
    const i = this.n++, M = this.mesh.instanceMatrix.array, o = i * 16;
    const c = Math.cos(a.heading), s = Math.sin(a.heading), sy = a.scale, sx = sy * look.w;
    M[o] = c * sx; M[o + 1] = 0; M[o + 2] = -s * sx; M[o + 3] = 0; M[o + 4] = 0; M[o + 5] = sy; M[o + 6] = 0; M[o + 7] = 0;
    M[o + 8] = s * sx; M[o + 9] = 0; M[o + 10] = c * sx; M[o + 11] = 0; M[o + 12] = a.x; M[o + 13] = a.y; M[o + 14] = a.z; M[o + 15] = 1;
    const q = i * 4, A = this.A;
    let v = A.iSkin.array; v[q] = look.skin.r; v[q + 1] = look.skin.g; v[q + 2] = look.skin.b; v[q + 3] = look.style;
    v = A.iHair.array; v[q] = look.hair.r; v[q + 1] = look.hair.g; v[q + 2] = look.hair.b; v[q + 3] = look.dress;
    v = A.iTop.array; v[q] = look.top.r; v[q + 1] = look.top.g; v[q + 2] = look.top.b; v[q + 3] = look.hat;
    v = A.iBot.array; v[q] = look.bot.r; v[q + 1] = look.bot.g; v[q + 2] = look.bot.b; v[q + 3] = look.headScale;
    v = A.iAcc.array; v[q] = look.acc.r; v[q + 1] = look.acc.g; v[q + 2] = look.acc.b; v[q + 3] = look.swayPh;
    v = A.iAnim.array; v[q] = anim ? a.phase : 0; v[q + 1] = anim ? a.amp : 0; v[q + 2] = a.stoop; v[q + 3] = anim ? a.work : 0;
  }
  flush() {
    const n = this.n, m = this.mesh; m.count = n; m.visible = n > 0;
    if (!n) return;
    const upd = (at, size) => { at.clearUpdateRanges(); at.addUpdateRange(0, n * size); at.needsUpdate = true; };
    upd(m.instanceMatrix, 16); for (const k in this.A) upd(this.A[k], 4);
  }
}

export class NpcRenderer {
  constructor(scene, sim) {
    this.sim = sim; this.group = new THREE.Group(); this.group.name = 'villagers'; scene.add(this.group);
    const { mat, depth } = makeMaterials();
    this.hi = new Layer(buildHumanGeometry(0), mat, depth, true);
    this.lo = new Layer(buildHumanGeometry(1), mat, depth, false);
    this.group.add(this.hi.mesh, this.lo.mesh);
    this.looks = sim.actors.map((a) => makeLook(a.res, a.scale));
    this.frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._s = new THREE.Sphere(); this._v = new THREE.Vector3();
    this.cand = new Float32Array(MAX * 2); this.counts = { near: 0, far: 0, tris: 0 };
    this.triHi = this.hi.mesh.geometry.attributes.position.count / 3; this.triLo = this.lo.mesh.geometry.attributes.position.count / 3;
  }
  setShadows(on) { this.hi.mesh.castShadow = on; }
  update(camera, Q, time) {
    shared.uTime.value = time;
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this._m);
    const cp = camera.position, far2 = Q.npcDist * Q.npcDist, near2 = Q.npcNear * Q.npcNear, frac = Q.npcFrac * 100;
    const acts = this.sim.actors; let nc = 0;
    const sp = this._s;
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i]; a.rendered = false; if (a.hidden) continue;
      if ((a.id * 37) % 100 >= frac) continue;
      const dx = a.x - cp.x, dz = a.z - cp.z, dy = a.y - cp.y, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > far2) continue;
      sp.center.set(a.x, a.y + 0.9 * a.scale, a.z); sp.radius = 1.4;
      if (!this.frustum.intersectsSphere(sp)) continue;
      this.cand[nc * 2] = i; this.cand[nc * 2 + 1] = d2; nc++;
    }
    let order = null;
    if (nc > Q.npcMax) { order = Array.from({ length: nc }, (_, k) => k).sort((p, q) => this.cand[p * 2 + 1] - this.cand[q * 2 + 1]); nc = Q.npcMax; }
    this.hi.n = 0; this.lo.n = 0;
    for (let k = 0; k < nc; k++) {
      const c = order ? order[k] : k, i = this.cand[c * 2], d2 = this.cand[c * 2 + 1], a = acts[i]; a.rendered = true;
      if (d2 < near2 && this.hi.n < Q.npcMaxNear) this.hi.put(a, this.looks[i], true); else this.lo.put(a, this.looks[i], false);
    }
    this.hi.flush(); this.lo.flush();
    this.counts.near = this.hi.n; this.counts.far = this.lo.n; this.counts.tris = this.hi.n * this.triHi + this.lo.n * this.triLo;
  }
  // nearest villager to a screen point (px) within maxDist metres
  pick(camera, cx, cy, W, H, maxDist = 60) {
    const v = this._v; let best = null, bs = 1e9;
    for (const a of this.sim.actors) {
      if (a.hidden || !a.rendered) continue;
      v.set(a.x, a.y + 1.0 * a.scale, a.z);
      const dx = v.x - camera.position.x, dy = v.y - camera.position.y, dz = v.z - camera.position.z, d = Math.hypot(dx, dy, dz); if (d > maxDist) continue;
      v.project(camera); if (v.z > 1 || v.z < -1) continue;
      const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
      // villager's on-screen half-height in px
      const half = Math.max(16, (0.9 * a.scale * H) / (2 * d * Math.tan((camera.fov * Math.PI) / 360)));
      const dist = Math.hypot(sx - cx, sy - cy), lim = Math.max(30, half * 1.1);
      if (dist < lim && dist / lim + d * 0.002 < bs) { bs = dist / lim + d * 0.002; best = a; }
    }
    return best;
  }
  screenPos(camera, a, W, H) {
    const v = this._v.set(a.x, a.y + 1.95 * a.scale, a.z).project(camera);
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, visible: v.z > -1 && v.z < 1 };
  }
}

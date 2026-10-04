// Second "hero" plot: Польова вулиця, 84 (Любимівка), modelled on the Google Street View of the real gate:
// two-storey house with white walls and a steep white gabled roof, a distinctive trapezoidal gable window (tall middle pane,
// two shorter side panes), two plain white-framed windows on the ground floor, a terracotta two-leaf swing gate with bars on top
// hung between pillars of light-tan irregular stone, dark horizontal-plank fence on a low stone base to the right, a tall wooden
// utility pole to the left, light concrete/gravel driveway, dense shrubs/trees along the east and south edges.
// Plot frame (same as hero.js): origin O on the road centre line, u = viewer's right when facing the plot, v = into the plot.
import * as THREE from 'three';
import { GeoBuilder } from './geo.js';
import { mulberry32, clamp } from '../util.js';
import { makePlotFrame, BOOST, cvs, tex, normalFromHeight, makeSoil, makeBushGeo, makeConiferGeo, makeLabel, tube } from './hero.js';

export const HERO84_LABEL = 'Польова, 84';
export const HERO84_ADDRESS = 'ул. Польова, 84';
// Even side of Польова вулиця (numbers grow towards the centre, ~26 m per even number: 42 -> 84 is ~21 plots further, past the
// Польова/Благовісна crossing), north side of the long E-W road.  Google's caption says "88–92"; this is the nearest free frontage.
const ANCHOR = [-338, 6];
const SIDE_REF = [-338, -150];        // plot side = north of the road (even side when walking west)
const HALF = 9.5, DEPTH = 56, GATE_U = 0;
const TERRA = [0.66, 0.24, 0.13];     // terracotta paint

export function planHero84(world, layout) {
  const H = makePlotFrame(world, layout, { anchor: ANCHOR, ref: SIDE_REF, away: false, gateU: GATE_U, HALF, DEPTH });
  if (!H) return null;
  const hw = H.hw, VF = H.VF, VB = H.VB, rot = H.rot;
  const reg = (kind, u0, u1, v0, v1, extra = {}) => {
    const [x, z] = H.W((u0 + u1) / 2, (v0 + v1) / 2);
    const b = { kind, x, z, rot, w: u1 - u0, d: v1 - v0, levels: 1, style: {}, osm: false, hero: true, ...extra };
    layout.buildings.push(b); return b;
  };
  H.footprints = {
    house: [-4.8, 4.8, VF + 7.5, VF + 18.5],
    garage: [4.4, 8.3, VF + 22, VF + 30],
    bath: [-8.4, -5.4, VF + 23, VF + 29],
    shed: [5.0, 8.3, VF + 34, VF + 38],
  };
  const F = H.footprints;
  const house = reg('house', ...F.house, { name: HERO84_LABEL, levels: 2 });
  const doorV = F.house[2] + 2.3;
  house.door = H.W(F.house[1] + 0.9, doorV);
  reg('barn', ...F.garage); reg('shed', ...F.bath); reg('shed', ...F.shed);
  H.houseIdx = layout.buildings.indexOf(house);
  const gateOut = H.W(GATE_U, hw + 0.3), gateIn = H.W(GATE_U, VF + 0.9);
  layout.paths.push([house.door, H.W(F.house[1] + 2.3, doorV), H.W(F.house[1] + 2.0, F.house[2] - 2.2), gateIn, gateOut]);
  // garden beds behind the house
  { const [cx, cz] = H.W(-3.6, VF + 42); layout.gardens.push({ cx, cz, rot, w: 8.4, d: 16 }); }
  // collision fences: stone/plank street fence with a 3.4 m gate gap (villagers pass), side + back fences, utility pole
  const line = (u0, v0, u1, v1) => layout.fences.push({ kind: 'hero', pts: [H.W(u0, v0), H.W(u1, v1)] });
  line(-HALF, VF, GATE_U - 1.7, VF); line(GATE_U + 1.7, VF, HALF, VF);
  line(-HALF, VF, -HALF, VB); line(HALF, VF, HALF, VB); line(-HALF, VB, HALF, VB);
  H.pole = { u: -3.7, v: hw + 1.15 };
  { const p = H.W(H.pole.u, H.pole.v); layout.fences.push({ kind: 'hero', pts: [p, [p[0] + 0.01, p[1]]] }); }
  // the closed two-leaf gate stops the player (NPCs use the gap)
  layout.gates.push({ pts: [H.W(GATE_U - 1.5, VF), H.W(GATE_U + 1.5, VF)] });
  // ground classes: gravel frontage + driveway, dirt beds
  const zone = (u0, u1, v0, v1, ch, strength, mask = 4) => { const [cx, cz] = H.W((u0 + u1) / 2, (v0 + v1) / 2); layout.zones.push({ cx, cz, rot, w: u1 - u0, d: v1 - v0, ch, strength, mask }); };
  zone(-HALF, HALF, hw + 0.2, VF, 1, 0.75);
  zone(-2.6, 2.6, VF, F.house[2] + 0.5, 1, 0.8);
  zone(-HALF, HALF - 3.4, F.house[2] - 4.5, F.house[2] - 0.6, 1, 0.55);
  zone(-6.8, -0.4, VF + 34, VF + 50, 0, 0.6);
  zone(F.house[0] - 1, F.house[1] + 1, F.house[2] - 1.2, F.house[3] + 1.2, 1, 0.3);
  // dense shrubs + trees along the east and south edges, a few fruit trees in the garden (shared tree system; flagged hero so they survive filtering)
  const rng = mulberry32(8484);
  const T = (u, v, sp, s) => { const [x, z] = H.W(u, v); layout.trees.push({ x, z, sp, s, hero: true }); };
  for (let v = VF + 3.5; v < VB - 0.5; v += 2.1 + rng() * 0.8) { T(HALF - 0.9 - rng() * 0.8, v, rng() < 0.7 ? 'bush' : 'birch', 0.95 + rng() * 0.6); if (rng() < 0.4) T(HALF - 2.6 - rng(), v + 1, 'bush', 0.9 + rng() * 0.5); }
  for (let u = -HALF + 1.2; u < HALF - 1; u += 2.4 + rng() * 0.8) T(u, VB - 1.0 - rng() * 0.8, rng() < 0.65 ? 'bush' : (rng() < 0.5 ? 'oak' : 'birch'), 0.95 + rng() * 0.6);
  T(-HALF + 1.3, VB - 3, 'pine', 1.05);
  T(-7.2, VF + 16, 'apple', 1.0); T(-6.4, VF + 45, 'apple', 0.95); T(6.6, VF + 45, 'apple', 0.9); T(-7.4, VF + 31.5, 'apple', 0.85);
  layout.hero84 = H;
  return H;
}

// ---------------------------------------------------------------- textures (canvas generated, built once)
function makeStone() {                      // light-tan irregular rubble masonry (jittered-cell / Voronoi pattern)
  const N = 256, G = 7, rng = mulberry32(5), seeds = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) seeds.push([(i + 0.15 + rng() * 0.7) / G, (j + 0.15 + rng() * 0.7) / G, 0.78 + rng() * 0.3, rng()]);
  const c = cvs(N, N), g = c.getContext('2d'), im = g.createImageData(N, N), hf = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = x / N, py = y / N, ci = Math.floor(px * G), cj = Math.floor(py * G);
    let d1 = 9, d2 = 9, best = null;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = (ci + di + G * 4) % G, jj = (cj + dj + G * 4) % G, s = seeds[jj * G + ii];
      const sx = s[0] + Math.floor((ci + di) / G), sy = s[1] + Math.floor((cj + dj) / G);
      const d = Math.hypot((px - sx) * 1.0, (py - sy) * 1.18);          // slightly wider than tall stones
      if (d < d1) { d2 = d1; d1 = d; best = s; } else if (d < d2) d2 = d;
    }
    const edge = (d2 - d1) * G;                                          // 0 at mortar line
    const dome = clamp(edge * 2.2, 0, 1), o = (y * N + x) * 4, k = best[2] * (0.88 + 0.12 * dome) * (0.94 + (rng() - 0.5) * 0.08);
    hf[y * N + x] = dome * 0.9 + rng() * 0.05;
    const m = edge < 0.12 ? 0.42 : 1;                                    // dark mortar joint
    im.data[o] = clamp(205 * k * m * (0.95 + best[3] * 0.1), 0, 255); im.data[o + 1] = clamp(184 * k * m, 0, 255); im.data[o + 2] = clamp(146 * k * m * (1.04 - best[3] * 0.1), 0, 255); im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return { map: tex(c, true), normal: tex(normalFromHeight(hf, N, N, 4.2), false) };
}
function makePlanks() {                     // dark-stained horizontal boards, 8 per metre tile
  const N = 256, P = 8, ph = N / P, rng = mulberry32(17), c = cvs(N, N), g = c.getContext('2d'), im = g.createImageData(N, N), hf = new Float32Array(N * N);
  const tone = []; for (let p = 0; p < P; p++) tone.push(0.78 + rng() * 0.4);
  const ph0 = []; for (let p = 0; p < P; p++) ph0.push(rng() * 50);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const p = Math.floor(y / ph), yy = y - p * ph, gap = yy < 2 || yy > ph - 3;
    const grain = Math.sin((x * 0.045 + ph0[p]) + Math.sin(yy * 0.35 + p) * 0.9) * 0.5 + 0.5, fine = (rng() - 0.5) * 0.12;
    const o = (y * N + x) * 4, k = tone[p] * (0.82 + grain * 0.28 + fine) * (gap ? 0.28 : 1) * (1 - Math.abs(yy - ph / 2) / ph * 0.35);
    hf[y * N + x] = gap ? 0 : 0.7 + grain * 0.2;
    im.data[o] = clamp(70 * k, 0, 255); im.data[o + 1] = clamp(48 * k, 0, 255); im.data[o + 2] = clamp(34 * k, 0, 255); im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return { map: tex(c, true), normal: tex(normalFromHeight(hf, N, N, 3.4), false) };
}
function makeRibbed(rgb, RIBS = 8, seed = 31) {   // vertical-rib steel sheet (roof / gate panel)
  const W = 256, Hh = 128, rng = mulberry32(seed), hf = new Float32Array(W * Hh);
  const prof = (x) => clamp(Math.sin(x * Math.PI * 2) * 2.4, -1, 1) * 0.5 + 0.5;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) hf[y * W + x] = prof((x / W) * RIBS);
  const c = cvs(W, Hh), g = c.getContext('2d'), im = g.createImageData(W, Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const p = (x / W) * RIBS, d = (prof(p + 0.01) - prof(p - 0.01)) * 9, k = 1 + d * 0.13 + (rng() - 0.5) * 0.03, o = (y * W + x) * 4;
    im.data[o] = clamp(rgb[0] * k, 0, 255); im.data[o + 1] = clamp(rgb[1] * k, 0, 255); im.data[o + 2] = clamp(rgb[2] * k, 0, 255); im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return { map: tex(c, true), normal: tex(normalFromHeight(hf, W, Hh, 5), false) };
}

// ---------------------------------------------------------------- meshes
export function buildHero84(scene, world, layout, materials, extra) {
  const H = layout.hero84; if (!H) return null;
  const group = new THREE.Group(); group.name = 'hero-84'; scene.add(group);
  const F = H.footprints, hw = H.hw, VF = H.VF, VB = H.VB;
  const rng = mulberry32(8484);
  const P = (u, y, v) => { const [x, z] = H.W(u, v); return [x, y, z]; };
  const gy = (u, v) => H.plane(u, v);
  const col = (m, c) => { const b = BOOST[m] || 1; return [c[0] * b, c[1] * b, c[2] * b]; };
  const B = {}; const gb = (k) => B[k] || (B[k] = new GeoBuilder());
  const box = (k, u0, y0, v0, u1, y1, v1, uvs, c, bottom = false) => gb(k).box(P, u0, y0, v0, u1, y1, v1, uvs, c, !bottom);
  const vWall = (k, ua, ub, ya, yb, v, uvs, c, side) => gb(k).quad(P(ua, ya, v), P(ub, ya, v), P(ub, yb, v), P(ua, yb, v), [[ua / uvs, ya / uvs], [ub / uvs, ya / uvs], [ub / uvs, yb / uvs], [ua / uvs, yb / uvs]], c, P((ua + ub) / 2, (ya + yb) / 2, v + side));
  const uWall = (k, u, va, vb, ya, yb, uvs, c, side) => gb(k).quad(P(u, ya, va), P(u, ya, vb), P(u, yb, vb), P(u, yb, va), [[va / uvs, ya / uvs], [vb / uvs, ya / uvs], [vb / uvs, yb / uvs], [va / uvs, yb / uvs]], c, P(u + side, (ya + yb) / 2, (va + vb) / 2));
  const TRIM = [0.95, 0.95, 0.93];

  // ---------------- materials
  const stone = makeStone(), planks = makePlanks(), roofTex = makeRibbed([226, 229, 232], 9, 41), gateTex = makeRibbed([168, 62, 34], 7, 53);
  const stoneMat = new THREE.MeshStandardMaterial({ map: stone.map, normalMap: stone.normal, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.95, vertexColors: true });
  const plankMat = new THREE.MeshStandardMaterial({ map: planks.map, normalMap: planks.normal, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.8, vertexColors: true });
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTex.map, normalMap: roofTex.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.5, metalness: 0.2, vertexColors: true, side: THREE.DoubleSide });
  const gateMat = new THREE.MeshStandardMaterial({ map: gateTex.map, normalMap: gateTex.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.46, metalness: 0.3, vertexColors: true, side: THREE.DoubleSide });
  const barMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35 });
  const stdPaint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
  const concMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const driveT = makeSoil([206, 202, 192], 77);
  const driveMat = new THREE.MeshStandardMaterial({ map: driveT.map, normalMap: driveT.normal, roughness: 1, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const soilD = makeSoil([120, 92, 68], 21);
  const dirtMat = new THREE.MeshStandardMaterial({ map: soilD.map, normalMap: soilD.normal, roughness: 1, vertexColors: true });

  // ---------------- street frontage: stone pillars, stone base + dark plank fence, terracotta gate
  const PIL_U = 1.95, PW = 0.62, PH = 2.55;
  const stonePillar = (u, v, h = PH, w = PW) => {
    const g0 = gy(u, v) - 0.2, c = [1, 1, 1];
    gb('stone').box(P, u - w / 2, g0, v - w / 2, u + w / 2, gy(u, v) + h, v + w / 2, 1.7, c, true);
    gb('conc').box(P, u - w / 2 - 0.07, gy(u, v) + h, v - w / 2 - 0.07, u + w / 2 + 0.07, gy(u, v) + h + 0.08, v + w / 2 + 0.07, 1, [0.74, 0.72, 0.68], true);
    gb('conc').box(P, u - w / 2 + 0.05, gy(u, v) + h + 0.08, v - w / 2 + 0.05, u + w / 2 - 0.05, gy(u, v) + h + 0.16, v + w / 2 - 0.05, 1, [0.7, 0.68, 0.64], true);
  };
  [-PIL_U, PIL_U, -HALF, HALF].forEach((u) => stonePillar(u, VF, u === -HALF || u === HALF ? 2.15 : PH, u === -HALF || u === HALF ? 0.55 : PW));
  // low stone base + horizontal plank fence between pillars (street side) and a plain plank fence along the sides/back
  const plankFence = (ua, ub, v, top = 1.95, baseH = 0.5, withBase = true) => {
    const t = 0.05, n = Math.max(1, Math.ceil(Math.abs(ub - ua) / 2.4));
    for (let i = 0; i < n; i++) {
      const a = ua + ((ub - ua) * i) / n, b = ua + ((ub - ua) * (i + 1)) / n;
      const ya = gy(a, v), yb = gy(b, v), y0a = ya + (withBase ? baseH : 0.1), y0b = yb + (withBase ? baseH : 0.1);
      for (const s of [1, -1]) gb('plank').quad(P(a, y0a, v + s * t), P(b, y0b, v + s * t), P(b, yb + top, v + s * t), P(a, ya + top, v + s * t), [[a / 2.0, y0a], [b / 2.0, y0b], [b / 2.0, yb + top], [a / 2.0, ya + top]], [1, 1, 1], P((a + b) / 2, ya + 1, v - s));
      box('paint', a - 0.045, ya - 0.15, v - 0.075, a + 0.045, ya + top + 0.02, v + 0.075, 1, [0.12, 0.085, 0.06]);
      box('paint', a, ya + top, v - 0.08, b, ya + top + 0.045, v + 0.08, 1, [0.16, 0.11, 0.08]);
      if (withBase) gb('stone').box(P, a, ya - 0.2, v - 0.17, b, ya + baseH, v + 0.17, 1.7, [1, 1, 1], true);
    }
    box('paint', ub - 0.045, gy(ub, v) - 0.15, v - 0.075, ub + 0.045, gy(ub, v) + top + 0.02, v + 0.075, 1, [0.12, 0.085, 0.06]);
  };
  plankFence(-HALF + 0.3, -PIL_U - PW / 2, VF); plankFence(PIL_U + PW / 2, HALF - 0.3, VF);
  // side & back fences (dark planks, no stone base)
  const sideFence = (u, v0, v1) => {
    const n = Math.max(1, Math.ceil((v1 - v0) / 2.8)), t = 0.05, top = 1.85;
    for (let i = 0; i < n; i++) {
      const a = v0 + ((v1 - v0) * i) / n, b = v0 + ((v1 - v0) * (i + 1)) / n, ya = gy(u, a), yb = gy(u, b);
      for (const s of [1, -1]) gb('plank').quad(P(u + s * t, ya + 0.1, a), P(u + s * t, yb + 0.1, b), P(u + s * t, yb + top, b), P(u + s * t, ya + top, a), [[a / 2.0, ya + 0.1], [b / 2.0, yb + 0.1], [b / 2.0, yb + top], [a / 2.0, ya + top]], [1, 1, 1], P(u - s, ya + 1, (a + b) / 2));
      box('paint', u - 0.075, ya - 0.15, a - 0.045, u + 0.075, ya + top + 0.02, a + 0.045, 1, [0.12, 0.085, 0.06]);
      box('paint', u - 0.08, ya + top, a, u + 0.08, yb + top + 0.045, b, 1, [0.16, 0.11, 0.08]);
    }
  };
  sideFence(-HALF, VF + 0.3, VB); sideFence(HALF, VF + 0.3, VB);
  { const n = 7; for (let i = 0; i < n; i++) { const a = -HALF + (2 * HALF * i) / n, b = -HALF + (2 * HALF * (i + 1)) / n, v = VB, ya = gy(a, v), yb = gy(b, v), t = 0.05, top = 1.85;
    for (const s of [1, -1]) gb('plank').quad(P(a, ya + 0.1, v + s * t), P(b, yb + 0.1, v + s * t), P(b, yb + top, v + s * t), P(a, ya + top, v + s * t), [[a / 2.0, ya + 0.1], [b / 2.0, yb + 0.1], [b / 2.0, yb + top], [a / 2.0, ya + top]], [1, 1, 1], P((a + b) / 2, ya + 1, v - s));
    box('paint', a - 0.045, ya - 0.15, v - 0.075, a + 0.045, ya + top + 0.02, v + 0.075, 1, [0.12, 0.085, 0.06]); box('paint', a, ya + top, v - 0.08, b, yb + top + 0.045, v + 0.08, 1, [0.16, 0.11, 0.08]); } }
  // ---- the gate: two leaves, ribbed terracotta panels below, vertical bars above, hinged on the stone pillars
  { const gv = VF, g0 = gy(0, gv), yLo = g0 + 0.14, yMid = g0 + 1.38, yTop = g0 + 2.18, tc = TERRA, dk = [TERRA[0] * 0.72, TERRA[1] * 0.7, TERRA[2] * 0.7];
    const LEAF = PIL_U - PW / 2 - 0.03;                                             // leaf reaches from the pillar to the centre line
    for (const sgn of [-1, 1]) {
      const uA = sgn > 0 ? 0.03 : -LEAF, uB = sgn > 0 ? LEAF : -0.03;
      for (const s of [1, -1]) gb('gate').quad(P(uA, yLo + 0.04, gv + s * 0.03), P(uB, yLo + 0.04, gv + s * 0.03), P(uB, yMid, gv + s * 0.03), P(uA, yMid, gv + s * 0.03), [[uA / 0.92, 0], [uB / 0.92, 0], [uB / 0.92, 0.55], [uA / 0.92, 0.55]], [1, 1, 1], P((uA + uB) / 2, yMid, gv - s));
      // frame rails + verticals
      box('bar', uA, yLo, gv - 0.045, uB, yLo + 0.08, gv + 0.045, 1, dk); box('bar', uA, yMid - 0.05, gv - 0.05, uB, yMid + 0.05, gv + 0.05, 1, dk); box('bar', uA, yTop - 0.06, gv - 0.045, uB, yTop + 0.02, gv + 0.045, 1, dk);
      for (const uu of [uA, uB]) box('bar', uu - 0.035, yLo, gv - 0.05, uu + 0.035, yTop + 0.02, gv + 0.05, 1, dk);
      const nb = 12; for (let i = 1; i < nb; i++) { const u = uA + ((uB - uA) * i) / nb; box('bar', u - 0.014, yMid, gv - 0.02, u + 0.014, yTop - 0.05, gv + 0.02, 1, tc); }
      // diagonal-free stiffening rib + hinge straps on the street side
      box('bar', uA + 0.04, yLo + 0.55, gv - 0.058, uB - 0.04, yLo + 0.6, gv - 0.04, 1, dk);
      for (const yy of [yLo + 0.3, yTop - 0.45]) { const hu = sgn > 0 ? uB - 0.2 : uA; box('bar', hu, yy, gv - 0.06, hu + 0.2, yy + 0.07, gv - 0.045, 1, [0.1, 0.1, 0.1]); }
    }
    // centre drop-bolt + latch
    box('bar', -0.02, yLo, gv - 0.075, 0.02, yLo + 0.55, gv - 0.055, 1, [0.12, 0.12, 0.13]); box('bar', 0.06, g0 + 1.05, gv - 0.1, 0.34, g0 + 1.13, gv - 0.055, 1, [0.1, 0.1, 0.11]);
    // concrete threshold
    gb('conc').box(P, -PIL_U + PW / 2, g0 - 0.2, gv - 0.2, PIL_U - PW / 2, g0 + 0.06, gv + 0.2, 1, [0.72, 0.71, 0.68], true);
  }
  // kerb along the road edge
  gb('conc').box(P, -HALF - 0.4, gy(0, hw + 0.1) - 0.2, hw + 0.02, HALF + 0.4, gy(0, hw + 0.1) + 0.12, hw + 0.18, 1, [0.82, 0.82, 0.79], true);

  // ---------------- driveway: light concrete/gravel from the road, through the gate, to the house (and a parking apron)
  { const dg = gb('drive'), q = (ua, ub, va, vb, c = [1, 1, 1]) => dg.quad(P(ua, gy(ua, va) + 0.05, va), P(ub, gy(ub, va) + 0.05, va), P(ub, gy(ub, vb) + 0.05, vb), P(ua, gy(ua, vb) + 0.05, vb), [[ua / 1.6, va / 1.6], [ub / 1.6, va / 1.6], [ub / 1.6, vb / 1.6], [ua / 1.6, vb / 1.6]], c, P(ua, -5, va));
    q(-2.9, 2.9, hw + 0.18, VF - 0.1);                     // apron from the road to the gate
    q(-2.6, 2.6, VF + 0.1, F.house[2] - 0.6);              // through the gate to the house
    q(-HALF + 2.0, HALF - 3.2, F.house[2] - 4.4, F.house[2] - 0.6, [0.96, 0.96, 0.94]);   // parking apron in front of the house
    q(-2.1, 2.1, VF - 0.1, VF + 0.1, [0.9, 0.9, 0.88]);
    // a footpath to the side door
    q(F.house[1] + 0.4, F.house[1] + 2.4, F.house[2] + 1.5, F.house[2] + 3.1, [0.9, 0.9, 0.88]);
  }

  // ---------------- the house
  const [HX0, HX1, HV0, HV1] = F.house;
  const g0h = gy(0, (HV0 + HV1) / 2), y0 = g0h + 0.38, yb = g0h - 0.5, WH = 3.25, yt = y0 + WH, tanp = Math.tan((42 * Math.PI) / 180);
  const wallC = [3.3, 3.9, 6.6], plinth = [0.7, 0.69, 0.66];
  const yPl = y0 + 0.45;
  for (const [fn, a, b, v, sd] of [['v', HX0, HX1, HV0, 1], ['v', HX0, HX1, HV1, -1]]) { void fn; vWall('conc', a, b, yb, yPl, v, 1.5, plinth, sd); vWall('plaster', a, b, yPl, yt, v, 2.2, wallC, sd); }
  for (const [u, sd] of [[HX0, 1], [HX1, -1]]) { uWall('conc', u, HV0, HV1, yb, yPl, 1.5, plinth, sd); uWall('plaster', u, HV0, HV1, yPl, yt, 2.2, wallC, sd); }
  // roof: steep gable, ridge along v (gable faces the street), white ribbed steel
  const ov = 0.55, gov = 0.4, ridgeY = yt + HX1 * tanp, eaveY = yt - ov * tanp, rcol = [0.9, 0.91, 0.92];
  const ridgeU = 0, vA = HV0 - gov, vB = HV1 + gov, SL = Math.hypot(HX1 + ov, ridgeY - eaveY);
  for (const s of [-1, 1]) {
    const e = s * (HX1 + ov);
    gb('roof').quad(P(e, eaveY, vA), P(e, eaveY, vB), P(ridgeU, ridgeY, vB), P(ridgeU, ridgeY, vA), [[vA / 0.95, 0], [vB / 0.95, 0], [vB / 0.95, SL / 0.95], [vA / 0.95, SL / 0.95]], rcol, P(s * 2, yt - 1, (HV0 + HV1) / 2));
    // fascia boards on the rake ends + eave gutter
    for (const [vv, sd] of [[vA, -1], [vB, 1]]) gb('paint').quad(P(e, eaveY - 0.02, vv), P(ridgeU, ridgeY - 0.02, vv), P(ridgeU, ridgeY - 0.2, vv), P(e, eaveY - 0.2, vv), [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], TRIM, P(s * 2, ridgeY - 2, vv - sd));
    box('paint', s > 0 ? e - 0.02 : e - 0.1, eaveY - 0.2, vA, s > 0 ? e + 0.1 : e + 0.02, eaveY - 0.06, vB, 1, [0.82, 0.82, 0.8]);
  }
  box('paint', -0.14, ridgeY - 0.05, vA, 0.14, ridgeY + 0.1, vB, 1, [0.85, 0.86, 0.87]);
  for (const [v, sd] of [[HV0, 1], [HV1, -1]]) gb('plaster').tri(P(HX0, yt, v), P(HX1, yt, v), P(0, ridgeY, v), [[HX0 / 2.2, yt / 2.2], [HX1 / 2.2, yt / 2.2], [0, ridgeY / 2.2]], wallC, P(0, yt, v + sd));
  // downpipes
  for (const [u, v] of [[HX0 - 0.03, HV0 + 0.1], [HX1 + 0.03, HV1 - 0.1]]) gb('paint').cylinder(...(() => { const p = P(u, 0, v); return [p[0], yb + 0.5, p[2]]; })(), 0.045, 0.045, eaveY - yb - 0.4, 8, 1, [0.82, 0.82, 0.8], false);
  // chimney + flue
  { const cu = -1.9, cv = HV0 + 6.5, top = ridgeY + 0.9, ty = yt + 0.4;
    gb('plaster').box(P, cu - 0.32, ty, cv - 0.32, cu + 0.32, top, cv + 0.32, 1.2, col('plaster', [0.92, 0.9, 0.86]), true);
    gb('conc').box(P, cu - 0.42, top, cv - 0.42, cu + 0.42, top + 0.12, cv + 0.42, 1, [0.5, 0.5, 0.52], true); }
  // windows (glazing from the shared window texture)
  const winB = gb('win'), winL = gb('winLit');
  const addWinV = (u, v, side, ww = 1.25, wh = 1.45, yc = y0 + 1.6, lit = rng() < 0.4) => {
    const B2 = lit ? winL : winB, ua = u - ww / 2, ub = u + ww / 2, ya = yc - wh / 2, yb2 = yc + wh / 2, vv = v + side * 0.03;
    B2.quad(P(ua, ya, vv), P(ub, ya, vv), P(ub, yb2, vv), P(ua, yb2, vv), [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], P(u, yc, v - side));
    const t = 0.08, d = 0.05, a = side > 0 ? 0 : -d, b = side > 0 ? d : 0;
    box('paint', ua - t, ya - t, v + a, ub + t, ya, v + b, 1, TRIM); box('paint', ua - t, yb2, v + a, ub + t, yb2 + t, v + b, 1, TRIM);
    box('paint', ua - t, ya, v + a, ua, yb2, v + b, 1, TRIM); box('paint', ub, ya, v + a, ub + t, yb2, v + b, 1, TRIM);
    box('paint', u - 0.025, ya, v + a, u + 0.025, yb2, v + b, 1, TRIM);                         // central mullion
    box('paint', ua - 0.1, ya - 0.1, v + (side > 0 ? 0 : -0.12), ub + 0.1, ya - 0.03, v + (side > 0 ? 0.12 : 0), 1, [0.86, 0.86, 0.84]);
  };
  const addWinU = (u, v, side, ww = 1.15, wh = 1.45, yc = y0 + 1.6, lit = rng() < 0.4) => {
    const B2 = lit ? winL : winB, va = v - ww / 2, vb = v + ww / 2, ya = yc - wh / 2, yb2 = yc + wh / 2, uu = u + side * 0.03;
    B2.quad(P(uu, ya, va), P(uu, ya, vb), P(uu, yb2, vb), P(uu, yb2, va), [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], P(u - side, yc, v));
    const t = 0.08, d = 0.05, a = side > 0 ? 0 : -d, b = side > 0 ? d : 0;
    box('paint', u + a, ya - t, va - t, u + b, ya, vb + t, 1, TRIM); box('paint', u + a, yb2, va - t, u + b, yb2 + t, vb + t, 1, TRIM);
    box('paint', u + a, ya, va - t, u + b, yb2, va, 1, TRIM); box('paint', u + a, ya, vb, u + b, yb2, vb + t, 1, TRIM);
    box('paint', u + (side > 0 ? 0 : -0.12), ya - 0.1, va - 0.1, u + (side > 0 ? 0.12 : 0), ya - 0.03, vb + 0.1, 1, [0.86, 0.86, 0.84]);
  };
  addWinV(-2.9, HV0, -1, 1.3, 1.5, y0 + 1.65, false); addWinV(2.9, HV0, -1, 1.3, 1.5, y0 + 1.65, false);       // two plain ground-floor windows on the street face
  [HV0 + 5.9, HV0 + 9.0].forEach((v) => addWinU(HX1, v, 1)); [HV0 + 2.3, HV0 + 5.9, HV0 + 9.0].forEach((v) => addWinU(HX0, v, -1));
  [-3.2, 0, 3.2].forEach((u) => addWinV(u, HV1, 1, 1.2, 1.45, y0 + 1.6));
  // gable window: tall central rectangular pane + two shorter sloped-top side panes inside one trapezoidal white frame
  { const yb0 = yt + 0.55, v = HV0, vv = v - 0.025, pane = (pts, lit) => (lit ? winL : winB).quad(pts[0], pts[1], pts[2], pts[3], [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], P(0, yb0, v + 1));
    const outline = [[-1.4, 0], [1.4, 0], [1.4, 0.95], [0.55, 1.4], [0.55, 2.05], [-0.55, 2.05], [-0.55, 1.4], [-1.4, 0.95]];
    const cen = P(0, yb0 + 1.0, vv - 0.0), O = outline.map(([u, y]) => P(u, yb0 + y, vv));
    for (let i = 0; i < O.length; i++) { const a = O[i], b = O[(i + 1) % O.length]; gb('paint').tri(a, b, cen, [[0, 0], [1, 0], [0.5, 1]], TRIM, P(0, yb0 + 1, v + 1)); }
    const pz = v - 0.05, y1 = yb0;
    pane([P(-0.43, y1 + 0.1, pz), P(0.43, y1 + 0.1, pz), P(0.43, y1 + 1.97, pz), P(-0.43, y1 + 1.97, pz)], false);
    pane([P(-1.3, y1 + 0.1, pz), P(-0.6, y1 + 0.1, pz), P(-0.6, y1 + 1.28, pz), P(-1.3, y1 + 0.87, pz)], false);
    pane([P(0.6, y1 + 0.1, pz), P(1.3, y1 + 0.1, pz), P(1.3, y1 + 0.87, pz), P(0.6, y1 + 1.28, pz)], false);
    // raised sash bars + sill so the frame reads from a distance
    for (const u of [-0.5, 0.5]) box('paint', u - 0.05, y1 + 0.04, v - 0.07, u + 0.05, y1 + 1.4, v - 0.02, 1, TRIM);
    box('paint', -1.5, y1 - 0.1, v - 0.1, 1.5, y1 + 0.04, v - 0.02, 1, [0.86, 0.86, 0.84]);
    box('paint', -0.45, y1 + 1.97, v - 0.07, 0.45, y1 + 2.04, v - 0.02, 1, TRIM);
    box('paint', -1.34, y1 + 0.04, v - 0.07, -1.26, y1 + 0.9, v - 0.02, 1, TRIM); box('paint', 1.26, y1 + 0.04, v - 0.07, 1.34, y1 + 0.9, v - 0.02, 1, TRIM);
    addWinV(0, HV1, 1, 0.8, 0.9, yb0 + 0.8);                                                         // small attic window on the back gable
  }
  // side door on the east wall with step + small canopy
  { const dv = HV0 + 2.3, dw = 1.0, dh = 2.1, du = HX1 + 0.03, dc = [0.34, 0.2, 0.12];
    gb('paint').quad(P(du, y0, dv - dw / 2), P(du, y0, dv + dw / 2), P(du, y0 + dh, dv + dw / 2), P(du, y0 + dh, dv - dw / 2), [[0, 0], [1, 0], [1, 1], [0, 1]], dc, P(du - 1, y0 + 1, dv));
    box('paint', HX1, y0, dv - dw / 2 - 0.08, HX1 + 0.06, y0 + dh + 0.08, dv - dw / 2, 1, TRIM); box('paint', HX1, y0, dv + dw / 2, HX1 + 0.06, y0 + dh + 0.08, dv + dw / 2 + 0.08, 1, TRIM); box('paint', HX1, y0 + dh, dv - dw / 2 - 0.08, HX1 + 0.06, y0 + dh + 0.08, dv + dw / 2 + 0.08, 1, TRIM);
    box('conc', HX1, y0 - 0.5, dv - 1.0, HX1 + 1.2, y0 - 0.04, dv + 1.0, 1, [0.68, 0.67, 0.64], true); box('conc', HX1 + 1.2, y0 - 0.5, dv - 0.8, HX1 + 1.7, y0 - 0.25, dv + 0.8, 1, [0.66, 0.65, 0.62], true);
    gb('roof').quad(P(HX1, y0 + 2.55, dv - 1.1), P(HX1, y0 + 2.55, dv + 1.1), P(HX1 + 1.35, y0 + 2.3, dv + 1.1), P(HX1 + 1.35, y0 + 2.3, dv - 1.1), [[0, 0], [2.2, 0], [2.2, 1.4], [0, 1.4]], rcol, P(HX1 + 0.5, y0 + 1, dv));
    for (const s of [-1, 1]) box('paint', HX1 + 1.25, y0 - 0.04, dv + s * 1.0 - 0.04, HX1 + 1.33, y0 + 2.3, dv + s * 1.0 + 0.04, 1, TRIM);
  }

  // ---------------- outbuildings (garage with metal up-and-over door, bath-house, woodshed)
  const outbuilding = (fp, h, kind) => {
    const [u0, u1, v0, v1] = fp, gnd = gy((u0 + u1) / 2, (v0 + v1) / 2), yy0 = gnd + 0.2, ybb = gnd - 0.3, ytt = yy0 + h;
    const wc = kind === 'garage' ? col('plaster', [0.9, 0.88, 0.8]) : kind === 'bath' ? col('plaster', [1, 0.96, 0.88]) : [0.34, 0.24, 0.17];
    const mat = kind === 'shed' ? 'paint' : 'plaster';
    vWall(mat, u0, u1, ybb, ytt, v0, 2.2, wc, 1); vWall(mat, u0, u1, ybb, ytt, v1, 2.2, wc, -1); uWall(mat, u0, v0, v1, ybb, ytt, 2.2, wc, 1); uWall(mat, u1, v0, v1, ybb, ytt, 2.2, wc, -1);
    const hi = ytt + 0.6, lo = ytt + 0.12, o2 = 0.3, rc = kind === 'shed' ? [0.4, 0.28, 0.2] : kind === 'garage' ? [0.5, 0.52, 0.55] : [0.62, 0.3, 0.2];
    gb('roof').quad(P(u0 - o2, hi, v0 - o2), P(u1 + o2, hi, v0 - o2), P(u1 + o2, lo, v1 + o2), P(u0 - o2, lo, v1 + o2), [[0, 0], [(u1 - u0) / 0.95, 0], [(u1 - u0) / 0.95, (v1 - v0) / 0.95], [0, (v1 - v0) / 0.95]], rc, P((u0 + u1) / 2, ytt - 1, (v0 + v1) / 2));
    for (const [uu, sd] of [[u0, 1], [u1, -1]]) gb(mat).quad(P(uu, ytt, v0), P(uu, ytt, v1), P(uu, lo, v1), P(uu, hi, v0), [[0, 0], [1, 0], [1, 0.2], [0, 0.4]], wc, P(uu + sd, ytt, (v0 + v1) / 2));
    gb(mat).quad(P(u0, ytt, v0), P(u1, ytt, v0), P(u1, hi, v0), P(u0, hi, v0), [[0, 0], [1, 0], [1, 0.4], [0, 0.4]], wc, P((u0 + u1) / 2, ytt, v0 + 1));
    const dside = (u0 + u1) / 2 > 0 ? u0 : u1, ds = dside === u0 ? -1 : 1, dm = (v0 + v1) / 2;       // door faces the yard centre
    if (kind === 'garage') { for (let i = 0; i < 5; i++) box('metal', dside + ds * 0.01 - 0.02, yy0 + 0.1 + i * 0.5, dm - 1.6, dside + ds * 0.06, yy0 + 0.1 + i * 0.5 + 0.44, dm + 1.6, 1, [0.62, 0.64, 0.66]); }
    else gb('paint').quad(P(dside + ds * 0.03, yy0, dm - 0.45), P(dside + ds * 0.03, yy0, dm + 0.45), P(dside + ds * 0.03, yy0 + 1.9, dm + 0.45), P(dside + ds * 0.03, yy0 + 1.9, dm - 0.45), [[0, 0], [1, 0], [1, 1], [0, 1]], [0.38, 0.26, 0.17], P(dside - ds, yy0 + 1, dm));
    if (kind === 'bath') addWinU(dside === u0 ? u1 : u0, v0 + 1.4, dside === u0 ? 1 : -1, 0.8, 0.9, yy0 + 1.5, false);
  };
  outbuilding(F.garage, 2.6, 'garage'); outbuilding(F.bath, 2.4, 'bath'); outbuilding(F.shed, 2.1, 'shed');
  // utility pole in front of the plot, left of the gate (tall weathered wood, cross-arm, insulators, drop wire to the house)
  { const { u: pu, v: pv } = H.pole, g0 = gy(pu, pv), top = 8.6, wood = [0.16, 0.12, 0.09];
    const p0 = P(pu, 0, pv); gb('paint').cylinder(p0[0], g0 - 0.3, p0[2], 0.17, 0.115, top + 0.3, 9, 1.5, wood, true);
    box('paint', pu - 0.06, g0 + top - 0.55, pv - 0.85, pu + 0.06, g0 + top - 0.43, pv + 0.85, 1, [0.26, 0.21, 0.17]);
    box('paint', pu - 0.05, g0 + top - 1.9, pv - 0.55, pu + 0.05, g0 + top - 1.8, pv + 0.55, 1, [0.26, 0.21, 0.17]);
    const ins = [[pv - 0.8, top - 0.43], [pv, top + 0.0], [pv + 0.8, top - 0.43]];
    for (const [iv, iy] of ins) { const ip = P(pu, 0, iv); gb('metal').cylinder(ip[0], g0 + iy, ip[2], 0.045, 0.03, 0.14, 6, 1, [0.55, 0.62, 0.58], true); }
    // wires along the road, both ways (gently sagging)
    const wireC = [0.06, 0.06, 0.07];
    for (const [iv, iy] of ins) for (const dir of [-1, 1]) { const pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8, uu = pu + dir * t * 50; pts.push(P(uu, g0 + iy + 0.14 - Math.sin(t * Math.PI) * 0.9 * (1 - t) - t * 0.5, iv)); } tube(gb('wire'), pts, 0.012, 0.012, wireC, 3); }
    // service drop to the house corner
    const a = P(pu, g0 + top - 1.85, pv), b = P(F.house[0] + 0.3, y0 + 5.0, F.house[2] - 0.1), mid = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 0.35 + Math.abs(a[1] - b[1]) * 0.1, (a[2] + b[2]) / 2];
    tube(gb('wire'), [a, [(a[0] + mid[0]) / 2, (a[1] + mid[1]) / 2 - 0.1, (a[2] + mid[2]) / 2], mid, [(mid[0] + b[0]) / 2, (mid[1] + b[1]) / 2 - 0.1, (mid[2] + b[2]) / 2], b], 0.012, 0.012, wireC, 3);
  }

  // ---------------- turn the builders into meshes
  const M = { stone: stoneMat, plank: plankMat, roof: roofMat, gate: gateMat, bar: barMat, paint: stdPaint, conc: concMat, drive: driveMat, soilD: dirtMat, wire: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }), win: extra.win, winLit: extra.winLit };
  const stats = { tris: 0, meshes: 0 };
  for (const [k, g] of Object.entries(B)) {
    if (!(g instanceof GeoBuilder) || g.empty) continue;
    const mat = M[k] || materials.mats[k]; if (!mat) continue;
    const mesh = new THREE.Mesh(g.build(), mat);
    mesh.castShadow = !['win', 'winLit', 'drive', 'soilD', 'wire'].includes(k); mesh.receiveShadow = k !== 'wire'; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mesh.name = 'hero84-' + k;
    group.add(mesh); stats.tris += g.i.length / 3; stats.meshes++;
  }

  // ---------------- instanced vegetation & small props
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), cl = new THREE.Color();
  const instance = (geo, mat, items, name) => {
    const im = new THREE.InstancedMesh(geo, mat, items.length); im.name = name;
    items.forEach((it, i) => { q.setFromEuler(e.set(0, it.ry || 0, 0)); ps.set(...P(it.u, it.y ?? gy(it.u, it.v), it.v)); const s = it.s ?? 1; sc.set(s * (it.sx ?? 1), s * (it.sy ?? 1), s * (it.sx ?? 1)); m4.compose(ps, q, sc); im.setMatrixAt(i, m4); cl.setRGB(...(it.c || [1, 1, 1])); im.setColorAt(i, cl); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); group.add(im); return im;
  };
  // a few columnar conifers beside the driveway / fence + leafless-looking shrubs near the street fence
  instance(makeConiferGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), [
    { u: -HALF + 1.3, v: VF + 4.5, s: 1.7, sy: 1.5, ry: 1 }, { u: -HALF + 1.2, v: VF + 20, s: 1.8, sy: 1.5, ry: 2 }, { u: HALF - 1.4, v: VF + 11, s: 1.9, sy: 1.5, ry: 3 },
  ], 'hero84-conifers');
  instance(makeBushGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), [
    { u: -7.4, v: (hw + VF) / 2 + 0.9, s: 1.0, ry: 1.1 }, { u: 7.0, v: (hw + VF) / 2 + 1.2, s: 1.15, ry: 2.4 }, { u: 4.9, v: VF + 1.6, s: 0.9, ry: 0.4 },
  ], 'hero84-bushes');
  // garden: dark tilled ridges + vegetables
  { const dg = gb('soilD'), rows = [];
    const y = (u, v) => gy(u, v);
    for (let i = 0; i < 6; i++) { const u = -6.4 + i * 1.25, v0 = VF + 35, v1 = VF + 49, w = 0.42, hgt = 0.2, c = [0.8, 0.78, 0.76], a = (uu, vv, yy) => P(uu, y(uu, vv) + yy, vv); rows.push(u);
      dg.quad(a(u - w, v0, 0), a(u, v0, hgt), a(u, v1, hgt), a(u - w, v1, 0), [[0, v0], [0.4, v0], [0.4, v1], [0, v1]], c, P(u, -5, (v0 + v1) / 2));
      dg.quad(a(u, v0, hgt), a(u + w, v0, 0), a(u + w, v1, 0), a(u, v1, hgt), [[0.4, v0], [0.8, v0], [0.8, v1], [0.4, v1]], c, P(u, -5, (v0 + v1) / 2)); }
    const dgm = new THREE.Mesh(dg.build(), dirtMat); dgm.receiveShadow = true; dgm.matrixAutoUpdate = false; dgm.updateMatrix(); group.add(dgm); dg.i.length = 0;
    const cab = new THREE.IcosahedronGeometry(0.17, 1), cabMat = new THREE.MeshStandardMaterial({ roughness: 0.8 }), plants = [];
    rows.forEach((u, ri) => { for (let v = VF + 35.4; v < VF + 48.8; v += 0.7) { const g1 = 0.55 + rng() * 0.25; plants.push({ u: u + (rng() - 0.5) * 0.05, v, y: gy(u, v) + 0.24, s: 0.8 + rng() * 0.6, sy: 0.7, c: ri % 3 === 0 ? [0.3 * g1, 0.5 * g1, 0.22 * g1] : [0.28 * g1, 0.55 * g1, 0.18 * g1] }); } });
    instance(cab, cabMat, plants, 'hero84-plants');
    delete B.soilD;
  }

  // ---------------- floating POI label (same style as 35Б, terracotta)
  const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabel(HERO84_LABEL, 'rgba(150,62,38,0.94)'), depthWrite: false, depthTest: true, fog: true, transparent: true }));
  const [lx, , lz] = P(GATE_U, 0, VF - 0.6); const labY = gy(GATE_U, VF) + 5.6;
  lab.position.set(lx, labY, lz); lab.renderOrder = 6; scene.add(lab);
  const base = { w: 3.6, h: 1.05 };
  const poi = {
    label: lab, hero: H,
    update(pos) { const d = Math.hypot(lx - pos.x, lz - pos.z); lab.visible = d < 260; const k = clamp(d / 22, 1, 5); lab.scale.set(base.w * k, base.h * k, 1); },
  };
  const [vx, vz] = H.W(GATE_U, -1.6);                                // across the street, looking at the gate
  poi.view = { x: vx, z: vz, yaw: Math.atan2(-H.mx, -H.mz), pitch: 0.1 };
  poi.group = group; poi.stats = stats;
  return poi;
}

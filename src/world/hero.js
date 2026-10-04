// "Hero" plot: Польова вулиця, 35Б (Любимівка). Hand-built property modelled on the Google Street View of the real gate:
// street fence of vertical-ribbed RED corrugated steel between light-brick pillars, grey steel gate/door with a dark oval
// "35-Б" plaque, a strip of dry soil with a few dormant bushes + one small green conifer, a village house close to the street
// and outbuildings / vegetable garden behind it.  Everything is merged per material (a dozen draw calls) or instanced.
//
// Plot frame: origin O on the road centre line, u = along the street (viewer's right when standing in the road facing the plot),
// v = away from the road into the plot, y = up.
import * as THREE from 'three';
import { GeoBuilder } from './geo.js';
import { mulberry32, clamp, smoothstep } from '../util.js';

export const HERO_LABEL = 'Польова, 35Б';
export const HERO_ADDRESS = 'ул. Польова, 35Б';
const CELL = 2;                       // must match data.js carve grid
const ANCHOR = [217.4, -180.4];       // between OSM-mapped Польова 32 (even side) and 40; numbering 35 sits on the odd (opposite) side
const EVEN_REF = [230, -227];         // OSM node "Польова вулиця, 32"
const HALF = 8.5, DEPTH = 62;         // plot is 17 m wide, 62 m deep behind the fence line
const GATE_U = -1.5;                  // grey door centre
export const BOOST = { plaster: 1.75, brick: 1.2, wood: 2.3, roofSlate: 1.35 };

// ------------------------------------------------------------------------------------------------------------------
// 1. PLAN: runs before rasters / nav.  Finds the street, levels the ground, strips procedural stuff, registers the plot.
// ------------------------------------------------------------------------------------------------------------------
// Shared plot frame: finds the street nearest to cfg.anchor, builds the (u,v) frame, levels the ground, strips procedural stuff.
//   cfg = { anchor:[x,z], ref:[x,z], away:bool, gateU, HALF, DEPTH }   plot side = towards `ref` (or away from it when `away`)
export function makePlotFrame(world, layout, cfg) {
  const { anchor: ANCHOR, HALF, DEPTH } = cfg;
  const roads = world.json.roads.filter((r) => r.name === 'Польова вулиця' && r.kind !== 'track' && r.pts.length > 1);
  let best = null;
  for (const r of roads) for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1], b = r.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    const t = clamp(((ANCHOR[0] - a[0]) * dx + (ANCHOR[1] - a[1]) * dz) / l2, 0, 1);
    const px = a[0] + dx * t, pz = a[1] + dz * t, dd = Math.hypot(ANCHOR[0] - px, ANCHOR[1] - pz);
    if (!best || dd < best.dd) best = { dd, px, pz, dx, dz, hw: r.w / 2 };
  }
  if (!best || best.dd > 60) return null;
  const L = Math.hypot(best.dx, best.dz); const tx = best.dx / L, tz = best.dz / L;
  let mx = -tz, mz = tx;                                                     // plot side
  const side = (cfg.ref[0] - best.px) * mx + (cfg.ref[1] - best.pz) * mz;
  if ((cfg.away ? side > 0 : side < 0)) { mx = -mx; mz = -mz; }
  const ux = -mz, uz = mx;                                                   // u axis = viewer's right when facing the plot
  const hw = best.hw, VF = hw + 2.4, VB = VF + DEPTH;
  const H = {
    ox: best.px, oz: best.pz, ux, uz, mx, mz, hw, VF, VB, rot: Math.atan2(mx, -mz), ry: Math.atan2(-uz, ux), gateU: cfg.gateU, houseIdx: -1, HALF,
    W(u, v) { return [this.ox + this.ux * u + this.mx * v, this.oz + this.uz * u + this.mz * v]; },
    toUV(x, z) { const dx = x - this.ox, dz = z - this.oz; return [dx * this.ux + dz * this.uz, dx * this.mx + dz * this.mz]; },
  };

  // ---- level the ground: weighted LS plane through the natural terrain, blended into the surroundings via the carve grid
  const sums = { n: 0, su: 0, sv: 0, sh: 0, suu: 0, suv: 0, svv: 0, suh: 0, svh: 0 };
  for (let u = -HALF; u <= HALF; u += 2) for (let v = hw + 0.5; v <= VB; v += 3) {
    const [x, z] = H.W(u, v), h = world.heightAt(x, z), w = v < 9 ? 5 : 1;
    sums.n += w; sums.su += w * u; sums.sv += w * v; sums.sh += w * h; sums.suu += w * u * u; sums.suv += w * u * v; sums.svv += w * v * v; sums.suh += w * u * h; sums.svh += w * v * h;
  }
  const A = [[sums.n, sums.su, sums.sv], [sums.su, sums.suu, sums.suv], [sums.sv, sums.suv, sums.svv]], B = [sums.sh, sums.suh, sums.svh];
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(A), rep = (k) => A.map((row, i) => row.map((x, j) => (j === k ? B[i] : x)));
  let g0 = det3(rep(0)) / D, gu = det3(rep(1)) / D, gv = det3(rep(2)) / D;
  gu = clamp(gu, -0.05, 0.05); gv = clamp(gv, -0.05, 0.05);
  { const [x, z] = H.W(0, hw + 3); g0 = world.heightAt(x, z) - gv * (hw + 3); }          // pin the plane to the real road-edge height
  H.plane = (u, v) => g0 + gu * u + gv * v;
  const vmin = hw + 0.5, vmax = VB + 0.6, umax = HALF + 0.6;
  const n = world.carveN, half = world.half;
  const ext = 9;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * CELL - half, z = j * CELL - half;
    if (Math.abs(x - H.ox) > 90 || Math.abs(z - H.oz) > 90) continue;
    const [u, v] = H.toUV(x, z);
    const du = Math.max(Math.abs(u) - umax, 0), dv = v < vmin ? (vmin - v) * 2.5 : Math.max(v - vmax, 0);
    const dist = Math.hypot(du, dv); if (dist >= ext) continue;
    const w = 1 - smoothstep(0, ext, dist);
    const target = H.plane(u, v) - world.baseHeight(x, z), k = world.carve[j * n + i];
    world.carve[j * n + i] = k + (target - k) * w;
  }
  H.gy = (u, v) => { const [x, z] = H.W(u, v); return world.heightAt(x, z); };

  // ---- strip procedural houses, sheds, fences, gardens, trees and paths from the plot
  const inRect = (x, z, m = 0) => { const [u, v] = H.toUV(x, z); return Math.abs(u) <= HALF + m && v >= hw + 0.2 && v <= VB + m; };
  const cornersIn = (b) => { const c = Math.cos(b.rot), s = Math.sin(b.rot); return [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].some(([a, bb]) => inRect(b.x + c * a * b.w / 2 - s * bb * b.d / 2, b.z + s * a * b.w / 2 + c * bb * b.d / 2, 0.6)); };
  const dead = new Set(layout.buildings.filter((b) => !b.osm && !b.hero && cornersIn(b)));
  const deadDoors = new Set([...dead].map((b) => b.door).filter(Boolean));
  layout.buildings = layout.buildings.filter((b) => !dead.has(b));
  layout.paths = layout.paths.filter((p) => !deadDoors.has(p[0]) && !p.some((q) => inRect(q[0], q[1], 0.5)));
  layout.gardens = layout.gardens.filter((g) => !inRect(g.cx, g.cz, 2));
  layout.trees = layout.trees.filter((t) => !inRect(t.x, t.z, 2.5));
  layout.wells = layout.wells.filter((w) => !inRect(w.x, w.z, 2));
  const nf = [];
  for (const f of layout.fences) {
    let cur = null;
    for (let i = 1; i < f.pts.length; i++) {
      const a = f.pts[i - 1], b = f.pts[i];
      if (inRect((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.3) || inRect(a[0], a[1], 0.1) || inRect(b[0], b[1], 0.1)) { cur = null; continue; }
      if (!cur) { cur = { kind: f.kind, pts: [a] }; nf.push(cur); }
      cur.pts.push(b);
    }
  }
  layout.fences = nf;
  layout.zones = layout.zones || [];
  layout.gates = layout.gates || [];
  H.inPlot = (x, z, m = 0) => inRect(x, z, m);
  return H;
}

export function planHeroPlot(world, layout) {
  const H = makePlotFrame(world, layout, { anchor: ANCHOR, ref: EVEN_REF, away: true, gateU: GATE_U, HALF, DEPTH });
  if (!H) return null;
  const hw = H.hw, VF = H.VF, VB = H.VB;
  // ---- register the new property: house, outbuildings, garden beds, collision fences, door path, no-grass zones, trees
  const rot = H.rot;
  const reg = (kind, u0, u1, v0, v1, extra = {}) => {
    const [x, z] = H.W((u0 + u1) / 2, (v0 + v1) / 2);
    const b = { kind, x, z, rot, w: u1 - u0, d: v1 - v0, levels: 1, style: {}, osm: false, hero: true, ...extra };
    layout.buildings.push(b); return b;
  };
  H.footprints = {
    house: [-5.0, 6.4, 10.4, 17.8],
    kitchen: [3.4, 7.6, 22.5, 31.5],      // літня кухня
    shed: [-7.7, -5.2, 34.5, 39.0],       // дровник/сарай
    coop: [5.2, 7.6, 40.5, 42.8],         // курник
    green: [-5.6, -2.4, 52.0, 59.5],      // теплиця
  };
  const F = H.footprints;
  const house = reg('house', ...F.house, { name: HERO_LABEL });
  const doorU = -1.2, doorV = F.house[2] - 0.75;
  house.door = H.W(doorU, doorV);
  reg('barn', ...F.kitchen); reg('shed', ...F.shed); reg('shed', ...F.coop); reg('shed', ...F.green);
  H.houseObj = house; H.houseIdx = layout.buildings.indexOf(house);
  const gateOut = H.W(GATE_U, hw + 0.3), gateIn = H.W(GATE_U, VF + 0.9), porch = H.W(GATE_U + 0.2, F.house[2] - 1.5);
  layout.paths.push([house.door, porch, gateIn, gateOut]);
  layout.paths.push([H.W(doorU + 1.2, F.house[2] - 0.8), H.W(7.4, 12), H.W(7.4, 33), H.W(2.5, 36), H.W(1, 46)]);   // dirt path to the garden
  // vegetable beds (nav garden spots + yard ground paint)
  const bed = (u0, u1, v0, v1) => { const [cx, cz] = H.W((u0 + u1) / 2, (v0 + v1) / 2); layout.gardens.push({ cx, cz, rot, w: u1 - u0, d: v1 - v0 }); };
  bed(-1.6, 5.6, 29, 53);
  // collision fences (gate gap kept wide enough for villagers to squeeze through the 1 m collision grid)
  const line = (u0, v0, u1, v1) => layout.fences.push({ kind: 'hero', pts: [H.W(u0, v0), H.W(u1, v1)] });
  line(-HALF, VF, GATE_U - 1.3, VF); line(GATE_U + 1.3, VF, HALF, VF);
  line(-HALF, VF, -HALF, VB); line(HALF, VF, HALF, VB); line(-HALF, VB, HALF, VB);
  layout.gates.push({ pts: [H.W(GATE_U - 1.5, VF), H.W(GATE_U + 1.5, VF)] });         // closed door: blocks the player only, villagers use the gap
  // ground classes: the dry soil strip & the bare beds suppress grass and show dirt in the splat map
  const zone = (u0, u1, v0, v1, ch, strength, mask = 4) => { const [cx, cz] = H.W((u0 + u1) / 2, (v0 + v1) / 2); layout.zones.push({ cx, cz, rot, w: u1 - u0, d: v1 - v0, ch, strength, mask }); };
  zone(-HALF, HALF, hw + 0.2, VF, 0, 0.9);
  zone(-1.4, 5.4, 32, 52, 0, 0.6);
  zone(F.house[0] - 1, F.house[1] + 1, F.house[2] - 2.2, F.house[3] + 1.2, 1, 0.35);
  // fruit trees & berry bushes (the shared tree system)
  const T = (u, v, sp, s) => { const [x, z] = H.W(u, v); layout.trees.push({ x, z, sp, s, hero: true }); };
  T(-6.6, 22, 'apple', 1.0); T(-6.2, 28.5, 'apple', 0.9); T(7.0, 46.5, 'apple', 1.05); T(-6.8, 45, 'apple', 0.95); T(6.8, 17.8, 'apple', 0.85);
  T(7.2, 58, 'bush', 0.9); T(-0.5, 60.5, 'bush', 1.0); T(3, 60.5, 'bush', 0.9); T(-7.4, 63, 'oak', 0.9); T(6.5, 62, 'birch', 0.9);
  layout.hero = H;
  return H;
}

export function filterHeroTrees(H, list) { const Hs = (Array.isArray(H) ? H : [H]).filter(Boolean); return Hs.length ? list.filter((t) => t.hero || !Hs.some((h) => h.inPlot(t.x, t.z, 1.5))) : list; }

// ------------------------------------------------------------------------------------------------------------------
// 2. TEXTURES (canvas generated)
// ------------------------------------------------------------------------------------------------------------------
export const cvs = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
export const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
// height field (Float32 w*h, 0..1) -> tangent-space normal map canvas
export function normalFromHeight(hf, w, h, strength) {
  const c = cvs(w, h), g = c.getContext('2d'), im = g.createImageData(w, h);
  const at = (x, y) => hf[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), o = (y * w + x) * 4;
    im.data[o] = (-dx / l * 0.5 + 0.5) * 255; im.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; im.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0); return c;
}
function makeCorrugated() {
  const W = 256, Hh = 256, RIBS = 8, rng = mulberry32(31);
  const prof = (x) => { const s = Math.sin(x * Math.PI * 2); return clamp(s * 2.4, -1, 1) * 0.5 + 0.5; };          // trapezoidal C8 profile
  const hf = new Float32Array(W * Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) hf[y * W + x] = prof((x / W) * RIBS);
  const nor = normalFromHeight(hf, W, Hh, 5.5);
  const c = cvs(W, Hh), g = c.getContext('2d'), im = g.createImageData(W, Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const p = (x / W) * RIBS, d = (prof(p + 0.01) - prof(p - 0.01)) * 11;            // slope facing light -> brighter
    const grime = Math.pow(y / Hh, 3) * 0.2 + (rng() - 0.5) * 0.045 + Math.sin(x * 0.11 + y * 0.01) * 0.02;
    const k = 1 + d * 0.16 - grime, o = (y * W + x) * 4;
    im.data[o] = clamp(122 * k, 0, 255); im.data[o + 1] = clamp(27 * k, 0, 255); im.data[o + 2] = clamp(31 * k, 0, 255); im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return { map: tex(c, true), normal: tex(nor, false) };
}
export function makeSoil(base, seed, scale = 1) {
  const N = 256, rng = mulberry32(seed), hf = new Float32Array(N * N), c = cvs(N, N), g = c.getContext('2d'), im = g.createImageData(N, N);
  const grid = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rng(); return a; };
  const gs = [grid(8), grid(32), grid(128)];
  const samp = (a, n, x, y) => { const fx = x * n, fy = y * n, xi = Math.floor(fx), yi = Math.floor(fy), tx = fx - xi, ty = fy - yi; const f = (i, j) => a[((j % n + n) % n) * n + ((i % n + n) % n)]; const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty); return (f(xi, yi) * (1 - u) + f(xi + 1, yi) * u) * (1 - v) + (f(xi, yi + 1) * (1 - u) + f(xi + 1, yi + 1) * u) * v; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, h = samp(gs[0], 8, u, v) * 0.3 + samp(gs[1], 32, u, v) * 0.35 + samp(gs[2], 128, u, v) * 0.35;
    hf[y * N + x] = h; const k = 0.72 + h * 0.55, o = (y * N + x) * 4;
    im.data[o] = clamp(base[0] * k, 0, 255); im.data[o + 1] = clamp(base[1] * k, 0, 255); im.data[o + 2] = clamp(base[2] * k, 0, 255); im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0); void scale;
  return { map: tex(c, true), normal: tex(normalFromHeight(hf, N, N, 3.2), false) };
}
export function makePaving() {
  const N = 256, rng = mulberry32(8), hf = new Float32Array(N * N), c = cvs(N, N), g = c.getContext('2d'), im = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const jx = Math.min(x % 128, 128 - (x % 128)), jy = Math.min(y % 128, 128 - (y % 128));
    const groove = (jx < 3 || jy < 3) ? 0 : 1, n = rng();
    hf[y * N + x] = groove * 0.8 + n * 0.12;
    const tile = Math.floor(x / 128) * 2 + Math.floor(y / 128), tone = 0.9 + (tile % 3) * 0.05, o = (y * N + x) * 4, k = groove ? tone * (0.93 + n * 0.1) : 0.45;
    im.data[o] = 176 * k; im.data[o + 1] = 174 * k; im.data[o + 2] = 168 * k; im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0); return { map: tex(c, true), normal: tex(normalFromHeight(hf, N, N, 2.5), false) };
}
function makePlaque() {
  const c = cvs(512, 300), g = c.getContext('2d');
  g.clearRect(0, 0, 512, 300);
  g.fillStyle = '#23262a'; g.beginPath(); g.ellipse(256, 150, 250, 144, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#d9dcdf'; g.lineWidth = 7; g.beginPath(); g.ellipse(256, 150, 232, 126, 0, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#f4f5f6'; g.font = '700 150px Arial, "Helvetica Neue", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('35-Б', 256, 158);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
export function makeLabel(text = HERO_LABEL, fill = 'rgba(158,28,34,0.94)') {
  const c = cvs(512, 150), g = c.getContext('2d');
  g.fillStyle = fill; g.beginPath(); g.roundRect(4, 4, 504, 112, 26); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 5; g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(236, 114); g.lineTo(276, 114); g.lineTo(256, 146); g.closePath(); g.fill();
  g.font = '700 70px -apple-system, "Segoe UI", Roboto, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 62);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ------------------------------------------------------------------------------------------------------------------
// 3. BUILD the meshes
// ------------------------------------------------------------------------------------------------------------------
export function buildHeroPlot(scene, world, layout, materials, extra) {
  const H = layout.hero; if (!H) return null;
  const group = new THREE.Group(); group.name = 'hero-35B'; scene.add(group);
  const F = H.footprints, hw = H.hw, VF = H.VF, VB = H.VB;
  const rng = mulberry32(3535);
  const P = (u, y, v) => { const [x, z] = H.W(u, v); return [x, y, z]; };
  const gy = (u, v) => H.plane(u, v);                              // ground is levelled to this plane
  const col = (mat, c) => { const b = BOOST[mat] || 1; return [c[0] * b, c[1] * b, c[2] * b]; };
  const B = {};
  const gb = (k) => B[k] || (B[k] = new GeoBuilder());
  const box = (k, u0, y0, v0, u1, y1, v1, uvs, c, bottom = false) => gb(k).box(P2, u0, y0, v0, u1, y1, v1, uvs, c, !bottom);
  const P2 = (u, y, v) => P(u, y, v);
  // axis-aligned quads
  const vWall = (k, ua, ub, ya, yb, v, uvs, c, side) => gb(k).quad(P(ua, ya, v), P(ub, ya, v), P(ub, yb, v), P(ua, yb, v), [[ua / uvs, ya / uvs], [ub / uvs, ya / uvs], [ub / uvs, yb / uvs], [ua / uvs, yb / uvs]], c, P((ua + ub) / 2, (ya + yb) / 2, v + side));
  const uWall = (k, u, va, vb, ya, yb, uvs, c, side) => gb(k).quad(P(u, ya, va), P(u, ya, vb), P(u, yb, vb), P(u, yb, va), [[va / uvs, ya / uvs], [vb / uvs, ya / uvs], [vb / uvs, yb / uvs], [va / uvs, yb / uvs]], c, P(u + side, (ya + yb) / 2, (va + vb) / 2));
  const tint = { cream: [1.0, 0.93, 0.74], white: [1, 1, 1], lbrick: [1.9, 2.75, 3.3], rbrick: [0.95, 0.68, 0.58], roofDark: [0.17, 0.18, 0.21], roofGrey: [0.62, 0.63, 0.66], wood: [1.0, 0.85, 0.7] };

  // ---------------- street fence: red corrugated panels between light brick pillars ----------------
  const corr = makeCorrugated();
  const redMat = new THREE.MeshStandardMaterial({ map: corr.map, normalMap: corr.normal, normalScale: new THREE.Vector2(1.5, 1.5), roughness: 0.42, metalness: 0.28, envMapIntensity: 0.9 });
  const PW_ = 0.4, PH = 2.3, PANEL_TOP = 2.0, PANEL_BOT = 0.16;
  const redPanel = (ua, ub, v, top = PANEL_TOP) => {
    const ya = gy(ua, v) + PANEL_BOT, yb = gy(ub, v) + PANEL_BOT, ta = gy(ua, v) + top, tb = gy(ub, v) + top;
    const t = 0.03, uvv = (y0) => y0 / 2.2;
    for (const s of [1, -1]) {
      const vv = v + s * t / 2;
      gb('red').quad(P(ua, ya, vv), P(ub, yb, vv), P(ub, tb, vv), P(ua, ta, vv), [[ua / 0.92, uvv(0.16)], [ub / 0.92, uvv(0.16)], [ub / 0.92, uvv(top)], [ua / 0.92, uvv(top)]], [1, 1, 1], P((ua + ub) / 2, (ya + ta) / 2, v - s));
    }
    // folded top cap + bottom rail
    gb('paint').box(P2, ua, ta - 0.005, v - 0.045, ub, ta + 0.045, v + 0.045, 1, [0.38, 0.06, 0.07], true);
    gb('paint').box(P2, ua, ya - 0.05, v - 0.03, ub, ya + 0.04, v + 0.03, 1, [0.3, 0.06, 0.07], true);
  };
  const brickPillar = (u, v) => {
    const g0 = gy(u, v) - 0.15, x0 = u - PW_ / 2, x1 = u + PW_ / 2, z0 = v - PW_ / 2, z1 = v + PW_ / 2, top = gy(u, v) + PH;
    gb('brick').box(P2, x0, g0, z0, x1, top, z1, 1.5, col('brick', tint.lbrick), true);
    gb('conc').box(P2, x0 - 0.06, top, z0 - 0.06, x1 + 0.06, top + 0.06, z1 + 0.06, 1, [0.62, 0.62, 0.6], true);
    gb('conc').box(P2, x0 + 0.03, top + 0.06, z0 + 0.03, x1 - 0.03, top + 0.13, z1 - 0.03, 1, [0.58, 0.58, 0.56], true);
    gb('conc').box(P2, x0 - 0.02, g0, z0 - 0.02, x1 + 0.02, g0 + 0.3, z1 + 0.02, 1, [0.6, 0.6, 0.58], true);   // concrete foot
  };
  const pil = [-HALF, -5.4, -GATE_U - 0.8 > 0 ? -2.3 : -2.3, -0.7, 2.5, 5.7, HALF];
  pil[2] = GATE_U - 0.8; pil[3] = GATE_U + 0.8;
  pil.forEach((u) => brickPillar(u, VF));
  for (let i = 1; i < pil.length; i++) {
    if (i === 3) continue;                                                                    // gate opening
    redPanel(pil[i - 1] + PW_ / 2, pil[i] - PW_ / 2, VF);
  }
  // concrete strip under the fence
  gb('conc').box(P2, -HALF, gy(0, VF) - 0.3, VF - 0.1, GATE_U - 0.6, gy(0, VF) + 0.1, VF + 0.1, 1, [0.62, 0.62, 0.6], true);
  gb('conc').box(P2, GATE_U + 0.6, gy(0, VF) - 0.3, VF - 0.1, HALF, gy(0, VF) + 0.1, VF + 0.1, 1, [0.62, 0.62, 0.6], true);
  // side + back fences: red steel on posts
  const sideFence = (u, v0, v1) => {
    const n = Math.round((v1 - v0) / 3);
    for (let i = 0; i <= n; i++) { const v = v0 + ((v1 - v0) * i) / n; if (i === 0) continue; gb('paint').box(P2, u - 0.05, gy(u, v) - 0.2, v - 0.05, u + 0.05, gy(u, v) + 2.05, v + 0.05, 1, [0.2, 0.2, 0.21], true); }
    const sd = u > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const va = v0 + ((v1 - v0) * i) / n + (i ? 0.05 : 0.2), vb = v0 + ((v1 - v0) * (i + 1)) / n - 0.05;
      const ya = gy(u, va) + 0.12, yb = gy(u, vb) + 0.12, top = 1.85;
      for (const s of [1, -1]) {
        const uu = u + s * 0.02;
        gb('red').quad(P(uu, ya, va), P(uu, yb, vb), P(uu, yb + top, vb), P(uu, ya + top, va), [[va / 0.92, 0.05], [vb / 0.92, 0.05], [vb / 0.92, 0.9], [va / 0.92, 0.9]], [1, 1, 1], P(uu - s, ya + 1, (va + vb) / 2));
      }
      gb('paint').box(P2, u - 0.04, yb + top - 0.02, va, u + 0.04, yb + top + 0.04, vb, 1, [0.36, 0.06, 0.07], true);
    }
    void sd;
  };
  brickPillar(-HALF, VF + 3.2); brickPillar(HALF, VF + 3.2);
  sideFence(-HALF, VF + 3.4, VB); sideFence(HALF, VF + 3.4, VB);
  sideFence(-HALF, VF + 0.2, VF + 3.0); sideFence(HALF, VF + 0.2, VF + 3.0);
  // back fence
  { const n = 6; for (let i = 0; i < n; i++) { const ua = -HALF + (2 * HALF * i) / n + 0.05, ub = -HALF + (2 * HALF * (i + 1)) / n - 0.05, v = VB; const ya = gy(ua, v) + 0.12, yb = gy(ub, v) + 0.12;
    for (const s of [1, -1]) gb('red').quad(P(ua, ya, v + s * 0.02), P(ub, yb, v + s * 0.02), P(ub, yb + 1.85, v + s * 0.02), P(ua, ya + 1.85, v + s * 0.02), [[ua / 0.92, 0.05], [ub / 0.92, 0.05], [ub / 0.92, 0.9], [ua / 0.92, 0.9]], [1, 1, 1], P((ua + ub) / 2, ya + 1, v - s));
    gb('paint').box(P2, ub - 0.05, gy(ub, v) - 0.2, v - 0.05, ub + 0.05, gy(ub, v) + 2.05, v + 0.05, 1, [0.2, 0.2, 0.21], true); } }

  // ---------------- grey steel gate-door with frame, handle and the oval plaque ----------------
  { const gw = 1.12, gh = 2.02, gv = VF, g0 = gy(GATE_U, gv), c = [0.66, 0.68, 0.7];
    for (const s of [1, -1]) {
      gb('metal').quad(P(GATE_U - gw / 2, g0 + 0.1, gv + s * 0.035), P(GATE_U + gw / 2, g0 + 0.1, gv + s * 0.035), P(GATE_U + gw / 2, g0 + gh, gv + s * 0.035), P(GATE_U - gw / 2, g0 + gh, gv + s * 0.035), [[0, 0], [1, 0], [1, 1], [0, 1]], c, P(GATE_U, g0 + 1, gv - s));
    }
    gb('metal').box(P2, GATE_U - gw / 2 - 0.04, g0 + 0.06, gv - 0.045, GATE_U + gw / 2 + 0.04, g0 + 0.12, gv + 0.045, 1, [0.42, 0.44, 0.46], true);
    gb('metal').box(P2, GATE_U - gw / 2 - 0.04, g0 + gh, gv - 0.045, GATE_U + gw / 2 + 0.04, g0 + gh + 0.07, gv + 0.045, 1, [0.42, 0.44, 0.46], true);
    for (const sx of [-1, 1]) gb('metal').box(P2, GATE_U + sx * (gw / 2 + 0.02) - 0.03, g0 + 0.06, gv - 0.045, GATE_U + sx * (gw / 2 + 0.02) + 0.03, g0 + gh + 0.07, gv + 0.045, 1, [0.42, 0.44, 0.46], true);
    // stiffening ribs + handle + lock plate on the street side
    gb('metal').box(P2, GATE_U - gw / 2 + 0.06, g0 + 0.3, gv - 0.045, GATE_U + gw / 2 - 0.06, g0 + 0.34, gv - 0.036, 1, [0.58, 0.6, 0.62], true);
    gb('metal').box(P2, GATE_U - gw / 2 + 0.06, g0 + 1.6, gv - 0.045, GATE_U + gw / 2 - 0.06, g0 + 1.64, gv - 0.036, 1, [0.58, 0.6, 0.62], true);
    gb('metal').box(P2, GATE_U + 0.36, g0 + 0.98, gv - 0.075, GATE_U + 0.47, g0 + 1.2, gv - 0.04, 1, [0.12, 0.12, 0.13], true);
    gb('metal').box(P2, GATE_U + 0.28, g0 + 1.08, gv - 0.1, GATE_U + 0.52, g0 + 1.12, gv - 0.075, 1, [0.12, 0.12, 0.13], true);
    // mail slot
    gb('metal').box(P2, GATE_U - 0.2, g0 + 1.42, gv - 0.05, GATE_U + 0.2, g0 + 1.47, gv - 0.036, 1, [0.1, 0.1, 0.11], true);
    // plaque
    const pm = new THREE.MeshStandardMaterial({ map: makePlaque(), alphaTest: 0.5, roughness: 0.38, metalness: 0.35 });
    const pu = (pil[1] + pil[2]) / 2, py = gy(pu, gv) + 1.5, pw = 0.42, ph = 0.245;
    const pg = new THREE.PlaneGeometry(pw, ph); const pl = new THREE.Mesh(pg, pm);
    const [px, , pz] = P(pu, py, gv - 0.026); pl.position.set(px, py, pz); pl.rotation.y = Math.atan2(-H.mx, -H.mz); pl.castShadow = false; group.add(pl);
  }
  // curb along the road edge (white concrete) + dry soil strip
  { const cb = (u0, u1) => { const v = hw + 0.1; gb('conc').box(P2, u0, gy(u0, v) - 0.2, v - 0.08, u1, gy(u0, v) + 0.13, v + 0.08, 1, [0.9, 0.9, 0.87], true); };
    cb(-HALF - 0.4, HALF + 0.4);
    const soil = makeSoil([205, 184, 150], 12); const sm = new THREE.MeshStandardMaterial({ map: soil.map, normalMap: soil.normal, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexColors: true });
    const sdark = makeSoil([120, 92, 68], 21); const dm = new THREE.MeshStandardMaterial({ map: sdark.map, normalMap: sdark.normal, roughness: 1, vertexColors: true });
    const v0 = hw + 0.25, v1 = VF - 0.12, uvs = 1.4; const sg = gb('soil');
    const NU = 17; for (let i = 0; i < NU; i++) { const ua = -HALF - 0.3 + ((2 * HALF + 0.6) * i) / NU, ub = -HALF - 0.3 + ((2 * HALF + 0.6) * (i + 1)) / NU;
      const y = (u, v) => gy(u, v) + 0.045; sg.quad(P(ua, y(ua, v0), v0), P(ub, y(ub, v0), v0), P(ub, y(ub, v1), v1), P(ua, y(ua, v1), v1), [[ua / uvs, v0 / uvs], [ub / uvs, v0 / uvs], [ub / uvs, v1 / uvs], [ua / uvs, v1 / uvs]], [1, 0.97, 0.92], P(ua, -5, v0)); }
    // concrete slab path gate -> porch (tiles)
    const pave = makePaving(); const pvm = new THREE.MeshStandardMaterial({ map: pave.map, normalMap: pave.normal, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const pg2 = gb('pave'); const pu0 = GATE_U - 0.55, pu1 = GATE_U + 0.55; const pv0 = hw + 0.2, pv1 = F.house[2] - 0.05;
    const qs = (ua, ub, va, vb) => pg2.quad(P(ua, gy(ua, va) + 0.055, va), P(ub, gy(ub, va) + 0.055, va), P(ub, gy(ub, vb) + 0.055, vb), P(ua, gy(ua, vb) + 0.055, vb), [[ua / 1.0, va / 1.0], [ub / 1.0, va / 1.0], [ub / 1.0, vb / 1.0], [ua / 1.0, vb / 1.0]], [1, 1, 1], P(ua, -5, va));
    qs(pu0, pu1, pv0, VF - 0.2); qs(pu0, pu1, VF + 0.2, pv1);
    qs(GATE_U - 0.3, GATE_U + 0.9, VF - 0.2, VF + 0.2);
    // concrete threshold under the gate
    // raised beds: dark tilled ridges (rows run along the plot)
    const dg = gb('soilD');
    const ridge = (u, v0b, v1b, w, hgt) => { const y = (uu, vv) => gy(uu, vv);
      const a = (uu, vv, yy) => P(uu, y(uu, vv) + yy, vv); const c = [0.8, 0.78, 0.76];
      dg.quad(a(u - w, v0b, 0), a(u, v0b, hgt), a(u, v1b, hgt), a(u - w, v1b, 0), [[0, v0b], [0.4, v0b], [0.4, v1b], [0, v1b]], c, P(u, -5, (v0b + v1b) / 2));
      dg.quad(a(u, v0b, hgt), a(u + w, v0b, 0), a(u + w, v1b, 0), a(u, v1b, hgt), [[0.4, v0b], [0.8, v0b], [0.8, v1b], [0.4, v1b]], c, P(u, -5, (v0b + v1b) / 2));
      dg.tri(a(u - w, v0b, 0), a(u + w, v0b, 0), a(u, v0b, hgt), [[0, 0], [1, 0], [0.5, 0.3]], c, P(u, -5, v0b - 1)); dg.tri(a(u - w, v1b, 0), a(u + w, v1b, 0), a(u, v1b, hgt), [[0, 0], [1, 0], [0.5, 0.3]], c, P(u, -5, v1b + 1)); };
    const rows = []; for (let i = 0; i < 6; i++) { const u = -0.7 + i * 1.05; ridge(u, 33, 51, 0.4, 0.2); rows.push(u); }
    const dgm = dm; B.__dm = dgm; B.__sm = sm; B.__pvm = pvm; B.__rows = rows;
  }
  // gas pipe etc. are added with the house below

  // ---------------- the house ----------------
  const [HX0, HX1, HV0, HV1] = F.house;
  const g0h = gy((HX0 + HX1) / 2, (HV0 + HV1) / 2), y0 = g0h + 0.42, yb = g0h - 0.4, WH = 2.75, yt = y0 + WH, pitch = Math.tan((33 * Math.PI) / 180);
  const wallC = col('plaster', tint.cream), plC = col('brick', tint.rbrick);
  const winSpec = []; // {face, pos, y0, w, h}
  // walls
  const wallsFor = (k) => k;
  void wallsFor;
  const yPl = y0 + 0.5;
  vWall('brick', HX0, HX1, yb, yPl, HV0, 1.5, plC, 1); vWall('plaster', HX0, HX1, yPl, yt, HV0, 2.2, wallC, 1);
  vWall('brick', HX0, HX1, yb, yPl, HV1, 1.5, plC, -1); vWall('plaster', HX0, HX1, yPl, yt, HV1, 2.2, wallC, -1);
  uWall('brick', HX0, HV0, HV1, yb, yPl, 1.5, plC, 1); uWall('plaster', HX0, HV0, HV1, yPl, yt, 2.2, wallC, 1);
  uWall('brick', HX1, HV0, HV1, yb, yPl, 1.5, plC, -1); uWall('plaster', HX1, HV0, HV1, yPl, yt, 2.2, wallC, -1);
  // roof (gable, ridge parallel to the street)
  const ridgeV = (HV0 + HV1) / 2, ov = 0.55, gov = 0.4, eaveY = yt - ov * pitch, ridgeY = yt + ((HV1 - HV0) / 2) * pitch;
  const rc = col('roofSlate', tint.roofDark), RM = 'roofSlate';
  const slopeL = Math.hypot((HV1 - HV0) / 2 + ov, ridgeY - eaveY), ruv = 1.7;
  const x0 = HX0 - gov, x1 = HX1 + gov;
  gb(RM).quad(P(x0, eaveY, HV0 - ov), P(x1, eaveY, HV0 - ov), P(x1, ridgeY, ridgeV), P(x0, ridgeY, ridgeV), [[x0 / ruv, 0], [x1 / ruv, 0], [x1 / ruv, slopeL / ruv], [x0 / ruv, slopeL / ruv]], rc, P((x0 + x1) / 2, yt - 1, ridgeV));
  gb(RM).quad(P(x1, eaveY, HV1 + ov), P(x0, eaveY, HV1 + ov), P(x0, ridgeY, ridgeV), P(x1, ridgeY, ridgeV), [[x0 / ruv, 0], [x1 / ruv, 0], [x1 / ruv, slopeL / ruv], [x0 / ruv, slopeL / ruv]], rc, P((x0 + x1) / 2, yt - 1, ridgeV));
  for (const [u, s] of [[HX0, 1], [HX1, -1]]) gb('wood').tri(P(u, yt, HV0), P(u, yt, HV1), P(u, ridgeY, ridgeV), [[HV0 / 2, yt / 2], [HV1 / 2, yt / 2], [ridgeV / 2, ridgeY / 2]], col('wood', [1.0, 0.98, 0.92]), P(u + s, yt, ridgeV));
  // white fascia + dark gutters, ridge cap
  box('paint', x0, eaveY - 0.14, HV0 - ov - 0.03, x1, eaveY + 0.04, HV0 - ov + 0.03, 1, [0.9, 0.9, 0.88]);
  box('paint', x0, eaveY - 0.14, HV1 + ov - 0.03, x1, eaveY + 0.04, HV1 + ov + 0.03, 1, [0.9, 0.9, 0.88]);
  box('paint', HX0, eaveY - 0.19, HV0 - ov - 0.1, HX1, eaveY - 0.07, HV0 - ov, 1, [0.2, 0.14, 0.1]);
  box('paint', HX0, eaveY - 0.19, HV1 + ov, HX1, eaveY - 0.07, HV1 + ov + 0.1, 1, [0.2, 0.14, 0.1]);
  box('paint', x0, ridgeY - 0.04, ridgeV - 0.16, x1, ridgeY + 0.12, ridgeV + 0.16, 1, [0.12, 0.12, 0.14]);
  for (const [u, v, s] of [[HX0 + 0.12, HV0 - ov - 0.05, 1], [HX1 - 0.12, HV1 + ov + 0.05, 1]]) {
    gb('paint').cylinder(...(() => { const p = P(u, 0, v); return [p[0], y0 - 0.1, p[2]]; })(), 0.045, 0.045, eaveY - y0 + 0.0, 8, 1, [0.2, 0.14, 0.1], false); void s;
  }
  // chimney (brick) + steel flue
  { const cu = 2.6, cv = ridgeV + 0.35; const top = ridgeY + 0.95;
    gb('brick').box(P2, cu - 0.3, yt - 0.3, cv - 0.3, cu + 0.3, top, cv + 0.3, 1.2, col('brick', [0.95, 0.65, 0.55]), true);
    gb('conc').box(P2, cu - 0.4, top, cv - 0.4, cu + 0.4, top + 0.12, cv + 0.4, 1, [0.5, 0.5, 0.52], true);
    const fp = P(-3.0, 0, ridgeV - 0.9); gb('metal').cylinder(fp[0], ridgeY - 0.9, fp[2], 0.1, 0.1, 1.5, 10, 1, [0.62, 0.64, 0.66], true);
    const fc = P(-3.0, 0, ridgeV - 0.9); gb('metal').cylinder(fc[0], ridgeY + 0.6, fc[2], 0.17, 0.12, 0.12, 10, 1, [0.5, 0.52, 0.54], true);
  }
  // windows (glazing from the shared window texture, white surrounds + sills)
  const winB = gb('win'), winL = gb('winLit');
  const addWinV = (u, v, side, ww = 1.15, wh = 1.4, yc = y0 + 1.5) => {
    const B2 = rng() < 0.4 ? winL : winB, ua = u - ww / 2, ub = u + ww / 2, ya = yc - wh / 2, yb2 = yc + wh / 2, vv = v + side * 0.03;
    B2.quad(P(ua, ya, vv), P(ub, ya, vv), P(ub, yb2, vv), P(ua, yb2, vv), [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], P(u, yc, v - side));
    const t = 0.07, d = 0.05, wc = [0.95, 0.95, 0.93];
    box('paint', ua - t, ya - t, v + (side > 0 ? 0 : -d), ub + t, ya, v + (side > 0 ? d : 0), 1, wc); box('paint', ua - t, yb2, v + (side > 0 ? 0 : -d), ub + t, yb2 + t, v + (side > 0 ? d : 0), 1, wc);
    box('paint', ua - t, ya, v + (side > 0 ? 0 : -d), ua, yb2, v + (side > 0 ? d : 0), 1, wc); box('paint', ub, ya, v + (side > 0 ? 0 : -d), ub + t, yb2, v + (side > 0 ? d : 0), 1, wc);
    box('paint', ua - 0.1, ya - 0.1, v + (side > 0 ? 0 : -0.12), ub + 0.1, ya - 0.03, v + (side > 0 ? 0.12 : 0), 1, [0.86, 0.86, 0.84]);
  };
  const addWinU = (u, v, side, ww = 1.15, wh = 1.4, yc = y0 + 1.5) => {
    const B2 = rng() < 0.4 ? winL : winB, va = v - ww / 2, vb = v + ww / 2, ya = yc - wh / 2, yb2 = yc + wh / 2, uu = u + side * 0.03;
    B2.quad(P(uu, ya, va), P(uu, ya, vb), P(uu, yb2, vb), P(uu, yb2, va), [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], P(u - side, yc, v));
    const t = 0.07, d = 0.05, wc = [0.95, 0.95, 0.93], a = side > 0 ? 0 : -d, b = side > 0 ? d : 0;
    box('paint', u + a, ya - t, va - t, u + b, ya, vb + t, 1, wc); box('paint', u + a, yb2, va - t, u + b, yb2 + t, vb + t, 1, wc);
    box('paint', u + a, ya, va - t, u + b, yb2, va, 1, wc); box('paint', u + a, ya, vb, u + b, yb2, vb + t, 1, wc);
    box('paint', u + (side > 0 ? 0 : -0.12), ya - 0.1, va - 0.1, u + (side > 0 ? 0.12 : 0), ya - 0.03, vb + 0.1, 1, [0.86, 0.86, 0.84]);
  };
  [-3.7, 1.5, 4.5].forEach((u) => addWinV(u, HV0, -1));
  [-3.3, -0.5, 3.5].forEach((u) => (u > -1.4 && u < -0.9 ? 0 : addWinV(u, HV1, 1)));
  [HV0 + 1.9, HV0 + 5.4].forEach((v) => { addWinU(HX0, v, -1); addWinU(HX1, v, 1); });
  addWinU(HX0, ridgeV, -1, 0.6, 0.7, ridgeY - 0.9); addWinU(HX1, ridgeV, 1, 0.6, 0.7, ridgeY - 0.9);
  // front door + porch with canopy and concrete steps
  { const du = -1.2, dw = 1.0, dh = 2.05, shutC = col('wood', [0.62, 0.34, 0.18]);
    gb('wood').quad(P(du - dw / 2, y0, HV0 - 0.03), P(du + dw / 2, y0, HV0 - 0.03), P(du + dw / 2, y0 + dh, HV0 - 0.03), P(du - dw / 2, y0 + dh, HV0 - 0.03), [[0, 0], [0.62, 0], [0.62, 1.3], [0, 1.3]], shutC, P(du, y0 + 1, HV0 + 1));
    box('paint', du - dw / 2 - 0.08, y0, HV0 - 0.06, du - dw / 2, y0 + dh + 0.08, HV0 + 0.02, 1, [0.93, 0.93, 0.9]); box('paint', du + dw / 2, y0, HV0 - 0.06, du + dw / 2 + 0.08, y0 + dh + 0.08, HV0 + 0.02, 1, [0.93, 0.93, 0.9]);
    box('paint', du - dw / 2 - 0.08, y0 + dh, HV0 - 0.06, du + dw / 2 + 0.08, y0 + dh + 0.08, HV0 + 0.02, 1, [0.93, 0.93, 0.9]);
    box('metal', du + 0.32, y0 + 0.95, HV0 - 0.08, du + 0.38, y0 + 1.15, HV0 - 0.03, 1, [0.75, 0.75, 0.2]);
    box('conc', du - 1.1, y0 - 0.55, HV0 - 1.35, du + 1.1, y0 - 0.05, HV0 + 0.02, 1, [0.64, 0.63, 0.6], true);
    box('conc', du - 1.1, y0 - 0.55, HV0 - 2.0, du + 1.1, y0 - 0.28, HV0 - 1.35, 1, [0.62, 0.61, 0.58], true);
    const cy = y0 + 2.55;
    gb(RM).quad(P(du - 1.35, cy - 0.35, HV0 - 1.55), P(du + 1.35, cy - 0.35, HV0 - 1.55), P(du + 1.35, cy + 0.38, HV0 - 0.02), P(du - 1.35, cy + 0.38, HV0 - 0.02), [[0, 0], [1.6, 0], [1.6, 0.9], [0, 0.9]], rc, P(du, cy - 1.5, HV0 - 0.9));
    gb(RM).tri(P(du - 1.35, cy - 0.35, HV0 - 1.55), P(du - 1.35, cy + 0.38, HV0 - 0.02), P(du - 1.35, cy - 0.35, HV0 - 0.02), [[0, 0], [1, 1], [1, 0]], rc, P(du, cy, HV0 - 0.9));
    for (const s of [-1, 1]) box('paint', du + s * 1.2 - 0.05, y0 - 0.05, HV0 - 1.45, du + s * 1.2 + 0.05, cy - 0.33, HV0 - 1.35, 1, [0.92, 0.92, 0.9]);
    box('paint', du - 1.35, cy - 0.4, HV0 - 1.58, du + 1.35, cy - 0.3, HV0 - 1.5, 1, [0.92, 0.92, 0.9]);
  }
  // yellow gas pipe along the facade, meter box, electric meter box
  { const gyp = y0 + 2.45, c = [0.95, 0.75, 0.05];
    box('metal', HX1 - 0.9, gyp - 0.03, HV0 - 0.12, HX1 - 0.3, gyp + 0.03, HV0 - 0.06, 1, c); box('metal', -0.1, gyp - 0.03, HV0 - 0.12, HX1 - 0.9, gyp + 0.03, HV0 - 0.06, 1, c);
    box('metal', HX1 - 0.9, y0 + 0.25, HV0 - 0.12, HX1 - 0.84, gyp + 0.03, HV0 - 0.06, 1, c);
    box('metal', HX1 - 1.1, y0 + 0.9, HV0 - 0.16, HX1 - 0.64, y0 + 1.4, HV0 - 0.06, 1, [0.72, 0.73, 0.75]);
    box('metal', -0.45, y0 + 1.25, HV0 - 0.16, -0.05, y0 + 1.7, HV0 - 0.06, 1, [0.78, 0.78, 0.76]);
  }
  // back-yard annex (lean-to kitchen) and back door
  { const au0 = -3.2, au1 = 0.6, av1 = HV1 + 3.0, ah0 = y0 + 2.3, ah1 = y0 + 2.05, wcol = wallC;
    vWall('plaster', au0, au1, yb, ah1, av1, 2.2, wcol, -1);
    uWall('plaster', au0, HV1, av1, yb, ah0, 2.2, wcol, 1); uWall('plaster', au1, HV1, av1, yb, ah0, 2.2, wcol, -1);
    gb('plaster').tri(P(au0, ah1, av1), P(au0, ah0, HV1), P(au0, ah1, HV1), [[0, 0], [1, 1], [1, 0]], wcol, P(au0 + 1, ah1, HV1 + 1.5));
    gb('plaster').tri(P(au1, ah1, av1), P(au1, ah1, HV1), P(au1, ah0, HV1), [[0, 0], [1, 0], [1, 1]], wcol, P(au1 - 1, ah1, HV1 + 1.5));
    const ra = 0.2;
    gb(RM).quad(P(au0 - ra, ah0 + 0.15, HV1), P(au1 + ra, ah0 + 0.15, HV1), P(au1 + ra, ah1 - 0.05, av1 + 0.3), P(au0 - ra, ah1 - 0.05, av1 + 0.3), [[0, 0], [2, 0], [2, 1.9], [0, 1.9]], rc, P(-1, y0 + 1, HV1 + 1.5));
    addWinV(au0 + 0.9, av1, 1, 1.0, 1.2, y0 + 1.5);
    gb('wood').quad(P(0.0, y0, av1 + 0.03), P(0.0 + 0.9, y0, av1 + 0.03), P(0.9, y0 + 2.0, av1 + 0.03), P(0.0, y0 + 2.0, av1 + 0.03), [[0, 0], [0.55, 0], [0.55, 1.2], [0, 1.2]], col('wood', [0.9, 0.9, 0.9]), P(0.4, y0 + 1, av1 - 1));
    box('conc', -0.1, yb + 0.3, av1 + 0.02, 1.1, y0 - 0.05, av1 + 0.7, 1, [0.62, 0.61, 0.58], true);
  }

  // ---------------- outbuildings ----------------
  const outbuilding = (fp, h, kind) => {
    const [u0, u1, v0, v1] = fp, gnd = gy((u0 + u1) / 2, (v0 + v1) / 2), yy0 = gnd + 0.2, ybb = gnd - 0.3, ytt = yy0 + h;
    const brick = kind === 'kitchen', wood = !brick, mat = brick ? 'plaster' : 'wood';
    const wc = brick ? col('plaster', [1.0, 0.98, 0.9]) : col('wood', kind === 'coop' ? [0.8, 0.9, 1.0] : [1, 0.85, 0.65]);
    const uvs = brick ? 2.2 : 1.6;
    vWall(mat, u0, u1, ybb, ytt, v0, uvs, wc, 1); vWall(mat, u0, u1, ybb, ytt, v1, uvs, wc, -1); uWall(mat, u0, v0, v1, ybb, ytt, uvs, wc, 1); uWall(mat, u1, v0, v1, ybb, ytt, uvs, wc, -1);
    void wood;
    if (kind === 'kitchen') {                                    // gable along v, light grey slate
      const rg = ytt + ((u1 - u0) / 2) * 0.55, um = (u0 + u1) / 2, o2 = 0.35, rcc = col('roofSlate', tint.roofGrey), eaveO = ytt - o2 * 0.55;
      gb(RM).quad(P(u0 - o2, eaveO, v0 - 0.3), P(u0 - o2, eaveO, v1 + 0.3), P(um, rg, v1 + 0.3), P(um, rg, v0 - 0.3), [[0, 0], [11, 0], [11, 2.5], [0, 2.5]], rcc, P(um, ytt - 1, (v0 + v1) / 2));
      gb(RM).quad(P(u1 + o2, eaveO, v1 + 0.3), P(u1 + o2, eaveO, v0 - 0.3), P(um, rg, v0 - 0.3), P(um, rg, v1 + 0.3), [[0, 0], [11, 0], [11, 2.5], [0, 2.5]], rcc, P(um, ytt - 1, (v0 + v1) / 2));
      for (const [v, s] of [[v0, 1], [v1, -1]]) gb('plaster').tri(P(u0, ytt, v), P(u1, ytt, v), P(um, rg, v), [[u0 / 2.2, ytt / 2.2], [u1 / 2.2, ytt / 2.2], [um / 2.2, rg / 2.2]], wc, P(um, ytt, v + s));
      box('paint', um - 0.12, rg - 0.03, v0 - 0.3, um + 0.12, rg + 0.1, v1 + 0.3, 1, [0.3, 0.3, 0.32]);
      addWinU(u0, v0 + 2.0, -1, 0.9, 1.1, yy0 + 1.5); addWinU(u0, v1 - 2.2, -1, 0.9, 1.1, yy0 + 1.5);
      gb('wood').quad(P(u0 - 0.03, yy0, v0 + 4.6), P(u0 - 0.03, yy0, v0 + 5.5), P(u0 - 0.03, yy0 + 1.95, v0 + 5.5), P(u0 - 0.03, yy0 + 1.95, v0 + 4.6), [[0, 0], [0.55, 0], [0.55, 1.2], [0, 1.2]], col('wood', [0.5, 0.36, 0.25]), P(u0 - 1, yy0 + 1, v0 + 5));
      box('conc', u0 - 0.9, ybb + 0.2, v0 + 4.3, u0 - 0.02, yy0 - 0.02, v0 + 5.8, 1, [0.62, 0.61, 0.58], true);
      const cvv = v0 + 2.2; gb('brick').box(P2, um + 0.6 - 0.3, ytt - 0.4, cvv - 0.3, um + 0.6 + 0.3, rg + 0.7, cvv + 0.3, 1.2, col('brick', [0.9, 0.6, 0.5]), true);
    } else {                                                     // mono-pitch roof (corrugated sheet, dark)
      const hi = ytt + 0.5, lo = ytt + 0.1, o2 = 0.25, rcc = col('roofSlate', kind === 'coop' ? [0.5, 0.25, 0.2] : [0.36, 0.37, 0.4]);
      gb(RM).quad(P(u0 - o2, hi, v0 - o2), P(u1 + o2, hi, v0 - o2), P(u1 + o2, lo, v1 + o2), P(u0 - o2, lo, v1 + o2), [[0, 0], [(u1 - u0) / 1.7, 0], [(u1 - u0) / 1.7, (v1 - v0) / 1.7], [0, (v1 - v0) / 1.7]], rcc, P((u0 + u1) / 2, ytt - 1, (v0 + v1) / 2));
      gb(mat).quad(P(u0, ytt, v0), P(u0, ytt, v1), P(u0, lo, v1), P(u0, hi, v0), [[0, 0], [1, 0], [1, 0.2], [0, 0.4]], wc, P(u0 + 1, ytt, (v0 + v1) / 2));
      gb(mat).quad(P(u1, ytt, v0), P(u1, ytt, v1), P(u1, lo, v1), P(u1, hi, v0), [[0, 0], [1, 0], [1, 0.2], [0, 0.4]], wc, P(u1 - 1, ytt, (v0 + v1) / 2));
      gb(mat).quad(P(u0, ytt, v0), P(u1, ytt, v0), P(u1, hi, v0), P(u0, hi, v0), [[0, 0], [1, 0], [1, 0.4], [0, 0.4]], wc, P((u0 + u1) / 2, ytt, v0 + 1));
      // plank door facing the garden/street side
      const dsd = (u0 + u1) / 2 < 0 ? 1 : -1, uu = dsd > 0 ? u1 : u0, dv = (v0 + v1) / 2;
      gb('wood').quad(P(uu + dsd * 0.03, yy0, dv - 0.4), P(uu + dsd * 0.03, yy0, dv + 0.4), P(uu + dsd * 0.03, yy0 + 1.8, dv + 0.4), P(uu + dsd * 0.03, yy0 + 1.8, dv - 0.4), [[0, 0], [0.5, 0], [0.5, 1.1], [0, 1.1]], col('wood', [0.62, 0.45, 0.32]), P(uu - dsd, yy0 + 1, dv));
    }
  };
  outbuilding(F.kitchen, 2.7, 'kitchen'); outbuilding(F.shed, 2.3, 'shed'); outbuilding(F.coop, 1.5, 'coop');
  // greenhouse: aluminium frame + translucent polycarbonate hoop (low-poly gable)
  { const [u0, u1, v0, v1] = F.green, gnd = gy((u0 + u1) / 2, (v0 + v1) / 2), ya = gnd + 0.02, hw2 = 1.9, um = (u0 + u1) / 2, ridge = ya + 2.1, wallH = ya + 1.3, f = [0.8, 0.82, 0.84];
    const ribs = 6; for (let i = 0; i <= ribs; i++) { const v = v0 + ((v1 - v0) * i) / ribs;
      for (const s of [-1, 1]) { box('metal', um + s * (u1 - u0) / 2 - 0.025, ya, v - 0.025, um + s * (u1 - u0) / 2 + 0.025, wallH, v + 0.025, 1, f); }
      gb('metal').quad(P(um - (u1 - u0) / 2, wallH, v - 0.02), P(um, ridge, v - 0.02), P(um, ridge + 0.04, v + 0.02), P(um - (u1 - u0) / 2, wallH + 0.04, v + 0.02), [[0, 0], [1, 0], [1, 1], [0, 1]], f, null);
      gb('metal').quad(P(um + (u1 - u0) / 2, wallH, v - 0.02), P(um, ridge, v - 0.02), P(um, ridge + 0.04, v + 0.02), P(um + (u1 - u0) / 2, wallH + 0.04, v + 0.02), [[0, 0], [1, 0], [1, 1], [0, 1]], f, null); }
    void hw2;
    const gl = gb('glass'), W2 = (u1 - u0) / 2, c = [1, 1, 1];
    const sq = (a, b, cc, d) => gl.quad(a, b, cc, d, [[0, 0], [1, 0], [1, 1], [0, 1]], c, null);
    sq(P(um - W2, ya, v0), P(um - W2, ya, v1), P(um - W2, wallH, v1), P(um - W2, wallH, v0)); sq(P(um + W2, ya, v1), P(um + W2, ya, v0), P(um + W2, wallH, v0), P(um + W2, wallH, v1));
    sq(P(um - W2, wallH, v0), P(um - W2, wallH, v1), P(um, ridge, v1), P(um, ridge, v0)); sq(P(um + W2, wallH, v1), P(um + W2, wallH, v0), P(um, ridge, v0), P(um, ridge, v1));
    gl.tri(P(um - W2, ya, v0), P(um + W2, ya, v0), P(um + W2, wallH, v0), [[0, 0], [1, 0], [1, 1]], c, null); gl.tri(P(um - W2, ya, v0), P(um + W2, wallH, v0), P(um - W2, wallH, v0), [[0, 0], [1, 1], [0, 1]], c, null);
    gl.tri(P(um - W2, wallH, v0), P(um + W2, wallH, v0), P(um, ridge, v0), [[0, 0], [1, 0], [0.5, 1]], c, null);
    gl.tri(P(um - W2, ya, v1), P(um + W2, wallH, v1), P(um + W2, ya, v1), [[0, 0], [1, 1], [1, 0]], c, null); gl.tri(P(um - W2, ya, v1), P(um - W2, wallH, v1), P(um + W2, wallH, v1), [[0, 0], [0, 1], [1, 1]], c, null);
    gl.tri(P(um - W2, wallH, v1), P(um, ridge, v1), P(um + W2, wallH, v1), [[0, 0], [0.5, 1], [1, 0]], c, null);
    // raised bed inside
    gb('soilD').box(P2, um - 1.2, ya, v0 + 0.5, um - 0.4, ya + 0.35, v1 - 0.5, 1, [0.55, 0.5, 0.45], true);
    gb('soilD').box(P2, um + 0.4, ya, v0 + 0.5, um + 1.2, ya + 0.35, v1 - 0.5, 1, [0.55, 0.5, 0.45], true);
  }
  // little garden well with a pitched roof
  { const [wu, wv] = [-3.2, 41]; const w = P(wu, 0, wv), gnd = gy(wu, wv);
    gb('conc').cylinder(w[0], gnd - 0.1, w[2], 0.55, 0.55, 0.95, 14, 1.2, [0.66, 0.64, 0.6], true);
    box('wood', wu - 0.6, gnd, wv - 0.05, wu - 0.5, gnd + 2.0, wv + 0.05, 1.6, col('wood', [0.7, 0.55, 0.4])); box('wood', wu + 0.5, gnd, wv - 0.05, wu + 0.6, gnd + 2.0, wv + 0.05, 1.6, col('wood', [0.7, 0.55, 0.4]));
    const rcw = col('roofSlate', [0.45, 0.25, 0.2]);
    gb(RM).quad(P(wu - 0.85, gnd + 1.55, wv - 0.8), P(wu + 0.85, gnd + 1.55, wv - 0.8), P(wu + 0.85, gnd + 2.1, wv), P(wu - 0.85, gnd + 2.1, wv), [[0, 0], [1, 0], [1, 0.7], [0, 0.7]], rcw, P(wu, gnd + 1, wv));
    gb(RM).quad(P(wu + 0.85, gnd + 1.55, wv + 0.8), P(wu - 0.85, gnd + 1.55, wv + 0.8), P(wu - 0.85, gnd + 2.1, wv), P(wu + 0.85, gnd + 2.1, wv), [[0, 0], [1, 0], [1, 0.7], [0, 0.7]], rcw, P(wu, gnd + 1, wv));
  }

  // ---------------- turn the builders into meshes ----------------
  const stdPaint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
  const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.65, envMapIntensity: 1.0, side: THREE.DoubleSide });
  const concMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xe6f2ec, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false });
  const woodTint = (k) => k;
  void woodTint;
  const M = { red: redMat, paint: stdPaint, metal: metalMat, conc: concMat, glass: glassMat, soil: B.__sm, soilD: B.__dm, pave: B.__pvm, win: extra.win, winLit: extra.winLit };
  const stats = { tris: 0, meshes: 0 };
  for (const [k, g] of Object.entries(B)) {
    if (k.startsWith('__') || !(g instanceof GeoBuilder) || g.empty) continue;
    const mat = M[k] || materials.mats[k]; if (!mat) continue;
    if (materials.mats[k] && BOOST[k]) { /* BOOST already applied through col() */ }
    const mesh = new THREE.Mesh(g.build(), mat);
    mesh.castShadow = !['win', 'winLit', 'soil', 'pave', 'glass', 'soilD'].includes(k); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mesh.name = 'hero-' + k;
    if (k === 'glass') mesh.renderOrder = 3;
    group.add(mesh); stats.tris += g.i.length / 3; stats.meshes++;
  }

  // ---------------- instanced vegetation & small props ----------------
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), cl = new THREE.Color();
  const instance = (geo, mat, items, name) => {
    const im = new THREE.InstancedMesh(geo, mat, items.length); im.name = name;
    items.forEach((it, i) => { q.setFromEuler(e.set(it.rx || 0, it.ry || 0, it.rz || 0)); ps.set(...P(it.u, it.y ?? gy(it.u, it.v), it.v)); const s = it.s ?? 1; sc.set(s * (it.sx ?? 1), s * (it.sy ?? 1), s * (it.sx ?? 1)); m4.compose(ps, q, sc); im.setMatrixAt(i, m4); cl.setRGB(...(it.c || [1, 1, 1])); im.setColorAt(i, cl); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); group.add(im); return im;
  };
  // dormant bushes (leafless twig clusters)
  const bushGeo = makeBushGeo(); const bushMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  const vs = (VF + hw + 0.2) / 2 + 0.05;
  instance(bushGeo, bushMat, [
    { u: -7.0, v: vs + 0.35, s: 0.9, ry: 1.1 }, { u: -3.6, v: vs + 0.6, s: 1.15, ry: 2.4 }, { u: 3.6, v: vs + 0.55, s: 1.0, ry: 0.4 }, { u: 6.9, v: vs + 0.4, s: 1.2, ry: 4.4 },
    { u: -6.2, v: 19.4, s: 1.3, ry: 0.3 }, { u: 6.6, v: 24, s: 1.1, ry: 2.2 }, { u: 5.6, v: 36.5, s: 1.0, ry: 5 }, { u: -6.4, v: 51, s: 1.2, ry: 1.7 }, { u: 6.4, v: 51.5, s: 1.1, ry: 3.3 }, { u: 4.8, v: 59.2, s: 1.0, ry: 2 },
  ], 'hero-bushes');
  // evergreens: small bright-green conifer by the fence (left) + a few columnar thujas
  const coneGeo = makeConiferGeo(); const coneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: false });
  instance(coneGeo, coneMat, [
    { u: -4.1, v: vs - 0.25, s: 0.78, sy: 0.9, c: [1, 1, 1], ry: 0.3 }, { u: -7.6, v: 14.5, s: 1.9, sy: 1.5, ry: 1 }, { u: -7.6, v: 31, s: 1.7, sy: 1.5, ry: 2 }, { u: 7.7, v: 31, s: 1.8, sy: 1.4, ry: 3 },
  ], 'hero-conifers');
  // vegetable plants on the ridges
  const cab = new THREE.IcosahedronGeometry(0.17, 1); const cabMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const plants = []; B.__rows.forEach((u, ri) => { for (let v = 33.4; v < 50.8; v += 0.62 + (ri % 2) * 0.1) {
    const jitter = (rng() - 0.5) * 0.05; const g1 = 0.55 + rng() * 0.25; plants.push({ u: u + jitter, v, y: gy(u, v) + 0.24, s: 0.8 + rng() * 0.6, sy: 0.7, c: ri % 3 === 0 ? [0.2 * g1 * 1.5, 0.5 * g1, 0.22 * g1] : [0.28 * g1, 0.55 * g1, 0.18 * g1] }); } });
  instance(cab, cabMat, plants, 'hero-plants');
  // woodpile (instanced logs) against the shed + blue water barrels at the house corner
  const log = new THREE.CylinderGeometry(0.07, 0.07, 1.0, 7); log.rotateZ(Math.PI / 2); const logMat = new THREE.MeshStandardMaterial({ color: 0xa9835d, roughness: 0.9 });
  const logs = []; for (let r = 0; r < 5; r++) for (let k = 0; k < 9 - r; k++) logs.push({ u: -7.1 + (rng() - 0.5) * 0.04, v: 39.7 + k * 0.152 + r * 0.076, y: gy(-7.1, 40) + 0.08 + r * 0.14, s: 1, ry: H.ry + (rng() - 0.5) * 0.05, c: [0.8 + rng() * 0.3, 0.7 + rng() * 0.2, 0.6] });
  instance(log, logMat, logs, 'hero-logs');
  const barrel = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14); const barrelMat = new THREE.MeshStandardMaterial({ color: 0x2a5da8, roughness: 0.5, metalness: 0.1 });
  instance(barrel, barrelMat, [{ u: HX1 + 0.55, v: HV1 + 0.35, y: gy(HX1, HV1) + 0.45 }, { u: HX1 + 0.55, v: HV0 + 0.4, y: gy(HX1, HV0) + 0.45 }], 'hero-barrels');

  // ---------------- floating POI label ----------------
  const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabel(), depthWrite: false, depthTest: true, fog: true, transparent: true }));
  const [lx, , lz] = P(GATE_U, 0, VF - 0.6); const labY = gy(GATE_U, VF) + 4.7;
  lab.position.set(lx, labY, lz); lab.renderOrder = 6; scene.add(lab);
  const base = { w: 3.6, h: 1.05 };
  const poi = {
    label: lab, hero: H,
    update(pos) {
      const d = Math.hypot(lx - pos.x, lz - pos.z); lab.visible = d < 260;
      const k = clamp(d / 22, 1, 5); lab.scale.set(base.w * k, base.h * k, 1);
    },
  };
  // view spot in front of the gate, looking at it
  const [vx, vz] = H.W(GATE_U, 0.4);
  poi.view = { x: vx, z: vz, yaw: Math.atan2(-H.mx, -H.mz), pitch: 0.06 };
  poi.group = group; poi.stats = stats;
  return poi;
}

// ---------- instanced geometry factories ----------
export function tube(gb, pts, r0, r1, col, sides = 4) {
  const ring = (c, tg, r) => {
    const up = Math.abs(tg[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const a = [tg[1] * up[2] - tg[2] * up[1], tg[2] * up[0] - tg[0] * up[2], tg[0] * up[1] - tg[1] * up[0]]; const la = Math.hypot(...a) || 1; a[0] /= la; a[1] /= la; a[2] /= la;
    const b = [tg[1] * a[2] - tg[2] * a[1], tg[2] * a[0] - tg[0] * a[2], tg[0] * a[1] - tg[1] * a[0]];
    const out = []; for (let k = 0; k < sides; k++) { const t = (k / sides) * Math.PI * 2, cs = Math.cos(t) * r, sn = Math.sin(t) * r; out.push([c[0] + a[0] * cs + b[0] * sn, c[1] + a[1] * cs + b[1] * sn, c[2] + a[2] * cs + b[2] * sn]); }
    return out;
  };
  let prev = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], n = pts[Math.min(i + 1, pts.length - 1)], pp = pts[Math.max(i - 1, 0)];
    const tg = [n[0] - pp[0], n[1] - pp[1], n[2] - pp[2]]; const l = Math.hypot(...tg) || 1; tg[0] /= l; tg[1] /= l; tg[2] /= l;
    const r = r0 + (r1 - r0) * (i / (pts.length - 1)), cur = ring(p, tg, r);
    if (prev) for (let k = 0; k < sides; k++) { const k2 = (k + 1) % sides; gb.quad(prev[k], prev[k2], cur[k2], cur[k], [[0, 0], [1, 0], [1, 1], [0, 1]], col, null); }
    prev = cur;
  }
}
export function makeBushGeo() {
  const rng = mulberry32(99), gb = new GeoBuilder();
  const mainN = 11;
  for (let i = 0; i < mainN; i++) {
    const ang = (i / mainN) * Math.PI * 2 + rng() * 0.5, lean = 0.12 + rng() * 0.5, len = 0.7 + rng() * 0.55;
    const dir = [Math.cos(ang) * Math.sin(lean), Math.cos(lean), Math.sin(ang) * Math.sin(lean)];
    const bx = Math.cos(ang) * 0.05, bz = Math.sin(ang) * 0.05;
    const pts = []; for (let k = 0; k <= 3; k++) { const t = k / 3; pts.push([bx + dir[0] * len * t + Math.cos(ang) * 0.08 * t * t, dir[1] * len * t, bz + dir[2] * len * t + Math.sin(ang) * 0.08 * t * t]); }
    const c = [0.3 + rng() * 0.08, 0.23 + rng() * 0.05, 0.17 + rng() * 0.04];
    tube(gb, pts, 0.014, 0.005, c, 4);
    for (let s = 0; s < 2; s++) {                                    // side twigs
      const t0 = 0.45 + rng() * 0.3, base = pts[Math.min(3, Math.round(t0 * 3))], a2 = ang + (rng() - 0.5) * 2.2, l2 = 0.22 + rng() * 0.28;
      const p2 = []; for (let k = 0; k <= 2; k++) { const t = k / 2; p2.push([base[0] + Math.cos(a2) * l2 * t * 0.75, base[1] + l2 * t * 0.7, base[2] + Math.sin(a2) * l2 * t * 0.75]); }
      tube(gb, p2, 0.007, 0.0025, c, 3);
    }
  }
  const g = gb.build(); return g;
}
export function makeConiferGeo() {
  const rng = mulberry32(7), gb = new GeoBuilder(), tiers = 6, seg = 9, H = 1.0;
  const trunk = [0.3, 0.2, 0.12]; gb.cylinder(0, 0, 0, 0.035, 0.03, 0.18, 5, 1, trunk, false);
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers, y0 = 0.06 + f * H * 0.72, R = (0.38 - f * 0.26) * (0.9 + rng() * 0.2), top = y0 + H * (0.3 - f * 0.05);
    const ring = []; for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2 + t * 0.4, r = R * (0.82 + rng() * 0.36); ring.push([Math.cos(a) * r, y0, Math.sin(a) * r]); }
    const c1 = [0.1 + f * 0.05, 0.36 + rng() * 0.08 - f * 0.04, 0.09]; const apex = [0, top, 0];
    for (let k = 0; k < seg; k++) { const a = ring[k], b = ring[(k + 1) % seg]; gb.tri(a, b, apex, [[0, 0], [1, 0], [0.5, 1]], c1, [0, y0 - 0.2, 0]); }
    for (let k = 0; k < seg; k++) { const a = ring[k], b = ring[(k + 1) % seg]; gb.tri(a, [0, y0 - 0.05, 0], b, [[0, 0], [0.5, 0.5], [1, 0]], [c1[0] * 0.5, c1[1] * 0.5, c1[2] * 0.5], [0, y0 + 0.2, 0]); }
  }
  return gb.build();
}

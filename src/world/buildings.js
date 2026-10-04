// Building generator: oriented-rectangle houses with plinth, plastered/brick walls, pitched gable/hip roofs (tile/slate),
// windows (some lit at night), shutters, doors, porch canopies, chimneys; sheds, barns, warehouses, kiosks.
// All geometry is merged per (200 m chunk, material) so frustum culling works and draw calls stay low.
import * as THREE from 'three';
import { GeoBuilder } from './geo.js';
import { mulberry32, clamp } from '../util.js';
import { makeWindowTextures, makeSignTexture } from './procedural.js';

const UV = { plaster: 2.2, brick: 1.5, wood: 1.6, roofSlate: 1.7, roofClay: 1.4, roofRed: 1.5 };
const CHUNK = 400;
// Poly Haven albedos are fairly dark/neutral; vertex colours (tints) are boosted per material so painted walls read bright.
const BOOST = { plaster: 1.75, brick: 1.2, wood: 2.3, roofSlate: 1.35, roofClay: 1.55, roofRed: 1.35 };

export class BuildingSet {
  constructor() { this.map = new Map(); }
  get(x, z, mat) {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}|${mat}`;
    let g = this.map.get(k); if (!g) { g = new GeoBuilder(); this.map.set(k, g); }
    return g;
  }
  mesh(materials, extraMats, group, opts = {}) {
    const count = { tris: 0, meshes: 0 };
    for (const [k, gb] of this.map) {
      if (gb.empty) continue;
      const mat = k.split('|')[1];
      if (BOOST[mat]) { const f = BOOST[mat]; for (let i = 0; i < gb.c.length; i++) gb.c[i] *= f; }
      let material = materials.mats[mat] || extraMats[mat];
      if (!material && mat.startsWith('sign:')) {
        material = extraMats[mat] = new THREE.MeshStandardMaterial({ map: makeSignTexture([{ text: mat.slice(5), size: mat.length > 16 ? 56 : 72 }], mat === 'sign:ШКОЛА' ? '#1f4f93' : '#d92b2b', '#ffffff', true, 512, 128), roughness: 0.5 });
      }
      const m = new THREE.Mesh(gb.build(), material);
      m.castShadow = !mat.startsWith('win') && mat !== 'sign' && mat !== 'flag'; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      group.add(m); count.tris += gb.i.length / 3; count.meshes++;
    }
    void opts; return count;
  }
}

export function makeExtraMaterials() {
  const w = makeWindowTextures();
  const win = new THREE.MeshStandardMaterial({ map: w.map, roughness: 0.18, metalness: 0.0, envMapIntensity: 1.6 });
  const winLit = new THREE.MeshStandardMaterial({ map: w.map, emissiveMap: w.emissive, emissive: new THREE.Color(1, 0.8, 0.5), emissiveIntensity: 0, roughness: 0.25, metalness: 0 });
  const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });          // flat painted parts: awnings, columns, poles
  const flag = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  return { win, winLit, paint, flag, _w: w };
}

const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const mulc = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

function groundStats(world, b, pad = 0.6) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  let lo = Infinity, hi = -Infinity;
  const nx = Math.max(2, Math.ceil(b.w / 2)), nz = Math.max(2, Math.ceil(b.d / 2));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const lx = (i / nx - 0.5) * (b.w + pad), lz = (j / nz - 0.5) * (b.d + pad);
    const h = world.heightAt(b.x + c * lx - s * lz, b.z + s * lx + c * lz);
    if (h < lo) lo = h; if (h > hi) hi = h;
  }
  return { lo, hi };
}

export function addBuilding(S, world, b) {
  const st = b.style, rng = mulberry32(st.seed);
  const civic = b.kind === 'house' ? b.civic : null;      // 'shop' | 'school': distinct models
  if (civic === 'shop') Object.assign(st, { wall: 'plaster', wallTint: [1.0, 0.7, 0.4], roof: 'roofSlate', roofTint: [0.5, 0.85, 0.62], pitch: 11, hip: false, shutters: false, chimney: false });
  if (civic === 'school') Object.assign(st, { wall: 'plaster', wallTint: [1.0, 0.93, 0.58], roof: 'roofRed', roofTint: [1, 1, 1], pitch: 21, hip: true, shutters: false, chimney: false });
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const tf = (x, y, z) => [b.x + c * x - s * z, y, b.z + s * x + c * z];
  const hw = b.w / 2, hd = b.d / 2;
  const { lo, hi } = groundStats(world, b);
  const kind = b.kind;
  const y0 = hi + (kind === 'shed' ? 0.12 : 0.28);        // floor level
  const yb = lo - 0.45;                                    // foundation bottom
  const levels = civic === 'school' ? 2 : (b.levels || 1);
  const WH = kind === 'industrial' ? 6.4 : kind === 'shed' ? 2.3 : kind === 'barn' ? 3.0 : kind === 'kiosk' ? 2.7 : 2.65 * levels;
  const yt = y0 + WH;
  const wallMat = st.wall || 'plaster';
  const uvw = UV[wallMat] || 2;
  const var1 = 0.94 + rng() * 0.12;
  const wallCol = wallMat === 'wood' ? mul([0.8, 0.7, 0.6], 0.8 + rng() * 0.4) : wallMat === 'brick' ? mul([1, 1, 1], var1) : mul(st.wallTint || [1, 1, 1], var1);
  const roofCol = mul(st.roofTint || [1, 1, 1], 0.92 + rng() * 0.16);
  const roofMat = st.roof || 'roofSlate';
  const ruv = UV[roofMat] || 1.6;
  const mid = tf(0, y0 + 1, 0);
  const W = S.get(b.x, b.z, wallMat);
  const plinthCol = st.plinth && kind === 'house' ? mul(st.plinth, 1 / (BOOST[wallMat] || 1)) : mulc([0.62, 0.6, 0.58], wallMat === 'brick' ? [1.2, 1.2, 1.2] : [1, 1, 1]);

  // ---- walls (plinth + upper part)
  const wallDefs = [
    { id: 'front', o: [0, hd], ax: [1, 0], n: [0, 1], len: b.w },
    { id: 'back', o: [0, -hd], ax: [1, 0], n: [0, -1], len: b.w },
    { id: 'right', o: [hw, 0], ax: [0, 1], n: [1, 0], len: b.d },
    { id: 'left', o: [-hw, 0], ax: [0, 1], n: [-1, 0], len: b.d },
  ];
  const wp = (w, a, y, off = 0) => tf(w.o[0] + w.ax[0] * a + w.n[0] * off, y, w.o[1] + w.ax[1] * a + w.n[1] * off);
  const yPl = y0 + (kind === 'shed' ? 0.2 : 0.55);
  for (const w of wallDefs) {
    const a0 = -w.len / 2, a1 = w.len / 2;
    W.quad(wp(w, a0, yb), wp(w, a1, yb), wp(w, a1, yPl), wp(w, a0, yPl), [[a0 / uvw, yb / uvw], [a1 / uvw, yb / uvw], [a1 / uvw, yPl / uvw], [a0 / uvw, yPl / uvw]], kind === 'shed' ? mul(wallCol, 0.8) : plinthCol, mid);
    W.quad(wp(w, a0, yPl), wp(w, a1, yPl), wp(w, a1, yt), wp(w, a0, yt), [[a0 / uvw, yPl / uvw], [a1 / uvw, yPl / uvw], [a1 / uvw, yt / uvw], [a0 / uvw, yt / uvw]], wallCol, mid);
  }

  // ---- roof
  const pitch = Math.tan(((st.pitch || 32) * Math.PI) / 180);
  const R = S.get(b.x, b.z, roofMat);
  const ov = kind === 'industrial' ? 0.5 : 0.5, gov = kind === 'shed' ? 0.25 : 0.4;
  let ridgeY = yt;
  if (kind === 'shed') {
    const hF = yt + 0.45, hB = yt + 0.05;
    const xx = hw + gov;
    const yAt = (z) => hB + ((hF - hB) * (z + hd + 0.3)) / (b.d + 0.6);
    for (const sx of [1, -1]) W.quad(tf(sx * hw, yt, -hd), tf(sx * hw, yt, hd), tf(sx * hw, yAt(hd), hd), tf(sx * hw, yAt(-hd), -hd), [[-hd / uvw, yt / uvw], [hd / uvw, yt / uvw], [hd / uvw, (yt + 0.3) / uvw], [-hd / uvw, (yt + 0.1) / uvw]], wallCol, mid);
    W.quad(tf(-hw, yt, -hd), tf(hw, yt, -hd), tf(hw, yAt(-hd), -hd), tf(-hw, yAt(-hd), -hd), [[0, yt / uvw], [b.w / uvw, yt / uvw], [b.w / uvw, (yt + 0.1) / uvw], [0, (yt + 0.1) / uvw]], wallCol, mid);
    W.quad(tf(-hw, yt, hd), tf(hw, yt, hd), tf(hw, yAt(hd), hd), tf(-hw, yAt(hd), hd), [[0, yt / uvw], [b.w / uvw, yt / uvw], [b.w / uvw, (yt + 0.3) / uvw], [0, (yt + 0.3) / uvw]], wallCol, mid);
    const A = tf(-xx, hF, hd + 0.3), B = tf(xx, hF, hd + 0.3), C = tf(xx, hB, -hd - 0.3), D = tf(-xx, hB, -hd - 0.3);
    const sl = Math.hypot(b.d + 0.6, hF - hB);
    R.quad(A, B, C, D, [[0, 0], [(2 * xx) / ruv, 0], [(2 * xx) / ruv, sl / ruv], [0, sl / ruv]], roofCol, tf(0, yt - 1, 0));
    // back wall top fill (wall is lower than roof on the back): extend wall quad up to roof
  } else {
    const hip = !!st.hip && kind !== 'industrial' && kind !== 'barn';
    ridgeY = yt + hd * pitch;
    const eaveY = yt - ov * pitch;
    const gx = hip ? ov : gov;
    const x0 = -hw - gx, x1 = hw + gx, zf = hd + ov;
    const slopeLen = Math.hypot(zf, ridgeY - eaveY);
    const inside = tf(0, yt - 0.5, 0);
    if (!hip) {
      R.quad(tf(x0, eaveY, zf), tf(x1, eaveY, zf), tf(x1, ridgeY, 0), tf(x0, ridgeY, 0), [[x0 / ruv, 0], [x1 / ruv, 0], [x1 / ruv, slopeLen / ruv], [x0 / ruv, slopeLen / ruv]], roofCol, inside);
      R.quad(tf(x1, eaveY, -zf), tf(x0, eaveY, -zf), tf(x0, ridgeY, 0), tf(x1, ridgeY, 0), [[x0 / ruv, 0], [x1 / ruv, 0], [x1 / ruv, slopeLen / ruv], [x0 / ruv, slopeLen / ruv]], roofCol, inside);
      // gable triangles on end walls
      for (const sx of [1, -1]) {
        W.tri(tf(sx * hw, yt, -hd), tf(sx * hw, yt, hd), tf(sx * hw, ridgeY, 0), [[-hd / uvw, yt / uvw], [hd / uvw, yt / uvw], [0, ridgeY / uvw]], wallCol, mid);
      }
    } else {
      const hr = Math.max(0.2, hw - hd);
      const rx0 = -hr, rx1 = hr;
      R.quad(tf(x0, eaveY, zf), tf(x1, eaveY, zf), tf(rx1, ridgeY, 0), tf(rx0, ridgeY, 0), [[x0 / ruv, 0], [x1 / ruv, 0], [rx1 / ruv, slopeLen / ruv], [rx0 / ruv, slopeLen / ruv]], roofCol, inside);
      R.quad(tf(x1, eaveY, -zf), tf(x0, eaveY, -zf), tf(rx0, ridgeY, 0), tf(rx1, ridgeY, 0), [[x0 / ruv, 0], [x1 / ruv, 0], [rx0 / ruv, slopeLen / ruv], [rx1 / ruv, slopeLen / ruv]], roofCol, inside);
      const sl2 = Math.hypot(x1 - rx1, ridgeY - eaveY);
      R.tri(tf(x1, eaveY, zf), tf(x1, eaveY, -zf), tf(rx1, ridgeY, 0), [[-zf / ruv, 0], [zf / ruv, 0], [0, sl2 / ruv]], roofCol, inside);
      R.tri(tf(x0, eaveY, -zf), tf(x0, eaveY, zf), tf(rx0, ridgeY, 0), [[-zf / ruv, 0], [zf / ruv, 0], [0, sl2 / ruv]], roofCol, inside);
      st._hr = hr;
    }
  }

  // ---- openings
  const Paint = S.get(b.x, b.z, 'paint');
  const Win = S.get(b.x, b.z, 'win'), WinL = S.get(b.x, b.z, 'winLit'), Wood = S.get(b.x, b.z, 'wood');
  const night = (kind === 'house' || kind === 'kiosk') ? 0.38 : 0.1;
  const addWin = (w, a, yc, ww = 1.05, wh = 1.35) => {
    const B = rng() < night ? WinL : Win;
    const off = 0.02;
    B.quad(wp(w, a - ww / 2, yc - wh / 2, off), wp(w, a + ww / 2, yc - wh / 2, off), wp(w, a + ww / 2, yc + wh / 2, off), wp(w, a - ww / 2, yc + wh / 2, off), [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], mid);
    if (st.trim && kind === 'house' && !civic) { // painted window surround (наличник)
      const t = 0.1, o2 = 0.012;
      Paint.quad(wp(w, a - ww / 2 - t, yc - wh / 2 - t, o2), wp(w, a + ww / 2 + t, yc - wh / 2 - t, o2), wp(w, a + ww / 2 + t, yc + wh / 2 + t + 0.04, o2), wp(w, a - ww / 2 - t, yc + wh / 2 + t + 0.04, o2), [[0, 0], [1, 0], [1, 1], [0, 1]], st.trim, mid);
    }
  };
  const shutterCol = mul(st.shutter || [0.3, 0.4, 0.5], 0.9 + rng() * 0.2);
  const addShutters = (w, a, yc, ww = 1.05, wh = 1.35) => {
    const sw = 0.42;
    for (const sg of [-1, 1]) {
      const ac = a + sg * (ww / 2 + sw / 2 + 0.02);
      Wood.quad(wp(w, ac - sw / 2, yc - wh / 2, 0.035), wp(w, ac + sw / 2, yc - wh / 2, 0.035), wp(w, ac + sw / 2, yc + wh / 2, 0.035), wp(w, ac - sw / 2, yc + wh / 2, 0.035), [[0, 0], [sw / 1.6, 0], [sw / 1.6, wh / 1.6], [0, wh / 1.6]], shutterCol, mid);
    }
  };
  const doorCol = mul(shutterCol, 0.8);
  let doorInfo = null;
  const doorA0 = b.door ? (b.door[0] - b.x) * c + (b.door[1] - b.z) * s : 0;
  const civicFront = (w) => {
    const half = w.len / 2, dA = clamp(doorA0, -half + (civic === 'school' ? 3.2 : 2.6), half - (civic === 'school' ? 3.2 : 2.6));
    doorInfo = { a: dA };
    const q = (B, a0, a1, y1, y2, off, col = [1, 1, 1], uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) => B.quad(wp(w, a0, y1, off), wp(w, a1, y1, off), wp(w, a1, y2, off), wp(w, a0, y2, off), uv, col, mid);
    const bx = (B, a0, a1, y1, y2, o0, o1, col) => B.box((x, y, z) => wp(w, x, y, z), a0, y1, o0, a1, y2, o1, 1.5, col);
    const step = (wd, d) => { const gh = world.heightAt(...(() => { const p = wp(w, dA, 0, d); return [p[0], p[2]]; })()); const by = Math.min(gh, y0 - 0.15) - 0.15;
      bx(S.get(b.x, b.z, 'plaster'), dA - wd / 2, dA + wd / 2, by, y0 + 0.02, 0.02, d, [0.62, 0.6, 0.58]); };
    if (civic === 'shop') {
      const dark = [0.18, 0.2, 0.24];
      // glass double door + storefront panes on both sides
      q(Win, dA - 0.8, dA + 0.8, y0, y0 + 2.1, 0.04); bx(Paint, dA - 0.86, dA - 0.8, y0, y0 + 2.15, 0.02, 0.07, dark); bx(Paint, dA + 0.8, dA + 0.86, y0, y0 + 2.15, 0.02, 0.07, dark); bx(Paint, dA - 0.86, dA + 0.86, y0 + 2.1, y0 + 2.17, 0.02, 0.07, dark);
      for (const [lo, hi] of [[-half + 0.45, dA - 1.15], [dA + 1.15, half - 0.45]]) {
        const n2 = Math.max(1, Math.round((hi - lo) / 1.7)), sp = (hi - lo) / n2;
        for (let k = 0; k < n2; k++) { const a0 = lo + sp * k + 0.04, a1 = lo + sp * (k + 1) - 0.04; q(rng() < 0.3 ? WinL : Win, a0, a1, y0 + 0.5, y0 + 2.0, 0.03); }
        bx(Paint, lo, hi, y0 + 0.2, y0 + 0.5, 0.0, 0.09, [0.4, 0.38, 0.36]);
      }
      // striped awning over the whole shopfront + sign band above it
      const aw = (a0, a1, col) => { const o = 1.15; Paint.quad(wp(w, a0, y0 + 2.5, 0.02), wp(w, a1, y0 + 2.5, 0.02), wp(w, a1, y0 + 2.12, o), wp(w, a0, y0 + 2.12, o), [[0, 0], [1, 0], [1, 1], [0, 1]], col, tf(0, y0 + 1, 0)); Paint.quad(wp(w, a0, y0 + 2.12, o), wp(w, a1, y0 + 2.12, o), wp(w, a1, y0 + 1.95, o), wp(w, a0, y0 + 1.95, o), [[0, 0], [1, 0], [1, 1], [0, 1]], col, tf(0, y0 + 1, 0.5)); };
      const aL = -half + 0.2, aR = half - 0.2, ns = Math.max(4, Math.round((aR - aL) / 0.55)); for (let k = 0; k < ns; k++) aw(aL + ((aR - aL) * k) / ns, aL + ((aR - aL) * (k + 1)) / ns, k % 2 ? [0.95, 0.94, 0.9] : [0.1, 0.45, 0.2]);
      const sg = S.get(b.x, b.z, 'sign:МАГАЗИН'); q(sg, dA - 1.9, dA + 1.9, yt - 0.12, yt + 0.55, 0.07);
      // crates & a bench at the entrance
      bx(Wood, dA + 1.5, dA + 2.3, y0, y0 + 0.5, 0.2, 0.8, [0.75, 0.55, 0.32]); bx(Wood, dA - 2.3, dA - 1.6, y0, y0 + 0.4, 0.3, 0.75, [0.7, 0.5, 0.3]);
      step(2.0, 0.9);
    } else {
      const white = [0.96, 0.95, 0.9], dark = [0.2, 0.2, 0.24];
      // windows on both floors (skipping the entrance column), 2.4 m grid
      const n2 = Math.max(2, Math.floor((w.len - 0.8) / 2.4)), sp = w.len / n2;
      for (let k = 0; k < n2; k++) {
        const a = -half + sp * (k + 0.5);
        for (let lv = 0; lv < 2; lv++) { if (Math.abs(a - dA) < 1.9) continue; addWin(w, a, y0 + lv * 2.65 + 1.55, 1.25, 1.55); bx(Paint, a - 0.7, a + 0.7, y0 + lv * 2.65 + 0.7, y0 + lv * 2.65 + 0.78, 0.0, 0.1, white); }
      }
      // portico with two columns, flat slab, double doors, steps; blue school plate on the upper wall
      q(Wood, dA - 0.95, dA + 0.95, y0, y0 + 2.3, 0.04, [0.3, 0.22, 0.16], [[0, 0], [1.2, 0], [1.2, 1.4], [0, 1.4]]);
      for (const sg2 of [-1, 1]) bx(Paint, dA + sg2 * 1.45 - 0.14, dA + sg2 * 1.45 + 0.14, y0, y0 + 3.0, 1.45, 1.73, white);
      bx(Paint, dA - 1.8, dA + 1.8, y0 + 3.0, y0 + 3.22, 0.0, 1.9, white);
      bx(Paint, dA - 1.8, dA + 1.8, y0 + 3.22, y0 + 3.32, 1.7, 1.9, [0.8, 0.2, 0.18]);
      step(3.0, 1.55); step(2.6, 1.15);
      const sg = S.get(b.x, b.z, 'sign:ШКОЛА'); q(sg, dA - 1.4, dA + 1.4, y0 + 3.55, y0 + 4.3, 0.07);
      // flag pole with a blue-yellow flag
      const fx = clamp(dA + 4.2, -half + 1.2, half - 1.2), fp = wp(w, fx, 0, 1.2), fgy = world.heightAt(fp[0], fp[2]);
      Paint.cylinder(fp[0], fgy - 0.2, fp[2], 0.06, 0.04, 8.2, 6, 2, [0.78, 0.78, 0.8], true);
      const Fl = S.get(b.x, b.z, 'flag'); const fy = fgy + 7.9;
      const fq = (a0, a1, y1, y2, col) => Fl.quad(wp(w, fx + a0, y1, 1.2 + 0.0), wp(w, fx + a1, y1, 1.2), wp(w, fx + a1, y2, 1.2), wp(w, fx + a0, y2, 1.2), [[0, 0], [1, 0], [1, 1], [0, 1]], col, null);
      fq(0.06, 1.35, fy - 0.45, fy, [0.1, 0.35, 0.8]); fq(0.06, 1.35, fy - 0.9, fy - 0.45, [1.0, 0.82, 0.1]);
    }
  };
  if (kind === 'house' || kind === 'kiosk') {
    for (const w of wallDefs) {
      const long = w.id === 'front' || w.id === 'back';
      const n = long ? Math.max(1, Math.floor((w.len - 0.6) / 2.7)) : (w.len >= 4.4 ? 1 : 0);
      if (civic && w.id === 'front') { civicFront(w); continue; }
      const spacing = w.len / n;
      const doorSlot = w.id === 'front' ? Math.floor(n / 2) : -1;
      for (let k = 0; k < n; k++) {
        const a = -w.len / 2 + spacing * (k + 0.5) + (n === 1 && w.id === 'front' ? -w.len * 0.18 : 0);
        for (let lv = 0; lv < levels; lv++) {
          const yc = y0 + lv * 2.65 + 1.6;
          if (w.id === 'front' && n >= 2 && k === doorSlot && lv === 0) continue;
          addWin(w, a, yc);
          if (st.shutters && long) addShutters(w, a, yc);
        }
      }
      if (w.id === 'front') {
        let a = n === 1 ? w.len * 0.18 : -w.len / 2 + spacing * (doorSlot + 0.5);
        if (kind === 'kiosk') a = 0;
        doorInfo = { a };
        // door leaf
        Wood.quad(wp(w, a - 0.5, y0, 0.03), wp(w, a + 0.5, y0, 0.03), wp(w, a + 0.5, y0 + 2.05, 0.03), wp(w, a - 0.5, y0 + 2.05, 0.03), [[0, 0], [0.62, 0], [0.62, 1.28], [0, 1.28]], doorCol, mid);
        // step
        const gh = world.heightAt(...(() => { const p = wp(w, a, 0, 0.8); return [p[0], p[2]]; })());
        const topY = y0 + 0.02;
        const bw = 1.7, bd = 0.95, by = Math.min(gh, y0 - 0.15) - 0.15;
        const tfs = (x, y, z) => wp(w, a + x, y, z);
        S.get(b.x, b.z, 'wood'); // ensure builder exists
        S.get(b.x, b.z, 'plaster').box((x, y, z) => tfs(x, y, z - 0.0 + 0), -bw / 2, by, 0.02, bw / 2, topY, bd, 2, [0.62, 0.6, 0.58]);
        const porch = kind === 'house' && !civic ? st.porch : 'canopy';
        if (porch === 'veranda') { // glazed enclosed porch (веранда) with a lean-to roof
          const vw = 2.6, vd = 1.7, vh = 2.4, pc = [Math.min(1, wallCol[0] * 1.3), Math.min(1, wallCol[1] * 1.3), Math.min(1, wallCol[2] * 1.3)];
          const trimC = st.trim || [0.95, 0.95, 0.95];
          const T = (x, y, z) => tfs(x, y, z), inP = T(0, y0 + 1.2, vd / 2);
          Paint.box(T, -vw / 2, y0 - 0.1, vd - 0.1, -0.5, y0 + 0.85, vd, 1.5, pc); Paint.box(T, 0.5, y0 - 0.1, vd - 0.1, vw / 2, y0 + 0.85, vd, 1.5, pc);       // knee walls (front, door gap in the middle)
          Paint.box(T, -vw / 2, y0 - 0.1, 0.0, -vw / 2 + 0.1, y0 + 0.85, vd, 1.5, pc); Paint.box(T, vw / 2 - 0.1, y0 - 0.1, 0.0, vw / 2, y0 + 0.85, vd, 1.5, pc);
          for (const sx of [-vw / 2, -0.5, 0.5, vw / 2 - 0.08]) Paint.box(T, sx, y0 + 0.85, vd - 0.08, sx + 0.08, y0 + vh, vd, 1.5, trimC);
          Paint.box(T, -vw / 2, y0 + vh - 0.1, vd - 0.08, vw / 2, y0 + vh, vd, 1.5, trimC);
          for (const sg of [-1, 1]) { const x = sg * (vw / 2 - 0.12); Win.quad(T(x, y0 + 0.85, 0.05), T(x, y0 + 0.85, vd - 0.1), T(x, y0 + vh - 0.1, vd - 0.1), T(x, y0 + vh - 0.1, 0.05), [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], inP); }
          for (const [x0, x1] of [[-vw / 2 + 0.08, -0.5], [0.5, vw / 2 - 0.08]]) Win.quad(T(x0, y0 + 0.85, vd - 0.02), T(x1, y0 + 0.85, vd - 0.02), T(x1, y0 + vh - 0.1, vd - 0.02), T(x0, y0 + vh - 0.1, vd - 0.02), [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], inP);
          R.quad(T(-vw / 2 - 0.15, y0 + vh + 0.25, -0.05), T(vw / 2 + 0.15, y0 + vh + 0.25, -0.05), T(vw / 2 + 0.15, y0 + vh - 0.05, vd + 0.2), T(-vw / 2 - 0.15, y0 + vh - 0.05, vd + 0.2), [[0, 0], [vw / ruv, 0], [vw / ruv, vd / ruv], [0, vd / ruv]], roofCol, tf(0, y0 + 1, 0));
        } else {
          // canopy over the door (columns = wider porch with painted posts)
          const big = porch === 'columns';
          const cw = big ? 3.1 : 2.1, cdp = big ? 1.9 : 1.35;
          R.quad(wp(w, a - cw / 2, y0 + 2.7, 0.0), wp(w, a + cw / 2, y0 + 2.7, 0.0), wp(w, a + cw / 2, y0 + 2.35, cdp), wp(w, a - cw / 2, y0 + 2.35, cdp), [[0, 0], [cw / ruv, 0], [cw / ruv, cdp / ruv], [0, cdp / ruv]], roofCol, tf(0, y0 + 1, 0));
          const postCol = big ? (st.trim || [0.95, 0.95, 0.95]) : mul(shutterCol, 1.0), pw2 = big ? 0.08 : 0.05;
          for (const sg of [-1, 1]) Wood.box((x, y, z) => tfs(x, y, z), sg * (cw / 2 - 0.12) - pw2, y0, cdp - 0.15, sg * (cw / 2 - 0.12) + pw2, y0 + 2.4, cdp - 0.15 + pw2 * 2, 1.6, postCol);
          if (big) { const T = (x, y, z) => tfs(x, y, z); S.get(b.x, b.z, 'plaster').box(T, -cw / 2, y0 - 0.1, 0.0, cw / 2, y0 + 0.12, cdp + 0.1, 2, [0.6, 0.58, 0.56]); }
        }
      }
    }
    // attic windows in gables
    if (!st.hip && ridgeY - yt > 1.3 && kind === 'house') for (const w of [wallDefs[2], wallDefs[3]]) addWin(w, 0, yt + (ridgeY - yt) * 0.38, 0.6, 0.75);
  } else if (kind === 'industrial') {
    for (const w of [wallDefs[0], wallDefs[1]]) {
      const n = Math.max(2, Math.floor(w.len / 6));
      for (let k = 0; k < n; k++) addWin(w, -w.len / 2 + (w.len / n) * (k + 0.5), y0 + 4.4, 1.6, 0.9);
    }
    for (const sg of [-1, 1]) { // big roller doors
      const w = wallDefs[0], a = sg * Math.min(w.len * 0.25, 7);
      Wood.quad(wp(w, a - 2.2, y0, 0.05), wp(w, a + 2.2, y0, 0.05), wp(w, a + 2.2, y0 + 4.0, 0.05), wp(w, a - 2.2, y0 + 4.0, 0.05), [[0, 0], [2.6, 0], [2.6, 2.4], [0, 2.4]], [0.35, 0.4, 0.45], mid);
    }
  } else if (kind === 'barn') {
    const w = wallDefs[0];
    Wood.quad(wp(w, -1.3, y0, 0.05), wp(w, 1.3, y0, 0.05), wp(w, 1.3, y0 + 2.4, 0.05), wp(w, -1.3, y0 + 2.4, 0.05), [[0, 0], [1.6, 0], [1.6, 1.5], [0, 1.5]], mul(shutterCol, 0.7), mid);
  } else if (kind === 'shed') {
    const w = wallDefs[0];
    Wood.quad(wp(w, -0.5, y0, 0.04), wp(w, 0.5, y0, 0.04), wp(w, 0.5, y0 + 1.9, 0.04), wp(w, -0.5, y0 + 1.9, 0.04), [[0, 0], [0.6, 0], [0.6, 1.2], [0, 1.2]], mul(shutterCol, 0.75), mid);
  }
  if (kind === 'kiosk' && b.name) { // shop sign above door
    const sg = S.get(b.x, b.z, 'sign:' + b.name);
    const w = wallDefs[0];
    sg.quad(wp(w, -1.8, yt - 0.7, 0.06), wp(w, 1.8, yt - 0.7, 0.06), wp(w, 1.8, yt + 0.35, 0.06), wp(w, -1.8, yt + 0.35, 0.06), [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], mid);
  }

  // ---- chimney
  if ((kind === 'house') && st.chimney) {
    let cxl = (rng() - 0.5) * b.w * 0.55;
    if (st.hip && st._hr !== undefined) cxl = clamp(cxl, -st._hr + 0.2, st._hr - 0.2);
    const czl = (rng() < 0.5 ? -1 : 1) * 0.35;
    const top = ridgeY + 0.85;
    b.chimneyPos = tf(cxl, top + 0.2, czl);
    const Br = S.get(b.x, b.z, 'brick');
    Br.box(tf, cxl - 0.32, yt - 0.2, czl - 0.32, cxl + 0.32, top, czl + 0.32, 1.2, [0.85, 0.62, 0.52], true);
    Br.box(tf, cxl - 0.4, top, czl - 0.4, cxl + 0.4, top + 0.14, czl + 0.4, 1.2, [0.45, 0.45, 0.47], true);
  }
  if (kind === 'house' && !civic && st.annex) { // side annex (прибудова): lean-to with its own window
    const sg = st.annex > 0 ? 1 : -1, aw = 2.4 + (st.seed % 7) * 0.12, ad = Math.min(3.6, b.d * 0.75), zc = -(b.d / 2 - ad / 2) * 0.35;
    const x0 = sg * hw, x1 = sg * (hw + aw), hA = y0 + 2.1, hT = y0 + 2.45, z0 = zc - ad / 2, z1 = zc + ad / 2, ins = tf(sg * (hw + aw / 2), y0 + 1, zc);
    const uvq = (a, bq, y1, y2) => [[a / uvw, y1 / uvw], [bq / uvw, y1 / uvw], [bq / uvw, y2 / uvw], [a / uvw, y2 / uvw]];
    W.quad(tf(x1, yb, z0), tf(x1, yb, z1), tf(x1, hA, z1), tf(x1, hA, z0), uvq(z0, z1, yb, hA), wallCol, ins);
    for (const zz of [z0, z1]) W.quad(tf(x0, yb, zz), tf(x1, yb, zz), tf(x1, hA, zz), tf(x0, hT, zz), uvq(Math.min(x0, x1), Math.max(x0, x1), yb, hT), wallCol, ins);
    const rq = [tf(x0, hT + 0.03, z0 - 0.2), tf(x0, hT + 0.03, z1 + 0.2), tf(sg * (hw + aw + 0.25), hA + 0.06, z1 + 0.2), tf(sg * (hw + aw + 0.25), hA + 0.06, z0 - 0.2)];
    R.quad(rq[0], rq[1], rq[2], rq[3], [[0, 0], [ad / ruv, 0], [ad / ruv, aw / ruv], [0, aw / ruv]], roofCol, ins);
    const xw = sg * (hw + aw + 0.02);
    Win.quad(tf(xw, y0 + 0.85, zc - 0.55), tf(xw, y0 + 0.85, zc + 0.55), tf(xw, y0 + 1.85, zc + 0.55), tf(xw, y0 + 1.85, zc - 0.55), [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], ins);
  }
  if (kind === 'industrial') { // roof vent boxes
    S.get(b.x, b.z, 'roofSlate').box(tf, -2, ridgeY - 0.1, -0.8, 2, ridgeY + 0.5, 0.8, 1.5, [0.5, 0.52, 0.55]);
  }
  return { y0, doorInfo };
}

export function addWell(S, world, wx, wz) {
  const h = world.heightAt(wx, wz);
  const P = S.get(wx, wz, 'plaster'), Wd = S.get(wx, wz, 'wood'), Rf = S.get(wx, wz, 'roofRed');
  P.cylinder(wx, h - 0.1, wz, 0.62, 0.62, 0.95, 14, 1.4, [0.7, 0.68, 0.64], true, [0.05, 0.07, 0.09]);
  const id = (x, y, z) => [wx + x, y, wz + z];
  for (const sx of [-0.55, 0.55]) Wd.box(id, sx - 0.05, h, -0.05, sx + 0.05, h + 2.1, 0.05, 1.6, [0.6, 0.45, 0.32]);
  Wd.box(id, -0.55, h + 1.3, -0.04, 0.55, h + 1.38, 0.04, 1.6, [0.6, 0.45, 0.32]); // crossbar
  const rc = [0.75, 0.45, 0.35];
  Rf.quad(id(-0.85, h + 2.1, 0.0), id(0.85, h + 2.1, 0.0), id(0.85, h + 1.65, 0.8), id(-0.85, h + 1.65, 0.8), [[0, 0], [1, 0], [1, 0.7], [0, 0.7]], rc, id(0, h + 1.5, 0));
  Rf.quad(id(0.85, h + 2.1, 0.0), id(-0.85, h + 2.1, 0.0), id(-0.85, h + 1.65, -0.8), id(0.85, h + 1.65, -0.8), [[0, 0], [1, 0], [1, 0.7], [0, 0.7]], rc, id(0, h + 1.5, 0));
}

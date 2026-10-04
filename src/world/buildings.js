// Building generator: oriented-rectangle houses with plinth, plastered/brick walls, pitched gable/hip roofs (tile/slate),
// windows (some lit at night), shutters, doors, porch canopies, chimneys; sheds, barns, warehouses, kiosks.
// All geometry is merged per (200 m chunk, material) so frustum culling works and draw calls stay low.
import * as THREE from 'three';
import { GeoBuilder } from './geo.js';
import { mulberry32, clamp } from '../util.js';
import { makeWindowTextures, makeSignTexture } from './procedural.js';

const UV = { plaster: 2.2, brick: 1.5, wood: 1.6, roofSlate: 1.7, roofClay: 1.4, roofRed: 1.5 };
const CHUNK = 200;
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
        material = extraMats[mat] = new THREE.MeshStandardMaterial({ map: makeSignTexture([{ text: mat.slice(5), size: mat.length > 16 ? 56 : 72 }], '#d92b2b', '#ffffff', true, 512, 128), roughness: 0.5 });
      }
      const m = new THREE.Mesh(gb.build(), material);
      m.castShadow = !mat.startsWith('win') && mat !== 'sign'; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      group.add(m); count.tris += gb.i.length / 3; count.meshes++;
    }
    void opts; return count;
  }
}

export function makeExtraMaterials() {
  const w = makeWindowTextures();
  const win = new THREE.MeshStandardMaterial({ map: w.map, roughness: 0.18, metalness: 0.0, envMapIntensity: 1.6 });
  const winLit = new THREE.MeshStandardMaterial({ map: w.map, emissiveMap: w.emissive, emissive: new THREE.Color(1, 0.8, 0.5), emissiveIntensity: 0, roughness: 0.25, metalness: 0 });
  return { win, winLit, _w: w };
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
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const tf = (x, y, z) => [b.x + c * x - s * z, y, b.z + s * x + c * z];
  const hw = b.w / 2, hd = b.d / 2;
  const { lo, hi } = groundStats(world, b);
  const kind = b.kind;
  const y0 = hi + (kind === 'shed' ? 0.12 : 0.28);        // floor level
  const yb = lo - 0.45;                                    // foundation bottom
  const levels = b.levels || 1;
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
  const plinthCol = mulc([0.62, 0.6, 0.58], wallMat === 'brick' ? [1.2, 1.2, 1.2] : [1, 1, 1]);

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
  const Win = S.get(b.x, b.z, 'win'), WinL = S.get(b.x, b.z, 'winLit'), Wood = S.get(b.x, b.z, 'wood');
  const night = (kind === 'house' || kind === 'kiosk') ? 0.38 : 0.1;
  const addWin = (w, a, yc, ww = 1.05, wh = 1.35) => {
    const B = rng() < night ? WinL : Win;
    const off = 0.02;
    B.quad(wp(w, a - ww / 2, yc - wh / 2, off), wp(w, a + ww / 2, yc - wh / 2, off), wp(w, a + ww / 2, yc + wh / 2, off), wp(w, a - ww / 2, yc + wh / 2, off), [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], mid);
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
  if (kind === 'house' || kind === 'kiosk') {
    for (const w of wallDefs) {
      const long = w.id === 'front' || w.id === 'back';
      const n = long ? Math.max(1, Math.floor((w.len - 0.6) / 2.7)) : (w.len >= 4.4 ? 1 : 0);
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
        // canopy over the door
        const cw = 2.1, cdp = 1.35;
        R.quad(wp(w, a - cw / 2, y0 + 2.7, 0.0), wp(w, a + cw / 2, y0 + 2.7, 0.0), wp(w, a + cw / 2, y0 + 2.35, cdp), wp(w, a - cw / 2, y0 + 2.35, cdp), [[0, 0], [cw / ruv, 0], [cw / ruv, cdp / ruv], [0, cdp / ruv]], roofCol, tf(0, y0 + 2.5, 0));
        for (const sg of [-1, 1]) Wood.box((x, y, z) => tfs(x, y, z), sg * (cw / 2 - 0.12) - 0.05, y0, cdp - 0.15, sg * (cw / 2 - 0.12) + 0.05, y0 + 2.4, cdp - 0.05, 1.6, mul(shutterCol, 1.0));
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
    const Br = S.get(b.x, b.z, 'brick');
    Br.box(tf, cxl - 0.32, yt - 0.2, czl - 0.32, cxl + 0.32, top, czl + 0.32, 1.2, [0.85, 0.62, 0.52], true);
    Br.box(tf, cxl - 0.4, top, czl - 0.4, cxl + 0.4, top + 0.14, czl + 0.4, 1.2, [0.45, 0.45, 0.47], true);
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

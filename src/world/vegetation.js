// Vegetation: instanced trees (alpha-tested leaf-card crowns, 2 LODs, chunked for culling) and a streamed, wind-animated
// instanced grass / crop field around the player.
import * as THREE from 'three';
import { GeoBuilder } from './geo.js';
import { mulberry32, pointInPoly, polyBounds, distPointSeg, clamp, smoothstep, noise2 } from '../util.js';
import { makeTreeAtlas, makeTuftTexture, ATLAS } from './procedural.js';
import { M_FOREST, M_WATER, M_BUILD, M_ORCHARD, M_YARD, M_FIELD } from './splat.js';

const INSET = 0.012;
// double-sided foliage: keep the (smooth, outward) normal on back faces instead of flipping it
const noFlip = (fs) => fs.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
const slotUV = (slot, u, v) => [slot[0] + INSET + u * (0.5 - 2 * INSET), slot[1] + INSET + v * (0.5 - 2 * INSET)];

function leafCard(gb, rng, center, size, crownCenter, shadeLo, shadeHi, tint, slot = ATLAS.leaf, flat = 0) {
  // random orientation
  let nx = rng() * 2 - 1, ny = (rng() * 2 - 1) * (1 - flat), nz = rng() * 2 - 1;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  let tx = -nz, ty = 0, tz = nx; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  const hs = size / 2, ps = [];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) ps.push([center[0] + (tx * a + bx * b) * hs, center[1] + (ty * a + by * b) * hs, center[2] + (tz * a + bz * b) * hs]);
  // smooth normal = direction from crown centre (soft volumetric shading)
  let dx = center[0] - crownCenter[0], dy = center[1] - crownCenter[1], dz = center[2] - crownCenter[2];
  const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
  const up = clamp((dy * 0.5 + 0.5), 0, 1);
  const k = shadeLo + (shadeHi - shadeLo) * (up * 0.7 + clamp(dl / 3, 0, 1) * 0.3);
  const col = [tint[0] * k, tint[1] * k, tint[2] * k];
  gb.quadN(ps, [slotUV(slot, 0, 0), slotUV(slot, 1, 0), slotUV(slot, 1, 1), slotUV(slot, 0, 1)], [dx * 0.8, dy * 0.8 + 0.5, dz * 0.8], col);
}
function trunk(gb, x, z, h, r0, r1, seg, slot, col, lean = [0, 0]) {
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const P = (a, r, y, t) => [x + Math.cos(a) * r + lean[0] * t, y, z + Math.sin(a) * r + lean[1] * t];
    const p0 = P(a0, r0, 0, 0), p1 = P(a1, r0, 0, 0), p2 = P(a1, r1, h, 1), p3 = P(a0, r1, h, 1);
    const am = (a0 + a1) / 2; const n = [Math.cos(am), 0.1, Math.sin(am)];
    gb.quadN([p0, p1, p2, p3], [slotUV(slot, k / seg, 0), slotUV(slot, (k + 1) / seg, 0), slotUV(slot, (k + 1) / seg, 1), slotUV(slot, k / seg, 1)], n, col);
  }
}

// Species builders. `lod` 0 = full, 1 = reduced
const SPECIES = {
  oak(lod) {
    const gb = new GeoBuilder(), rng = mulberry32(1);
    trunk(gb, 0, 0, 4.3, 0.3, 0.14, lod ? 5 : 7, ATLAS.bark, [0.8, 0.75, 0.7]);
    const blobs = [[0, 6.4, 0, 3.0], [1.9, 5.5, 1.2, 2.2], [-1.8, 5.7, 1.4, 2.2], [0.8, 5.4, -2.0, 2.2], [-1.0, 7.6, -0.5, 2.0]];
    const per = lod ? 3 : 10;
    for (const [bx, by, bz, r] of blobs) for (let i = 0; i < per; i++) {
      const a = rng() * Math.PI * 2, e = Math.acos(rng() * 2 - 1), rr = r * (0.45 + rng() * 0.6);
      const c = [bx + Math.sin(e) * Math.cos(a) * rr, by + Math.cos(e) * rr * 0.8, bz + Math.sin(e) * Math.sin(a) * rr];
      leafCard(gb, rng, c, (lod ? 3.7 : 2.6) + rng() * 0.8, [0, 6, 0], 0.5, 1.15, [1, 1, 1]);
    }
    return gb;
  },
  birch(lod) {
    const gb = new GeoBuilder(), rng = mulberry32(2);
    trunk(gb, 0, 0, 8.5, 0.14, 0.06, lod ? 4 : 6, ATLAS.birch, [1, 1, 1], [0.25, 0.1]);
    const n = lod ? 7 : 26;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, y = 4.8 + rng() * 5.2, rr = (1.0 + Math.sin(((y - 4.8) / 5.2) * Math.PI) * 1.3) * (0.4 + rng() * 0.7);
      leafCard(gb, rng, [Math.cos(a) * rr + 0.2, y, Math.sin(a) * rr + 0.1], (lod ? 2.4 : 1.7) + rng() * 0.5, [0.2, 7.5, 0.1], 0.6, 1.25, [1.12, 1.15, 0.8]);
    }
    return gb;
  },
  pine(lod) {
    const gb = new GeoBuilder(), rng = mulberry32(3);
    trunk(gb, 0, 0, 15, 0.26, 0.08, lod ? 4 : 6, ATLAS.bark, [0.65, 0.55, 0.5]);
    const tiers = lod ? 4 : 8, spokes = lod ? 4 : 6;
    for (let t = 0; t < tiers; t++) {
      const f = t / (tiers - 1), y = 2.8 + f * 11.5, R = 3.4 * (1 - f * 0.78) + 0.4, drop = 1.9 * (1 - f * 0.4);
      for (let s = 0; s < spokes; s++) {
        const a = ((s + (t % 2) * 0.5) / spokes) * Math.PI * 2 + rng() * 0.3, da = (Math.PI / spokes) * 1.15;
        const P = (aa, r, yy) => [Math.cos(aa) * r, yy, Math.sin(aa) * r];
        const sh = 0.62 + f * 0.45;
        const am = a; gb.quadN([P(a - da * 0.25, 0.15, y + 0.5), P(a - da, R, y - drop), P(a + da, R, y - drop), P(a + da * 0.25, 0.15, y + 0.5)],
          [slotUV(ATLAS.needle, 0.3, 1), slotUV(ATLAS.needle, 0, 0), slotUV(ATLAS.needle, 1, 0), slotUV(ATLAS.needle, 0.7, 1)], [Math.cos(am) * 0.6, 0.7, Math.sin(am) * 0.6], [sh, sh, sh * 0.95]);
      }
    }
    return gb;
  },
  apple(lod) {
    const gb = new GeoBuilder(), rng = mulberry32(4);
    trunk(gb, 0, 0, 2.0, 0.17, 0.09, lod ? 4 : 6, ATLAS.bark, [0.8, 0.75, 0.7]);
    const n = lod ? 5 : 18;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, e = Math.acos(rng() * 2 - 1), rr = 1.9 * (0.5 + rng() * 0.55);
      leafCard(gb, rng, [Math.sin(e) * Math.cos(a) * rr, 3.2 + Math.cos(e) * rr * 0.65, Math.sin(e) * Math.sin(a) * rr], (lod ? 2.2 : 1.5) + rng() * 0.4, [0, 3.1, 0], 0.55, 1.2, [1.1, 1.12, 0.95]);
    }
    return gb;
  },
  bush(lod) {
    const gb = new GeoBuilder(), rng = mulberry32(5);
    const n = lod ? 4 : 12;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, e = Math.acos(rng() * 1.6 - 0.6), rr = 0.75 * (0.5 + rng() * 0.6);
      leafCard(gb, rng, [Math.sin(e) * Math.cos(a) * rr, 0.6 + Math.cos(e) * rr * 0.8, Math.sin(e) * Math.sin(a) * rr], 1.1 + rng() * 0.3, [0, 0.6, 0], 0.5, 1.1, [1, 1.05, 0.9]);
    }
    return gb;
  },
};
const TRUNK_R = { oak: 0.4, birch: 0.25, pine: 0.35, apple: 0.3, bush: 0 };

export class Trees {
  constructor(scene, quality) {
    this.group = new THREE.Group(); this.group.name = 'trees'; scene.add(this.group);
    const atlas = makeTreeAtlas();
    this.mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true, roughness: 0.92, metalness: 0, alphaToCoverage: true });
    this.mat.onBeforeCompile = (sh) => { sh.fragmentShader = noFlip(sh.fragmentShader); };
    this.geo = {};
    for (const k of Object.keys(SPECIES)) this.geo[k] = [SPECIES[k](0).build(), SPECIES[k](1).build()];
    this.chunks = []; this.count = 0; this.quality = quality;
  }
  // list: [{x,z,sp,s}]
  build(world, list, rasters) {
    const CS = 140, groups = new Map();
    const rng = mulberry32(2024);
    for (const t of list) {
      const key = `${Math.floor(t.x / CS)},${Math.floor(t.z / CS)}|${t.sp}`;
      let g = groups.get(key); if (!g) { g = []; groups.set(key, g); }
      g.push(t);
      if (TRUNK_R[t.sp] && rasters && Math.abs(t.x) < 520 && Math.abs(t.z) < 520) rasters.blockCircle(t.x, t.z, TRUNK_R[t.sp] * Math.min(1.2, t.s));
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    for (const [key, arr] of groups) {
      const sp = key.split('|')[1];
      const meshes = [0, 1].map((lod) => {
        const im = new THREE.InstancedMesh(this.geo[sp][lod], this.mat, arr.length);
        im.castShadow = lod === 0; im.receiveShadow = true; im.frustumCulled = true; im.matrixAutoUpdate = false;
        im.visible = lod === 0; return im;
      });
      let cx = 0, cz = 0;
      arr.forEach((t, i) => {
        const y = world.heightAt(t.x, t.z) - 0.1;
        q.setFromEuler(e.set((rng() - 0.5) * 0.06, rng() * Math.PI * 2, (rng() - 0.5) * 0.06));
        const s = t.s * (0.9 + rng() * 0.25); sc.set(s * (0.92 + rng() * 0.16), s, s * (0.92 + rng() * 0.16)); p.set(t.x, y, t.z);
        m4.compose(p, q, sc);
        const hsl = 0.9 + rng() * 0.2; col.setRGB(hsl * (0.95 + rng() * 0.1), hsl, hsl * (0.9 + rng() * 0.2));
        for (const im of meshes) { im.setMatrixAt(i, m4); im.setColorAt(i, col); }
        cx += t.x; cz += t.z;
      });
      for (const im of meshes) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); this.group.add(im); }
      this.chunks.push({ cx: cx / arr.length, cz: cz / arr.length, near: meshes[0], far: meshes[1], n: arr.length });
      this.count += arr.length;
    }
  }
  update(px, pz, treeDist, shadows) {
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - px, c.cz - pz);
      const vis = d < treeDist + 150;
      const near = d < 230;
      c.near.visible = vis && near; c.far.visible = vis && !near;
      c.near.castShadow = shadows && d < 140;
    }
  }
}

// ---------- tree placement from OSM land use + layout ----------
export function planTrees(world, layout, rasters) {
  const J = world.json, rng = mulberry32(555);
  const out = [...layout.trees];
  const free = (x, z) => {
    const m = rasters.maskAt(x, z);
    if (m & (M_WATER | M_BUILD | M_YARD)) return false;
    if (rasters.splatAt(x, z, 0) + rasters.splatAt(x, z, 1) * 1 + rasters.splatAt(x, z, 2) > 0.55 && !(m & M_FOREST)) return false;
    if (rasters.splatAt(x, z, 2) > 0.1 || rasters.splatAt(x, z, 1) > 0.5) return false;
    return true;
  };
  const LIM = 690;
  const inBounds = (x, z) => Math.abs(x) < LIM && Math.abs(z) < LIM;
  // forests
  const forestSp = () => { const r = rng(); return r < 0.34 ? 'oak' : r < 0.58 ? 'birch' : 'pine'; };
  for (const a of J.areas) {
    if (a.pts.length < 3) continue;
    const bb = polyBounds(a.pts);
    if (a.kind === 'wood' || a.kind === 'forest') {
      const step = 6.8;
      for (let x = bb.x0; x < bb.x1; x += step) for (let z = bb.z0; z < bb.z1; z += step) {
        const px = x + (rng() - 0.5) * step * 0.9, pz = z + (rng() - 0.5) * step * 0.9;
        if (!inBounds(px, pz) || !pointInPoly(px, pz, a.pts) || !free(px, pz)) continue;
        out.push({ x: px, z: pz, sp: forestSp(), s: 0.85 + rng() * 0.55 });
        if (rng() < 0.28) out.push({ x: px + 2 + rng() * 2, z: pz + (rng() - 0.5) * 4, sp: 'bush', s: 0.8 + rng() * 0.8 });
      }
    } else if (a.kind === 'orchard') {
      const step = 10;
      for (let x = bb.x0; x < bb.x1; x += step) for (let z = bb.z0; z < bb.z1; z += step) {
        const px = x + (rng() - 0.5) * 1.2, pz = z + (rng() - 0.5) * 1.2;
        if (!inBounds(px, pz) || !pointInPoly(px, pz, a.pts) || !free(px, pz)) continue;
        out.push({ x: px, z: pz, sp: 'apple', s: 0.9 + rng() * 0.3 });
      }
    } else if (a.kind === 'scrub' || a.kind === 'wetland') {
      for (let x = bb.x0; x < bb.x1; x += 9) for (let z = bb.z0; z < bb.z1; z += 9) {
        const px = x + rng() * 6, pz = z + rng() * 6;
        if (inBounds(px, pz) && pointInPoly(px, pz, a.pts) && free(px, pz) && rng() < 0.5) out.push({ x: px, z: pz, sp: 'bush', s: 0.9 + rng() * 0.9 });
      }
    }
  }
  // tree belts along main roads
  for (const r of J.roads) {
    if (r.kind !== 'trunk' && r.kind !== 'tertiary' && r.kind !== 'residential' && r.kind !== 'unclassified') continue;
    const dense = r.kind === 'trunk';
    let acc = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      for (let t = acc; t < L; t += dense ? 8 + rng() * 8 : 16 + rng() * 14) {
        for (const side of [1, -1]) {
          if (!dense && rng() < 0.6) continue;
          const off = (r.w / 2 + (dense ? 6 : 3.2)) * side + (rng() - 0.5) * 2;
          const px = ax + dx * t - dz * off, pz = az + dz * t + dx * off;
          if (!inBounds(px, pz) || rasters.maskAt(px, pz) & (M_WATER | M_BUILD)) continue;
          if (rasters.splatAt(px, pz, 2) > 0.1 || rasters.splatAt(px, pz, 1) > 0.4) continue;
          out.push({ x: px, z: pz, sp: dense ? (rng() < 0.45 ? 'pine' : rng() < 0.5 ? 'oak' : 'birch') : (rng() < 0.5 ? 'birch' : 'oak'), s: 0.85 + rng() * 0.45 });
        }
        acc = t + 1 - L;
      }
      acc = Math.max(0, acc);
    }
  }
  // scattered meadow trees / shrubs + boundary forest ring
  for (let x = -LIM; x < LIM; x += 20) for (let z = -LIM; z < LIM; z += 20) {
    const px = x + rng() * 20, pz = z + rng() * 20;
    if (!free(px, pz)) continue;
    const edge = Math.max(Math.abs(px), Math.abs(pz));
    const m = rasters.maskAt(px, pz);
    if (m & (M_FOREST | M_ORCHARD)) continue;
    const ring = edge > 480;
    const p = ring ? 0.9 : (m & M_FIELD) ? 0.01 : 0.1;
    if (rng() < p) out.push({ x: px, z: pz, sp: rng() < 0.2 ? 'bush' : forestSp(), s: 0.8 + rng() * 0.6 });
    if (ring && rng() < 0.5) out.push({ x: px + 5, z: pz + 6, sp: forestSp(), s: 0.9 + rng() * 0.6 });
  }
  return out;
}

// ---------- Grass / crops streamed around the player ----------
export class Grass {
  constructor(scene, world, rasters) {
    this.world = world; this.rasters = rasters; this.group = new THREE.Group(); this.group.name = 'grass'; scene.add(this.group);
    const tex = makeTuftTexture();
    this.uniforms = { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() }, uFadeA: { value: 30 }, uFadeB: { value: 48 } };
    this.mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, alphaToCoverage: true });
    const U = this.uniforms;
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uPlayer; uniform float uFadeA; uniform float uFadeB;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          float hh = uv.y;
          float sw = sin(uTime * 1.7 + ip.x * 0.31 + ip.z * 0.23) * 0.11 + sin(uTime * 3.1 + ip.z * 0.9 + ip.x * 0.4) * 0.04;
          transformed.x += sw * hh * hh; transformed.z += sw * 0.55 * hh * hh;
          float dd = length(ip.xz - uPlayer.xz);
          float f = 1.0 - smoothstep(uFadeA, uFadeB, dd);
          transformed *= f;
        }`);
      sh.fragmentShader = noFlip(sh.fragmentShader);
    };
    // tuft: two crossed quads
    const gb = new GeoBuilder();
    const W = 0.75, H = 0.6;
    for (const a of [0, Math.PI / 2 + 0.3]) {
      const c = Math.cos(a) * W / 2, s = Math.sin(a) * W / 2;
      gb.quadN([[-c, 0, -s], [c, 0, s], [c, H, s], [-c, H, -s]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0], [1, 1, 1]);
    }
    this.geo = gb.build(); this.geo.deleteAttribute('color');
    this.CS = 16; this.chunks = new Map(); this.pool = []; this.density = 4.5; this.radius = 50; this.shadows = true;
    this.enabled = true;
  }
  setQuality(q) { this.radius = q.grassR; this.density = q.grassDensity; this.uniforms.uFadeA.value = q.grassR * 0.62; this.uniforms.uFadeB.value = q.grassR * 0.97; this.cap = Math.ceil(this.CS * this.CS * this.density); this.clear(); }
  clear() { for (const [, c] of this.chunks) { this.group.remove(c); this.pool.push(c); } this.chunks.clear(); }
  _fill(mesh, ci, cj) {
    const { world, rasters, CS } = this;
    const rng = mulberry32((ci * 73856093) ^ (cj * 19349663) ^ 0x9e3779b9);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    let n = 0; const cap = mesh.instanceMatrix.count;
    const tries = cap;
    for (let t = 0; t < tries && n < cap; t++) {
      const x = ci * CS + rng() * CS, z = cj * CS + rng() * CS;
      const mk = rasters.maskAt(x, z);
      if (mk & (M_WATER | M_BUILD)) continue;
      const sd = rasters.splatAt(x, z, 0), sg = rasters.splatAt(x, z, 1), sa = rasters.splatAt(x, z, 2), sf = rasters.splatAt(x, z, 3);
      const rej = sg * 1.3 + sa * 2 + sd * 0.7;
      if (rng() < rej) continue;
      let s = 0.7 + rng() * 0.8, r = 0.8, g = 0.9, b = 0.7;
      const macro = noise2(x / 23, z / 23);
      if (mk & M_FIELD || sf > 0.5) { // crops / vegetable garden
        if (mk & M_YARD) { s = 0.45 + rng() * 0.4; g = 0.85 + rng() * 0.2; r = 0.55 + rng() * 0.3; b = 0.5; if (rng() < 0.6) continue; }
        else { s = 1.15 + rng() * 0.6; r = 1.15; g = 0.95; b = 0.45 + macro * 0.2; if (macro > 0.55) { r = 0.8; g = 1.0; b = 0.5; } }
      } else if (mk & M_FOREST) { if (rng() < 0.6) continue; s *= 0.8; r = 0.6; g = 0.75; b = 0.5; }
      else { const dry = smoothstep(0.35, 0.8, noise2(x / 41 + 9, z / 41)); r = 0.78 + dry * 0.35; g = 0.92 - dry * 0.1; b = 0.62 - dry * 0.15; r *= 0.9 + macro * 0.3; }
      const y = world.heightAt(x, z) - 0.02;
      q.setFromEuler(e.set(0, rng() * Math.PI, 0)); sc.set(s * 1.1, s, s * 1.1); p.set(x, y, z);
      m4.compose(p, q, sc); mesh.setMatrixAt(n, m4);
      const v = 0.85 + rng() * 0.3; col.setRGB(r * v, g * v, b * v); mesh.setColorAt(n, col);
      n++;
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.n = n;
    mesh.boundingSphere = null; mesh.computeBoundingSphere();
    // inflate for blade height
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 2;
  }
  update(px, pz, time, budget = 2) {
    this.uniforms.uTime.value = time; this.uniforms.uPlayer.value.set(px, 0, pz);
    if (!this.enabled) return;
    const { CS, radius } = this;
    const i0 = Math.floor((px - radius) / CS), i1 = Math.floor((px + radius) / CS), j0 = Math.floor((pz - radius) / CS), j1 = Math.floor((pz + radius) / CS);
    const want = new Set(); const todo = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const d = Math.hypot((i + 0.5) * CS - px, (j + 0.5) * CS - pz);
      if (d > radius + CS) continue;
      const k = i + ',' + j; want.add(k);
      if (!this.chunks.has(k)) todo.push([d, i, j, k]);
    }
    for (const [k, mesh] of this.chunks) if (!want.has(k)) { this.group.remove(mesh); this.pool.push(mesh); this.chunks.delete(k); }
    todo.sort((a, b) => a[0] - b[0]);
    for (let t = 0; t < Math.min(budget, todo.length); t++) {
      const [, i, j, k] = todo[t];
      let mesh = this.pool.pop();
      if (!mesh || mesh.instanceMatrix.count !== this.cap) {
        mesh = new THREE.InstancedMesh(this.geo, this.mat, this.cap); mesh.frustumCulled = true; mesh.matrixAutoUpdate = false; mesh.castShadow = false;
        mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      }
      mesh.receiveShadow = this.shadows;
      this._fill(mesh, i, j); this.group.add(mesh); this.chunks.set(k, mesh);
    }
  }
}

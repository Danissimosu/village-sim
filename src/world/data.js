// Loads baked OSM + elevation data and exposes the height field (terrain + carved ponds/streams).
import { BASE, TERRAIN_SIZE } from '../config.js';
import { noise2, pointInPoly, distPointSeg, polyBounds, smoothstep, clamp } from '../util.js';

const CELL = 2; // carve grid cell size (m)

export class WorldData {
  constructor(json, hbuf) {
    this.json = json;
    this.half = TERRAIN_SIZE / 2;
    const h = json.heights;
    this.hN = h.n; this.hStep = h.step; this.hBase = h.base; this.hScale = h.scale;
    this.hOrigin = -json.half;
    this.heights = new Uint16Array(hbuf);
    this.carveN = Math.round(TERRAIN_SIZE / CELL) + 1;
    this.carve = new Float32Array(this.carveN * this.carveN);
    this.ponds = [];
    this.streams = [];
    this._buildWater();
  }
  // bilinear interpolated DEM (m above sea level - base)
  demAt(x, z) {
    const fx = (x - this.hOrigin) / this.hStep, fz = (z - this.hOrigin) / this.hStep;
    const n = this.hN;
    const ix = clamp(Math.floor(fx), 0, n - 2), iz = clamp(Math.floor(fz), 0, n - 2);
    const tx = clamp(fx - ix, 0, 1), tz = clamp(fz - iz, 0, 1);
    const H = this.heights;
    const a = H[iz * n + ix], b = H[iz * n + ix + 1], c = H[(iz + 1) * n + ix], d = H[(iz + 1) * n + ix + 1];
    const v = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    return v * this.hScale;
  }
  baseHeight(x, z) {
    // DEM is smooth (SRTM-derived); add gentle procedural rolling relief so ground reads as terrain
    const rel = noise2(x / 140 + 11.3, z / 140 + 5.1) * 1.6 + noise2(x / 38 + 3.7, z / 38 + 9.2) * 0.45 + noise2(x / 9 + 1.1, z / 9 + 7.7) * 0.07;
    return this.demAt(x, z) + rel;
  }
  carveAt(x, z) {
    const n = this.carveN;
    const fx = (x + this.half) / CELL, fz = (z + this.half) / CELL;
    const ix = clamp(Math.floor(fx), 0, n - 2), iz = clamp(Math.floor(fz), 0, n - 2);
    const tx = clamp(fx - ix, 0, 1), tz = clamp(fz - iz, 0, 1);
    const C = this.carve;
    return (C[iz * n + ix] * (1 - tx) + C[iz * n + ix + 1] * tx) * (1 - tz) + (C[(iz + 1) * n + ix] * (1 - tx) + C[(iz + 1) * n + ix + 1] * tx) * tz;
  }
  heightAt(x, z) { return this.baseHeight(x, z) + this.carveAt(x, z); }

  _buildWater() {
    const n = this.carveN, C = this.carve;
    const J = this.json;
    // ponds
    for (const w of J.water) {
      if (w.pts.length < 3) continue;
      const bb = polyBounds(w.pts);
      if (bb.x1 < -this.half || bb.x0 > this.half || bb.z1 < -this.half || bb.z0 > this.half) continue;
      // level: lower-quartile of boundary ground height
      const hs = w.pts.map((p) => this.baseHeight(p[0], p[1])).sort((a, b) => a - b);
      const level = hs[Math.floor(hs.length * 0.3)] - 0.05;
      const pond = { pts: w.pts, holes: w.holes || [], level, bb, kind: w.kind, area: Math.abs(areaOf(w.pts)) };
      if (pond.area < 25) continue;
      this.ponds.push(pond);
      const M = 7;
      const i0 = clamp(Math.floor((bb.x0 - M + this.half) / CELL), 0, n - 1), i1 = clamp(Math.ceil((bb.x1 + M + this.half) / CELL), 0, n - 1);
      const j0 = clamp(Math.floor((bb.z0 - M + this.half) / CELL), 0, n - 1), j1 = clamp(Math.ceil((bb.z1 + M + this.half) / CELL), 0, n - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * CELL - this.half, z = j * CELL - this.half;
        let d = Infinity;
        for (let k = 0, l = w.pts.length - 1; k < w.pts.length; l = k++) d = Math.min(d, distPointSeg(x, z, w.pts[l][0], w.pts[l][1], w.pts[k][0], w.pts[k][1]));
        const inside = pointInPoly(x, z, w.pts);
        const base = this.baseHeight(x, z);
        let target, t;
        if (inside) { target = level - clamp(0.12 + 0.45 * d, 0, 1.7); t = 1; }
        else if (d < M) { t = smoothstep(M, 0, d); t *= t; target = level + 0.12; }
        else continue;
        const v = (target - base) * t;
        if (Math.abs(v) > Math.abs(C[j * n + i])) C[j * n + i] = v;
      }
    }
    // streams: shallow ditch along polyline
    for (const s of J.waterways) {
      if (s.pts.length < 2) continue;
      this.streams.push({ pts: s.pts, kind: s.kind });
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const p of s.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      const i0 = clamp(Math.floor((x0 - 5 + this.half) / CELL), 0, n - 1), i1 = clamp(Math.ceil((x1 + 5 + this.half) / CELL), 0, n - 1);
      const j0 = clamp(Math.floor((z0 - 5 + this.half) / CELL), 0, n - 1), j1 = clamp(Math.ceil((z1 + 5 + this.half) / CELL), 0, n - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * CELL - this.half, z = j * CELL - this.half;
        let d = Infinity;
        for (let k = 1; k < s.pts.length; k++) d = Math.min(d, distPointSeg(x, z, s.pts[k - 1][0], s.pts[k - 1][1], s.pts[k][0], s.pts[k][1]));
        if (d < 4) { const v = -0.55 * smoothstep(4, 0.8, d); if (v < C[j * n + i]) C[j * n + i] = v; }
      }
    }
  }
}
function areaOf(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return a / 2; }

export async function loadWorldData() {
  const [json, hbuf] = await Promise.all([
    fetch(BASE + 'data/village.json').then((r) => r.json()),
    fetch(BASE + 'data/heights.bin').then((r) => r.arrayBuffer()),
  ]);
  return new WorldData(json, hbuf);
}

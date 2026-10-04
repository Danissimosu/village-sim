// Rasterises OSM + layout into (a) the terrain splat map (RGBA = dirt, gravel, asphalt, field; grass = remainder)
// and (b) a 1 m collision/class grid used by walking collision and vegetation placement.
import { TERRAIN_SIZE, SPLAT_RES } from '../config.js';
import { clamp, distPointSeg, polyBounds, pointInPoly, mulberry32 } from '../util.js';

export const M_FOREST = 1, M_WATER = 2, M_BUILD = 4, M_ORCHARD = 8, M_YARD = 16, M_FIELD = 32;

export class Rasters {
  constructor() {
    this.N = SPLAT_RES; this.half = TERRAIN_SIZE / 2; this.k = this.N / TERRAIN_SIZE;
    this.splat = new Uint8Array(this.N * this.N * 4);
    this.mask = new Uint8Array(this.N * this.N);        // class bits (same res as splat)
    this.CN = TERRAIN_SIZE;                              // collision grid 1 m
    this.block = new Uint8Array(this.CN * this.CN);     // 1 = blocked
    this.pblock = new Uint8Array(this.CN * this.CN);    // 1 = blocked for the PLAYER only (closed gates; villagers use the gap)
  }
  px(x) { return (x + this.half) * this.k; }
  maskAt(x, z) {
    const i = Math.floor(this.px(x)), j = Math.floor(this.px(z));
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return 0;
    return this.mask[j * this.N + i];
  }
  splatAt(x, z, ch) {
    const i = Math.floor(this.px(x)), j = Math.floor(this.px(z));
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return 0;
    return this.splat[(j * this.N + i) * 4 + ch] / 255;
  }
  blockedAt(x, z) {
    const i = Math.floor(x + this.half), j = Math.floor(z + this.half);
    if (i < 0 || j < 0 || i >= this.CN || j >= this.CN) return true;
    return this.block[j * this.CN + i] !== 0;
  }
  pBlockedAt(x, z) {
    const i = Math.floor(x + this.half), j = Math.floor(z + this.half);
    if (i < 0 || j < 0 || i >= this.CN || j >= this.CN) return false;
    return this.pblock[j * this.CN + i] !== 0;
  }
  // ---- painters
  _blend(idx, ch, w) {
    const S = this.splat, o = idx * 4;
    const v = w * 255;
    for (let c = 0; c < 4; c++) {
      if (c === ch) { if (v > S[o + c]) S[o + c] = v; } else S[o + c] = S[o + c] * (1 - w);
    }
  }
  paintLine(pts, halfW, soft, ch, strength = 1) {
    const N = this.N, k = this.k;
    for (let s = 1; s < pts.length; s++) {
      const ax = pts[s - 1][0], az = pts[s - 1][1], bx = pts[s][0], bz = pts[s][1];
      const m = halfW + soft + 1;
      const i0 = clamp(Math.floor(this.px(Math.min(ax, bx) - m)), 0, N - 1), i1 = clamp(Math.ceil(this.px(Math.max(ax, bx) + m)), 0, N - 1);
      const j0 = clamp(Math.floor(this.px(Math.min(az, bz) - m)), 0, N - 1), j1 = clamp(Math.ceil(this.px(Math.max(az, bz) + m)), 0, N - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) / k - this.half, z = (j + 0.5) / k - this.half;
        const d = distPointSeg(x, z, ax, az, bx, bz);
        let w = clamp((halfW + soft - d) / (2 * soft), 0, 1);
        if (w <= 0) continue;
        w = w * w * (3 - 2 * w) * strength;
        this._blend(j * N + i, ch, w);
      }
    }
  }
  paintPoly(pts, holes, ch, strength, maskBit = 0) {
    const N = this.N;
    const bb = polyBounds(pts);
    const i0 = clamp(Math.floor(this.px(bb.x0)), 0, N - 1), i1 = clamp(Math.ceil(this.px(bb.x1)), 0, N - 1);
    const j0 = clamp(Math.floor(this.px(bb.z0)), 0, N - 1), j1 = clamp(Math.ceil(this.px(bb.z1)), 0, N - 1);
    for (let j = j0; j <= j1; j++) {
      const z = (j + 0.5) / this.k - this.half;
      // scanline intersections
      const xs = [];
      const edges = [pts, ...(holes || [])];
      for (const ring of edges) for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const za = ring[a][1], zb = ring[b][1];
        if (za > z !== zb > z) xs.push(ring[a][0] + ((z - za) / (zb - za)) * (ring[b][0] - ring[a][0]));
      }
      xs.sort((p, q) => p - q);
      for (let t = 0; t + 1 < xs.length; t += 2) {
        const ia = clamp(Math.ceil(this.px(xs[t]) - 0.5), 0, N - 1), ib = clamp(Math.floor(this.px(xs[t + 1]) - 0.5), 0, N - 1);
        for (let i = ia; i <= ib; i++) {
          if (ch >= 0) this._blend(j * N + i, ch, strength);
          if (maskBit) this.mask[j * N + i] |= maskBit;
        }
      }
    }
  }
  paintRect(cx, cz, rot, w, d, ch, strength, soft = 0.4, maskBit = 0) {
    const N = this.N, c = Math.cos(rot), s = Math.sin(rot);
    const r = Math.hypot(w, d) / 2 + soft + 1;
    const i0 = clamp(Math.floor(this.px(cx - r)), 0, N - 1), i1 = clamp(Math.ceil(this.px(cx + r)), 0, N - 1);
    const j0 = clamp(Math.floor(this.px(cz - r)), 0, N - 1), j1 = clamp(Math.ceil(this.px(cz + r)), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) / this.k - this.half - cx, z = (j + 0.5) / this.k - this.half - cz;
      const u = x * c + z * s, v = -x * s + z * c;
      const dd = Math.max(Math.abs(u) - w / 2, Math.abs(v) - d / 2);
      let wt = clamp((soft - dd) / (2 * soft), 0, 1);
      if (wt <= 0) continue;
      wt = wt * wt * (3 - 2 * wt) * strength;
      if (ch >= 0) this._blend(j * N + i, ch, wt);
      if (maskBit && dd < 0) this.mask[j * N + i] |= maskBit;
    }
  }
  blur(radius = 2) {
    const N = this.N, S = this.splat, tmp = new Float32Array(N * N);
    for (let c = 0; c < 4; c++) {
      for (let j = 0; j < N; j++) { // horizontal
        let acc = 0; const row = j * N;
        for (let i = -radius; i <= radius; i++) acc += S[(row + clamp(i, 0, N - 1)) * 4 + c];
        for (let i = 0; i < N; i++) { tmp[row + i] = acc / (2 * radius + 1); acc += S[(row + clamp(i + radius + 1, 0, N - 1)) * 4 + c] - S[(row + clamp(i - radius, 0, N - 1)) * 4 + c]; }
      }
      for (let i = 0; i < N; i++) { // vertical
        let acc = 0;
        for (let j = -radius; j <= radius; j++) acc += tmp[clamp(j, 0, N - 1) * N + i];
        for (let j = 0; j < N; j++) { S[(j * N + i) * 4 + c] = acc / (2 * radius + 1); acc += tmp[clamp(j + radius + 1, 0, N - 1) * N + i] - tmp[clamp(j - radius, 0, N - 1) * N + i]; }
      }
    }
  }
  // ---- collision grid painters (1 m cells)
  blockRect(cx, cz, rot, w, d, margin = 0.3) {
    const c = Math.cos(rot), s = Math.sin(rot), CN = this.CN, h = this.half;
    const r = Math.hypot(w, d) / 2 + margin + 1;
    const i0 = clamp(Math.floor(cx - r + h), 0, CN - 1), i1 = clamp(Math.ceil(cx + r + h), 0, CN - 1);
    const j0 = clamp(Math.floor(cz - r + h), 0, CN - 1), j1 = clamp(Math.ceil(cz + r + h), 0, CN - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i + 0.5 - h - cx, z = j + 0.5 - h - cz;
      const u = x * c + z * s, v = -x * s + z * c;
      // cell is blocked if its centre lies within the rect grown by margin + half cell diag
      if (Math.abs(u) <= w / 2 + margin + 0.35 && Math.abs(v) <= d / 2 + margin + 0.35) this.block[j * CN + i] = 1;
    }
  }
  blockCircle(cx, cz, r, arr = this.block) {
    const CN = this.CN, h = this.half;
    for (let j = Math.floor(cz - r + h); j <= Math.ceil(cz + r + h); j++) for (let i = Math.floor(cx - r + h); i <= Math.ceil(cx + r + h); i++) {
      if (i < 0 || j < 0 || i >= CN || j >= CN) continue;
      if (Math.hypot(i + 0.5 - h - cx, j + 0.5 - h - cz) <= r + 0.5) arr[j * CN + i] = 1;
    }
  }
  blockLine(pts, r, arr = this.block) {
    for (let s = 1; s < pts.length; s++) {
      const L = Math.hypot(pts[s][0] - pts[s - 1][0], pts[s][1] - pts[s - 1][1]);
      const n = Math.max(1, Math.ceil(L / 0.6));
      for (let t = 0; t <= n; t++) this.blockCircle(pts[s - 1][0] + ((pts[s][0] - pts[s - 1][0]) * t) / n, pts[s - 1][1] + ((pts[s][1] - pts[s - 1][1]) * t) / n, r, arr);
    }
  }
}

const ROAD_STYLE = {
  trunk: { ch: 2, w: 7.6, shoulder: 1.3 }, trunk_link: { ch: 2, w: 5.2, shoulder: 1.0 }, primary: { ch: 2, w: 7, shoulder: 1.2 }, secondary: { ch: 2, w: 6.5, shoulder: 1.2 }, tertiary: { ch: 2, w: 6, shoulder: 1.0 },
  unclassified: { ch: 1, w: 4.5, shoulder: 0.8 }, residential: { ch: 2, w: 5, shoulder: 1.2 }, living_street: { ch: 1, w: 4, shoulder: 0.8 }, service: { ch: 1, w: 3.2, shoulder: 0.6 },
  track: { ch: 0, w: 3.0, shoulder: 0.5 }, path: { ch: 0, w: 1.2, shoulder: 0.2 }, footway: { ch: 1, w: 1.5, shoulder: 0.2 }, steps: { ch: 1, w: 1.5, shoulder: 0.1 }, cycleway: { ch: 2, w: 2, shoulder: 0.3 },
};
const ORDER = ['path', 'footway', 'steps', 'cycleway', 'track', 'service', 'living_street', 'unclassified', 'residential', 'tertiary', 'secondary', 'primary', 'trunk_link', 'trunk'];

export function buildRasters(world, layout) {
  const R = new Rasters();
  const J = world.json;
  const rng = mulberry32(77);

  // 1. land use
  for (const a of J.areas) {
    if (a.pts.length < 3) continue;
    switch (a.kind) {
      case 'allotments': R.paintPoly(a.pts, a.holes, 3, 0.75, M_FIELD); break;
      case 'farmland': case 'farmyard': R.paintPoly(a.pts, a.holes, 3, 1.0, M_FIELD); break;
      case 'wood': case 'forest': R.paintPoly(a.pts, a.holes, 0, 0.45, M_FOREST); break;
      case 'scrub': case 'wetland': R.paintPoly(a.pts, a.holes, 0, 0.3, 0); break;
      case 'orchard': R.paintPoly(a.pts, a.holes, 0, 0.15, M_ORCHARD); break;
      case 'industrial': R.paintPoly(a.pts, a.holes, 1, 0.85, 0); break;
      default: break;
    }
  }
  for (const w of world.ponds) R.paintPoly(w.pts, w.holes, -1, 0, M_WATER);
  R.blur(2);

  // 2. pond banks (wet mud)
  for (const p of world.ponds) {
    const b = p.bb, m = 5;
    const i0 = Math.floor(R.px(b.x0 - m)), i1 = Math.ceil(R.px(b.x1 + m)), j0 = Math.floor(R.px(b.z0 - m)), j1 = Math.ceil(R.px(b.z1 + m));
    for (let j = clamp(j0, 0, R.N - 1); j <= clamp(j1, 0, R.N - 1); j++) for (let i = clamp(i0, 0, R.N - 1); i <= clamp(i1, 0, R.N - 1); i++) {
      const x = (i + 0.5) / R.k - R.half, z = (j + 0.5) / R.k - R.half;
      let d = Infinity;
      for (let k = 0, l = p.pts.length - 1; k < p.pts.length; l = k++) d = Math.min(d, distPointSeg(x, z, p.pts[l][0], p.pts[l][1], p.pts[k][0], p.pts[k][1]));
      const inside = pointInPoly(x, z, p.pts);
      const dd = inside ? -d : d;
      if (dd < 4) { const w = clamp((4 - dd) / 4.5, 0, 1) * 0.85; R._blend(j * R.N + i, 0, w * w * (3 - 2 * w)); }
    }
  }

  // 3. gardens (vegetable beds) + yard ground around houses
  for (const g of layout.gardens) R.paintRect(g.cx, g.cz, g.rot, g.w, g.d, 3, 0.95, 0.5, M_YARD);
  for (const b of layout.buildings) {
    const gravelRing = b.kind === 'industrial' ? 6 : 1.1;
    R.paintRect(b.x, b.z, b.rot, b.w + gravelRing, b.d + gravelRing, b.kind === 'house' ? 1 : 0, b.kind === 'house' ? 0.55 : 0.6, 0.6, M_BUILD);
  }
  for (const z of layout.zones || []) R.paintRect(z.cx, z.cz, z.rot, z.w, z.d, z.ch, z.strength, 0.4, z.mask);
  for (const p of layout.paths) R.paintLine(p, 0.55, 0.35, 0, 0.9);

  // 4. roads (small first, main last so they overwrite)
  const roads = [...J.roads].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  for (const r of roads) {
    const st = ROAD_STYLE[r.kind]; if (!st) continue;
    let ch = st.ch; let w = st.w;
    if (r.kind === 'residential' || r.kind === 'unclassified') { // alternate asphalt / gravel streets deterministically
      const h = ((r.pts[0][0] * 7 + r.pts[0][1] * 13) | 0) & 3;
      ch = h === 0 ? 1 : 2;
    }
    if (r.kind === 'trunk') w = 7.6;
    // shoulder
    R.paintLine(r.pts, w / 2 + st.shoulder, 0.6, ch === 2 ? 1 : 0, ch === 2 ? 0.8 : 0.7);
    R.paintLine(r.pts, w / 2, 0.45, ch, 1);
  }
  // road mask -> not vegetated / for grass rejection handled via splat

  // 5. collisions
  for (const b of layout.buildings) R.blockRect(b.x, b.z, b.rot, b.w, b.d, 0.25);
  for (const w of layout.wells) R.blockCircle(w.x, w.z, 0.8);
  for (const f of layout.fences) R.blockLine(f.pts, 0.12);
  for (const g of layout.gates || []) R.blockLine(g.pts, 0.12, R.pblock);       // closed gates: solid for the player, open gap for NPC pathing
  // deep water
  for (const p of world.ponds) {
    const b = p.bb;
    for (let z = Math.floor(b.z0); z <= Math.ceil(b.z1); z++) for (let x = Math.floor(b.x0); x <= Math.ceil(b.x1); x++) {
      if (!pointInPoly(x + 0.5, z + 0.5, p.pts)) continue;
      if (p.level - world.heightAt(x + 0.5, z + 0.5) > 0.45) {
        const i = Math.floor(x + R.half), j = Math.floor(z + R.half);
        if (i >= 0 && j >= 0 && i < R.CN && j < R.CN) R.block[j * R.CN + i] = 1;
      }
    }
  }
  void rng;
  return R;
}

// Pedestrian navigation for villagers: a waypoint graph built from the OSM road/track/footway data, A* routing,
// and "places" (house doors, gardens, shop, school, bus stop, ponds, fields …) with access legs from the graph.
// No rendering here.
import { mulberry32, distPointSeg, pointInPoly, polyBounds, clamp } from '../util.js';
import { M_WATER, M_FOREST } from './splat.js';

const LIM = 690;
const EDGE_MUL = { trunk: 1.8, trunk_link: 1.6, track: 1.15, steps: 1.3 };

export class RoadGraph {
  constructor() { this.x = []; this.z = []; this.hw = []; this.kind = []; this.adj = []; this.comp = []; this.G = 16; this.grid = new Map(); this._g = []; this._stamp = []; this._st = 0; this._par = []; }
  _k(i, j) { return (i + 2048) * 4096 + (j + 2048); }
  get size() { return this.x.length; }
  _near(x, z, r, pred) { // nearest node within r (brute over grid cells)
    const G = this.G, R = Math.ceil(r / G);
    const ci = Math.floor(x / G), cj = Math.floor(z / G);
    let best = -1, bd = r;
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) {
      const c = this.grid.get(this._k(i, j)); if (!c) continue;
      for (const n of c) { if (pred && !pred(n)) continue; const d = Math.hypot(this.x[n] - x, this.z[n] - z); if (d < bd) { bd = d; best = n; } }
    }
    return best < 0 ? null : { n: best, d: bd };
  }
  addNode(x, z, hw, kind, merge = 1.8) {
    const hit = this._near(x, z, merge);
    if (hit) { if (hw > this.hw[hit.n]) this.hw[hit.n] = hw; return hit.n; }
    const id = this.x.length; this.x.push(x); this.z.push(z); this.hw.push(hw); this.kind.push(kind); this.adj.push([]);
    const k = this._k(Math.floor(x / this.G), Math.floor(z / this.G)); let c = this.grid.get(k); if (!c) this.grid.set(k, (c = [])); c.push(id);
    return id;
  }
  link(a, b, mul = 1) {
    if (a === b) return; const A = this.adj[a]; for (const e of A) if (e.to === b) return;
    const d = Math.hypot(this.x[a] - this.x[b], this.z[a] - this.z[b]) * mul;
    A.push({ to: b, c: d }); this.adj[b].push({ to: a, c: d });
  }
  labelComponents() {
    const n = this.size; this.comp = new Array(n).fill(-1); let cid = 0; const sizes = [];
    for (let s = 0; s < n; s++) {
      if (this.comp[s] >= 0) continue; const st = [s]; this.comp[s] = cid; let cnt = 0;
      while (st.length) { const v = st.pop(); cnt++; for (const e of this.adj[v]) if (this.comp[e.to] < 0) { this.comp[e.to] = cid; st.push(e.to); } }
      sizes.push(cnt); cid++;
    }
    let best = 0; for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
    this.main = best; this.mainSize = sizes[best];
  }
  nearest(x, z, maxD = 60, mainOnly = true) { return this._near(x, z, maxD, mainOnly ? (n) => this.comp[n] === this.main : null); }
  // A* between node ids; returns node-id array or null
  path(a, b) {
    if (a === b) return [a];
    const n = this.size; if (this._g.length !== n) { this._g = new Float32Array(n); this._stamp = new Int32Array(n); this._par = new Int32Array(n); this._closed = new Uint8Array(n); }
    const st = ++this._st, G = this._g, S = this._stamp, P = this._par, C = this._closed;
    const bx = this.x[b], bz = this.z[b];
    const h = (v) => Math.hypot(this.x[v] - bx, this.z[v] - bz);
    const heap = [[h(a), a]]; G[a] = 0; S[a] = st; P[a] = -1; C.fill(0);
    const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = i * 2 + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [, v] = pop(); if (C[v]) continue; C[v] = 1;
      if (v === b) { const out = []; for (let q = b; q >= 0; q = P[q]) out.push(q); return out.reverse(); }
      for (const e of this.adj[v]) {
        const g = G[v] + e.c;
        if (S[e.to] !== st || g < G[e.to]) { S[e.to] = st; G[e.to] = g; P[e.to] = v; push([g + h(e.to), e.to]); }
      }
    }
    return null;
  }
}

export function clearLine(R, ax, az, bx, bz, step = 0.5, skipA = 0, skipB = 0) {
  const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / step));
  for (let i = 0; i <= n; i++) { const t = i / n, d = t * L; if (d < skipA || L - d < skipB) continue; if (R.blockedAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
  return true;
}

function buildGraph(world) {
  const g = new RoadGraph(); const J = world.json;
  const roadId = []; // node -> first road id
  J.roads.forEach((r, ri) => {
    const hw = r.w / 2; let prev = -1;
    for (let i = 0; i < r.pts.length; i++) {
      const pts = [];
      if (i > 0) { const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 9)); for (let k = 1; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); }
      pts.push(r.pts[i]);
      for (const p of pts) {
        if (Math.abs(p[0]) > LIM || Math.abs(p[1]) > LIM) { prev = -1; continue; }
        const nid = g.addNode(p[0], p[1], hw, r.kind); if (roadId[nid] === undefined) roadId[nid] = ri;
        if (prev >= 0) g.link(prev, nid, EDGE_MUL[r.kind] || 1);
        prev = nid;
      }
    }
  });
  // junctions: link nodes of different roads that lie within 6 m of each other (T-junctions, crossings)
  for (let a = 0; a < g.size; a++) {
    const G = g.G, ci = Math.floor(g.x[a] / G), cj = Math.floor(g.z[a] / G);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const c = g.grid.get(g._k(i, j)); if (!c) continue;
      for (const b of c) if (b > a && roadId[b] !== roadId[a] && Math.hypot(g.x[a] - g.x[b], g.z[a] - g.z[b]) < 6) g.link(a, b, 1.2);
    }
  }
  g.labelComponents();
  return g;
}

const STREET_FALLBACK = ['Центральная', 'Зарічна', 'Садова', 'Шкільна', 'Соборна', 'Квіткова', 'Яблунева', 'Берегова'];
function streetNames(world) {
  return world.json.roads.map((r, i) => {
    if (r.name) return r.name.replace(/^вулиця\s+/i, '').replace(/\s+вулиця$/i, '');
    return STREET_FALLBACK[i % STREET_FALLBACK.length];
  });
}

/** Build everything the NPC simulation needs. */
export function buildNpcNav(world, layout, rasters, seed = 991) {
  const rng = mulberry32(seed);
  const graph = buildGraph(world);
  const J = world.json;
  const pt = (x, z) => [x, z];
  const names = streetNames(world);
  const nodePt = (n) => [graph.x[n], graph.z[n]];

  // ---------- houses with door access legs
  const pathOf = new Map(); for (const p of layout.paths) pathOf.set(p[0], p);
  const houses = [];
  layout.buildings.forEach((b, idx) => {
    if (b.kind !== 'house' || !b.door) return;
    const path = pathOf.get(b.door); if (!path || path.length < 2) return;
    const rev = path.slice().reverse().map((p) => pt(p[0], p[1])); // road -> door
    const hit = graph.nearest(rev[0][0], rev[0][1], 16, true); if (!hit) return;
    if (!clearLine(rasters, graph.x[hit.n], graph.z[hit.n], rev[0][0], rev[0][1])) return;
    let ok = true; for (let i = 1; i < rev.length; i++) if (!clearLine(rasters, rev[i - 1][0], rev[i - 1][1], rev[i][0], rev[i][1], 0.5, 0, i === rev.length - 1 ? 1.8 : 0)) ok = false;
    if (!ok) return;
    houses.push({ id: idx, b, x: b.x, z: b.z, node: hit.n, base: [nodePt(hit.n), ...rev], address: '', neighbors: [] });
  });

  // ---------- addresses: nearest named street + running house number (odd/even by side)
  const segs = []; J.roads.forEach((r, ri) => { if (r.kind === 'trunk' || r.kind === 'trunk_link' || r.kind === 'track' || r.kind === 'steps' || r.kind === 'footway') return; let acc = 0; for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1], b = r.pts[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push({ ri, a, b, off: acc, L }); acc += L; } });
  const groups = new Map();
  for (const h of houses) {
    let best = null, bd = 1e9;
    for (const s of segs) { const d = distPointSeg(h.x, h.z, s.a[0], s.a[1], s.b[0], s.b[1]); if (d < bd) { bd = d; best = s; } }
    if (!best) { h.street = 'Центральная'; h.along = 0; h.side = 1; }
    else {
      const dx = best.b[0] - best.a[0], dz = best.b[1] - best.a[1], l2 = dx * dx + dz * dz || 1;
      const t = clamp(((h.x - best.a[0]) * dx + (h.z - best.a[1]) * dz) / l2, 0, 1);
      h.street = names[best.ri]; h.along = best.off + t * best.L; h.side = (dx * (h.z - best.a[1]) - dz * (h.x - best.a[0])) > 0 ? 1 : -1;
    }
    if (!groups.has(h.street)) groups.set(h.street, []); groups.get(h.street).push(h);
  }
  for (const [street, arr] of groups) {
    for (const side of [1, -1]) {
      const s = arr.filter((h) => h.side === side).sort((a, b) => a.along - b.along);
      s.forEach((h, i) => { h.address = `ул. ${street}, ${i * 2 + (side > 0 ? 1 : 2)}`; });
    }
  }

  // ---------- civic buildings: 4 shops (k-means hubs of the settlement) + 1 school in the biggest hub
  const K = Math.min(4, Math.max(1, Math.floor(houses.length / 25)));
  let cents = []; { const srt = houses.slice().sort((a, b) => a.x - b.x); for (let k = 0; k < K; k++) { const h = srt[Math.floor(((k + 0.5) / K) * srt.length)]; cents.push([h.x, h.z]); } }
  let assign = new Array(houses.length).fill(0);
  for (let it = 0; it < 12; it++) {
    houses.forEach((h, i) => { let bi = 0, bd = 1e18; cents.forEach((c, k) => { const d = (h.x - c[0]) ** 2 + (h.z - c[1]) ** 2; if (d < bd) { bd = d; bi = k; } }); assign[i] = bi; });
    cents = cents.map((c, k) => { let sx = 0, sz = 0, n = 0; houses.forEach((h, i) => { if (assign[i] === k) { sx += h.x; sz += h.z; n++; } }); return n ? [sx / n, sz / n] : c; });
  }
  const hubSize = cents.map((_, k) => assign.filter((a) => a === k).length);
  const cx = cents.reduce((a, c, k) => a + c[0] * hubSize[k], 0) / houses.length, cz = cents.reduce((a, c, k) => a + c[1] * hubSize[k], 0) / houses.length;
  const civicPool = houses.filter((h) => !h.b.hero);                    // hero plots stay private homes
  const shopHouses = cents.map((c) => civicPool.slice().sort((a, b) => Math.hypot(a.x - c[0], a.z - c[1]) - Math.hypot(b.x - c[0], b.z - c[1]))[0]);
  const bigHub = hubSize.indexOf(Math.max(...hubSize));
  const hubC = cents[bigHub];
  const schoolH = civicPool.filter((h) => !shopHouses.includes(h) && Math.hypot(h.x - hubC[0], h.z - hubC[1]) < 200 && shopHouses.every((s) => Math.hypot(h.x - s.x, h.z - s.z) > 40)).sort((a, b) => b.b.w * b.b.d - a.b.w * a.b.d)[0] || civicPool.find((h) => !shopHouses.includes(h));
  shopHouses.forEach((h) => { h.civic = 'shop'; h.b.civic = 'shop'; h.address = 'Сельский магазин'; });
  schoolH.civic = 'school'; schoolH.b.civic = 'school'; schoolH.address = 'Школа';

  // ---------- spot factories
  const doorSpot = (h) => { const p = h.base[h.base.length - 1]; return { x: p[0], z: p[1], node: h.node, pts: h.base, house: h.id, hide: true }; };
  for (const h of houses) {
    h.door = doorSpot(h);
    // yard spot (between door and gate)
    const n = h.base.length; const a = h.base[n - 1], g = h.base[Math.max(0, n - 2)];
    const yp = pt(a[0] + (g[0] - a[0]) * 0.55, a[1] + (g[1] - a[1]) * 0.55);
    h.yard = { x: yp[0], z: yp[1], node: h.node, pts: [...h.base.slice(0, n - 1), yp], house: h.id };
  }
  // gardens -> nearest house with same orientation
  for (const gd of layout.gardens) {
    let best = null, bd = 28;
    for (const h of houses) { if (Math.abs(h.b.rot - gd.rot) > 1e-6) continue; const d = Math.hypot(h.x - gd.cx, h.z - gd.cz); if (d < bd) { bd = d; best = h; } }
    if (!best || best.garden) continue;
    const b = best.b, c = Math.cos(b.rot), s = Math.sin(b.rot);
    const P = (ox, oz) => pt(b.x + c * ox - s * oz, b.z + s * ox + c * oz);
    const door = best.base[best.base.length - 1];
    const dox = (door[0] - b.x) * c + (door[1] - b.z) * s;
    const C = P(dox, b.d / 2 + 1.9);
    for (const sg of [1, -1]) {
      const A = P(sg * (b.w / 2 + 1.8), b.d / 2 + 1.9), B = P(sg * (b.w / 2 + 1.8), -(b.d / 2 + 1.5));
      const spots = [];
      for (let k = 0; k < 4; k++) {
        const u = (rng() - 0.5) * gd.w * 0.7, v = (rng() - 0.5) * gd.d * 0.6;
        const q = pt(gd.cx + Math.cos(gd.rot) * u - Math.sin(gd.rot) * v, gd.cz + Math.sin(gd.rot) * u + Math.cos(gd.rot) * v);
        if (clearLine(rasters, B[0], B[1], q[0], q[1])) spots.push(q);
      }
      if (!spots.length || !clearLine(rasters, door[0], door[1], C[0], C[1], 0.5, 1.8, 0) || !clearLine(rasters, C[0], C[1], A[0], A[1]) || !clearLine(rasters, A[0], A[1], B[0], B[1])) continue;
      best.garden = spots.map((q) => ({ x: q[0], z: q[1], node: best.node, pts: [...best.base, C, A, B, q], house: best.id }));
      break;
    }
  }

  // ---------- generic area / shore spot sampling
  const addSpot = (arr, x, z, maxD = 130) => {
    if (Math.abs(x) > LIM - 10 || Math.abs(z) > LIM - 10) return false;
    if (rasters.blockedAt(x, z)) return false; const m = rasters.maskAt(x, z); if (m & (M_WATER | M_FOREST)) return false;
    const hit = graph.nearest(x, z, maxD, true); if (!hit) return false;
    const nx = graph.x[hit.n], nz = graph.z[hit.n];
    if (!clearLine(rasters, nx, nz, x, z)) return false;
    arr.push({ x, z, node: hit.n, pts: [nodePt(hit.n), pt(x, z)] }); return true;
  };
  const places = { fields: [], ponds: [] };
  const polyCentroid = (pts) => { let a = 0, b = 0; for (const p of pts) { a += p[0]; b += p[1]; } return [a / pts.length, b / pts.length]; };
  for (const ar of J.areas) {
    const kind = ar.kind === 'allotments' ? 'field' : ar.kind === 'orchard' ? 'orchard' : ar.kind === 'grassland' ? 'pasture' : null;
    if (!kind || ar.pts.length < 3) continue;
    const bb = polyBounds(ar.pts); if (bb.x1 < -LIM || bb.x0 > LIM || bb.z1 < -LIM || bb.z0 > LIM) continue;
    const spots = []; let tries = 0;
    while (spots.length < 12 && tries++ < 700) {
      const x = bb.x0 + rng() * (bb.x1 - bb.x0), z = bb.z0 + rng() * (bb.z1 - bb.z0);
      if (!pointInPoly(x, z, ar.pts)) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 8)) continue;
      addSpot(spots, x, z, 110);
    }
    if (spots.length >= 3) { const c = polyCentroid(ar.pts); places.fields.push({ kind, x: c[0], z: c[1], spots }); }
  }
  for (const p of world.ponds) {
    if (p.area < 180) continue;
    const spots = []; const c = polyCentroid(p.pts);
    const order = p.pts.map((_, i) => i).sort(() => rng() - 0.5);
    for (const i of order) {
      if (spots.length >= 10) break;
      const v = p.pts[i]; const dx = v[0] - c[0], dz = v[1] - c[1], L = Math.hypot(dx, dz) || 1;
      const off = 3 + rng() * 2; const x = v[0] + (dx / L) * off, z = v[1] + (dz / L) * off;
      if (pointInPoly(x, z, p.pts)) continue;
      let dmin = 1e9; for (let k = 0, l = p.pts.length - 1; k < p.pts.length; l = k++) dmin = Math.min(dmin, distPointSeg(x, z, p.pts[l][0], p.pts[l][1], p.pts[k][0], p.pts[k][1]));
      if (dmin < 2) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 9)) continue;
      addSpot(spots, x, z, 140);
    }
    if (spots.length >= 2) places.ponds.push({ kind: 'pond', x: c[0], z: c[1], area: p.area, spots });
  }

  // ---------- forecourt of the shop (village centre), bus stop, post office
  const lateralSpots = (h, n, spread) => {
    const base = h.base; const k = Math.max(0, base.length - 3); const g = base[k];     // gate on the road side
    const nx = base[k + 1][0] - g[0], nz = base[k + 1][1] - g[1], L = Math.hypot(nx, nz) || 1; const ux = nx / L, uz = nz / L;
    const out = [];
    for (let i = 0; i < n * 6 && out.length < n; i++) {
      const lat = (rng() - 0.5) * 2 * spread, inw = 0.6 + rng() * 2.2;
      addSpot(out, g[0] - uz * lat + ux * inw, g[1] + ux * lat + uz * inw, 40);
    }
    if (!out.length) out.push({ x: g[0], z: g[1], node: h.node, pts: base.slice(0, k + 1) });   // fallback: the gate itself
    return out;
  };
  const shops = shopHouses.map((h) => ({ house: h, x: h.x, z: h.z, door: h.door, spots: lateralSpots(h, 6, 5) }));
  const school = { house: schoolH, x: schoolH.x, z: schoolH.z, door: schoolH.door, spots: lateralSpots(schoolH, 6, 6) };
  // bus stops stand on the trunk road (the highway south of the village): one per cluster of hubs, on the side facing the houses
  const busStops = [];
  { const samples = [];
    for (const r of J.roads) {
      if (r.kind !== 'trunk') continue;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) continue;
        const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
        for (let d = 0; d < L; d += 6) { const x = a[0] + dx * d, z = a[1] + dz * d; if (Math.abs(x) < LIM - 40 && Math.abs(z) < LIM - 40) samples.push({ x, z, dx, dz, hw: r.w / 2 }); }
      }
    }
    const order = cents.map((c, k) => ({ c, k, n: hubSize[k] })).sort((a, b) => b.n - a.n);
    for (const { c } of order) {
      if (!samples.length) break;
      let near = null, nd = 1e18; for (const q of samples) { const d = (q.x - c[0]) ** 2 + (q.z - c[1]) ** 2; if (d < nd) { nd = d; near = q; } }
      if (busStops.some((s) => Math.hypot(s.rx - near.x, s.rz - near.z) < 170)) continue;
      const cands = samples.filter((q) => Math.hypot(q.x - near.x, q.z - near.z) < 80).sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z));
      for (const q of cands) {
        let nx = -q.dz, nz = q.dx; if (nx * (c[0] - q.x) + nz * (c[1] - q.z) < 0) { nx = -nx; nz = -nz; }
        const off = q.hw + 2.2, sx = q.x + nx * off, sz = q.z + nz * off;
        let ok = true; for (const [u, w] of [[0, 0], [2, 0], [-2, 0], [0, 1], [0, -1], [2, 1], [-2, 1]]) { const px = sx + q.dx * u + nx * w, pz = sz + q.dz * u + nz * w; if (rasters.blockedAt(px, pz) || (rasters.maskAt(px, pz) & (M_WATER | M_FOREST))) { ok = false; break; } }
        if (!ok) continue;
        const spots = [];
        for (let i = 0; i < 40 && spots.length < 6; i++) { const u = (rng() - 0.5) * 7, w = -0.9 + rng() * 2.2; addSpot(spots, sx + q.dx * u + nx * w, sz + q.dz * u + nz * w, 40); }
        if (!spots.length) continue;
        busStops.push({ x: sx, z: sz, node: spots[0].node, spots, rx: q.x, rz: q.z, tx: q.dx, tz: q.dz, nx, nz, rot: Math.atan2(q.dx, q.dz) });
        break;
      }
    }
    if (!busStops.length) for (const q of shops) if (q.spots.length) busStops.push({ x: q.x, z: q.z, node: q.spots[0].node, spots: q.spots, rx: q.x, rz: q.z, tx: 1, tz: 0, nx: 0, nz: 1, rot: 0, fallback: true });
  }
  const kiosk = layout.buildings.find((b) => b.kind === 'kiosk');
  let post = null;
  if (kiosk) {
    const spots = []; const hit = graph.nearest(kiosk.x, kiosk.z, 80, true);
    if (hit) for (let i = 0; i < 30 && spots.length < 3; i++) { const a = rng() * 6.28, r = Math.max(kiosk.w, kiosk.d) / 2 + 1.8 + rng() * 2; addSpot(spots, kiosk.x + Math.cos(a) * r, kiosk.z + Math.sin(a) * r, 90); }
    if (spots.length) post = { x: kiosk.x, z: kiosk.z, spots };
  }

  // ---------- routing
  const route = (A, B, lat = 0.9) => {
    // common prefix of the two access legs (same house) is skipped
    const ap = A.pts, bp = B.pts; let pre = 0;
    if (A.node === B.node) while (pre < ap.length && pre < bp.length && ap[pre] === bp[pre]) pre++;
    const out = [];
    const push = (p) => { const l = out[out.length - 1]; if (!l || Math.abs(l[0] - p[0]) + Math.abs(l[1] - p[1]) > 0.05) out.push([p[0], p[1]]); };
    if (pre > 0) { // same access chain: back up from A to the fork point, then down to B
      for (let i = ap.length - 1; i >= pre - 1; i--) push(ap[i]);
      for (let i = pre; i < bp.length; i++) push(bp[i]);
      return out;
    }
    for (let i = ap.length - 1; i >= 1; i--) push(ap[i]);   // spot -> road (excl. node point itself)
    const nodes = graph.path(A.node, B.node); if (!nodes) return null;
    const chain = nodes.map((n, i) => {
      const p = nodes[Math.max(0, i - 1)], q = nodes[Math.min(nodes.length - 1, i + 1)];
      let dx = graph.x[q] - graph.x[p], dz = graph.z[q] - graph.z[p]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const off = nodes.length > 1 ? Math.min(lat, graph.hw[n] * 0.6) : 0;
      return [graph.x[n] - dz * off, graph.z[n] + dx * off];
    });
    const full = [...(ap.length > 1 ? [ap[1]] : []), ...chain, ...(bp.length > 1 ? [bp[1]] : [])];
    // string pulling along the road (only when the shortcut stays within 2 m of the original line and is unobstructed)
    const sm = [full[0]]; let i = 0;
    while (i < full.length - 1) {
      let j = Math.min(full.length - 1, i + 8);
      for (; j > i + 1; j--) {
        let ok = true; for (let k = i + 1; k < j && ok; k++) if (distPointSeg(full[k][0], full[k][1], full[i][0], full[i][1], full[j][0], full[j][1]) > 2.2) ok = false;
        if (ok && clearLine(rasters, full[i][0], full[i][1], full[j][0], full[j][1], 0.75)) break;
      }
      sm.push(full[j]); i = j;
    }
    for (let k = 1; k < sm.length; k++) push(sm[k]);
    for (let k = 2; k < bp.length; k++) push(bp[k]);
    return out;
  };

  const stats = { graphNodes: graph.size, mainNodes: graph.mainSize, houses: houses.length, withGarden: houses.filter((h) => h.garden).length, fields: places.fields.length, ponds: places.ponds.length, busStops: busStops.length, shops: shops.length, hubs: hubSize };
  return { graph, houses, shops, school, busStops, post, fields: places.fields, ponds: places.ponds, route, stats, centreXZ: { x: cx, z: cz }, hubs: cents };
}

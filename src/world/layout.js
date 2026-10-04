// Procedural infill of the village: OSM has only a handful of mapped buildings around Lyubimivka,
// so houses, yards, fences, gardens, sheds, wells and trees are generated along the REAL road network
// inside the REAL landuse=residential polygons (Ukrainian rural style). Deterministic (seeded).
import { mulberry32, pointInPoly, distPointSeg, minAreaRect, resample, clamp, polyBounds } from '../util.js';

const HOUSE_ROADS = new Set(['residential', 'unclassified', 'tertiary', 'living_street', 'service']);
const WALL_TINTS = [[1, 1, 1], [1, 0.96, 0.82], [1, 0.9, 0.62], [0.78, 0.88, 0.97], [0.82, 0.93, 0.8], [0.97, 0.82, 0.8], [0.93, 0.78, 0.55], [0.9, 0.9, 0.86]];
const ROOF_STYLES = [
  { mat: 'roofSlate', tint: [0.75, 0.75, 0.78] }, { mat: 'roofSlate', tint: [0.5, 0.62, 0.52] }, { mat: 'roofSlate', tint: [0.7, 0.5, 0.42] },
  { mat: 'roofRed', tint: [0.95, 0.75, 0.7] }, { mat: 'roofClay', tint: [1, 0.9, 0.85] }, { mat: 'roofSlate', tint: [0.42, 0.5, 0.65] }, { mat: 'roofRed', tint: [0.7, 0.62, 0.6] },
];

// ---- Ukrainian village house types (хата / цегляний / дерев'яний / з металочерепицею / сучасний), derived from the style seed
const PL = { blue: [0.22, 0.38, 0.72], green: [0.2, 0.5, 0.32], brown: [0.45, 0.28, 0.2], ochre: [0.75, 0.55, 0.25], grey: [0.55, 0.55, 0.56], red: [0.62, 0.2, 0.18] };
const METAL = { green: [0.3, 0.58, 0.36], red: [0.66, 0.26, 0.22], brown: [0.5, 0.33, 0.25], blue: [0.28, 0.4, 0.68], grey: [0.55, 0.57, 0.6] };
export const GATE_COLORS = { green: [0.22, 0.5, 0.3], blue: [0.22, 0.38, 0.72], brown: [0.45, 0.3, 0.2], red: [0.6, 0.2, 0.18], grey: [0.5, 0.52, 0.55] };
export function decorateStyle(st, modern) {
  const r = mulberry32((st.seed ^ 0x5bd1e995) >>> 0), pk = (a) => a[Math.floor(r() * a.length)];
  const u = r();
  st.paintName = pk(['green', 'blue', 'brown', 'red', 'grey']);
  if (modern) { st.type = 'modern'; st.trim = pk([[0.95, 0.95, 0.95], [0.3, 0.3, 0.33]]); st.plinth = pk([PL.grey, [0.4, 0.4, 0.42]]); st.porch = r() < 0.55 ? 'columns' : 'none'; st.annex = 0; return st; }
  if (st.wall === 'brick') { st.type = 'brick'; st.trim = [0.96, 0.95, 0.92]; st.plinth = null; st.porch = pk(['veranda', 'canopy', 'columns', 'canopy', 'none']); st.annex = r() < 0.25 ? (r() < 0.5 ? 1 : -1) : 0; return st; }
  if (u < 0.1) { // log / timber house
    st.type = 'wood'; st.wall = 'wood'; st.wallTint = [1, 1, 1]; st.roof = pk(['roofSlate', 'roofRed']); st.roofTint = st.roof === 'roofRed' ? [0.85, 0.65, 0.6] : pk([METAL.grey, METAL.green, METAL.brown]);
    st.trim = pk([[0.95, 0.95, 0.92], PL.blue, PL.green]); st.plinth = null; st.porch = pk(['columns', 'canopy', 'veranda']); st.annex = r() < 0.2 ? 1 : 0; st.hip = r() < 0.15; return st;
  }
  if (u < 0.5) { // хата: whitewashed walls, coloured plinth, blue/green trim
    st.type = 'khata'; st.wallTint = pk([[1, 1, 1], [1, 1, 1], [1, 0.97, 0.86], [0.85, 0.92, 1], [1, 0.95, 0.72], [0.9, 0.95, 0.85]]);
    st.plinth = pk([PL.blue, PL.green, PL.brown, PL.ochre, PL.blue]); st.trim = pk([PL.blue, PL.green, [0.95, 0.95, 0.95], PL.brown]);
    st.roof = pk(['roofSlate', 'roofSlate', 'roofClay', 'roofRed']); st.roofTint = st.roof === 'roofSlate' ? pk([[0.45, 0.47, 0.5], METAL.green, METAL.brown, [0.35, 0.37, 0.4]]) : st.roof === 'roofClay' ? [1, 0.9, 0.85] : [0.85, 0.7, 0.65];
    st.shutters = r() < 0.7; st.shutter = st.trim; st.porch = pk(['none', 'canopy', 'veranda', 'canopy']); st.annex = r() < 0.3 ? (r() < 0.5 ? 1 : -1) : 0; return st;
  }
  // painted stucco + metal-tile roof
  st.type = 'sheet'; st.wallTint = pk([[1, 0.82, 0.55], [0.75, 0.88, 0.72], [0.74, 0.86, 0.98], [0.98, 0.78, 0.7], [0.92, 0.9, 0.82], [0.95, 0.9, 0.5], [0.8, 0.78, 0.9]]);
  st.roof = 'roofSlate'; st.roofTint = pk([METAL.green, METAL.red, METAL.brown, METAL.blue, METAL.grey, METAL.brown]);
  st.trim = pk([[0.96, 0.96, 0.96], [0.96, 0.96, 0.96], PL.brown, PL.blue]); st.plinth = pk([PL.grey, PL.brown, PL.grey, null]);
  st.porch = pk(['columns', 'veranda', 'canopy', 'none', 'columns']); st.annex = r() < 0.25 ? (r() < 0.5 ? 1 : -1) : 0; st.hip = st.hip || r() < 0.3;
  return st;
}

export function generateLayout(world, seed = 20240611) {
  const rng = mulberry32(seed);
  const J = world.json;
  const L = { gateObjs: [], gates: [], buildings: [], wells: [], fences: [], gardens: [], paths: [], trees: [], poles: [], cables: [], signs: [], mast: null, roadSegs: [], stats: {} };
  const LIM = 640;

  // ---- road segment list
  const segs = [];
  for (const r of J.roads) {
    const hw = r.w / 2;
    for (let i = 1; i < r.pts.length; i++) segs.push([r.pts[i - 1][0], r.pts[i - 1][1], r.pts[i][0], r.pts[i][1], hw, r.kind]);
  }
  L.roadSegs = segs;
  const roadClear = (x, z) => {
    let m = 1e9;
    for (const s of segs) { const d = distPointSeg(x, z, s[0], s[1], s[2], s[3]) - s[4]; if (d < m) m = d; }
    return m;
  };
  const nearestRoad = (x, z) => {
    let m = 1e9, best = null;
    for (const s of segs) { if (s[5] === 'trunk' || s[5] === 'trunk_link') continue; const d = distPointSeg(x, z, s[0], s[1], s[2], s[3]); if (d < m) { m = d; best = s; } }
    return best ? { d: m, seg: best } : null;
  };
  const ponds = world.ponds;
  const nearPond = (x, z, m) => {
    for (const p of ponds) {
      const b = p.bb;
      if (x < b.x0 - m || x > b.x1 + m || z < b.z0 - m || z > b.z1 + m) continue;
      if (pointInPoly(x, z, p.pts)) return true;
      for (let k = 0, l = p.pts.length - 1; k < p.pts.length; l = k++) if (distPointSeg(x, z, p.pts[l][0], p.pts[l][1], p.pts[k][0], p.pts[k][1]) < m) return true;
    }
    return false;
  };
  const resAreas = J.areas.filter((a) => a.kind === 'residential').map((a) => ({ ...a, bb: polyBounds(a.pts), modern: /котедж|жк/i.test(a.name || '') }));
  const woods = J.areas.filter((a) => (a.kind === 'wood' || a.kind === 'forest') && a.pts.length > 2).map((a) => ({ ...a, bb: polyBounds(a.pts) }));
  const inRes = (x, z) => { for (const a of resAreas) { if (x < a.bb.x0 || x > a.bb.x1 || z < a.bb.z0 || z > a.bb.z1) continue; if (pointInPoly(x, z, a.pts)) return a; } return null; };
  const inWood = (x, z) => { for (const a of woods) { if (x < a.bb.x0 || x > a.bb.x1 || z < a.bb.z0 || z > a.bb.z1) continue; if (pointInPoly(x, z, a.pts)) return true; } return false; };

  // ---- occupancy (circles in a spatial hash)
  const CELL = 16, occ = new Map();
  const key = (i, j) => i * 100003 + j;
  const addOcc = (x, z, r) => { const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); if (!occ.has(k)) occ.set(k, []); occ.get(k).push([x, z, r]); } };
  const isFree = (x, z, r) => { const i0 = Math.floor((x - r - 12) / CELL), i1 = Math.floor((x + r + 12) / CELL), j0 = Math.floor((z - r - 12) / CELL), j1 = Math.floor((z + r + 12) / CELL); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = occ.get(key(i, j)); if (a) for (const c of a) if (Math.hypot(c[0] - x, c[1] - z) < c[2] + r) return false; } return true; };
  const rectCorners = (cx, cz, rot, w, d, m = 0) => { const c = Math.cos(rot), s = Math.sin(rot); const hw = w / 2 + m, hd = d / 2 + m; return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]); };
  const inRect = (x, z, b, m = 0) => { const c = Math.cos(b.rot), s = Math.sin(b.rot); const dx = x - b.x, dz = z - b.z; const u = dx * c + dz * s, v = -dx * s + dz * c; return Math.abs(u) <= b.w / 2 + m && Math.abs(v) <= b.d / 2 + m; };

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const pick2 = (r, arr) => arr[Math.floor(r() * arr.length)];
  const mkStyle = (modern, brick) => {
    const roof = modern ? { mat: 'roofSlate', tint: pick([[0.35, 0.33, 0.33], [0.5, 0.25, 0.2], [0.3, 0.34, 0.4]]) } : pick(ROOF_STYLES);
    const st = { wall: brick ? 'brick' : 'plaster', wallTint: modern ? pick([[0.95, 0.95, 0.92], [0.85, 0.83, 0.78], [0.7, 0.72, 0.75]]) : pick(WALL_TINTS), roof: roof.mat, roofTint: roof.tint, shutter: pick([[0.2, 0.45, 0.3], [0.25, 0.35, 0.6], [0.45, 0.25, 0.15], [0.9, 0.9, 0.9], [0.6, 0.15, 0.15]]), hip: rng() < (modern ? 0.7 : 0.35), pitch: 28 + rng() * 12, shutters: rng() < 0.55, chimney: rng() < 0.8, seed: Math.floor(rng() * 1e9) };
    return decorateStyle(st, modern);       // extra variety uses its own seeded RNG (the layout RNG sequence is untouched)
  };
  const addBuilding = (b) => {
    L.buildings.push(b);
    addOcc(b.x, b.z, Math.hypot(b.w, b.d) / 2 + 0.6);
    return b;
  };

  // ---- 1. real OSM buildings (oriented min-area rectangles)
  for (const ob of J.buildings) {
    const r = minAreaRect(ob.pts);
    const nr = nearestRoad(r.cx, r.cz);
    let rot = r.rot;
    if (nr) { // front faces the nearest road
      const c = Math.cos(rot), s = Math.sin(rot);
      const vx = -s, vz = c; // v axis (front = +v)
      const s0 = nr.seg; const dx = s0[2] - s0[0], dz = s0[3] - s0[1]; const L2 = dx * dx + dz * dz || 1;
      const t = clamp(((r.cx - s0[0]) * dx + (r.cz - s0[1]) * dz) / L2, 0, 1);
      const px = s0[0] + dx * t - r.cx, pz = s0[1] + dz * t - r.cz;
      if (px * vx + pz * vz < 0) rot += Math.PI;
    }
    const industrial = /industrial|warehouse|hospital|commercial|retail/.test(ob.type);
    const b = addBuilding({ kind: industrial ? 'industrial' : 'house', x: r.cx, z: r.cz, rot, w: Math.max(r.w, 3), d: Math.max(r.d, 3), levels: ob.levels || 1, style: mkStyle(false, rng() < 0.3), osm: true, name: ob.name });
    if (industrial) { b.w = Math.max(b.w, 14); b.d = Math.max(b.d, 8); }
  }
  const osmCount = L.buildings.length;

  // ---- 2. houses along residential roads
  let tries = 0;
  const plots = [];
  for (const road of J.roads) {
    if (!HOUSE_ROADS.has(road.kind)) continue;
    const hw = road.w / 2;
    const step = () => 21 + rng() * 9;
    const samples = resample(road.pts, step);
    for (const s of samples) {
      for (const side of [1, -1]) {
        tries++;
        if (rng() < 0.16) continue;
        const nx = -s.dz * side, nz = s.dx * side;       // direction from road toward the plot
        const zone = inRes(s.x + nx * 20, s.z + nz * 20);
        const nearOsm = L.buildings.some((b) => b.osm && Math.hypot(b.x - s.x, b.z - s.z) < 80);
        if (!zone && !nearOsm) continue;
        if (road.kind === 'service' && !nearOsm && rng() < 0.7) continue;
        const modern = zone && zone.modern;
        const W = modern ? 11 + rng() * 5 : 7.5 + rng() * 5, D = modern ? 8 + rng() * 3 : 5.2 + rng() * 2.3;
        const setback = (modern ? 5 : 4 + rng() * 5);
        const dist = hw + setback + D / 2;
        const cx = s.x + nx * dist, cz = s.z + nz * dist;
        if (Math.abs(cx) > LIM || Math.abs(cz) > LIM) continue;
        // facing the road
        let rot = Math.atan2(s.dz, s.dx) + (side === 1 ? Math.PI : 0);
        let w = W, d = D;
        if (rng() < 0.12) { rot += Math.PI / 2; w = D * 1.1; d = W * 0.8; }
        const corners = rectCorners(cx, cz, rot, w, d, 1.2);
        let ok = true;
        for (const c of corners) { if (roadClear(c[0], c[1]) < 2.0 || nearPond(c[0], c[1], 5) || inWood(c[0], c[1])) { ok = false; break; } }
        if (!ok) continue;
        if (!isFree(cx, cz, Math.hypot(w, d) / 2 + 0.8)) continue;
        const levels = modern ? 2 : rng() < 0.16 ? 2 : 1;
        const house = addBuilding({ kind: 'house', x: cx, z: cz, rot, w, d, levels, style: mkStyle(modern, !modern && rng() < 0.22), osm: false });
        // door path to the road
        const c0 = Math.cos(rot), s0 = Math.sin(rot);
        const door = [cx + (-s0) * (d / 2 + 0.6) + c0 * (rng() - 0.5) * w * 0.3, cz + c0 * (d / 2 + 0.6) + s0 * (rng() - 0.5) * w * 0.3];
        L.paths.push([door, [s.x + nx * (hw + 0.3) + (door[0] - cx) * 0.0, s.z + nz * (hw + 0.3)]]);
        house.door = door;
        // plot
        const plotW = step() * 0.95;
        plots.push({ house, s, nx, nz, hw, plotW, modern });
      }
    }
  }

  // ---- 3. plot dressing: fences, gardens, sheds, wells, trees
  const fencePieces = (a, b, kind, out) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / 2));
    let cur = null;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
      const mx = a[0] + (b[0] - a[0]) * tm, mz = a[1] + (b[1] - a[1]) * tm;
      let valid = !nearPond(mx, mz, 2) && roadClear(mx, mz) > 0.8;
      if (valid) for (const bd of L.buildings) { if (Math.abs(bd.x - mx) < 20 && Math.abs(bd.z - mz) < 20 && inRect(mx, mz, bd, 0.6)) { valid = false; break; } }
      if (valid) {
        if (!cur) { cur = { kind, pts: [[a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]] }; out.push(cur); }
        cur.pts.push([a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]);
      } else cur = null;
    }
  };
  const FENCE_KINDS = ['picket', 'picket', 'picket_white', 'picket_green', 'mesh', 'board'];
  for (const p of plots) {
    const { house: h, s, nx, nz, hw, plotW, modern } = p;
    const tx = s.dx, tz = s.dz; // along the road
    const fkind0 = modern ? 'board' : pick(FENCE_KINDS);
    const gr = mulberry32((h.style.seed ^ 0x27d4eb2f) >>> 0), g01 = () => gr();
    let fkind = fkind0;
    if (!modern && h.style.type) {      // fence & gate follow the house type
      const t = g01(), pn = h.style.paintName;
      if (t < 0.34) fkind = 'metal_' + (pn === 'grey' ? 'green' : pn);
      else if (t < 0.5 && h.style.type === 'khata') fkind = 'picket_blue';
    } else if (modern && g01() < 0.4) fkind = 'metal_grey';
    const frontDist = hw + 1.4;
    const depth = 34 + rng() * 10;
    const P = (along, out) => [s.x + nx * out + tx * along, s.z + nz * out + tz * along];
    const hwid = plotW / 2;
    // front fence with gate gap
    const gate = (rng() - 0.5) * hwid * 0.8;
    const f = L.fences;
    { // gate between two pillars; leaves are open (villagers & player walk through) or closed (blocks the player only)
      const gc = fkind.startsWith('metal_') ? fkind.slice(6) : pick2(gr, ['green', 'blue', 'brown', 'red', 'grey']);
      const gk = g01() < 0.58 ? 'metal' : 'wood', open = g01() < 0.55, pil = pick2(gr, ['brick', 'stone', 'wood', 'brick']);
      const gp = P(gate, frontDist);
      if (g01() < 0.85) { L.gateObjs.push({ x: gp[0], z: gp[1], tx, tz, nx, nz, kind: gk, col: gc, open, pil, ang: 0.9 + g01() * 0.5 }); if (!open) L.gates.push({ pts: [P(gate - 1.5, frontDist), P(gate + 1.5, frontDist)] }); }
    }
    fencePieces(P(-hwid, frontDist), P(gate - 1.6, frontDist), fkind, f);
    fencePieces(P(gate + 1.6, frontDist), P(hwid, frontDist), fkind, f);
    fencePieces(P(-hwid, frontDist), P(-hwid, frontDist + depth), fkind, f);
    fencePieces(P(hwid, frontDist), P(hwid, frontDist + depth), fkind, f);
    fencePieces(P(-hwid, frontDist + depth), P(hwid, frontDist + depth), fkind, f);
    // redirect the door path to the gate
    const path = L.paths.find((q) => q[0] === h.door);
    if (path) path.splice(1, 0, P(gate, frontDist + 0.8), P(gate, hw + 0.3));
    // garden behind house
    const c = Math.cos(h.rot), sn = Math.sin(h.rot);
    const bx = -(-sn), bz = -(c); // back direction (-v)
    const gw = 7 + rng() * 6, gd = 8 + rng() * 9;
    const gdist = h.d / 2 + 3 + gd / 2;
    const gx = h.x + bx * gdist, gz = h.z + bz * gdist;
    const gcorn = rectCorners(gx, gz, h.rot, gw, gd, 0.5);
    let gok = !p.modern || rng() < 0.4;
    for (const q of gcorn) { if (nearPond(q[0], q[1], 2) || roadClear(q[0], q[1]) < 1 || inWood(q[0], q[1])) gok = false; }
    if (gok && rng() < 0.9) { L.gardens.push({ cx: gx, cz: gz, rot: h.rot, w: gw, d: gd }); }
    // shed / outbuilding
    const place = (kind, w, d, ox, oz, style) => {
      const x = h.x + c * ox - sn * oz, z = h.z + sn * ox + c * oz;
      if (!isFree(x, z, Math.hypot(w, d) / 2 + 0.3) || roadClear(x, z) < 3 || nearPond(x, z, 3)) return null;
      return addBuilding({ kind, x, z, rot: h.rot + (rng() < 0.5 ? 0 : Math.PI), w, d, levels: 1, style, osm: false });
    };
    const bk = -(h.d / 2 + 4);
    if (rng() < 0.55) place('shed', 2.6 + rng() * 1.6, 2.2 + rng() * 1.2, (rng() < 0.5 ? -1 : 1) * (h.w / 2 + 2 + rng() * 4), bk - 2 - rng() * 6, { ...mkStyle(false, false), wall: 'wood' });
    if (rng() < 0.25) place('barn', 6 + rng() * 3, 4 + rng(), (rng() < 0.5 ? -1 : 1) * (h.w / 2 + 6 + rng() * 3), bk - 8 - rng() * 6, { ...mkStyle(false, false), wall: 'wood' });
    if (rng() < 0.2) { const ox = (rng() < 0.5 ? -1 : 1) * (hwid * 0.6), oz = h.d / 2 + 5; const x = h.x + c * ox - sn * oz, z = h.z + sn * ox + c * oz; if (isFree(x, z, 1.5) && roadClear(x, z) > 3 && !nearPond(x, z, 3)) { L.wells.push({ x, z }); addOcc(x, z, 1.2); } }
    // trees in yard
    const nTrees = 3 + Math.floor(rng() * 5);
    for (let i = 0; i < nTrees; i++) {
      const ox = (rng() - 0.5) * hwid * 1.8, oz = -(h.d / 2 + 5 + rng() * 22);
      const x = h.x + c * ox - sn * oz, z = h.z + sn * ox + c * oz;
      if (!isFree(x, z, 1.8) || roadClear(x, z) < 2.5 || nearPond(x, z, 3) || inWood(x, z)) continue;
      if (gok && Math.abs(ox) < gw / 2 + 1 && -oz > h.d / 2 + 2 && -oz < h.d / 2 + 4 + gd) continue;
      L.trees.push({ x, z, sp: rng() < 0.75 ? 'apple' : rng() < 0.5 ? 'oak' : 'birch', s: 0.8 + rng() * 0.5 });
      addOcc(x, z, 2);
    }
    if (rng() < 0.45) { // front tree / bushes
      const ox = (rng() < 0.5 ? -1 : 1) * hwid * (0.55 + rng() * 0.3), oz = h.d / 2 + 3.5;
      const x = h.x + c * ox - sn * oz, z = h.z + sn * ox + c * oz;
      if (isFree(x, z, 2) && roadClear(x, z) > 2.5 && !nearPond(x, z, 3)) { L.trees.push({ x, z, sp: pick(['birch', 'oak', 'pine', 'apple']), s: 0.8 + rng() * 0.6 }); addOcc(x, z, 2); }
    }
  }

  // ---- 4. warehouses inside industrial areas
  for (const a of J.areas.filter((q) => q.kind === 'industrial')) {
    const bb = polyBounds(a.pts);
    let n = 0;
    for (let t = 0; t < 120 && n < 4; t++) {
      const cx = bb.x0 + rng() * (bb.x1 - bb.x0), cz = bb.z0 + rng() * (bb.z1 - bb.z0);
      const rot = (rng() < 0.5 ? 0 : Math.PI / 2) + 0.05;
      const w = 24 + rng() * 22, d = 12 + rng() * 8;
      const cs = rectCorners(cx, cz, rot, w, d, 3);
      if (!cs.every((q) => pointInPoly(q[0], q[1], a.pts) && roadClear(q[0], q[1]) > 3)) continue;
      if (!isFree(cx, cz, Math.hypot(w, d) / 2 + 2)) continue;
      addBuilding({ kind: 'industrial', x: cx, z: cz, rot, w, d, levels: 1, style: { ...mkStyle(false, false), wall: 'plaster', wallTint: pick([[0.7, 0.72, 0.75], [0.85, 0.8, 0.7]]), roof: 'roofSlate', roofTint: [0.55, 0.58, 0.62], hip: false, pitch: 9, shutters: false, chimney: false }, osm: false });
      n++;
    }
  }

  // ---- 5. POIs: telecom mast, post-office kiosks
  for (const p of J.pois) {
    if (p.kind === 'mast') L.mast = { x: p.x, z: p.z };
    else if (p.kind === 'post_office' && Math.abs(p.x) < LIM && Math.abs(p.z) < LIM) {
      const nr = nearestRoad(p.x, p.z);
      let rot = 0; if (nr) rot = Math.atan2(nr.seg[3] - nr.seg[1], nr.seg[2] - nr.seg[0]);
      if (isFree(p.x, p.z, 4)) addBuilding({ kind: 'kiosk', x: p.x, z: p.z, rot, w: 6.5, d: 4.5, levels: 1, style: { ...mkStyle(false, false), wallTint: [0.9, 0.2, 0.2], roof: 'roofSlate', roofTint: [0.4, 0.4, 0.42], hip: false, pitch: 12, shutters: false, chimney: false }, name: p.name, osm: true });
    }
  }

  // ---- 6. power poles along mapped lines
  for (const line of J.powerLines) {
    const pts = resample(line, () => 42);
    pts.forEach((q) => { if (Math.abs(q.x) < 690 && Math.abs(q.z) < 690) L.poles.push({ x: q.x, z: q.z, dx: q.dx, dz: q.dz }); });
  }

  L.stats = { osmBuildings: osmCount, houses: L.buildings.filter((b) => b.kind === 'house').length, sheds: L.buildings.filter((b) => b.kind === 'shed').length, barns: L.buildings.filter((b) => b.kind === 'barn').length, fences: L.fences.length, gardens: L.gardens.length, wells: L.wells.length, yardTrees: L.trees.length, tries };
  return L;
}

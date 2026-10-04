// Props: picket fences, power lines, telecom mast, road markings, village entrance signs, stream ribbons.
import * as THREE from 'three';
import { GeoBuilder } from './geo.js';
import { makeFenceTextures, makeSignTexture } from './procedural.js';
import { resample } from '../util.js';

const FENCE = {
  picket: { tex: 'picket', h: 1.15, col: [0.82, 0.68, 0.5] }, picket_white: { tex: 'picket', h: 1.15, col: [1, 1, 1] }, picket_green: { tex: 'picket', h: 1.2, col: [0.35, 0.55, 0.38] },
  board: { tex: 'board', h: 1.9, col: [0.62, 0.5, 0.4] }, picket_blue: { tex: 'picket', h: 1.15, col: [0.35, 0.5, 0.85] },
  metal_green: { tex: 'metal', h: 1.8, col: [0.25, 0.55, 0.35] }, metal_blue: { tex: 'metal', h: 1.8, col: [0.25, 0.4, 0.75] }, metal_brown: { tex: 'metal', h: 1.8, col: [0.55, 0.38, 0.28] }, metal_red: { tex: 'metal', h: 1.8, col: [0.68, 0.25, 0.22] }, metal_grey: { tex: 'metal', h: 1.9, col: [0.62, 0.64, 0.67] },
  mesh: { tex: 'mesh', h: 1.35, col: [1, 1, 1] },
};

export function buildFences(world, layout, group) {
  const tex = makeFenceTextures();
  const mats = {};
  for (const k of Object.keys(tex)) mats[k] = new THREE.MeshStandardMaterial({ map: tex[k], alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, vertexColors: true, alphaToCoverage: true });
  const builders = new Map();
  const CH = 400;
  let tris = 0;
  for (const f of layout.fences) {
    if (f.kind === 'hero') continue;             // hand-built fence of the 35Б plot (collision only)
    const def = FENCE[f.kind] || FENCE.picket;
    // chunk by first point
    const key = `${Math.floor(f.pts[0][0] / CH)},${Math.floor(f.pts[0][1] / CH)}|${def.tex}`;
    let gb = builders.get(key); if (!gb) { gb = new GeoBuilder(); builders.set(key, gb); }
    let dist = 0;
    for (let i = 1; i < f.pts.length; i++) {
      const ax = f.pts[i - 1][0], az = f.pts[i - 1][1], bx = f.pts[i][0], bz = f.pts[i][1];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
      const ya = world.heightAt(ax, az) - 0.12, yb = world.heightAt(bx, bz) - 0.12;
      gb.quad([ax, ya, az], [bx, yb, bz], [bx, yb + def.h, bz], [ax, ya + def.h, az], [[dist / 3, 0], [(dist + L) / 3, 0], [(dist + L) / 3, 1], [dist / 3, 1]], def.col);
      dist += L;
    }
  }
  for (const [k, gb] of builders) {
    if (gb.empty) continue;
    const m = new THREE.Mesh(gb.build(), mats[k.split('|')[1]]);
    m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); tris += gb.i.length / 3;
  }
  return tris;
}

export function buildPoles(world, layout, group) {
  const gb = new GeoBuilder();
  const wood = [0.38, 0.29, 0.22];
  const pts = [];
  for (const p of layout.poles) {
    const h = world.heightAt(p.x, p.z);
    gb.cylinder(p.x, h - 0.2, p.z, 0.16, 0.12, 8.2, 6, 2, wood, true);
    // cross-arm perpendicular to line direction
    const nx = -p.dz, nz = p.dx;
    const tf = (x, y, z) => [p.x + p.dx * z + nx * x, y, p.z + p.dz * z + nz * x];
    gb.box(tf, -1.0, h + 7.3, -0.06, 1.0, h + 7.45, 0.06, 2, wood);
    p.top = [h + 7.4, nx, nz];
  }
  // cables with sag between consecutive poles of the same line (poles are listed in order)
  for (let i = 1; i < layout.poles.length; i++) {
    const a = layout.poles[i - 1], b = layout.poles[i];
    if (Math.hypot(a.x - b.x, a.z - b.z) > 60) continue;
    for (const off of [-0.9, 0, 0.9]) {
      const seg = 8;
      for (let s = 0; s < seg; s++) {
        const t0 = s / seg, t1 = (s + 1) / seg;
        const P = (t) => [a.x + (b.x - a.x) * t + a.top[1] * off, a.top[0] + (b.top[0] - a.top[0]) * t - Math.sin(Math.PI * t) * 0.9, a.z + (b.z - a.z) * t + a.top[2] * off];
        pts.push(...P(t0), ...P(t1));
      }
    }
  }
  const mesh = new THREE.Mesh(gb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  mesh.castShadow = true; group.add(mesh);
  if (pts.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x15181c })); lines.frustumCulled = true; group.add(lines);
  }
}

export function buildMast(world, layout, group) {
  if (!layout.mast) return;
  const { x, z } = layout.mast; const h = world.heightAt(x, z);
  const gb = new GeoBuilder();
  const H = 46;
  for (let i = 0; i < 9; i++) { // red/white segments
    const y0 = h + (i * H) / 9, r0 = 0.9 - (i * 0.07), r1 = 0.9 - ((i + 1) * 0.07);
    gb.cylinder(x, y0, z, r0, r1, H / 9, 8, 3, i % 2 ? [0.9, 0.12, 0.1] : [0.95, 0.95, 0.95], false);
  }
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.4; gb.box((px, py, pz) => [x + Math.cos(a) * 1.4 + px, py, z + Math.sin(a) * 1.4 + pz], -0.5, h + H - 6, -0.15, 0.5, h + H - 2, 0.15, 2, [0.8, 0.8, 0.82]); }
  const m = new THREE.Mesh(gb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }));
  m.castShadow = true; group.add(m);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2200, toneMapped: false }));
  lamp.position.set(x, h + H + 0.6, z); group.add(lamp);
}

// white lane markings along asphalt carriageways of the main road
export function buildRoadMarkings(world, group) {
  const gb = new GeoBuilder();
  const up = [0, 1, 0];
  const strip = (pts, off, width, dash, gap) => {
    // offset polyline sideways by `off`
    const line = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      line.push([pts[i][0] + (-dz / L) * off, pts[i][1] + (dx / L) * off]);
    }
    const samples = resample(line, () => 1.0);
    // build quads between successive 1 m samples, skipping gaps for dashes
    for (let i = 1; i < samples.length; i++) {
      if (dash && (i % (dash + gap)) >= dash) continue;
      const a = samples[i - 1], b = samples[i];
      const nx = -a.dz * width / 2, nz = a.dx * width / 2;
      const ya = world.heightAt(a.x, a.z) + 0.07, yb = world.heightAt(b.x, b.z) + 0.07;
      gb.quad([a.x - nx, ya, a.z - nz], [b.x - nx, yb, b.z - nz], [b.x + nx, yb, b.z + nz], [a.x + nx, ya, a.z + nz], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.92, 0.92, 0.9], null);
    }
  };
  for (const r of world.json.roads) {
    if (r.kind !== 'trunk' && r.kind !== 'tertiary') continue;
    if (r.pts.length < 2) continue;
    const w = r.kind === 'trunk' ? 7.6 : 6;
    strip(r.pts, w / 2 - 0.35, 0.14, 0, 0);
    strip(r.pts, -(w / 2 - 0.35), 0.14, 0, 0);
    if (r.kind === 'trunk') strip(r.pts, 0, 0.14, 3, 4); else strip(r.pts, 0, 0.12, 0, 0);
  }
  if (gb.empty) return;
  // force upward normals
  const g = gb.build(); const n = g.attributes.normal; for (let i = 0; i < n.count; i++) { if (n.getY(i) < 0) n.setXYZ(i, 0, 1, 0); else n.setXYZ(i, 0, 1, 0); }
  void up;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide, vertexColors: true });
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; group.add(m);
}

export function buildSigns(world, spawn, group) {
  // blue/white village-name sign near spawn, plus a post
  const tex = makeSignTexture([{ text: 'Любимівка', size: 84 }, { text: 'Київська обл.', size: 44 }], '#ffffff', '#111111', true, 512, 256);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
  const h = world.heightAt(spawn.signX, spawn.signZ);
  const g = new THREE.Group(); g.position.set(spawn.signX, h, spawn.signZ); g.rotation.y = spawn.signRot;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0x777b80, roughness: 0.5, metalness: 0.6 }));
  post.position.y = 1.3; post.castShadow = true;
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 0.05), [new THREE.MeshStandardMaterial({ color: 0xeeeeee }), new THREE.MeshStandardMaterial({ color: 0xeeeeee }), new THREE.MeshStandardMaterial({ color: 0xeeeeee }), new THREE.MeshStandardMaterial({ color: 0xeeeeee }), mat, new THREE.MeshStandardMaterial({ color: 0x999999 })]);
  board.position.set(0, 2.25, 0.06); board.castShadow = true;
  g.add(post, board); group.add(g);
}

// Bus shelters on the trunk road (one per nav bus stop): steel frame, glass sides, bench, roof, a "АВТОБУС" plate on a pole.
export function buildBusStops(world, nav, group) {
  const metal = new GeoBuilder(), glass = new GeoBuilder(), plate = new GeoBuilder();
  for (const s of nav.busStops) {
    if (s.fallback) continue;
    const tx = s.tx, tz = s.tz, nx = s.nx, nz = s.nz;                       // t = along the road, n = towards the houses (away from the road)
    const tf = (u, y, w) => [s.x + tx * u + nx * w, y, s.z + tz * u + nz * w];
    let gy = -1e9; for (const [u, w] of [[-1.8, -1], [1.8, -1], [-1.8, 1], [1.8, 1], [0, 0]]) { const p = tf(u, 0, w); gy = Math.max(gy, world.heightAt(p[0], p[2])); }
    const g0 = gy + 0.05, base = g0 - 0.45;
    const stone = [0.62, 0.62, 0.6], steel = [0.16, 0.3, 0.5], roof = [0.2, 0.23, 0.27], wood = [0.55, 0.38, 0.22];
    metal.box(tf, -1.9, base, -1.0, 1.9, g0 + 0.1, 1.0, 2, stone, true);                                  // concrete pad
    for (const u of [-1.7, 1.7]) for (const w of [-0.8, 0.8]) metal.box(tf, u - 0.05, g0 + 0.1, w - 0.05, u + 0.05, g0 + 2.45, w + 0.05, 2, steel);
    metal.box(tf, -2.0, g0 + 2.45, -1.1, 2.0, g0 + 2.58, 1.1, 2, roof);                                    // flat roof
    metal.box(tf, -2.0, g0 + 2.2, 1.04, 2.0, g0 + 2.45, 1.1, 2, steel);                                    // fascia (village side)
    metal.box(tf, -1.1, g0 + 0.42, 0.35, 1.1, g0 + 0.48, 0.78, 1, wood);                                  // bench seat
    metal.box(tf, -1.1, g0 + 0.7, 0.72, 1.1, g0 + 1.0, 0.77, 1, wood);                                    // bench back
    for (const u of [-0.95, 0.95]) metal.box(tf, u - 0.04, g0 + 0.1, 0.4, u + 0.04, g0 + 0.42, 0.7, 1, steel);
    // glass: back + both sides
    glass.box(tf, -1.7, g0 + 0.25, 0.78, 1.7, g0 + 2.2, 0.8, 2, [1, 1, 1]);
    glass.box(tf, -1.72, g0 + 0.25, -0.8, -1.7, g0 + 2.2, 0.8, 2, [1, 1, 1]);
    glass.box(tf, 1.7, g0 + 0.25, -0.8, 1.72, g0 + 2.2, 0.8, 2, [1, 1, 1]);
    // sign pole + plate (double-sided: faces along the road both ways)
    const pu = 2.7, pw = -0.9;
    metal.cylinder(tf(pu, 0, pw)[0], gy - 0.2, tf(pu, 0, pw)[2], 0.045, 0.045, 3.1, 6, 2, [0.5, 0.52, 0.55], true);
    const pq = (w, flip) => plate.quad(tf(pu - 0.5, g0 + 2.55, w), tf(pu + 0.5, g0 + 2.55, w), tf(pu + 0.5, g0 + 3.15, w), tf(pu - 0.5, g0 + 3.15, w), flip ? [[1, 0], [0, 0], [0, 1], [1, 1]] : [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1], tf(pu, g0 + 2.85, flip ? 0.5 : -2.5));
    pq(pw - 0.06, false); pq(pw + 0.06, true);
  }
  if (metal.empty) return;
  const m1 = new THREE.Mesh(metal.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.25 })); m1.castShadow = true; m1.receiveShadow = true; group.add(m1);
  const m2 = new THREE.Mesh(glass.build(), new THREE.MeshStandardMaterial({ color: 0xa8c8d8, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, vertexColors: true, depthWrite: false, side: THREE.DoubleSide })); m2.renderOrder = 2; group.add(m2);
  const tex = makeSignTexture([{ text: 'АВТОБУС', size: 78 }, { text: 'зупинка', size: 52 }], '#1b5fb4', '#ffffff', true, 512, 256);
  const m3 = new THREE.Mesh(plate.build(), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, vertexColors: true, side: THREE.DoubleSide })); m3.castShadow = true; group.add(m3);
}

// ---- yard gates: two pillars (brick / stone / timber) + double leaves (profiled metal or planks), open or closed
import { GATE_COLORS } from './layout.js';
export function buildGates(world, layout, group) {
  const builders = new Map(); const CH = 400; let tris = 0;
  const PIL = { brick: [0.62, 0.34, 0.27], stone: [0.7, 0.68, 0.64], wood: [0.4, 0.3, 0.22] };
  for (const g of layout.gateObjs || []) {
    const key = `${Math.floor(g.x / CH)},${Math.floor(g.z / CH)}`;
    let gb = builders.get(key); if (!gb) { gb = new GeoBuilder(); builders.set(key, gb); }
    // local frame: u along the fence (tx,tz), v away from the road (nx,nz)
    const base = (u, v) => [g.x + g.tx * u + g.nx * v, g.z + g.tz * u + g.nz * v];
    const tfOf = (u0, v0, ang) => { const ca = Math.cos(ang), sa = Math.sin(ang); return (x, y, z) => { const rx = x * ca - z * sa, rz = x * sa + z * ca; const p = base(u0 + rx, v0 + rz); return [p[0], y, p[1]]; }; };
    const pc = PIL[g.pil] || PIL.brick, lc = GATE_COLORS[g.col] || GATE_COLORS.green;
    const h0 = world.heightAt(g.x, g.z);
    for (const sg of [-1, 1]) {
      const t = tfOf(sg * 1.7, 0, 0), hp = world.heightAt(...base(sg * 1.7, 0));
      gb.box(t, -0.22, hp - 0.3, -0.22, 0.22, hp + 1.95, 0.22, 1, pc);
      gb.box(t, -0.29, hp + 1.95, -0.29, 0.29, hp + 2.05, 0.29, 1, [pc[0] * 0.75, pc[1] * 0.75, pc[2] * 0.75]);
    }
    // leaves: hinged at the pillars, 1.45 m each; open = swung into the yard (+v)
    for (const sg of [-1, 1]) {
      const hingeU = sg * 1.48, dirU = -sg;                                   // the leaf points from the hinge toward the gate centre
      const th = g.open ? (dirU > 0 ? g.ang : Math.PI - g.ang) : (dirU > 0 ? 0 : Math.PI);
      const ca = Math.cos(th), sa = Math.sin(th);
      const t = (x, y, z) => { const p = base(hingeU + x * ca - z * sa, x * sa + z * ca); return [p[0], y, p[1]]; };
      const hp = h0 + 0.12;
      if (g.kind === 'metal') {
        gb.box(t, 0, hp + 0.12, -0.03, 1.42, hp + 1.65, 0.03, 1, lc);
        gb.box(t, 0, hp + 0.08, -0.05, 1.42, hp + 0.2, 0.05, 1, [lc[0] * 0.7, lc[1] * 0.7, lc[2] * 0.7]);
        gb.box(t, 0, hp + 1.58, -0.05, 1.42, hp + 1.7, 0.05, 1, [lc[0] * 0.7, lc[1] * 0.7, lc[2] * 0.7]);
      } else {
        for (let k = 0; k < 6; k++) gb.box(t, k * 0.24 + 0.01, hp + 0.1, -0.025, k * 0.24 + 0.23, hp + 1.45 + (k % 2) * 0.05, 0.025, 1, [0.62 + 0.04 * (k % 3), 0.5 + 0.03 * (k % 2), 0.36]);
        gb.box(t, 0, hp + 0.3, 0.025, 1.42, hp + 0.4, 0.07, 1, [0.5, 0.38, 0.28]); gb.box(t, 0, hp + 1.1, 0.025, 1.42, hp + 1.2, 0.07, 1, [0.5, 0.38, 0.28]);
      }
    }
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
  for (const gb of builders.values()) { if (gb.empty) continue; const m = new THREE.Mesh(gb.build(), mat); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m); tris += gb.i.length / 3; }
  return tris;
}

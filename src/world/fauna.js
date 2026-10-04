// Vehicles (cars, vans, pickups, tractors driving along the real roads) and domestic animals (cows, chickens, dogs, cats
// wandering near yards). Everything is a handful of vertex-coloured InstancedMeshes (1 draw call per species), animated on the CPU.
import * as THREE from 'three';
import { mulberry32, clamp } from '../util.js';

// ---- tiny vertex-coloured geometry builder (flat shaded boxes / cylinders)
export class VB {
  constructor() { this.p = []; this.n = []; this.c = []; }
  tri(a, b, c, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const v of [a, b, c]) { this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  // axis-aligned box from min/max corners
  box(x0, y0, z0, x1, y1, z1, col) {
    const v = (x, y, z) => [x, y, z];
    this.quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1), col); this.quad(v(x1, y0, z0), v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), col);
    this.quad(v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0), col); this.quad(v(x1, y0, z1), v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), col);
    this.quad(v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0), v(x0, y1, z0), col); this.quad(v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1), col);
  }
  // slanted-top box: front/back heights differ (for hoods/windscreens)
  wedge(x0, x1, y0, yA, yB, z0, z1, col) { // top goes from yA at x0 to yB at x1
    const v = (x, y, z) => [x, y, z];
    this.quad(v(x0, y0, z1), v(x1, y0, z1), v(x1, yB, z1), v(x0, yA, z1), col); this.quad(v(x1, y0, z0), v(x0, y0, z0), v(x0, yA, z0), v(x1, yB, z0), col);
    this.quad(v(x0, y0, z0), v(x0, y0, z1), v(x0, yA, z1), v(x0, yA, z0), col); this.quad(v(x1, y0, z1), v(x1, y0, z0), v(x1, yB, z0), v(x1, yB, z1), col);
    this.quad(v(x0, yA, z1), v(x1, yB, z1), v(x1, yB, z0), v(x0, yA, z0), col);
  }
  // cylinder along the Z axis (wheels)
  cylZ(cx, cy, cz, r, len, col, seg = 10) {
    const z0 = cz - len / 2, z1 = cz + len / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
      this.quad([p0[0], p0[1], z1], [p1[0], p1[1], z1], [p1[0], p1[1], z0], [p0[0], p0[1], z0], col);
      this.tri([cx, cy, z1], [p0[0], p0[1], z1], [p1[0], p1[1], z1], [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8]);
      this.tri([cx, cy, z0], [p1[0], p1[1], z0], [p0[0], p0[1], z0], [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8]);
    }
  }
  cylY(cx, y0, cz, r, h, col, seg = 6) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r];
      this.quad([p0[0], y0, p0[1]], [p0[0], y0 + h, p0[1]], [p1[0], y0 + h, p1[1]], [p1[0], y0, p1[1]], col);
      this.tri([cx, y0 + h, cz], [p1[0], y0 + h, p1[1]], [p0[0], y0 + h, p0[1]], col);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); return g;
  }
}
const W = [1, 1, 1], GLASS = [0.16, 0.22, 0.28], TYRE = [0.07, 0.07, 0.075], DARK = [0.12, 0.12, 0.13], CHROME = [0.55, 0.56, 0.58], HEAD = [0.95, 0.9, 0.7], TAIL = [0.55, 0.05, 0.05];

function wheels(b, xs, r, wz, wlen, ry) { for (const x of xs) for (const s of [-1, 1]) { b.cylZ(x, r, s * wz, r, wlen, TYRE, 10); b.cylZ(x, r, s * (wz + wlen * 0.4), r * 0.5, wlen * 0.3, CHROME, 8); } void ry; }

function geoSedan() { // Lada/VAZ-style saloon, forward = +X
  const b = new VB();
  wheels(b, [-1.3, 1.3], 0.31, 0.74, 0.22);
  b.box(-2.05, 0.28, -0.85, 2.05, 0.82, 0.85, W);                       // lower body
  b.wedge(1.0, 2.05, 0.82, 0.82, 0.95, -0.85, 0.85, W);                  // hood
  b.box(-1.05, 0.82, -0.78, 0.9, 1.34, 0.78, GLASS);                    // glasshouse
  b.box(-1.15, 1.34, -0.8, 0.8, 1.42, 0.8, W);                          // roof
  b.box(1.99, 0.42, -0.7, 2.08, 0.62, -0.45, HEAD); b.box(1.99, 0.42, 0.45, 2.08, 0.62, 0.7, HEAD);
  b.box(-2.08, 0.5, -0.8, -2.0, 0.66, -0.5, TAIL); b.box(-2.08, 0.5, 0.5, -2.0, 0.66, 0.8, TAIL);
  b.box(-2.1, 0.28, -0.85, -1.98, 0.4, 0.85, DARK); b.box(1.98, 0.28, -0.85, 2.1, 0.4, 0.85, DARK);
  return b.build();
}
function geoVan() { // UAZ "буханка" style van
  const b = new VB();
  wheels(b, [-1.35, 1.25], 0.36, 0.8, 0.26);
  b.box(-2.2, 0.35, -0.9, 2.2, 1.0, 0.9, W);
  b.box(-2.2, 1.0, -0.88, 1.75, 1.95, 0.88, W);
  b.box(-1.9, 1.15, -0.9, 1.7, 1.65, 0.9, GLASS);
  b.box(-2.2, 1.0, -0.9, -1.9, 1.95, 0.9, W); b.box(-1.95, 1.9, -0.9, 1.78, 2.0, 0.9, W);
  b.wedge(1.75, 2.2, 1.0, 1.0, 1.0, -0.88, 0.88, W); b.wedge(1.75, 2.0, 1.0, 1.9, 1.4, -0.88, 0.88, GLASS);
  b.box(2.15, 0.5, -0.75, 2.25, 0.72, -0.45, HEAD); b.box(2.15, 0.5, 0.45, 2.25, 0.72, 0.75, HEAD);
  b.box(-2.25, 0.5, -0.85, -2.17, 0.75, -0.6, TAIL); b.box(-2.25, 0.5, 0.6, -2.17, 0.75, 0.85, TAIL);
  b.box(2.18, 0.35, -0.9, 2.28, 0.48, 0.9, DARK);
  return b.build();
}
function geoPickup() {
  const b = new VB();
  wheels(b, [-1.5, 1.35], 0.36, 0.82, 0.26);
  b.box(-2.3, 0.4, -0.9, 2.3, 0.95, 0.9, W);
  b.box(0.0, 0.95, -0.85, 1.45, 1.55, 0.85, GLASS); b.box(-0.1, 1.55, -0.88, 1.35, 1.63, 0.88, W);
  b.wedge(1.45, 2.3, 0.95, 0.95, 1.1, -0.9, 0.9, W);
  b.box(-2.3, 0.95, -0.9, -0.2, 1.3, -0.82, W); b.box(-2.3, 0.95, 0.82, -0.2, 1.3, 0.9, W); b.box(-2.3, 0.95, -0.9, -2.22, 1.3, 0.9, W);
  b.box(-2.2, 0.95, -0.82, -0.25, 1.0, 0.82, [0.35, 0.28, 0.2]);
  b.box(2.25, 0.5, -0.8, 2.35, 0.72, -0.5, HEAD); b.box(2.25, 0.5, 0.5, 2.35, 0.72, 0.8, HEAD);
  b.box(-2.34, 0.55, -0.85, -2.28, 0.78, -0.6, TAIL); b.box(-2.34, 0.55, 0.6, -2.28, 0.78, 0.85, TAIL);
  return b.build();
}
function geoTractor() { // MTZ-style: big rear wheels, hood, cab
  const b = new VB();
  const B = [1, 1, 1];
  for (const s of [-1, 1]) { b.cylZ(-0.75, 0.78, s * 0.95, 0.78, 0.4, TYRE, 12); b.cylZ(-0.75, 0.78, s * 0.95, 0.4, 0.44, [0.8, 0.8, 0.2], 8); b.cylZ(1.25, 0.46, s * 0.75, 0.46, 0.22, TYRE, 10); b.cylZ(1.25, 0.46, s * 0.75, 0.25, 0.25, [0.8, 0.8, 0.2], 8); }
  b.box(-0.4, 0.55, -0.45, 2.1, 1.2, 0.45, B);                    // chassis + engine hood
  b.wedge(0.9, 2.1, 1.2, 1.2, 1.1, -0.42, 0.42, B);
  b.box(-1.25, 0.8, -0.62, 0.3, 1.0, 0.62, B);                    // rear deck
  b.box(-1.15, 1.0, -0.6, 0.15, 2.25, 0.6, GLASS);               // cab glass
  b.box(-1.3, 2.25, -0.68, 0.3, 2.35, 0.68, B);                  // roof
  for (const [x, z] of [[-1.15, -0.6], [-1.15, 0.6], [0.15, -0.6], [0.15, 0.6]]) b.box(x - 0.04, 1.0, z - 0.04, x + 0.04, 2.25, z + 0.04, B);
  b.cylY(1.55, 1.2, 0.2, 0.05, 0.75, DARK, 5);                   // exhaust
  b.box(2.05, 0.6, -0.4, 2.15, 0.8, 0.4, DARK); b.box(2.08, 0.9, -0.38, 2.14, 1.0, -0.2, HEAD); b.box(2.08, 0.9, 0.2, 2.14, 1.0, 0.38, HEAD);
  return b.build();
}
// ---- animals (forward = +X, y up, origin on the ground)
const SPOT = [0.08, 0.08, 0.08], PINK = [0.9, 0.62, 0.6];
function geoCow() {
  const b = new VB();
  b.box(-0.85, 0.72, -0.34, 0.8, 1.35, 0.34, W);                         // barrel
  b.box(-0.2, 0.74, -0.345, 0.45, 1.2, 0.345, SPOT); b.box(-0.9, 1.0, -0.2, -0.5, 1.37, 0.2, SPOT);            // pied patches
  b.box(0.8, 0.95, -0.2, 1.3, 1.4, 0.2, W); b.box(1.28, 0.98, -0.16, 1.5, 1.2, 0.16, PINK);                     // neck + head + muzzle
  b.box(0.95, 1.4, -0.22, 1.0, 1.52, -0.12, DARK); b.box(0.95, 1.4, 0.12, 1.0, 1.52, 0.22, DARK);             // horns
  b.box(1.1, 1.34, -0.3, 1.2, 1.4, 0.3, W);                                                                      // ears
  for (const [x, z] of [[-0.65, -0.22], [-0.65, 0.22], [0.55, -0.22], [0.55, 0.22]]) { b.box(x - 0.07, 0.0, z - 0.07, x + 0.07, 0.74, z + 0.07, W); b.box(x - 0.075, 0.0, z - 0.075, x + 0.075, 0.1, z + 0.075, DARK); }
  b.box(-0.95, 0.9, -0.03, -0.85, 1.28, 0.03, W); b.box(-1.0, 0.62, -0.03, -0.9, 0.92, 0.03, SPOT);           // tail
  b.box(-0.55, 0.6, -0.15, -0.3, 0.74, 0.15, PINK);                                                              // udder
  return b.build();
}
function geoChicken() {
  const b = new VB();
  b.box(-0.12, 0.17, -0.07, 0.12, 0.35, 0.07, W); b.box(0.08, 0.3, -0.045, 0.16, 0.5, 0.045, W); b.box(0.12, 0.45, -0.035, 0.2, 0.52, 0.035, W);
  b.box(0.1, 0.5, -0.012, 0.18, 0.56, 0.012, [0.85, 0.1, 0.08]); b.box(0.2, 0.45, -0.015, 0.25, 0.48, 0.015, [0.95, 0.75, 0.2]);
  b.box(-0.2, 0.28, -0.015, -0.1, 0.45, 0.015, [0.35, 0.3, 0.3]); b.box(-0.18, 0.26, -0.04, -0.1, 0.36, 0.04, [0.6, 0.55, 0.5]);
  for (const z of [-0.035, 0.035]) b.box(-0.01, 0, z - 0.008, 0.01, 0.18, z + 0.008, [0.9, 0.7, 0.2]);
  return b.build();
}
function geoDog() {
  const b = new VB();
  b.box(-0.3, 0.3, -0.1, 0.25, 0.52, 0.1, W); b.box(0.2, 0.42, -0.08, 0.38, 0.66, 0.08, W); b.box(0.3, 0.46, -0.07, 0.5, 0.62, 0.07, W);
  b.box(0.48, 0.5, -0.04, 0.54, 0.57, 0.04, DARK); b.box(0.3, 0.64, -0.06, 0.36, 0.72, -0.02, DARK); b.box(0.3, 0.64, 0.02, 0.36, 0.72, 0.06, DARK);
  for (const [x, z] of [[-0.22, -0.07], [-0.22, 0.07], [0.15, -0.07], [0.15, 0.07]]) b.box(x - 0.03, 0, z - 0.03, x + 0.03, 0.32, z + 0.03, W);
  b.box(-0.45, 0.42, -0.02, -0.28, 0.6, 0.02, W);
  return b.build();
}
function geoCat() {
  const b = new VB();
  b.box(-0.2, 0.17, -0.06, 0.17, 0.33, 0.06, W); b.box(0.14, 0.26, -0.055, 0.28, 0.42, 0.055, W);
  b.box(0.18, 0.4, -0.05, 0.22, 0.46, -0.02, W); b.box(0.18, 0.4, 0.02, 0.22, 0.46, 0.05, W);
  for (const [x, z] of [[-0.14, -0.04], [-0.14, 0.04], [0.1, -0.04], [0.1, 0.04]]) b.box(x - 0.02, 0, z - 0.02, x + 0.02, 0.2, z + 0.02, W);
  b.box(-0.36, 0.3, -0.015, -0.18, 0.34, 0.015, W); b.box(-0.37, 0.3, -0.015, -0.33, 0.52, 0.015, W);
  return b.build();
}

function inPoly(pts, x, z) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function geoGoose() {
  const b = new VB(); const O = [0.95, 0.6, 0.15];
  b.box(-0.28, 0.22, -0.13, 0.22, 0.46, 0.13, W); b.box(-0.4, 0.34, -0.05, -0.28, 0.46, 0.05, W);                       // body + tail
  b.box(0.12, 0.4, -0.04, 0.2, 0.78, 0.04, W); b.box(0.14, 0.74, -0.05, 0.28, 0.84, 0.05, W); b.box(0.28, 0.76, -0.03, 0.38, 0.81, 0.03, O);   // neck, head, beak
  for (const z of [-0.06, 0.06]) b.box(-0.02, 0, z - 0.012, 0.02, 0.24, z + 0.012, O);
  return b.build();
}
function geoGoat() {
  const b = new VB(); const D = [0.2, 0.18, 0.17];
  b.box(-0.4, 0.38, -0.15, 0.34, 0.75, 0.15, W); b.box(0.3, 0.55, -0.1, 0.5, 0.92, 0.1, W); b.box(0.46, 0.62, -0.08, 0.66, 0.82, 0.08, W);
  b.box(0.52, 0.9, -0.08, 0.57, 1.08, -0.04, D); b.box(0.52, 0.9, 0.04, 0.57, 1.08, 0.08, D); b.box(0.64, 0.6, -0.04, 0.68, 0.7, 0.04, D);
  for (const [x, z] of [[-0.3, -0.1], [-0.3, 0.1], [0.22, -0.1], [0.22, 0.1]]) b.box(x - 0.035, 0, z - 0.035, x + 0.035, 0.4, z + 0.035, W);
  b.box(-0.46, 0.6, -0.025, -0.38, 0.72, 0.025, W); b.box(0.5, 0.58, -0.02, 0.56, 0.66, 0.02, W);
  return b.build();
}
function geoBus() { // маршрутка (minibus) – yellow, forward = +X
  const b = new VB(); const Y = [0.95, 0.75, 0.15];
  wheels(b, [-2.1, 1.9], 0.4, 0.95, 0.28);
  b.box(-3.0, 0.4, -1.0, 3.0, 1.1, 1.0, W); b.box(-3.0, 1.1, -0.98, 2.4, 2.55, 0.98, W); b.box(-2.9, 1.55, -1.0, 2.3, 2.15, 1.0, GLASS); b.box(-3.0, 1.1, -1.0, 3.0, 1.35, 1.0, Y);
  b.box(-3.0, 2.5, -0.98, 2.4, 2.6, 0.98, W); b.wedge(2.4, 3.0, 1.1, 1.1, 1.1, -0.98, 0.98, W); b.wedge(2.4, 2.95, 1.1, 2.45, 1.7, -0.98, 0.98, GLASS);
  b.box(2.95, 0.55, -0.85, 3.05, 0.8, -0.5, HEAD); b.box(2.95, 0.55, 0.5, 3.05, 0.8, 0.85, HEAD); b.box(-3.05, 0.6, -0.9, -2.97, 0.9, -0.6, TAIL); b.box(-3.05, 0.6, 0.6, -2.97, 0.9, 0.9, TAIL);
  b.box(2.2, 2.6, -0.4, 2.4, 2.75, 0.4, [0.95, 0.75, 0.15]);
  return b.build();
}
function geoCart() { // конь с телегой (hay wagon), forward = +X
  const b = new VB(); const BR = [0.36, 0.23, 0.14], WD = [0.55, 0.4, 0.26], HAY = [0.8, 0.68, 0.3];
  b.box(0.9, 0.85, -0.27, 2.5, 1.5, 0.27, BR); b.box(2.3, 1.2, -0.15, 2.8, 1.95, 0.15, BR); b.box(2.7, 1.68, -0.13, 3.2, 1.95, 0.13, BR); b.box(3.12, 1.68, -0.1, 3.22, 1.82, 0.1, [0.15, 0.1, 0.08]);
  b.box(2.3, 1.6, -0.04, 2.75, 2.02, 0.04, DARK); b.box(0.78, 0.9, -0.04, 0.92, 1.45, 0.04, DARK); b.box(2.78, 1.9, -0.12, 2.86, 2.08, -0.06, BR); b.box(2.78, 1.9, 0.06, 2.86, 2.08, 0.12, BR);
  for (const x of [1.1, 2.3]) for (const z of [-0.17, 0.17]) { b.box(x - 0.06, 0, z - 0.06, x + 0.06, 0.88, z + 0.06, BR); b.box(x - 0.065, 0, z - 0.065, x + 0.065, 0.1, z + 0.065, DARK); }
  b.box(-0.5, 0.95, -0.42, 1.6, 1.0, -0.37, WD); b.box(-0.5, 0.95, 0.37, 1.6, 1.0, 0.42, WD);                 // shafts
  b.box(1.35, 1.1, -0.3, 1.65, 1.5, 0.3, [0.25, 0.15, 0.1]);                                                     // collar
  b.box(-2.6, 0.7, -0.8, 0.2, 0.78, 0.8, WD);
  b.box(-2.6, 0.78, -0.82, 0.2, 1.18, -0.74, WD); b.box(-2.6, 0.78, 0.74, 0.2, 1.18, 0.82, WD); b.box(0.14, 0.78, -0.8, 0.24, 1.25, 0.8, WD); b.box(-2.64, 0.78, -0.8, -2.56, 1.15, 0.8, WD);
  b.box(-2.4, 0.78, -0.72, -0.4, 1.3, 0.72, HAY); b.box(-0.35, 1.02, -0.5, 0.1, 1.1, 0.5, [0.45, 0.3, 0.2]);
  wheels(b, [-1.9, -0.3], 0.55, 0.88, 0.1);
  return b.build();
}
const MAT = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 });
const MAT_A = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
const CAR_COLORS = [[0.78, 0.78, 0.8], [0.8, 0.12, 0.1], [0.12, 0.25, 0.55], [0.85, 0.82, 0.7], [0.2, 0.4, 0.28], [0.08, 0.08, 0.1], [0.55, 0.57, 0.6], [0.8, 0.55, 0.15]];
const TRACTOR_COLORS = [[0.1, 0.28, 0.7], [0.1, 0.28, 0.7], [0.65, 0.12, 0.1], [0.15, 0.5, 0.2]];
const COW_COLORS = [[1, 1, 1], [1, 1, 1], [0.62, 0.42, 0.3], [0.45, 0.32, 0.26], [0.85, 0.8, 0.7]];
const CHICKEN_COLORS = [[1, 1, 1], [0.78, 0.5, 0.3], [0.45, 0.32, 0.22], [0.3, 0.28, 0.28], [0.9, 0.78, 0.55]];
const DOG_COLORS = [[0.12, 0.1, 0.1], [0.6, 0.4, 0.25], [0.8, 0.65, 0.4], [0.5, 0.5, 0.5], [0.9, 0.9, 0.85]];
const CAT_COLORS = [[0.85, 0.5, 0.2], [0.5, 0.5, 0.52], [0.1, 0.1, 0.1], [0.92, 0.9, 0.85], [0.6, 0.45, 0.3]];

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class Fauna {
  constructor(scene, world, layout, rasters, nav) {
    this.world = world; this.rasters = rasters; this.group = new THREE.Group(); this.group.name = 'fauna'; scene.add(this.group);
    const rng = mulberry32(424242); this.rng = rng;
    // roads as a 1 m block grid, so that yard animals and parked cars stay off the carriageway
    const roadBlock = new Uint8Array(rasters.CN * rasters.CN); this.roadBlock = roadBlock;
    for (const r of world.json.roads) if (['trunk', 'trunk_link', 'residential', 'unclassified', 'service'].includes(r.kind)) rasters.blockLine(r.pts, r.w / 2 + 0.6, roadBlock);
    const blocked = (x, z) => { if (rasters.blockedAt(x, z)) return true; const i = Math.floor(x + rasters.half), j = Math.floor(z + rasters.half); return i < 0 || j < 0 || i >= rasters.CN || j >= rasters.CN || roadBlock[j * rasters.CN + i] !== 0; };
    this.blocked = blocked;
    const pick = (a) => a[Math.floor(rng() * a.length)];
    this.meshes = {};
    const mk = (key, geo, max, mat, shadow) => {
      const m = new THREE.InstancedMesh(geo, mat, max); m.count = 0; m.frustumCulled = false; m.castShadow = !!shadow; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.name = key; this.group.add(m); this.meshes[key] = m; return m;
    };
    // ---- vehicles
    this.vehicles = []; this.parked = [];
    const roads = world.json.roads.filter((r) => ['trunk', 'residential', 'unclassified', 'track', 'service'].includes(r.kind) && r.pts.length >= 2).map((r) => {
      const cum = [0]; for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
      return { kind: r.kind, w: r.w, pts: r.pts, cum, len: cum[cum.length - 1] };
    }).filter((r) => r.len > 120);
    const byKind = (...k) => roads.filter((r) => k.includes(r.kind));
    const carRoads = byKind('trunk', 'residential', 'unclassified'), tractorRoads = byKind('track', 'unclassified', 'residential');
    const mkCars = { sedan: geoSedan(), van: geoVan(), pickup: geoPickup(), tractor: geoTractor(), bus: geoBus(), cart: geoCart() };
    const caps = { sedan: 18, van: 8, pickup: 8, tractor: 10, bus: 2, cart: 4 };
    for (const k of Object.keys(mkCars)) mk(k, mkCars[k], caps[k], MAT(), true);
    this.counts = { sedan: 0, van: 0, pickup: 0, tractor: 0, bus: 0, cart: 0 };
    const addVeh = (type, road, speed, parked, pos) => {
      const idx = this.counts[type]++; if (idx >= caps[type]) { this.counts[type]--; return; }
      const col = type === 'tractor' ? pick(TRACTOR_COLORS) : type === 'cart' ? [1, 1, 1] : type === 'bus' ? [0.9, 0.9, 0.9] : pick(CAR_COLORS);
      this.meshes[type].setColorAt(idx, _c.setRGB(col[0], col[1], col[2]));
      const v = { type, idx, road, s: 0, dir: rng() < 0.5 ? 1 : -1, speed, v: 0, parked, x: 0, z: 0, ang: 0, wait: 0, lane: road ? road.w * 0.25 : 0 };
      if (road) v.s = road.len * (0.1 + rng() * 0.8);
      if (pos) { v.x = pos.x; v.z = pos.z; v.ang = pos.ang; }
      this.vehicles.push(v); return v;
    };
    const R = (a, b) => a + rng() * (b - a);
    const moving = [['sedan', carRoads, 6, 11], ['sedan', carRoads, 6, 11], ['sedan', carRoads, 5, 9], ['van', carRoads, 6, 10], ['van', carRoads, 5, 9], ['pickup', carRoads, 6, 10], ['pickup', carRoads, 5, 9], ['sedan', carRoads, 7, 12],
      ['sedan', carRoads, 6, 10], ['pickup', carRoads, 6, 9], ['van', carRoads, 6, 9], ['bus', byKind('trunk'), 9, 13], ['bus', byKind('trunk'), 8, 12],
      ['cart', tractorRoads, 1.4, 2.4], ['cart', tractorRoads, 1.2, 2.2], ['cart', carRoads, 1.4, 2.2], ['tractor', tractorRoads, 2.5, 4.5], ['tractor', tractorRoads, 2.5, 4.5], ['tractor', tractorRoads, 2, 4], ['tractor', tractorRoads, 2, 4], ['tractor', tractorRoads, 2.5, 4], ['tractor', tractorRoads, 2.5, 4]];
    for (const [type, rs, a, b] of moving) {
      if (!rs.length) continue;
      const tot = rs.reduce((s, r) => s + r.len, 0); let t = rng() * tot, road = rs[0]; for (const r of rs) { t -= r.len; if (t <= 0) { road = r; break; } }
      addVeh(type, road, R(a, b), false);
    }
    // parked at houses (beside the gate / in the yard), static
    const houses = layout.buildings.filter((b) => b.kind === 'house' && !b.hero && !b.osm && Math.abs(b.x) < 520 && Math.abs(b.z) < 520);
    this.houses = houses;
    const rectFree = (x, z, ang, hl, hw) => { const c = Math.cos(ang), s = Math.sin(ang); for (const [u, v] of [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw], [0, 0]]) if (blocked(x + u * c - v * s, z + u * s + v * c)) return false; return true; };
    for (const h of houses) {
      if (rng() > 0.17) continue;
      const type = rng() < 0.12 ? 'tractor' : pick(['sedan', 'sedan', 'van', 'pickup']);
      const hl = type === 'tractor' ? 2.3 : 2.4, hw = type === 'tractor' ? 1.3 : 1.0;
      const cs = Math.cos(h.rot), sn = Math.sin(h.rot), side = rng() < 0.5 ? -1 : 1;
      for (const off of [[side * (h.w / 2 + 3.2), h.d / 2 + 3.2, 0], [side * (h.w / 2 + 3.2), -(h.d / 2 + 3.2), 0], [-side * (h.w / 2 + 3.2), h.d / 2 + 3.2, 0]]) {
        const x = h.x + cs * off[0] - sn * off[1], z = h.z + sn * off[0] + cs * off[1];
        const ang = h.rot + (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 0.3;
        if (!rectFree(x, z, ang, hl, hw)) continue;
        const v = addVeh(type, null, 0, true, { x, z, ang }); if (v) { this.parked.push(v); break; }
      }
    }
    // ---- animals
    this.animals = [];
    const aCap = { cow: 80, chicken: 240, dog: 80, cat: 60, goose: 40, goat: 60 };
    mk('cow', geoCow(), aCap.cow, MAT_A(), false); mk('chicken', geoChicken(), aCap.chicken, MAT_A(), false); mk('dog', geoDog(), aCap.dog, MAT_A(), false); mk('cat', geoCat(), aCap.cat, MAT_A(), false); mk('goose', geoGoose(), aCap.goose, MAT_A(), false); mk('goat', geoGoat(), aCap.goat, MAT_A(), false);
    const SPEC = {
      cow: { cols: COW_COLORS, walk: 0.55, scale: 1, bob: 0.015, graze: true },
      chicken: { cols: CHICKEN_COLORS, walk: 0.7, scale: 1, bob: 0.02, graze: true },
      dog: { cols: DOG_COLORS, walk: 1.5, scale: 1, bob: 0.03, graze: false },
      cat: { cols: CAT_COLORS, walk: 0.8, scale: 1, bob: 0.01, graze: false },
      goose: { cols: [[1, 1, 1], [1, 1, 1], [0.85, 0.85, 0.82], [0.6, 0.6, 0.6]], walk: 0.6, scale: 1, bob: 0.012, graze: true },
      goat: { cols: [[1, 1, 1], [0.85, 0.8, 0.7], [0.45, 0.35, 0.28], [0.2, 0.18, 0.17], [0.8, 0.78, 0.74]], walk: 0.8, scale: 1, bob: 0.015, graze: true },
    };
    this.spec = SPEC; this.aCount = { cow: 0, chicken: 0, dog: 0, cat: 0, goose: 0, goat: 0 };
    const addAnimal = (kind, hx, hz, r, scaleJ = 0.1) => {
      if (this.aCount[kind] >= aCap[kind]) return null;
      const idx = this.aCount[kind]++, col = pick(SPEC[kind].cols);
      this.meshes[kind].setColorAt(idx, _c.setRGB(col[0], col[1], col[2]));
      const a = { kind, idx, x: hx, z: hz, hx, hz, r, ang: rng() * 6.28, tx: hx, tz: hz, state: 0, timer: rng() * 5, sc: 1 + (rng() - 0.5) * 2 * scaleJ, ph: rng() * 6, col: new THREE.Color(col[0], col[1], col[2]), y: 0, tilt: 0, vis: true, sleepy: rng() < 0.5 };
      this.animals.push(a); return a;
    };
    const free = (x, z) => !blocked(x, z) && !blocked(x + 0.5, z) && !blocked(x - 0.5, z) && !blocked(x, z + 0.5) && !blocked(x, z - 0.5);
    const around = (h, k, rr, tries = 12) => { // random free spot in the yard behind / beside the house
      const cs = Math.cos(h.rot), sn = Math.sin(h.rot);
      for (let i = 0; i < tries; i++) {
        const ox = (rng() - 0.5) * (h.w + 8), oz = -(h.d / 2 + 2 + rng() * rr) * (k === 'front' ? -0.5 : 1);
        const x = h.x + cs * ox - sn * oz, z = h.z + sn * ox + cs * oz;
        if (free(x, z)) return [x, z];
      }
      return null;
    };
    for (const h of houses) {
      const u = rng();
      if (u < 0.2) { const p = around(h, 'back', 16); if (p) addAnimal('cow', p[0], p[1], 6); }
      if (rng() < 0.38) { const n = 2 + Math.floor(rng() * 4); const p = around(h, rng() < 0.5 ? 'back' : 'front', 12); if (p) for (let i = 0; i < n; i++) addAnimal('chicken', p[0] + (rng() - 0.5) * 2, p[1] + (rng() - 0.5) * 2, 5); }
      if (rng() < 0.3) { const p = around(h, 'front', 8); if (p) addAnimal('dog', p[0], p[1], 7); }
      if (rng() < 0.24) { const p = around(h, 'front', 6); if (p) addAnimal('cat', p[0], p[1], 5); }
    }
    // pasture herds (cows + goats on the mapped grassland) and geese on the pond banks
    for (const ar of world.json.areas) {
      if (ar.kind !== 'grassland' || ar.pts.length < 3) continue;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of ar.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
      for (let t = 0; t < 60; t++) {
        const x = x0 + rng() * (x1 - x0), z = z0 + rng() * (z1 - z0); if (Math.abs(x) > 500 || Math.abs(z) > 500 || !inPoly(ar.pts, x, z) || !free(x, z)) continue;
        const nC = 2 + Math.floor(rng() * 4), nG = 1 + Math.floor(rng() * 3);
        for (let i = 0; i < nC; i++) addAnimal('cow', x + (rng() - 0.5) * 8, z + (rng() - 0.5) * 8, 11);
        for (let i = 0; i < nG; i++) addAnimal('goat', x + (rng() - 0.5) * 8, z + (rng() - 0.5) * 8, 10);
        break;
      }
    }
    for (const p of world.ponds) {
      if (p.area < 250) continue; const cxp = p.pts.reduce((a, q) => a + q[0], 0) / p.pts.length, czp = p.pts.reduce((a, q) => a + q[1], 0) / p.pts.length;
      let placed = 0;
      for (let t = 0; t < 40 && !placed; t++) {
        const q = p.pts[Math.floor(rng() * p.pts.length)], dx = q[0] - cxp, dz = q[1] - czp, L = Math.hypot(dx, dz) || 1, x = q[0] + dx / L * 2.2, z = q[1] + dz / L * 2.2;
        if (Math.abs(x) > 500 || Math.abs(z) > 500 || !free(x, z)) continue;
        const n = 3 + Math.floor(rng() * 4); for (let i = 0; i < n; i++) addAnimal('goose', x + (rng() - 0.5) * 3, z + (rng() - 0.5) * 3, 7); placed = 1;
      }
    }
    // goats in some yards
    for (const h of houses) if (rng() < 0.1) { const p = around(h, 'back', 14); if (p) addAnimal('goat', p[0], p[1], 6); }
    // headlights / tail lights at night (additive glow sprites, one Points draw call)
    { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const n = (this.vehicles.length) * 4; this.lightPos = new Float32Array(n * 3); const col = new Float32Array(n * 3);
      for (let i = 0; i < this.vehicles.length; i++) for (let k = 0; k < 4; k++) { const o = (i * 4 + k) * 3; if (k < 2) { col[o] = 1; col[o + 1] = 0.95; col[o + 2] = 0.75; } else { col[o] = 0.9; col[o + 1] = 0.08; col[o + 2] = 0.05; } }
      const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(this.lightPos, 3)); g2.setAttribute('color', new THREE.BufferAttribute(col, 3)); g2.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      this.lightMat = new THREE.PointsMaterial({ map: tex, size: 1.8, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, opacity: 0, fog: false });
      this.lights = new THREE.Points(g2, this.lightMat); this.lights.frustumCulled = false; this.lights.visible = false; this.group.add(this.lights); }
    this._ids = 0;
  }

  // position & heading on a road at distance s, driving on the right-hand lane
  _roadPose(r, s, dir, lane, out) {
    const pts = r.pts, cum = r.cum;
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const a = pts[i - 1], b = pts[i], seg = (cum[i] - cum[i - 1]) || 1, t = clamp((s - cum[i - 1]) / seg, 0, 1);
    const dx = (b[0] - a[0]) / seg * dir, dz = (b[1] - a[1]) / seg * dir;
    out.x = a[0] + (b[0] - a[0]) * t - dz * lane; out.z = a[1] + (b[1] - a[1]) * t + dx * lane; out.ang = Math.atan2(dz, dx);
  }
  _setMat(mesh, idx, x, y, z, ang, sc, tilt) {
    _m.makeRotationY(-ang);
    if (tilt) { _m2.makeRotationZ(tilt); _m.multiply(_m2); }
    if (sc !== 1) { _m2.makeScale(sc, sc, sc); _m.multiply(_m2); }
    _m.setPosition(x, y, z); mesh.setMatrixAt(idx, _m);
  }
  update(dt, playerPos, hour, time, nightF = 0) {
    const world = this.world, px = playerPos.x, pz = playerPos.z;
    // ---- vehicles
    const pose = { x: 0, z: 0, ang: 0 };
    for (const v of this.vehicles) {
      const mesh = this.meshes[v.type];
      let x, z, ang;
      if (v.parked) { x = v.x; z = v.z; ang = v.ang; }
      else {
        const r = v.road;
        // slow down for the player ahead / nearby
        let target = v.speed;
        const dxp = px - v.x, dzp = pz - v.z, dp = Math.hypot(dxp, dzp);
        if (dp < 14) { const fx = Math.cos(v.ang), fz = Math.sin(v.ang); const ahead = (dxp * fx + dzp * fz) / (dp || 1); if (ahead > 0.4 && dp < 12) target = dp < 6.5 ? 0 : v.speed * 0.35; }
        v.v += clamp(target - v.v, -9 * dt, 3 * dt);
        v.s += v.dir * v.v * dt;
        if (v.s > r.len - 4) { v.s = r.len - 4; v.dir = -1; } else if (v.s < 4) { v.s = 4; v.dir = 1; }
        this._roadPose(r, v.s, v.dir, r.kind === 'track' ? 0 : r.w * 0.25, pose);
        v.x = pose.x; v.z = pose.z; v.ang = pose.ang; x = v.x; z = v.z; ang = v.ang;
      }
      // ground-following pitch from front/rear heights
      const L = v.type === 'cart' ? 2.0 : v.type === 'tractor' ? 1.4 : v.type === 'bus' ? 2.2 : 1.6, c = Math.cos(ang), s = Math.sin(ang);
      const hf = world.heightAt(x + c * L, z + s * L), hr = world.heightAt(x - c * L, z - s * L);
      _x.set(c * 2 * L, hf - hr, s * 2 * L).normalize();
      _z.crossVectors(_x, UP).normalize(); _y.crossVectors(_z, _x).normalize();
      _m.makeBasis(_x, _y, _z); _m.setPosition(x, (hf + hr) / 2 + 0.02, z);
      mesh.setMatrixAt(v.idx, _m);
    }
    this.lightMat.opacity = Math.min(1, nightF * 1.3); this.lights.visible = nightF > 0.2;
    if (this.lights.visible) {
      const P = this.lightPos; let i = 0;
      for (const v of this.vehicles) {
        const c = Math.cos(v.ang), s = Math.sin(v.ang), fl = v.type === 'tractor' ? 2.1 : v.type === 'bus' ? 3.0 : v.type === 'van' ? 2.2 : 2.05, rl = v.type === 'tractor' ? -1.2 : v.type === 'bus' ? -3.0 : -2.1, y = world.heightAt(v.x, v.z) + (v.type === 'tractor' ? 0.95 : v.type === 'bus' ? 0.7 : 0.55), w = v.type === 'bus' ? 0.7 : 0.6;
        const on = v.parked || v.type === 'cart' ? 0 : 1; // parked cars stay dark
        for (let k = 0; k < 4; k++) { const lx = k < 2 ? fl : rl, lz = (k % 2 ? 1 : -1) * w, o = (i * 4 + k) * 3; P[o] = v.x + c * lx - s * lz; P[o + 1] = on ? y : -100; P[o + 2] = v.z + s * lx + c * lz; }
        i++;
      }
      this.lights.geometry.attributes.position.needsUpdate = true;
    }
    for (const k of ['sedan', 'van', 'pickup', 'tractor', 'bus', 'cart']) { const m = this.meshes[k]; m.count = this.counts[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }

    // ---- animals (only those near the player are simulated; far ones are not drawn)
    const night = hour < 5.2 || hour > 21;      // chickens roost, others rest
    const R2 = 170 * 170;
    const vis = { cow: 0, chicken: 0, dog: 0, cat: 0, goose: 0, goat: 0 };
    const map = { cow: [], chicken: [], dog: [], cat: [], goose: [], goat: [] };
    for (const a of this.animals) {
      const dxp = a.x - px, dzp = a.z - pz;
      if (dxp * dxp + dzp * dzp > R2) continue;
      if (a.kind === 'chicken' && night) continue;
      const sp = this.spec[a.kind];
      a.timer -= dt;
      let moving = false;
      if (a.state === 1) { // walking to the target
        const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
        if (d < 0.25 || a.timer < 0) { a.state = 0; a.timer = 1 + Math.random() * (night ? 12 : 5); }
        else {
          const want = Math.atan2(dz, dx); let da = want - a.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); a.ang += clamp(da, -3 * dt, 3 * dt);
          const run = a.kind === 'dog' && a.run ? 2.4 : 1;
          const nx = a.x + Math.cos(a.ang) * sp.walk * run * dt, nz = a.z + Math.sin(a.ang) * sp.walk * run * dt;
          if (this.blocked(nx, nz) || this.blocked(nx + Math.cos(a.ang) * 0.4, nz + Math.sin(a.ang) * 0.4)) { a.state = 0; a.timer = 0.5; a.ang += 1.2; } else { a.x = nx; a.z = nz; moving = true; }
        }
      } else if (a.timer < 0) {
        const pickAng = Math.random() * 6.283, rr = Math.random() * a.r;
        a.tx = a.hx + Math.cos(pickAng) * rr; a.tz = a.hz + Math.sin(pickAng) * rr; a.state = 1; a.timer = 12; a.run = Math.random() < 0.25;
        if (night && Math.random() < 0.85) { a.state = 0; a.timer = 6 + Math.random() * 20; }
      }
      a.ph += dt * (moving ? (a.kind === 'chicken' ? 10 : a.kind === 'dog' ? 9 : 5) : 0.8);
      const gy = world.heightAt(a.x, a.z);
      let y = gy + (moving ? Math.abs(Math.sin(a.ph)) * sp.bob : 0), tilt = 0;
      if (!moving && sp.graze) tilt = a.kind === 'chicken' || a.kind === 'goose' ? -0.5 * (0.5 + 0.5 * Math.sin(a.ph * 2.2 + a.idx)) : -0.18;
      if (!moving && (a.kind === 'cat' || a.kind === 'dog') && a.sleepy && night) tilt = 0;
      this._setMat(this.meshes[a.kind], vis[a.kind], a.x, y, a.z, a.ang, a.sc, tilt);
      map[a.kind].push(a);
      vis[a.kind]++;
    }
    // instance colours follow the compacted order
    for (const k of ['cow', 'chicken', 'dog', 'cat', 'goose', 'goat']) {
      const m = this.meshes[k]; m.count = vis[k];
      const arr = map[k];
      for (let i = 0; i < arr.length; i++) { const col = this._colors(k, arr[i]); m.setColorAt(i, col); }
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    void time;
  }
  _colors(k, a) { if (!a.col) { const r = mulberry32(a.idx * 977 + k.length * 131); const arr = this.spec[k].cols; const c = arr[Math.floor(r() * arr.length)]; a.col = new THREE.Color(c[0], c[1], c[2]); } return a.col; }
  stats() { return { vehicles: this.vehicles.length, parked: this.parked.length, animals: this.animals.length, visible: Object.fromEntries(Object.entries(this.meshes).map(([k, m]) => [k, m.count])) }; }
}

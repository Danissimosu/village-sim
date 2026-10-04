// Tiny flat-shaded geometry builder (positions, normals, metric UVs, vertex colours).
import * as THREE from 'three';

export class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.count = 0; }
  // quad p0..p3 (counter-clockwise when seen from outside); `inside` = point on the inner side to auto-orient.
  quad(p0, p1, p2, p3, uv, col = [1, 1, 1], inside = null) {
    let a = p0, b = p1, c = p2, d = p3, ua = uv[0], ub = uv[1], uc = uv[2], ud = uv[3];
    let n = norm3(cross3(sub3(b, a), sub3(d, a)));
    if (inside && dot3(n, sub3(p0, inside)) < 0) { a = p0; b = p3; c = p2; d = p1; ua = uv[0]; ub = uv[3]; uc = uv[2]; ud = uv[1]; n = [-n[0], -n[1], -n[2]]; }
    this._push([a, b, c, d], [ua, ub, uc, ud], n, col);
    this.i.push(this.count - 4, this.count - 3, this.count - 2, this.count - 4, this.count - 2, this.count - 1);
  }
  tri(p0, p1, p2, uv, col = [1, 1, 1], inside = null) {
    let a = p0, b = p1, c = p2, ua = uv[0], ub = uv[1], uc = uv[2];
    let n = norm3(cross3(sub3(b, a), sub3(c, a)));
    if (inside && dot3(n, sub3(p0, inside)) < 0) { b = p2; c = p1; ub = uv[2]; uc = uv[1]; n = [-n[0], -n[1], -n[2]]; }
    this._push([a, b, c], [ua, ub, uc], n, col);
    this.i.push(this.count - 3, this.count - 2, this.count - 1);
  }
  // quad with a given (smooth) normal, no auto-orientation
  quadN(ps, uvs, n, col) {
    this._push(ps, uvs, n, col);
    this.i.push(this.count - 4, this.count - 3, this.count - 2, this.count - 4, this.count - 2, this.count - 1);
  }
  // free-form triangle with explicit per-vertex normals
  triN(ps, ns, uvs, col) {
    for (let k = 0; k < 3; k++) { this.p.push(...ps[k]); this.n.push(...ns[k]); this.u.push(...uvs[k]); this.c.push(...col); }
    this.count += 3; this.i.push(this.count - 3, this.count - 2, this.count - 1);
  }
  _push(ps, uvs, n, col) {
    for (let k = 0; k < ps.length; k++) { this.p.push(ps[k][0], ps[k][1], ps[k][2]); this.n.push(n[0], n[1], n[2]); this.u.push(uvs[k][0], uvs[k][1]); this.c.push(col[0], col[1], col[2]); }
    this.count += ps.length;
  }
  // axis-aligned-in-local-frame box helper: tf(lx,ly,lz) -> world
  box(tf, x0, y0, z0, x1, y1, z1, uvScale, col, skipBottom = true) {
    const P = (x, y, z) => tf(x, y, z);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, ins = tf(cx, cy, cz);
    const s = 1 / uvScale;
    this.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), [[x0 * s, y0 * s], [x1 * s, y0 * s], [x1 * s, y1 * s], [x0 * s, y1 * s]], col, ins);
    this.quad(P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), [[x0 * s, y0 * s], [x1 * s, y0 * s], [x1 * s, y1 * s], [x0 * s, y1 * s]], col, ins);
    this.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), [[z0 * s, y0 * s], [z1 * s, y0 * s], [z1 * s, y1 * s], [z0 * s, y1 * s]], col, ins);
    this.quad(P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), [[z0 * s, y0 * s], [z1 * s, y0 * s], [z1 * s, y1 * s], [z0 * s, y1 * s]], col, ins);
    this.quad(P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0), [[x0 * s, z1 * s], [x1 * s, z1 * s], [x1 * s, z0 * s], [x0 * s, z0 * s]], col, ins);
    if (!skipBottom) this.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), [[x0 * s, z0 * s], [x1 * s, z0 * s], [x1 * s, z1 * s], [x0 * s, z1 * s]], col, ins);
  }
  cylinder(cx, y0, cz, r0, r1, h, seg, uvScale, col, cap = true, capCol = null) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], p1 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      const p2 = [cx + Math.cos(a1) * r1, y0 + h, cz + Math.sin(a1) * r1], p3 = [cx + Math.cos(a0) * r1, y0 + h, cz + Math.sin(a0) * r1];
      const L = (Math.PI * 2 * r0) / uvScale / seg;
      this.quad(p0, p1, p2, p3, [[k * L, 0], [(k + 1) * L, 0], [(k + 1) * L, h / uvScale], [k * L, h / uvScale]], col, [cx, y0 + h / 2, cz]);
    }
    if (cap) for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      this.tri([cx, y0 + h, cz], [cx + Math.cos(a1) * r1, y0 + h, cz + Math.sin(a1) * r1], [cx + Math.cos(a0) * r1, y0 + h, cz + Math.sin(a0) * r1], [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]], capCol || col, [cx, y0, cz]);
    }
  }
  get empty() { return this.count === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

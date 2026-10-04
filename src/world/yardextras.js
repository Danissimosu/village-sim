// Yard extras for the procedural houses (all merged into a few static, chunked meshes): woodpiles, beehives (пасіка),
// sunflowers, hollyhocks/flower beds along the wall and a bench by the door (лавка). Seeded per house; no layout RNG is touched.
import * as THREE from 'three';
import { VB } from './fauna.js';
import { mulberry32 } from '../util.js';

const WOOD = [[0.5, 0.36, 0.22], [0.44, 0.31, 0.19], [0.55, 0.4, 0.25], [0.4, 0.28, 0.17]];
const HIVE = [[0.25, 0.45, 0.75], [0.95, 0.8, 0.2], [0.35, 0.65, 0.4], [0.92, 0.92, 0.88], [0.85, 0.4, 0.25]];
const FLOWER = [[0.9, 0.25, 0.4], [0.95, 0.6, 0.7], [0.95, 0.95, 0.9], [0.9, 0.7, 0.15], [0.75, 0.2, 0.55], [0.85, 0.3, 0.2]];
const GREEN = [0.2, 0.42, 0.14];

export class YardExtras {
  constructor(scene, world, layout, rasters) {
    this.group = new THREE.Group(); this.group.name = 'yardextras'; scene.add(this.group);
    const houses = layout.buildings.filter((b) => b.kind === 'house' && !b.civic && !b.hero && !b.osm && b.style && Math.abs(b.x) < 540 && Math.abs(b.z) < 540);
    const chunks = new Map(); let items = 0;
    const getChunk = (x, z) => { const k = Math.floor(x / 300) + ',' + Math.floor(z / 300); let c = chunks.get(k); if (!c) { c = new VB(); chunks.set(k, c); } return c; };
    const free = (x, z) => !rasters.blockedAt(x, z);
    for (const b of houses) {
      const r = mulberry32(((b.style.seed ^ 0x6a09e667) >>> 0) || 1), R = () => r();
      const c = Math.cos(b.rot), s = Math.sin(b.rot), hw = b.w / 2, hd = b.d / 2;
      const W2 = (x, z) => [b.x + c * x - s * z, b.z + s * x + c * z];
      const out = getChunk(b.x, b.z);
      const L = new VB();            // local item geometry, then transformed into the chunk
      const flush = (ox, oz, gy, yaw) => { // local (x,z) in house frame -> world, extra yaw
        const cy = Math.cos(b.rot + yaw), sy = Math.sin(b.rot + yaw);
        for (let i = 0; i < L.p.length; i += 3) {
          const x = L.p[i], y = L.p[i + 1], z = L.p[i + 2], nx = L.n[i], nz = L.n[i + 2];
          out.p.push(ox + cy * x - sy * z, gy + y, oz + sy * x + cy * z); out.n.push(cy * nx - sy * nz, L.n[i + 1], sy * nx + cy * nz);
        }
        for (const v of L.c) out.c.push(v);
        L.p = []; L.n = []; L.c = []; items++;
      };
      const doorA = b.door ? (b.door[0] - b.x) * c + (b.door[1] - b.z) * s : 0;
      // ---- woodpile beside the house (local axes: item x along the pile)
      if (R() < 0.38) {
        const sx = R() < 0.5 ? -1 : 1, lx = sx * (hw + 1.6 + R()), lz = -hd * (0.1 + R() * 0.6);
        const [wx, wz] = W2(lx, lz);
        if (free(wx, wz) && free(...W2(lx, lz + 1.2)) && free(...W2(lx, lz - 1.2))) {
          for (let k = 0; k < 4; k++) L.box(-0.3, k * 0.28, -1.0 + k * 0.03, 0.3, k * 0.28 + 0.27, 1.0 - k * 0.03, WOOD[(k + Math.floor(R() * 4)) % 4]);
          L.box(-0.34, 0, -1.04, -0.26, 0.5, -0.94, [0.3, 0.22, 0.14]); L.box(-0.34, 0, 0.94, -0.26, 0.5, 1.04, [0.3, 0.22, 0.14]);
          flush(wx, wz, world.heightAt(wx, wz) - 0.03, Math.PI / 2);
        }
      }
      // ---- beehives (пасіка) in the back yard
      if (R() < 0.14) {
        const n = 2 + Math.floor(R() * 3), lz0 = -hd - 4.5 - R() * 3, lx0 = (R() - 0.5) * b.w * 0.6;
        for (let k = 0; k < n; k++) {
          const lx = lx0 + k * 1.1, [wx, wz] = W2(lx, lz0); if (!free(wx, wz)) continue;
          const col = HIVE[Math.floor(R() * HIVE.length)];
          L.box(-0.2, 0, -0.2, -0.14, 0.32, -0.14, WOOD[3]); L.box(0.14, 0, -0.2, 0.2, 0.32, -0.14, WOOD[3]); L.box(-0.2, 0, 0.14, -0.14, 0.32, 0.2, WOOD[3]); L.box(0.14, 0, 0.14, 0.2, 0.32, 0.2, WOOD[3]);
          L.box(-0.27, 0.32, -0.23, 0.27, 0.78, 0.23, col); L.box(-0.31, 0.78, -0.27, 0.31, 0.84, 0.27, [0.85, 0.85, 0.85]); L.box(-0.05, 0.32, 0.23, 0.05, 0.38, 0.27, [0.1, 0.1, 0.1]);
          flush(wx, wz, world.heightAt(wx, wz), 0);
        }
      }
      // ---- sunflowers in the back yard (a loose group)
      if (R() < 0.3) {
        const n = 4 + Math.floor(R() * 4), lz0 = -hd - 3 - R() * 5, lx0 = (R() - 0.5) * b.w;
        for (let k = 0; k < n; k++) {
          const lx = lx0 + (R() - 0.5) * 3, lz = lz0 + (R() - 0.5) * 2, [wx, wz] = W2(lx, lz); if (!free(wx, wz)) continue;
          const h = 1.5 + R() * 0.7;
          L.box(-0.025, 0, -0.025, 0.025, h, 0.025, GREEN); L.box(-0.2, h - 0.08, 0.02, 0.2, h + 0.3, 0.07, [0.95, 0.75, 0.1]); L.box(-0.11, h, 0.07, 0.11, h + 0.22, 0.1, [0.25, 0.14, 0.06]);
          L.box(-0.2, h * 0.5, -0.02, -0.03, h * 0.5 + 0.05, 0.02, GREEN);
          flush(wx, wz, world.heightAt(wx, wz), (R() - 0.5) * 1.2);
        }
      }
      // ---- flowers (мальви / чорнобривці) along the front wall + a bench
      const front = (a) => W2(a, hd + 0.5);
      if (R() < 0.55) {
        const n = 3 + Math.floor(R() * 4), tall = R() < 0.5;
        for (let k = 0; k < n; k++) {
          const a = (R() - 0.5) * (b.w - 1.5); if (Math.abs(a - doorA) < 2.4) continue;
          const [wx, wz] = front(a), h = tall ? 1.1 + R() * 0.6 : 0.35 + R() * 0.2, col = FLOWER[Math.floor(R() * FLOWER.length)];
          L.box(-0.03, 0, -0.03, 0.03, h, 0.03, GREEN);
          if (tall) { for (let j = 0; j < 3; j++) L.box(-0.09, h * (0.45 + j * 0.2), -0.09, 0.09, h * (0.45 + j * 0.2) + 0.14, 0.09, col); } else L.box(-0.14, h - 0.05, -0.14, 0.14, h + 0.1, 0.14, col);
          flush(wx, wz, world.heightAt(wx, wz), 0);
        }
      }
      if (R() < 0.4) {
        const sg = R() < 0.5 ? -1 : 1, a = doorA + sg * (2.6 + R() * 0.6);
        if (Math.abs(a) < hw - 0.9) {
          const [wx, wz] = W2(a, hd + 0.42);
          const col = R() < 0.5 ? [0.45, 0.3, 0.18] : [0.2, 0.4, 0.28];
          L.box(-0.7, 0.42, -0.2, 0.7, 0.47, 0.2, col); L.box(-0.7, 0.62, -0.24, 0.7, 0.88, -0.19, col); L.box(-0.6, 0, -0.18, -0.52, 0.42, 0.18, [0.25, 0.2, 0.15]); L.box(0.52, 0, -0.18, 0.6, 0.42, 0.18, [0.25, 0.2, 0.15]);
          flush(wx, wz, world.heightAt(wx, wz), 0); // faces +z (away from the wall -> toward the yard)
          void 0;
        }
      }
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    this.tris = 0;
    for (const vb of chunks.values()) {
      if (!vb.p.length) continue;
      const m = new THREE.Mesh(vb.build(), mat); m.receiveShadow = true; m.castShadow = false; this.group.add(m); this.tris += vb.p.length / 9;
    }
    this.items = items;
  }
}

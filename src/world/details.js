// Street furniture & farm details: street lamps (glow at night), road signs, haystacks and round bales. All instanced / merged.
import * as THREE from 'three';
import { VB } from './fauna.js';
import { mulberry32, distPointSeg } from '../util.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,230,170,1)'); gr.addColorStop(0.25, 'rgba(255,200,110,0.55)'); gr.addColorStop(1, 'rgba(255,170,70,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function signAtlas() { // 4 signs in a 2x2 atlas: speed 40, give way, pedestrian crossing, village (road end)
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S * 2; const g = c.getContext('2d');
  g.fillStyle = '#888'; g.fillRect(0, 0, S * 2, S * 2);
  const cell = (i, fn) => { g.save(); g.translate((i % 2) * S, Math.floor(i / 2) * S); fn(); g.restore(); };
  cell(0, () => { g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.fillStyle = '#d4202a'; g.beginPath(); g.arc(S / 2, S / 2, 60, 0, 7); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(S / 2, S / 2, 45, 0, 7); g.fill(); g.fillStyle = '#111'; g.font = '700 54px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('40', S / 2, S / 2 + 3); });
  cell(1, () => { g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.fillStyle = '#d4202a'; g.beginPath(); g.moveTo(8, 18); g.lineTo(120, 18); g.lineTo(64, 116); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(26, 28); g.lineTo(102, 28); g.lineTo(64, 94); g.closePath(); g.fill(); });
  cell(2, () => { g.fillStyle = '#1b5fb5'; g.fillRect(0, 0, S, S); g.fillStyle = '#fff'; g.fillRect(8, 8, S - 16, S - 16); g.fillStyle = '#1b5fb5'; g.fillRect(14, 14, S - 28, S - 28); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(64, 24); g.lineTo(100, 90); g.lineTo(28, 90); g.closePath(); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(64, 62, 7, 0, 7); g.fill(); g.fillRect(60, 68, 8, 16); });
  cell(3, () => { g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.fillStyle = '#e8b800'; g.save(); g.translate(64, 64); g.rotate(Math.PI / 4); g.fillRect(-42, -42, 84, 84); g.fillStyle = '#fff'; g.fillRect(-32, -32, 64, 64); g.fillStyle = '#e8b800'; g.fillRect(-26, -26, 52, 52); g.restore(); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class Details {
  constructor(scene, world, layout, rasters, nav) {
    this.group = new THREE.Group(); this.group.name = 'details'; scene.add(this.group);
    const rng = mulberry32(8675309);
    const roads = world.json.roads.filter((r) => r.pts.length >= 2);
    const houses = layout.buildings.filter((b) => b.kind === 'house');
    const hgrid = new Map(); const hk = (x, z) => Math.floor(x / 40) * 4099 + Math.floor(z / 40);
    for (const b of houses) { const k = hk(b.x, b.z); if (!hgrid.has(k)) hgrid.set(k, []); hgrid.get(k).push(b); }
    const housesNear = (x, z, r) => { let n = 0; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = hgrid.get(hk(x + i * 40, z + j * 40)); if (a) for (const b of a) if (Math.hypot(b.x - x, b.z - z) < r) n++; } return n; };
    const clearOf = (x, z) => !rasters.blockedAt(x, z) && !world.ponds.some((p) => x > p.bb.x0 - 3 && x < p.bb.x1 + 3 && z > p.bb.z0 - 3 && z < p.bb.z1 + 3 && p.pts.some((q) => Math.hypot(q[0] - x, q[1] - z) < 12));

    // ---------- street lamps
    const lamps = [];
    for (const r of roads) {
      if (!['residential', 'unclassified', 'tertiary'].includes(r.kind)) continue;
      let acc = 25 + rng() * 30;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) continue;
        const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
        for (let d = acc; d < L; d += 52 + rng() * 10) {
          const side = lamps.length % 2 ? 1 : -1, off = r.w / 2 + 1.1;
          const x = a[0] + dx * d - dz * off * side, z = a[1] + dz * d + dx * off * side;
          acc = d + 52;
          if (Math.abs(x) > 520 || Math.abs(z) > 520) continue;
          if (housesNear(x, z, 45) < 2 || !clearOf(x, z)) continue;
          lamps.push({ x, z, ang: Math.atan2(-dx * side, dz * side) });
        }
        acc = Math.max(0, acc - L);
      }
    }
    // lamp geometry: pole + arm + head (local +x points to the road)
    const lg = new VB(); const GREY = [0.45, 0.46, 0.48], DK = [0.2, 0.2, 0.22];
    lg.cylY(0, 0, 0, 0.1, 6.0, GREY, 6); lg.box(-0.05, 5.8, -0.05, 1.15, 5.95, 0.05, GREY); lg.box(0.85, 5.7, -0.14, 1.4, 5.82, 0.14, DK); lg.box(0.85, 5.82, -0.14, 1.4, 5.86, 0.14, [0.7, 0.7, 0.72]);
    const poleM = new THREE.InstancedMesh(lg.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 }), Math.max(1, lamps.length));
    const gg = new VB(); gg.box(0.9, 5.66, -0.1, 1.35, 5.7, 0.1, [1, 1, 1]);
    this.lampGlowMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const headM = new THREE.InstancedMesh(gg.build(), this.lampGlowMat, Math.max(1, lamps.length));
    const glowPts = [];
    lamps.forEach((l, i) => {
      const y = world.heightAt(l.x, l.z) - 0.1;
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -l.ang); _p.set(l.x, y, l.z); _m.compose(_p, _q, _s); poleM.setMatrixAt(i, _m); headM.setMatrixAt(i, _m);
      glowPts.push(l.x + Math.cos(l.ang) * 1.12, y + 5.62, l.z + Math.sin(l.ang) * 1.12);
    });
    poleM.count = headM.count = lamps.length; poleM.castShadow = true; poleM.frustumCulled = headM.frustumCulled = false;
    this.group.add(poleM, headM);
    const gp = new THREE.BufferGeometry(); gp.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
    this.glowMat = new THREE.PointsMaterial({ map: glowTexture(), size: 7, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false });
    this.glow = new THREE.Points(gp, this.glowMat); this.glow.frustumCulled = false; this.group.add(this.glow);
    this.lampCount = lamps.length;

    // ---------- road signs (merged, textured atlas)
    const tex = signAtlas();
    const sg = new THREE.BufferGeometry(); const P = [], N = [], UV = [], I = [];
    const cellUV = [[0, 0.5], [0.5, 0.5], [0, 0], [0.5, 0]];
    const addSign = (x, z, ang, type, h = 2.2, sz = 0.6) => {
      const y = world.heightAt(x, z), c = Math.cos(ang), s = Math.sin(ang); // sign faces (cos, sin)
      const rt = [-s, c]; // right vector
      const base = P.length / 3, [u0, v0] = cellUV[type];
      for (const [px, py] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(x + rt[0] * px * sz / 2 + c * 0.06, y + h + py * sz / 2 + sz / 2, z + rt[1] * px * sz / 2 + s * 0.06); N.push(c, 0, s); UV.push(u0 + (px > 0 ? 0.5 : 0) , v0 + (py > 0 ? 0.5 : 0)); }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      // back (grey)
      const b2 = P.length / 3;
      for (const [px, py] of [[1, -1], [-1, -1], [-1, 1], [1, 1]]) { P.push(x + rt[0] * px * sz / 2 - c * 0.0, y + h + py * sz / 2 + sz / 2, z + rt[1] * px * sz / 2 - s * 0.0); N.push(-c, 0, -s); UV.push(0.25, 0.25); }
      I.push(b2, b2 + 1, b2 + 2, b2, b2 + 2, b2 + 3);
      return [x, y, z];
    };
    const poles = new VB();
    const addPole = (x, z, h = 2.9) => poles.cylY(x, world.heightAt(x, z) - 0.05, z, 0.035, h, [0.6, 0.6, 0.62], 5);
    let nSigns = 0;
    const sign = (x, z, ang, type, h = 2.2) => { if (!clearOf(x, z)) return; addSign(x, z, ang, type, h); addPole(x, z, h + 0.35); nSigns++; };
    // speed limit on the trunk (both ends of the village stretch) every ~220 m
    for (const r of roads) {
      if (r.kind !== 'trunk') continue;
      let acc = 60;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) continue; const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
        for (let d = acc; d < L; d += 230) {
          const off = r.w / 2 + 2.2, x = a[0] + dx * d - dz * off, z = a[1] + dz * d + dx * off;
          if (Math.abs(x) < 530 && Math.abs(z) < 530) sign(x, z, Math.atan2(-dz, -dx), 0); // faces back toward drivers coming along +d
        }
        acc = Math.max(0, acc - L);
      }
    }
    // give-way signs on minor roads ending at a larger road
    const segs = layout.roadSegs;
    for (const r of roads) {
      if (!['residential', 'unclassified', 'service'].includes(r.kind)) continue;
      for (const end of [0, 1]) {
        const p = end ? r.pts[r.pts.length - 1] : r.pts[0], q = end ? r.pts[r.pts.length - 2] : r.pts[1]; if (!q) continue;
        let ok = false; for (const s of segs) { if (s[5] !== 'trunk' && s[5] !== 'residential' && s[5] !== 'unclassified' && s[5] !== 'tertiary') continue; if (distPointSeg(p[0], p[1], s[0], s[1], s[2], s[3]) < s[4] + 3 && Math.hypot(s[0] - q[0], s[1] - q[1]) > 0.1) { ok = true; break; } }
        if (!ok || Math.abs(p[0]) > 520 || Math.abs(p[1]) > 520) continue;
        const dx = p[0] - q[0], dz = p[1] - q[1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L; // direction toward the junction
        const x = p[0] - ux * (r.w / 2 + 6) + uz * (r.w / 2 + 1.0), z = p[1] - uz * (r.w / 2 + 6) - ux * (r.w / 2 + 1.0);
        sign(x, z, Math.atan2(-uz, -ux), 1);
      }
    }
    // pedestrian crossing signs at the shops and the school
    for (const sh of [...nav.shops.map((s) => s.house), nav.school && nav.school.house].filter(Boolean)) {
      let best = null, bd = 1e9; for (const s of segs) { const d = distPointSeg(sh.x, sh.z, s[0], s[1], s[2], s[3]); if (d < bd && s[5] !== 'trunk') { bd = d; best = s; } }
      if (!best || bd > 40) continue;
      const L = Math.hypot(best[2] - best[0], best[3] - best[1]) || 1, dx = (best[2] - best[0]) / L, dz = (best[3] - best[1]) / L;
      const t = Math.max(0, Math.min(L, (sh.x - best[0]) * dx + (sh.z - best[1]) * dz)), cx = best[0] + dx * t, cz = best[1] + dz * t;
      const sd = ((sh.x - cx) * -dz + (sh.z - cz) * dx) >= 0 ? 1 : -1;
      for (const k of [-1, 1]) sign(cx + dx * k * 14 - dz * sd * (best[4] + 1.0), cz + dz * k * 14 + dx * sd * (best[4] + 1.0), Math.atan2(dz * k, dx * k) + Math.PI, 2);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); sg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); sg.setIndex(I);
    if (P.length) { sg.computeBoundingSphere(); const sm = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide })); sm.castShadow = false; this.group.add(sm); }
    const pm = new THREE.Mesh(poles.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 })); this.group.add(pm);
    this.signCount = nSigns;

    // ---------- haystacks beside barns / bales on fields
    const hay = new VB(); const GOLD = [0.78, 0.62, 0.28], GOLD2 = [0.65, 0.5, 0.22];
    for (let k = 0; k < 8; k++) { const y0 = k / 8 * 2.8, y1 = (k + 1) / 8 * 2.8, r0 = 1.7 * (1 - (k / 8) ** 1.6 * 0.9) , r1 = 1.7 * (1 - ((k + 1) / 8) ** 1.6 * 0.9); const col = k % 2 ? GOLD : GOLD2; for (let i = 0; i < 8; i++) { const a0 = i / 8 * 6.283, a1 = (i + 1) / 8 * 6.283; hay.quad([Math.cos(a0) * r0, y0, Math.sin(a0) * r0], [Math.cos(a1) * r0, y0, Math.sin(a1) * r0], [Math.cos(a1) * r1, y1, Math.sin(a1) * r1], [Math.cos(a0) * r1, y1, Math.sin(a0) * r1], col); } }
    hay.box(-0.06, 0, -0.06, 0.06, 3.2, 0.06, [0.4, 0.3, 0.2]);
    const bale = new VB(); bale.cylZ(0, 0.65, 0, 0.65, 1.2, [0.82, 0.7, 0.35], 10);
    const stacks = [], bales = [];
    for (const b of layout.buildings) if (b.kind === 'barn' && Math.abs(b.x) < 520 && Math.abs(b.z) < 520 && rng() < 0.7) {
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      for (let t = 0; t < 4; t++) { const ox = (b.w / 2 + 2.6 + rng() * 2) * (rng() < 0.5 ? -1 : 1), oz = (rng() - 0.5) * b.d; const x = b.x + c * ox - s * oz, z = b.z + s * ox + c * oz; if (clearOf(x, z) && !stacks.some((q) => Math.hypot(q[0] - x, q[1] - z) < 4)) { stacks.push([x, z, 0.8 + rng() * 0.4]); break; } }
    }
    for (const g of layout.gardens) if (rng() < 0.05) { const x = g.cx + 6, z = g.cz; if (Math.abs(x) < 500 && clearOf(x, z)) stacks.push([x, z, 0.7 + rng() * 0.3]); }
    for (const a of world.json.areas) {
      if (a.kind !== 'farmland' || a.pts.length < 3) continue;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of a.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      let n = 0; for (let t = 0; t < 80 && n < 5; t++) { const x = x0 + rng() * (x1 - x0), z = z0 + rng() * (z1 - z0); if (Math.abs(x) > 520 || Math.abs(z) > 520) continue; if (!pointIn(a.pts, x, z)) continue; if (!clearOf(x, z)) continue; bales.push([x, z, rng() * 6.28]); n++; if (rng() < 0.5) bales.push([x + 1.5, z + 0.3, rng() * 6.28]); }
    }
    const hayM = new THREE.InstancedMesh(hay.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), Math.max(1, stacks.length));
    stacks.forEach((s, i) => { _p.set(s[0], world.heightAt(s[0], s[1]) - 0.05, s[1]); _q.identity(); _s.set(s[2], s[2], s[2]); _m.compose(_p, _q, _s); hayM.setMatrixAt(i, _m); });
    hayM.count = stacks.length; hayM.castShadow = true; hayM.frustumCulled = false; this.group.add(hayM);
    const baleM = new THREE.InstancedMesh(bale.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), Math.max(1, bales.length));
    bales.forEach((s, i) => { _p.set(s[0], world.heightAt(s[0], s[1]) - 0.02, s[1]); _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s[2]); _s.set(1, 1, 1); _m.compose(_p, _q, _s); baleM.setMatrixAt(i, _m); });
    baleM.count = bales.length; baleM.castShadow = true; baleM.frustumCulled = false; this.group.add(baleM);
    this.hayCount = stacks.length; this.baleCount = bales.length;
    void _e;
  }
  // night factor 0..1
  update(night) {
    const n = Math.max(0, Math.min(1, night));
    this.glowMat.opacity = n * 0.9; this.glow.visible = n > 0.02;
    this.lampGlowMat.color.setRGB(0.14 + 1.0 * n, 0.14 + 0.82 * n, 0.14 + 0.5 * n);
  }
}
function pointIn(pts, x, z) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; }

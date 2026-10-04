// Farming: the owned vegetable beds of plots 35Б and 84 are split into cells; seeds -> growth (game hours) -> harvest.
// State is a plain object kept in the save: farm[id] = { c: crop, p: progress (game hours), w: wet-until (absolute game hour) }.
import * as THREE from 'three';

export const CROPS = {
  potato: { name: 'Картофель', icon: '🥔', seed: 'seed_potato', hours: 6, yield: [7, 9], bush: 0x4a8a2c, fruit: 0xf2e9c8, fy: 0.5, fs: 0.07 },
  carrot: { name: 'Морковь', icon: '🥕', seed: 'seed_carrot', hours: 4, yield: [9, 12], bush: 0x66a83a, fruit: 0xe8801c, fy: 0.04, fs: 0.1 },
  tomato: { name: 'Помидоры', icon: '🍅', seed: 'seed_tomato', hours: 8, yield: [5, 7], bush: 0x3c7a2a, fruit: 0xd83222, fy: 0.3, fs: 0.1 },
};
export const CROP_KEYS = Object.keys(CROPS);

export function createFarm({ scene, world, layout }) {
  const plots = [];
  for (const g of layout.gardens) {
    if (!g.own) continue;
    const n = Math.max(1, Math.floor(g.d / 5)), cd = g.d / n, c = Math.cos(g.rot), s = Math.sin(g.rot);
    for (let k = 0; k < n; k++) {
      const vc = -g.d / 2 + cd * (k + 0.5);
      const plot = { id: `${Math.round(g.cx)},${Math.round(g.cz)}:${k}`, g, c, s, vc, cd, hw: g.w / 2, cells: [], base: 0 };
      const rows = Math.max(2, Math.floor((cd - 1.0) / 0.9)), cols = Math.max(3, Math.floor((g.w - 1.0) / 0.8));
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        const u = (q - (cols - 1) / 2) * 0.8, v = vc + (r - (rows - 1) / 2) * 0.9;
        const x = g.cx + c * u - s * v, z = g.cz + s * u + c * v;
        plot.cells.push({ x, z, y: world.heightAt(x, z), rnd: ((q * 7 + r * 13 + k * 5) % 10) / 10 });
      }
      plots.push(plot);
    }
  }
  let total = 0; for (const p of plots) { p.base = total; total += p.cells.length; }
  const cap = Math.max(1, total);

  const bushGeo = new THREE.ConeGeometry(0.2, 0.5, 6); bushGeo.translate(0, 0.25, 0);
  const fruitGeo = new THREE.IcosahedronGeometry(1, 0);
  const mat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  const bushes = new THREE.InstancedMesh(bushGeo, mat(), cap), fruits = new THREE.InstancedMesh(fruitGeo, mat(), cap);
  for (const m of [bushes, fruits]) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.count = total; scene.add(m); }
  const dummy = new THREE.Object3D(), col = new THREE.Color(), seedCol = new THREE.Color(0x7bbf45);
  const hide = (i) => { dummy.position.set(0, -50, 0); dummy.scale.setScalar(0.0001); dummy.updateMatrix(); bushes.setMatrixAt(i, dummy.matrix); fruits.setMatrixAt(i, dummy.matrix); };
  for (let i = 0; i < total; i++) hide(i);
  const shown = new Map();   // plot id -> last quantised stage drawn

  const frac = (st) => (st ? Math.min(1, st.p / CROPS[st.c].hours) : 0);
  const draw = (plot, st) => {
    if (!st) { for (let i = 0; i < plot.cells.length; i++) hide(plot.base + i); }
    else {
      const f = frac(st), cr = CROPS[st.c], ripe = f >= 1, sc = 0.25 + 0.75 * f;
      for (let i = 0; i < plot.cells.length; i++) {
        const cell = plot.cells[i], idx = plot.base + i, j = 0.85 + cell.rnd * 0.3;
        dummy.position.set(cell.x, cell.y, cell.z); dummy.rotation.set(0, cell.rnd * 6.28, 0); dummy.scale.set(sc * j, sc * j * (st.c === 'tomato' ? 1.7 : st.c === 'potato' ? 1.2 : 0.8), sc * j); dummy.updateMatrix();
        bushes.setMatrixAt(idx, dummy.matrix);
        col.setHex(cr.bush).lerp(seedCol, (1 - f) * 0.7); bushes.setColorAt(idx, col);
        if (f > 0.55) {
          const fs = cr.fs * Math.min(1, (f - 0.5) * 2.2);
          dummy.position.set(cell.x + (cell.rnd - 0.5) * 0.15, cell.y + cr.fy * sc * (st.c === 'tomato' ? 1.7 : 1.1), cell.z + (0.5 - cell.rnd) * 0.12); dummy.scale.setScalar(fs); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
          fruits.setMatrixAt(idx, dummy.matrix); col.setHex(cr.fruit); fruits.setColorAt(idx, col);
        } else { dummy.position.set(0, -50, 0); dummy.scale.setScalar(0.0001); dummy.updateMatrix(); fruits.setMatrixAt(idx, dummy.matrix); }
        void ripe;
      }
    }
    bushes.instanceMatrix.needsUpdate = true; fruits.instanceMatrix.needsUpdate = true;
    if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true; if (fruits.instanceColor) fruits.instanceColor.needsUpdate = true;
  };
  const sync = (farm) => { for (const p of plots) { const st = farm[p.id]; shown.set(p.id, st ? st.c + Math.floor(frac(st) * 12) : ''); draw(p, st); } };

  return {
    plots, CROPS, total,
    sync,
    // advance growth by dAbs game hours (rain doubles the rate, watering adds +50%); redraw plots whose stage changed
    advance(farm, dAbs, absNow, raining) {
      if (dAbs <= 0) return false; let any = false;
      for (const p of plots) {
        const st = farm[p.id]; if (!st) continue;
        const rate = 1 + (st.w > absNow ? 0.5 : 0) + (raining ? 1 : 0);
        if (st.p < CROPS[st.c].hours) { st.p = Math.min(CROPS[st.c].hours, st.p + dAbs * rate); any = true; }
        const key = st.c + Math.floor(frac(st) * 12);
        if (shown.get(p.id) !== key) { shown.set(p.id, key); draw(p, st); }
      }
      return any;
    },
    redraw(farm, plot) { shown.set(plot.id, farm[plot.id] ? farm[plot.id].c + Math.floor(frac(farm[plot.id]) * 12) : ''); draw(plot, farm[plot.id]); },
    // nearest plot the player stands at/next to, or null
    plotAt(px, pz) {
      let best = null, bd = 1e9;
      for (const p of plots) {
        const dx = px - p.g.cx, dz = pz - p.g.cz; if (Math.abs(dx) > 40 || Math.abs(dz) > 40) continue;
        const u = p.c * dx + p.s * dz, v = -p.s * dx + p.c * dz;
        if (Math.abs(u) > p.hw + 1.6 || Math.abs(v - p.vc) > p.cd / 2 + 0.9) continue;
        const d = Math.abs(v - p.vc) + Math.abs(u) * 0.1; if (d < bd) { bd = d; best = p; }
      }
      return best;
    },
    frac,
  };
}

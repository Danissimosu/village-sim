// PBR material library (Poly Haven CC0 sets: diffuse + GL normal + ARM[AO,Rough,Metal], 1K WebP) and terrain texture arrays.
import * as THREE from 'three';
import { BASE } from '../config.js';

const SETS = ['plaster', 'brick', 'wood', 'roofSlate', 'roofClay', 'roofRed'];
const TERRAIN_LAYERS = ['grass', 'dirt', 'gravel', 'asphalt', 'field']; // array index order
export const TEX_SIZE = 1024;

const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => rej(new Error('img ' + url)); i.src = url; });

export async function loadMaterials(renderer, aniso, progress = () => {}) {
  const loader = new THREE.TextureLoader();
  const maxAniso = Math.min(aniso, renderer.capabilities.getMaxAnisotropy());
  const tex = (url, srgb) => new Promise((res, rej) => loader.load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t);
  }, undefined, rej));
  const mats = {};
  let done = 0; const total = SETS.length + 1;
  await Promise.all(SETS.map(async (name) => {
    const [d, n, a] = await Promise.all([tex(`${BASE}tex/${name}_diff.webp`, true), tex(`${BASE}tex/${name}_nor.webp`, false), tex(`${BASE}tex/${name}_arm.webp`, false)]);
    const roof = name.startsWith('roof');
    mats[name] = new THREE.MeshStandardMaterial({ map: d, normalMap: n, aoMap: a, roughnessMap: a, roughness: 1, metalness: 0, vertexColors: true, side: roof ? THREE.DoubleSide : THREE.FrontSide, normalScale: new THREE.Vector2(1, 1) });
    progress(++done / total);
  }));

  // terrain: 3 texture arrays (diffuse sRGB, normal, ARM), one layer per ground type.
  const arrays = {};
  const N = TEX_SIZE, layerBytes = N * N * 4;
  const cv = document.createElement('canvas'); cv.width = cv.height = N; const cx = cv.getContext('2d', { willReadFrequently: true });
  for (const [key, suffix] of [['diff', 'diff'], ['nor', 'nor'], ['arm', 'arm']]) {
    const data = new Uint8Array(layerBytes * TERRAIN_LAYERS.length);
    const imgs = await Promise.all(TERRAIN_LAYERS.map((l) => loadImg(`${BASE}tex/${l}_${suffix}.webp`)));
    imgs.forEach((img, li) => {
      cx.clearRect(0, 0, N, N); cx.drawImage(img, 0, 0, N, N);
      const px = cx.getImageData(0, 0, N, N).data;
      // flip rows so that v increases upwards like a regular flipY texture (keeps GL normal-map convention)
      for (let y = 0; y < N; y++) data.set(px.subarray((N - 1 - y) * N * 4, (N - y) * N * 4), li * layerBytes + y * N * 4);
    });
    const t = new THREE.DataArrayTexture(data, N, N, TERRAIN_LAYERS.length);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = maxAniso;
    if (key === 'diff') t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true; arrays[key] = t;
    progress(Math.min(0.99, ++done / total + 0.1 * (key === 'arm')));
  }
  return { mats, arrays };
}

export function setAnisotropy(materials, level) {
  const seen = new Set();
  const visit = (t) => { if (t && !seen.has(t)) { seen.add(t); t.anisotropy = level; } };
  Object.values(materials.mats).forEach((m) => { visit(m.map); visit(m.normalMap); visit(m.aoMap); });
  Object.values(materials.arrays).forEach(visit);
}

// ---- optional 2K texture pack (diffuse + normal of the building materials, diffuse of the terrain layers)
const BUILD_SETS = ['plaster', 'brick', 'wood', 'roofSlate', 'roofClay', 'roofRed'];
export async function setTextureQuality(materials, terrainMesh, level, aniso, progress = () => {}) {
  const st = materials._tq || (materials._tq = { level: '1k', lo: null, hi: null, busy: false });
  if (st.busy || st.level === level) return st.level;
  st.busy = true;
  try {
    if (!st.lo) { st.lo = { build: {}, terrainDiff: materials.arrays.diff }; for (const n of BUILD_SETS) st.lo.build[n] = { map: materials.mats[n].map, nor: materials.mats[n].normalMap }; }
    if (level === '2k' && !st.hi) {
      const loader = new THREE.TextureLoader(); const hi = { build: {}, terrainDiff: null }; let done = 0; const total = BUILD_SETS.length + 1;
      const tex = (url, srgb) => new Promise((res, rej) => loader.load(url, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, rej));
      for (const n of BUILD_SETS) { const [map, nor] = await Promise.all([tex(`${BASE}tex2k/${n}_diff.webp`, true), tex(`${BASE}tex2k/${n}_nor.webp`, false)]); hi.build[n] = { map, nor }; progress(++done / total); }
      const N = 2048, layerBytes = N * N * 4, data = new Uint8Array(layerBytes * TERRAIN_LAYERS.length);
      const cv = document.createElement('canvas'); cv.width = cv.height = N; const cx = cv.getContext('2d', { willReadFrequently: true });
      for (let li = 0; li < TERRAIN_LAYERS.length; li++) {
        const img = await loadImg(`${BASE}tex2k/${TERRAIN_LAYERS[li]}_diff.webp`);
        cx.clearRect(0, 0, N, N); cx.drawImage(img, 0, 0, N, N); const px = cx.getImageData(0, 0, N, N).data;
        for (let y = 0; y < N; y++) data.set(px.subarray((N - 1 - y) * N * 4, (N - y) * N * 4), li * layerBytes + y * N * 4);
        await new Promise((r) => setTimeout(r, 0));
      }
      const t = new THREE.DataArrayTexture(data, N, N, TERRAIN_LAYERS.length);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = aniso; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
      hi.terrainDiff = t; st.hi = hi;
    }
    const from = level === '2k' ? st.lo : st.hi, to = level === '2k' ? st.hi : st.lo;
    for (const n of BUILD_SETS) { const m = materials.mats[n]; m.map = to.build[n].map; m.normalMap = to.build[n].nor; m.needsUpdate = true; from.build[n].map.dispose(); from.build[n].nor.dispose(); }
    const U = terrainMesh.userData.U; if (U) { U.tDiff.value = to.terrainDiff; materials.arrays.diff = to.terrainDiff; }
    from.terrainDiff.dispose();
    st.level = level;
  } finally { st.busy = false; }
  return st.level;
}

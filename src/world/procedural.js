// Procedurally generated textures (canvas / typed arrays): windows, fences, foliage atlas, grass tufts, water normals, noise, signs.
import * as THREE from 'three';
import { mulberry32 } from '../util.js';

const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const canvasTex = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };

export function makeNoiseTexture(size = 256) { // tileable value noise, R = low freq, G = mid freq, B = high, A = 255
  const rng = mulberry32(5);
  const grids = [8, 16, 32].map((g) => { const a = new Float32Array(g * g); for (let i = 0; i < a.length; i++) a[i] = rng(); return { g, a }; });
  const sample = ({ g, a }, x, y) => { const fx = x * g, fy = y * g; const xi = Math.floor(fx), yi = Math.floor(fy); const tx = fx - xi, ty = fy - yi; const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty); const X = (i) => ((i % g) + g) % g; const A = a[X(yi) * g + X(xi)], B = a[X(yi) * g + X(xi + 1)], C = a[X(yi + 1) * g + X(xi)], D = a[X(yi + 1) * g + X(xi + 1)]; return (A * (1 - u) + B * u) * (1 - v) + (C * (1 - u) + D * u) * v; };
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size; const o = (y * size + x) * 4;
    const n0 = sample(grids[0], u, v), n1 = sample(grids[1], u, v), n2 = sample(grids[2], u, v);
    data[o] = (n0 * 0.65 + n1 * 0.35) * 255; data[o + 1] = (n1 * 0.5 + n2 * 0.5) * 255; data[o + 2] = n2 * 255; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export function makeWindowTextures() {
  const W = 128, H = 160;
  const draw = (lit, seed) => {
    const rng = mulberry32(seed);
    const c = mkCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = lit ? '#050403' : '#f3f1ea'; g.fillRect(0, 0, W, H);       // frame
    const fx = 9, fy = 9;
    const grd = g.createLinearGradient(0, fy, W, H - fy);
    if (lit) { grd.addColorStop(0, '#ffe2a0'); grd.addColorStop(1, '#ffb455'); } else { grd.addColorStop(0, '#7e98ae'); grd.addColorStop(0.5, '#36485a'); grd.addColorStop(1, '#1c2733'); }
    g.fillStyle = grd; g.fillRect(fx, fy, W - 2 * fx, H - 2 * fy);
    if (rng() < 0.7) { // curtains
      g.fillStyle = lit ? 'rgba(255,160,70,0.9)' : 'rgba(235,225,205,0.85)';
      g.fillRect(fx, fy, 18 + rng() * 14, H - 2 * fy - 40);
      if (rng() < 0.6) g.fillRect(W - fx - 18 - rng() * 14, fy, 28, H - 2 * fy - 40);
    }
    g.fillStyle = lit ? '#050403' : '#f3f1ea'; // mullions
    g.fillRect(W / 2 - 3, fy, 6, H - 2 * fy); g.fillRect(fx, H * 0.38, W - 2 * fx, 6);
    if (!lit) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, H - 8, W, 8); g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2); }
    return c;
  };
  const map = canvasTex(draw(false, 3)); map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  const lit = canvasTex(draw(true, 3)); lit.wrapS = lit.wrapT = THREE.ClampToEdgeWrapping;
  const mapLit = canvasTex(draw(true, 3)); mapLit.wrapS = mapLit.wrapT = THREE.ClampToEdgeWrapping;
  return { map, emissive: lit, mapLit };
}

export function makeFenceTextures() {
  const mk = (type) => {
    const W = 512, H = 128; const c = mkCanvas(W, H), g = c.getContext('2d'); g.clearRect(0, 0, W, H);
    if (type === 'picket') {
      const n = 21, pw = W / n;
      for (let i = 0; i < n; i++) {
        const x = i * pw + 4, w = pw - 8; const sh = 225 + Math.random() * 25;
        g.fillStyle = `rgb(${sh},${sh - 8},${sh - 20})`;
        g.beginPath(); g.moveTo(x, H); g.lineTo(x, 22); g.lineTo(x + w / 2, 4); g.lineTo(x + w, 22); g.lineTo(x + w, H); g.closePath(); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + w - 3, 22, 3, H);
      }
      g.fillStyle = 'rgb(190,180,165)'; g.fillRect(0, 44, W, 10); g.fillRect(0, 92, W, 10);
    } else if (type === 'board') {
      const n = 18, pw = W / n;
      for (let i = 0; i < n; i++) { const sh = 200 + Math.random() * 45; g.fillStyle = `rgb(${sh},${sh - 6},${sh - 14})`; g.fillRect(i * pw, 0, pw - 1.5, H); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(i * pw + pw - 4, 0, 2.5, H); }
    } else { // wire mesh on posts
      g.strokeStyle = 'rgba(150,155,160,1)'; g.lineWidth = 2;
      for (let i = -H; i < W + H; i += 18) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + H, H); g.stroke(); g.beginPath(); g.moveTo(i + H, 0); g.lineTo(i, H); g.stroke(); }
      g.fillStyle = 'rgb(120,120,125)'; for (let i = 0; i < 5; i++) g.fillRect(i * (W / 4) - 1 + (i === 4 ? -6 : 0), 0, 7, H);
      g.fillRect(0, 0, W, 5);
    }
    const t = canvasTex(c); t.anisotropy = 8; return t;
  };
  return { picket: mk('picket'), board: mk('board'), mesh: mk('mesh') };
}

export function makeTuftTexture() {
  const S = 128; const c = mkCanvas(S, S), g = c.getContext('2d'); g.clearRect(0, 0, S, S);
  const rng = mulberry32(11);
  for (let i = 0; i < 26; i++) {
    const bx = 14 + rng() * (S - 28), h = 55 + rng() * 68, lean = (rng() - 0.5) * 46, w = 3 + rng() * 4;
    const grd = g.createLinearGradient(0, S, 0, S - h);
    grd.addColorStop(0, '#2b4415'); grd.addColorStop(0.5, '#5f8a2c'); grd.addColorStop(1, '#a9cb55');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(bx - w, S); g.quadraticCurveTo(bx - w * 0.5 + lean * 0.3, S - h * 0.6, bx + lean, S - h); g.quadraticCurveTo(bx + w * 0.5 + lean * 0.3, S - h * 0.6, bx + w, S); g.closePath(); g.fill();
  }
  const t = canvasTex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; return t;
}

// Foliage atlas 1024x1024: [0,0]=broad leaves, [1,0]=conifer needles, [0,1]=bark, [1,1]=birch bark (each 512x512)
export const ATLAS = { leaf: [0, 0.5], needle: [0.5, 0.5], bark: [0, 0], birch: [0.5, 0] }; // uv origin (v up) of each slot
export function makeTreeAtlas() {
  const S = 1024, H = 512; const c = mkCanvas(S, S), g = c.getContext('2d'); const rng = mulberry32(99);
  g.clearRect(0, 0, S, S);
  // broad leaves (top-left slot)
  g.save(); g.beginPath(); g.rect(0, 0, H, H); g.clip();
  const leaves = ['#3f6a20', '#4f7f26', '#5c8f2b', '#6f9d34', '#86ad45', '#355c1c'];
  for (let i = 0; i < 1000; i++) {
    const r = Math.sqrt(rng()); const a = rng() * Math.PI * 2; const x = H / 2 + Math.cos(a) * r * (H / 2 - 36), y = H / 2 + Math.sin(a) * r * (H / 2 - 36);
    const rot = rng() * Math.PI * 2, len = 30 + rng() * 24, wd = 11 + rng() * 8;
    g.save(); g.translate(x, y); g.rotate(rot);
    g.fillStyle = leaves[Math.floor(rng() * leaves.length)];
    g.beginPath(); g.moveTo(-len / 2, 0); g.quadraticCurveTo(0, -wd, len / 2, 0); g.quadraticCurveTo(0, wd, -len / 2, 0); g.fill();
    g.strokeStyle = 'rgba(20,45,10,0.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke();
    g.restore();
  }
  g.restore();
  // needles (top-right slot): dense drooping branchlets (high alpha coverage so alpha-test survives mip-mapping)
  g.save(); g.translate(H, 0); g.beginPath(); g.rect(0, 0, H, H); g.clip();
  for (let b = 0; b < 15; b++) {
    const y0 = 16 + (b / 15) * (H - 60) + rng() * 10, side = b % 2 ? 1 : -1;
    const ex = H / 2 + side * (170 + rng() * 70), ey = y0 + 55 + rng() * 40;
    g.strokeStyle = `rgb(${34 + rng() * 14},${70 + rng() * 22},${30 + rng() * 10})`;
    g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.moveTo(H / 2, y0 - 10); g.quadraticCurveTo(H / 2 + side * 110, y0 - 12, ex, ey); g.stroke();
    for (let n = 0; n < 46; n++) {
      const t = rng(); const px = H / 2 + (ex - H / 2) * t, py = (y0 - 10) * (1 - t) * (1 - t) + 2 * (1 - t) * t * (y0 - 12) + ey * t * t;
      const len = 36 + rng() * 34, dir = (rng() < 0.5 ? 1 : -1);
      g.lineWidth = 5 + rng() * 3; g.strokeStyle = `rgb(${26 + rng() * 26},${74 + rng() * 44},${30 + rng() * 20})`;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + side * len * 0.35 + dir * 6, py + len * 0.9); g.stroke();
      g.beginPath(); g.moveTo(px, py); g.lineTo(px - side * len * 0.2 + dir * 3, py - len * 0.55); g.stroke();
    }
  }
  g.restore();
  // bark (bottom-left): vertical streaks
  const bark = g.getImageData(0, 0, 1, 1); void bark;
  g.fillStyle = '#4b3a2b'; g.fillRect(0, H, H, H);
  for (let i = 0; i < 700; i++) { const x = rng() * H, w = 2 + rng() * 6, y = H + rng() * H, h = 40 + rng() * 160; const s = 20 + rng() * 55; g.fillStyle = `rgba(${s},${s * 0.8},${s * 0.6},0.55)`; g.fillRect(x, y, w, h); }
  for (let i = 0; i < 300; i++) { const x = rng() * H, w = 1 + rng() * 3, y = H + rng() * H, h = 30 + rng() * 120; g.fillStyle = `rgba(150,125,95,${0.1 + rng() * 0.2})`; g.fillRect(x, y, w, h); }
  // birch bark (bottom-right)
  g.fillStyle = '#e8e4da'; g.fillRect(H, H, H, H);
  for (let i = 0; i < 140; i++) { const x = H + rng() * H, y = H + rng() * H, w = 14 + rng() * 60, h = 3 + rng() * 6; g.fillStyle = `rgba(25,25,25,${0.55 + rng() * 0.4})`; g.fillRect(x, y, w, h); }
  for (let i = 0; i < 200; i++) { const x = H + rng() * H, y = H + rng() * H; g.fillStyle = `rgba(150,140,120,${rng() * 0.25})`; g.fillRect(x, y, 4 + rng() * 20, 2 + rng() * 14); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.premultiplyAlpha = false;
  return t;
}

export function makeWaterNormals(size = 256) {
  const rng = mulberry32(31);
  const octs = [4, 8, 16, 32].map((g) => { const a = new Float32Array(g * g); for (let i = 0; i < a.length; i++) a[i] = rng(); return { g, a }; });
  const smp = ({ g, a }, x, y) => { const fx = x * g, fy = y * g; const xi = Math.floor(fx), yi = Math.floor(fy); const tx = fx - xi, ty = fy - yi; const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty); const X = (i) => ((i % g) + g) % g; return (a[X(yi) * g + X(xi)] * (1 - u) + a[X(yi) * g + X(xi + 1)] * u) * (1 - v) + (a[X(yi + 1) * g + X(xi)] * (1 - u) + a[X(yi + 1) * g + X(xi + 1)] * u) * v; };
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let s = 0, amp = 1; for (let o = 0; o < 4; o++) { s += smp(octs[o], x / size, y / size) * amp; amp *= 0.55; } h[y * size + x] = s; }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const L = h[y * size + ((x - 1 + size) % size)], R = h[y * size + ((x + 1) % size)], U = h[((y - 1 + size) % size) * size + x], D = h[((y + 1) % size) * size + x];
    const nx = (L - R) * 3.0, ny = (U - D) * 3.0, nz = 1; const l = Math.hypot(nx, ny, nz);
    const o = (y * size + x) * 4; data[o] = (nx / l * 0.5 + 0.5) * 255; data[o + 1] = (ny / l * 0.5 + 0.5) * 255; data[o + 2] = (nz / l * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; t.anisotropy = 4;
  return t;
}

export function makeSignTexture(lines, bg = '#f4f4f0', fg = '#111', border = true, w = 512, h = 256) {
  const c = mkCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (border) { g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20); }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => { const sz = l.size || 64; g.font = `bold ${sz}px "Arial", "Helvetica", sans-serif`; g.fillText(l.text, w / 2, (h * (i + 1)) / (lines.length + 1)); });
  const t = canvasTex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

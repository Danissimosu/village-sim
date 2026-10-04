// "Fears to Fathom"-style lo-fi retro look: the scene is rendered into a small (~40 %) HDR target, then a post pass applies a cold desaturated grade,
// vignette, film grain, 4x4 ordered dithering and colour banding; the canvas itself is tiny and upscaled by the browser with nearest-neighbour
// (CSS image-rendering: pixelated).  Textures are swapped for 128 px posterised nearest-filtered copies without normal maps; materials go flat-shaded.
import * as THREE from 'three';

const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tScene; uniform vec2 uRes; uniform float uTime; uniform float uDim; uniform float uSat; uniform float uLevels; uniform float uGrain;
const float B4[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec3 c = texture2D(tScene, vUv).rgb * uDim;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat) * vec3(0.90, 0.98, 1.10);          // desaturated, cold
  c = max(c, vec3(0.0));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 o = gl_FragColor.rgb;
  o = (o - 0.5) * 1.12 + 0.47;                                  // slightly crushed, hard contrast
  vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
  o *= mix(1.0, smoothstep(0.95, 0.18, length(q)), 0.62);       // vignette
  vec2 px = floor(vUv * uRes);
  float g = hash12(px + floor(uTime * 14.0) * 17.31) - 0.5;
  o += g * uGrain;                                              // film grain
  float d = B4[int(mod(px.x, 4.0)) + 4 * int(mod(px.y, 4.0))] / 16.0 - 0.5;
  o = floor(o * uLevels + 0.5 + d * 0.9) / uLevels;             // ordered dither + banding
  gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
}`;

export class LoFiPost {
  constructor(renderer) {
    this.renderer = renderer;
    const half = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
    this.rt = new THREE.WebGLRenderTarget(64, 64, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, samples: 0 });
    this.u = { tScene: { value: this.rt.texture }, uRes: { value: new THREE.Vector2(64, 64) }, uTime: { value: 0 }, uDim: { value: 1.0 }, uSat: { value: 0.5 }, uLevels: { value: 28 }, uGrain: { value: 0.07 } };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, fog: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._v = new THREE.Vector2();
  }
  resize() { const s = this.renderer.getDrawingBufferSize(this._v); const w = Math.max(8, s.x | 0), h = Math.max(8, s.y | 0); if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h); this.u.uRes.value.set(w, h); }
  render(scene, camera, time) {
    const r = this.renderer; this.u.uTime.value = time;
    r.setRenderTarget(this.rt); r.render(scene, camera);
    r.setRenderTarget(null); r.render(this.scene, this.cam);
  }
  dispose() { this.rt.dispose(); this.quad.material.dispose(); this.quad.geometry.dispose(); }
}

// ------------------------------------------------------------------ textures
const posterize = (ctx, w, h, lv) => { const im = ctx.getImageData(0, 0, w, h), d = im.data; for (let i = 0; i < d.length; i += 4) { d[i] = Math.round(d[i] / 255 * lv) / lv * 255; d[i + 1] = Math.round(d[i + 1] / 255 * lv) / lv * 255; d[i + 2] = Math.round(d[i + 2] / 255 * lv) / lv * 255; } ctx.putImageData(im, 0, 0); };
const imgOK = (t) => { const i = t && t.image; return !!i && (i instanceof HTMLImageElement || i instanceof HTMLCanvasElement || (typeof ImageBitmap !== 'undefined' && i instanceof ImageBitmap)) && (i.width || i.naturalWidth) > 0; };

export function makeLoFiTextures() {
  const cache = new Map();   // original texture -> lo-fi copy
  const lofi = (t, size = 128) => {
    if (!imgOK(t)) return null;
    let o = cache.get(t); if (o) return o;
    const iw = t.image.width || t.image.naturalWidth, ih = t.image.height || t.image.naturalHeight, w = Math.min(size, iw), h = Math.min(size, ih);
    const c = document.createElement('canvas'); c.width = w; c.height = h; const cx = c.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high'; cx.drawImage(t.image, 0, 0, w, h);
    try { posterize(cx, w, h, 14); } catch (e) { /* tainted canvas: keep */ }
    const n = new THREE.CanvasTexture(c);
    n.wrapS = t.wrapS; n.wrapT = t.wrapT; n.repeat.copy(t.repeat); n.offset.copy(t.offset); n.rotation = t.rotation; n.channel = t.channel; n.colorSpace = t.colorSpace; n.flipY = t.flipY;
    n.magFilter = THREE.NearestFilter; n.minFilter = THREE.NearestMipmapLinearFilter; n.generateMipmaps = true; n.anisotropy = 1;
    cache.set(t, n); return n;
  };
  return { lofi, cache };
}

// terrain: 5-layer texture arrays -> 128 px posterised diffuse, flat normals, constant ARM (1x1 layers)
function lofiTerrainArrays(srcDiff) {
  const img = srcDiff.image; if (!img || !img.data) return null;
  const N = img.width, L = img.depth, M = 128, f = N / M, out = new Uint8Array(M * M * 4 * L), lv = 14;
  for (let l = 0; l < L; l++) for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = 0; sy < f; sy += 2) for (let sx = 0; sx < f; sx += 2) { const o = (l * N * N + ((y * f + sy) | 0) * N + ((x * f + sx) | 0)) * 4; r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++; }
    const o = (l * M * M + y * M + x) * 4;
    out[o] = Math.round(r / n / 255 * lv) / lv * 255; out[o + 1] = Math.round(g / n / 255 * lv) / lv * 255; out[o + 2] = Math.round(b / n / 255 * lv) / lv * 255; out[o + 3] = 255;
  }
  const mk = (data, w, h, nearestMips) => { const t = new THREE.DataArrayTexture(data, w, h, L); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.minFilter = nearestMips ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter; t.generateMipmaps = !!nearestMips; t.needsUpdate = true; return t; };
  const diff = mk(out, M, M, true); diff.colorSpace = srcDiff.colorSpace;
  const nor = new Uint8Array(4 * L), arm = new Uint8Array(4 * L);
  for (let l = 0; l < L; l++) { nor.set([128, 128, 255, 255], l * 4); arm.set([255, 235, 0, 255], l * 4); }
  return { diff, nor: mk(nor, 1, 1, false), arm: mk(arm, 1, 1, false) };
}

// Switch every (non-shader) material of the scene to / from the lo-fi look.  `state` is kept between calls so the realistic look restores exactly.
export function setLoFiMaterials(state, scene, materials, terrain, on) {
  if (!!state.on === on) return;
  state.on = on;
  state.saved = state.saved || new Map(); state.tex = state.tex || makeLoFiTextures();
  const U = terrain && terrain.userData && terrain.userData.U;
  if (on) {
    const seen = new Set();
    scene.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) {
        if (seen.has(m) || m === (terrain && terrain.material) || m.isShaderMaterial || m.isRawShaderMaterial || m.isLineBasicMaterial || m.isPointsMaterial || m.isSpriteMaterial) continue;
        seen.add(m);
        if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial)) continue;
        const keep = { map: m.map, normalMap: m.normalMap, aoMap: m.aoMap, roughnessMap: m.roughnessMap, flat: m.flatShading, rough: m.roughness, bumpMap: m.bumpMap };
        state.saved.set(m, keep);
        if (m.map) { const l = state.tex.lofi(m.map, m.map.image instanceof HTMLCanvasElement ? 256 : 128); if (l) m.map = l; }
        if (m.normalMap) m.normalMap = null; if (m.aoMap) m.aoMap = null; if (m.bumpMap) m.bumpMap = null;
        if (m.roughnessMap) { m.roughnessMap = null; if (m.roughness !== undefined) m.roughness = 0.92; }
        if (!Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile') && !m.alphaTest && (m.isMeshStandardMaterial || m.isMeshLambertMaterial)) m.flatShading = true;
        m.needsUpdate = true;
      }
    });
    if (U && !state.terr) {
      state.terr = { diff: U.tDiff.value, nor: U.tNor.value, arm: U.tArm.value };
      const lo = state.terrLo || (state.terrLo = lofiTerrainArrays(U.tDiff.value));
      if (lo) { U.tDiff.value = lo.diff; U.tNor.value = lo.nor; U.tArm.value = lo.arm; } else state.terr = null;
    }
  } else {
    for (const [m, k] of state.saved) { m.map = k.map; m.normalMap = k.normalMap; m.aoMap = k.aoMap; m.roughnessMap = k.roughnessMap; m.bumpMap = k.bumpMap; m.flatShading = k.flat; if (k.rough !== undefined) m.roughness = k.rough; m.needsUpdate = true; }
    state.saved.clear();
    if (U && state.terr) { U.tDiff.value = state.terr.diff; U.tNor.value = state.terr.nor; U.tArm.value = state.terr.arm; state.terr = null; }
  }
}

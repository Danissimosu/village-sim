// Terrain mesh (4 m grid over DEM + procedural relief + carved ponds) with a 5-layer PBR splat shader:
// grass / dirt / gravel / asphalt / field-soil from texture arrays (albedo + normal + ARM), splat map from OSM rasters,
// grass anti-tiling (two scales) and macro colour variation. Built on MeshStandardMaterial via onBeforeCompile.
import * as THREE from 'three';
import { TERRAIN_SIZE, SEG, SPLAT_RES } from '../config.js';
import { makeNoiseTexture } from './procedural.js';

export function buildTerrain(world, rasters, arrays) {
  const n = SEG + 1;
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, world.heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  void n;

  const splatTex = new THREE.DataTexture(rasters.splat, SPLAT_RES, SPLAT_RES, THREE.RGBAFormat);
  splatTex.magFilter = THREE.LinearFilter; splatTex.minFilter = THREE.LinearMipmapLinearFilter; splatTex.generateMipmaps = true;
  splatTex.wrapS = splatTex.wrapT = THREE.ClampToEdgeWrapping; splatTex.anisotropy = 4; splatTex.needsUpdate = true;
  const noiseTex = makeNoiseTexture(256);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const U = {
    tDiff: { value: arrays.diff }, tNor: { value: arrays.nor }, tArm: { value: arrays.arm },
    tSplat: { value: splatTex }, tMacro: { value: noiseTex }, uHalf: { value: TERRAIN_SIZE / 2 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform highp sampler2DArray tDiff; uniform highp sampler2DArray tNor; uniform highp sampler2DArray tArm;
uniform sampler2D tSplat; uniform sampler2D tMacro; uniform float uHalf;
vec3 gNormTS; float gRough; float gAO;
mat3 tFrame(vec3 eye_pos, vec3 surf_norm, vec2 uv) {
  vec3 q0 = dFdx(eye_pos.xyz); vec3 q1 = dFdy(eye_pos.xyz);
  vec2 st0 = dFdx(uv.st); vec2 st1 = dFdy(uv.st);
  vec3 N = surf_norm;
  vec3 q1perp = cross(q1, N); vec3 q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = (det == 0.0) ? 0.0 : inversesqrt(det);
  return mat3(T * scale, B * scale, N);
}
vec3 decodeN(vec3 t) { vec3 n = t * 2.0 - 1.0; return n; }`)
      .replace('#include <map_fragment>', `
{
  vec2 wp = vWPos.xz;
  vec4 sp = texture2D(tSplat, (wp + uHalf) / (2.0 * uHalf));
  vec2 nz = vec2(texture2D(tMacro, wp * 0.0085).r, texture2D(tMacro, wp * 0.043).g);
  float grassW = clamp(1.0 - (sp.r + sp.g + sp.b + sp.a), 0.0, 1.0);
  // ragged, noise-driven transitions
  float jit = (nz.y - 0.5) * 0.45;
  vec4 e = smoothstep(vec4(0.12), vec4(0.62), sp + jit);
  float eg = smoothstep(0.12, 0.62, grassW + jit * 0.8);
  float wsum = e.x + e.y + e.z + e.w + eg + 1e-4;
  float w0 = eg / wsum; float w1 = e.x / wsum; float w2 = e.y / wsum; float w3 = e.z / wsum; float w4 = e.w / wsum;
  vec2 uvG = wp / 3.4, uvG2 = wp / 11.7 + 0.37, uvD = wp / 2.8, uvV = wp / 2.4, uvA = wp / 3.2, uvF = wp / 2.6;
  vec4 d0 = texture(tDiff, vec3(uvG, 0.0)); vec4 d0b = texture(tDiff, vec3(uvG2, 0.0));
  vec3 d1 = texture(tDiff, vec3(uvD, 1.0)).rgb; vec3 d2 = texture(tDiff, vec3(uvV, 2.0)).rgb;
  vec3 d3 = texture(tDiff, vec3(uvA, 3.0)).rgb; vec3 d4 = texture(tDiff, vec3(uvF, 4.0)).rgb;
  float lb = max(dot(d0b.rgb, vec3(0.333)), 0.02);
  vec3 g0 = d0.rgb * mix(vec3(1.0), clamp(d0b.rgb / lb * 0.55, 0.45, 1.7), 0.55);
  vec3 alb = g0 * w0 + d1 * w1 + d2 * w2 + d3 * w3 + d4 * w4;
  // macro colour variation (large scale patchiness)
  float mv = 0.78 + 0.5 * nz.x;
  vec3 tint = mix(vec3(0.9, 1.0, 0.82), vec3(1.12, 1.05, 0.9), nz.x);
  alb *= mv * mix(vec3(1.0), tint, w0);
  diffuseColor.rgb *= alb;
  vec3 n0 = texture(tNor, vec3(uvG, 0.0)).rgb; vec3 n0b = texture(tNor, vec3(uvG2, 0.0)).rgb;
  vec3 n1 = texture(tNor, vec3(uvD, 1.0)).rgb; vec3 n2 = texture(tNor, vec3(uvV, 2.0)).rgb;
  vec3 n3 = texture(tNor, vec3(uvA, 3.0)).rgb; vec3 n4 = texture(tNor, vec3(uvF, 4.0)).rgb;
  vec3 nn = decodeN(n0) * (w0 * 0.7) + decodeN(n0b) * (w0 * 0.5) * vec3(1.0, 1.0, 0.0) + decodeN(n1) * w1 + decodeN(n2) * w2 + decodeN(n3) * w3 + decodeN(n4) * w4;
  gNormTS = normalize(vec3(nn.xy * 1.15, max(nn.z, 0.15)));
  vec3 a0 = texture(tArm, vec3(uvG, 0.0)).rgb; vec3 a1 = texture(tArm, vec3(uvD, 1.0)).rgb; vec3 a2 = texture(tArm, vec3(uvV, 2.0)).rgb;
  vec3 a3 = texture(tArm, vec3(uvA, 3.0)).rgb; vec3 a4 = texture(tArm, vec3(uvF, 4.0)).rgb;
  vec3 arm = a0 * w0 + a1 * w1 + a2 * w2 + a3 * w3 + a4 * w4;
  gAO = mix(1.0, arm.r, 0.9); gRough = clamp(arm.g, 0.2, 1.0);
}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * gRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize(tFrame(-vViewPosition, normal, vWPos.xz) * gNormTS);')
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= gAO;');
  };
  mat.customProgramCacheKey = () => 'terrain-splat-v1';
  // Split into 7x7 tiles that share the vertex buffers but have their own index buffer + bounding sphere, so the frustum culls them
  // (a single 245k-triangle mesh was always drawn in full).
  const idx = geo.index.array, T = 7, per = Math.ceil(SEG / T), mesh = new THREE.Group(), P = geo.attributes.position, cell = TERRAIN_SIZE / SEG;
  for (let tj = 0; tj < T; tj++) for (let ti = 0; ti < T; ti++) {
    const i0 = ti * per, i1 = Math.min(SEG, i0 + per), j0 = tj * per, j1 = Math.min(SEG, j0 + per);
    if (i1 <= i0 || j1 <= j0) continue;
    const arr = new Uint32Array((i1 - i0) * (j1 - j0) * 6); let o = 0;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const f = (j * SEG + i) * 6; for (let k = 0; k < 6; k++) arr[o++] = idx[f + k]; }
    let y0 = 1e9, y1 = -1e9;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const y = P.getY(j * (SEG + 1) + i); if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', P); g.setAttribute('normal', geo.attributes.normal); g.setAttribute('uv', geo.attributes.uv); g.setIndex(new THREE.BufferAttribute(arr, 1));
    const cx = -TERRAIN_SIZE / 2 + (i0 + i1) / 2 * cell, cz = -TERRAIN_SIZE / 2 + (j0 + j1) / 2 * cell, hw = (i1 - i0) * cell / 2, hd = (j1 - j0) * cell / 2, hy = (y1 - y0) / 2;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (y0 + y1) / 2, cz), Math.sqrt(hw * hw + hd * hd + hy * hy) + 1);
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.matrixAutoUpdate = false; mesh.add(m);
  }
  mesh.material = mat; mesh.userData.splat = splatTex; mesh.userData.U = U;
  return mesh;
}

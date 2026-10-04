// Sky dome (Poly Haven HDRI + procedural sun/moon/stars/twilight), time-of-day driven sun/moon light, fog, dynamic IBL.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { BASE } from '../config.js';
import { clamp, lerp, smoothstep } from '../util.js';

const LAT = (50.43 * Math.PI) / 180, DECL = (-4.0 * Math.PI) / 180; // early October

export function sunVector(hours) {
  const H = ((hours - 12) * 15 * Math.PI) / 180;
  const sinAlt = Math.sin(LAT) * Math.sin(DECL) + Math.cos(LAT) * Math.cos(DECL) * Math.cos(H);
  const alt = Math.asin(clamp(sinAlt, -1, 1)), cosAlt = Math.cos(alt);
  let cosAz = (Math.sin(DECL) - sinAlt * Math.sin(LAT)) / (cosAlt * Math.cos(LAT) + 1e-6);
  let az = Math.acos(clamp(cosAz, -1, 1)); if (H > 0) az = Math.PI * 2 - az;
  // x east, y up, z south
  return new THREE.Vector3(Math.sin(az) * cosAlt, sinAlt, -Math.cos(az) * cosAlt);
}

const VERT = /* glsl */`
varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const FRAG = /* glsl */`
varying vec3 vDir;
uniform sampler2D tHDR; uniform vec3 uSun; uniform vec3 uMoon; uniform vec3 uSunCol;
uniform float uDay; uniform float uTwi; uniform float uTime; uniform float uEnv; uniform float uRot;
uniform vec3 uFogOut; uniform vec3 uGround;
float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float c = cos(uRot), s = sin(uRot);
  vec3 dr = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
  vec2 uv = vec2(atan(dr.z, dr.x) / 6.2831853 + 0.5, asin(clamp(dr.y, -1.0, 1.0)) / 3.14159265 + 0.5);
  vec3 hdr = texture2D(tHDR, uv).rgb;
  hdr = min(hdr, vec3(1.35));                       // remove HDRI sun hot-spot (procedural sun is used instead)
  float sd = dot(d, uSun);
  vec3 tint = mix(vec3(1.0), vec3(1.0, 0.58, 0.4), clamp(uTwi * (0.25 + 0.75 * pow(max(sd, 0.0), 2.5)), 0.0, 1.0));
  vec3 skyDay = hdr * tint;
  skyDay += uSunCol * (pow(max(sd, 0.0), 28.0) * 0.55 + pow(max(sd, 0.0), 5.0) * 0.12);
  // night
  vec3 night = vec3(0.007, 0.013, 0.03) + vec3(0.0, 0.008, 0.016) * (1.0 - abs(d.y));
  vec3 sp = d * 380.0; vec3 id = floor(sp); float hs = h31(id);
  float star = smoothstep(0.9935, 1.0, hs) * smoothstep(0.34, 0.1, length(fract(sp) - 0.5)) * (0.55 + 0.45 * sin(uTime * 2.0 + hs * 90.0));
  night += vec3(0.85, 0.9, 1.0) * star * 1.4 * smoothstep(0.0, 0.25, d.y);
  float md = dot(d, uMoon);
  night += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99965, 0.99985, md) * 3.0 + pow(max(md, 0.0), 60.0) * 0.05);
  vec3 col = mix(night, skyDay * uDay, clamp(uDay * 1.4, 0.0, 1.0));
  col += uSunCol * smoothstep(0.99983, 0.99992, sd) * 40.0 * (1.0 - uEnv) * step(-0.02, d.y);
  if (uEnv > 0.5 && d.y < 0.0) col = mix(col, uGround, smoothstep(0.0, -0.12, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float hz = d.y < 0.0 ? 1.0 : pow(1.0 - d.y, 8.0) * 0.92;
  if (uEnv > 0.5) hz = d.y < 0.0 ? 0.0 : hz * 0.5;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogOut, hz);
}`;

export class Sky {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.uniforms = {
      tHDR: { value: null }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: new THREE.Vector3(0, -1, 0) }, uSunCol: { value: new THREE.Color(1, 0.9, 0.7) },
      uDay: { value: 1 }, uTwi: { value: 0 }, uTime: { value: 0 }, uEnv: { value: 0 }, uRot: { value: 0 }, uFogOut: { value: new THREE.Color(0.6, 0.7, 0.85) }, uGround: { value: new THREE.Color(0.1, 0.12, 0.07) },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
    const geo = new THREE.SphereGeometry(1, 40, 20);
    this.dome = new THREE.Mesh(geo, this.mat); this.dome.scale.setScalar(2500); this.dome.frustumCulled = false; this.dome.renderOrder = -10; scene.add(this.dome);
    this.envScene = new THREE.Scene(); this.envDome = new THREE.Mesh(geo, this.mat); this.envDome.scale.setScalar(100); this.envScene.add(this.envDome);
    this.pmrem = new THREE.PMREMGenerator(renderer); this.pmrem.compileCubemapShader();
    this.envRT = null; this.lastEnvHour = -99; this.lastEnvT = 0;

    this.sun = new THREE.DirectionalLight(0xffffff, 3); this.sun.castShadow = true;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 420; this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.07;
    scene.add(this.sun, this.sun.target);
    this.fog = new THREE.FogExp2(0x9fb4cc, 0.0017); scene.fog = this.fog;
    this.sunDir = new THREE.Vector3(0, 1, 0); this.lightDir = new THREE.Vector3(0, 1, 0);
    this.dayFog = new THREE.Color(0.55, 0.66, 0.82);
    this.hour = 10.5; this.state = { day: 1, sunAlt: 0.5, night: 0 };
  }
  async load() {
    const tex = await new Promise((res, rej) => new HDRLoader().load(BASE + 'hdri/sky_1k.hdr', res, undefined, rej));
    tex.mapping = THREE.EquirectangularReflectionMapping; tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    this.uniforms.tHDR.value = tex;
    // horizon colour from the HDRI -> fog colour
    try {
      const { data, width, height } = tex.image; let r = 0, g = 0, b = 0, n = 0;
      const row0 = Math.floor(height * 0.5) + 1, row1 = Math.floor(height * 0.5) + 6;   // just above horizon (row 0 = top for RGBELoader flipY? try both)
      for (const [a, bnd] of [[row0, row1]]) for (let y = a; y < bnd; y++) for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4; r += DataUtilsHalf(data[o]); g += DataUtilsHalf(data[o + 1]); b += DataUtilsHalf(data[o + 2]); n++;
      }
      this.dayFog.setRGB(Math.min(r / n, 0.9), Math.min(g / n, 0.95), Math.min(b / n, 1.0));
    } catch (e) { /* keep default */ }
    return tex;
  }
  setHour(h, camera, time, force = false) {
    this.hour = ((h % 24) + 24) % 24;
    const sv = sunVector(this.hour), sa = sv.y;
    this.sunDir.copy(sv);
    const day = smoothstep(-0.12, 0.16, sa), twi = Math.exp(-Math.pow((sa - 0.02) / 0.17, 2));
    const sunCol = new THREE.Color().setRGB(1, 0.96, 0.88).lerp(new THREE.Color(1, 0.55, 0.28), smoothstep(0.38, 0.02, sa));
    const U = this.uniforms;
    U.uSun.value.copy(sv); U.uMoon.value.copy(sv).multiplyScalar(-1); U.uSunCol.value.copy(sunCol); U.uDay.value = day; U.uTwi.value = twi; U.uTime.value = time || 0;
    U.uRot.value = (time || 0) * 0.0015;
    // lights
    const sunI = 3.6 * smoothstep(0.0, 0.2, sa);
    const moonI = 0.85 * (1 - smoothstep(-0.12, 0.02, sa)) * smoothstep(-0.02, 0.1, -sa);
    const useSun = sa > -0.06;
    this.lightDir.copy(useSun ? sv : U.uMoon.value);
    this.sun.color.copy(useSun ? sunCol : new THREE.Color(0.55, 0.65, 1.0));
    this.sun.intensity = useSun ? Math.max(sunI, moonI) : moonI;
    // fog
    const night = new THREE.Color(0.006, 0.01, 0.022);
    const twiC = new THREE.Color(0.62, 0.36, 0.28);
    const fogC = night.clone().lerp(this.dayFog.clone().lerp(twiC, twi * 0.55), day);
    this.fog.color.copy(fogC);
    U.uFogOut.value.copy(fogC).convertLinearToSRGB();
    this.fog.density = lerp(0.0014, 0.0019, 1 - day) + twi * 0.0004;
    U.uGround.value.setRGB(0.1, 0.12, 0.07).multiplyScalar(Math.max(0.03, day));
    this.renderer.toneMappingExposure = lerp(1.45, 0.92, day);
    this.state = { day, sunAlt: sa, night: 1 - day };
    // dome follows camera
    if (camera) this.dome.position.copy(camera.position);
    // refresh IBL when time moved enough
    const now = performance.now();
    if (force || (Math.abs(this.hour - this.lastEnvHour) > 0.12 && now - this.lastEnvT > 350) || !this.envRT) this.updateEnv();
    return this.state;
  }
  updateEnv() {
    const U = this.uniforms;
    const fogOut = U.uFogOut.value.clone();
    U.uEnv.value = 1; U.uFogOut.value.copy(this.fog.color);
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 200);
    U.uEnv.value = 0; U.uFogOut.value.copy(fogOut);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt; this.scene.environment = rt.texture;
    this.lastEnvHour = this.hour; this.lastEnvT = performance.now();
  }
  // snap shadow frustum to the player in light space (texel-stable)
  followShadow(px, py, pz, range, mapSize) {
    const L = this.sun, dir = this.lightDir;
    const fwd = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize();
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(fwd, right).normalize();
    const texel = (range * 2) / mapSize;
    const p = new THREE.Vector3(px, py, pz);
    const a = Math.floor(p.dot(right) / texel) * texel, b = Math.floor(p.dot(up) / texel) * texel, c = p.dot(fwd);
    const snapped = right.clone().multiplyScalar(a).add(up.clone().multiplyScalar(b)).add(fwd.clone().multiplyScalar(c));
    L.target.position.copy(snapped); L.target.updateMatrixWorld();
    L.position.copy(snapped).addScaledVector(dir, 200);
    const cam = L.shadow.camera;
    if (cam.right !== range) { cam.left = -range; cam.right = range; cam.top = range; cam.bottom = -range; cam.updateProjectionMatrix(); }
  }
}
function DataUtilsHalf(v) { return THREE.DataUtils.fromHalfFloat(v); }

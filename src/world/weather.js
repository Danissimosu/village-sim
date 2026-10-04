// Weather toggle: clear / rain / fog. Smoothly blends sky overcast, sun strength, fog density and a cheap GPU rain streak layer.
import * as THREE from 'three';
import { mulberry32 } from '../util.js';

export const WEATHER = { clear: 'ясно', rain: 'дождь', fog: 'туман' };
export const WEATHER_ORDER = ['clear', 'rain', 'fog'];

export class Weather {
  constructor(scene, sky) {
    this.sky = sky; this.kind = 'clear'; this.over = 0; this.fog = 0; this.rain = 0; this._settled = true;
    const N = 3200, rng = mulberry32(99);
    const pos = new Float32Array(N * 2 * 3), seed = new Float32Array(N * 2 * 4), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const sx = rng() * 2 - 1, sy = rng(), sz = rng() * 2 - 1, sw = rng();
      for (let k = 0; k < 2; k++) { const j = i * 2 + k; seed.set([sx, sy, sz, sw], j * 4); end[j] = k; }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uLight: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, fog: false,
      vertexShader: `uniform float uTime; uniform vec3 uCam; uniform float uAmt; attribute vec4 aSeed; attribute float aEnd; varying float vA;
        void main(){
          if (aSeed.w > uAmt) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
          float W = 24.0;
          float wx = uCam.x + mod(aSeed.x * W - uCam.x + W, 2.0 * W) - W, wz = uCam.z + mod(aSeed.z * W - uCam.z + W, 2.0 * W) - W;
          float y = uCam.y - 10.0 + mod(aSeed.y * 28.0 - uTime * 16.0, 28.0);
          vec3 p = vec3(wx, y, wz) + vec3(0.12, 0.85, 0.05) * aEnd * 0.9;
          vec4 mv = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          vA = (aEnd < 0.5 ? 0.0 : 1.0) * smoothstep(60.0, 5.0, -mv.z); }`,
      fragmentShader: `uniform float uLight; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.72, 0.78, 0.86) * uLight, vA * 0.4); }`,
    });
    this.lines = new THREE.LineSegments(g, m); this.lines.frustumCulled = false; this.lines.visible = false; this.lines.renderOrder = 8; scene.add(this.lines);
  }
  set(kind) { if (!WEATHER[kind]) kind = 'clear'; this.kind = kind; this._settled = false; }
  update(dt, time, cam, night) {
    const tgt = { over: this.kind === 'rain' ? 0.88 : this.kind === 'fog' ? 0.55 : 0, fog: this.kind === 'fog' ? 1 : 0, rain: this.kind === 'rain' ? 1 : 0 };
    tgt.over = Math.max(tgt.over, this.styleOver || 0); tgt.fog = Math.max(tgt.fog, this.styleFog || 0);
    const k = Math.min(1, dt * 0.45);
    this.over += (tgt.over - this.over) * k; this.fog += (tgt.fog - this.fog) * k; this.rain += (tgt.rain - this.rain) * k;
    this.sky.wx.over = this.over; this.sky.wx.fog = this.fog;
    this.u.uTime.value = time; this.u.uCam.value.copy(cam.position); this.u.uAmt.value = this.rain; this.u.uLight.value = 0.35 + 0.65 * (1 - night);
    this.lines.visible = this.rain > 0.02;
    if (!this._settled && Math.abs(this.over - tgt.over) < 0.02 && Math.abs(this.fog - tgt.fog) < 0.02) { this._settled = true; this.sky.updateEnv(); }
  }
}

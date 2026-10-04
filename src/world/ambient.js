// Ambient life: flocks of birds (instanced, flapping in the vertex shader) and chimney smoke (one Points draw call).
import * as THREE from 'three';
import { mulberry32 } from '../util.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), UPV = new THREE.Vector3(0, 1, 0);

function birdGeometry() {
  const p = [], n = [];
  const tri = (a, b, c) => { for (const v of [a, b, c]) { p.push(...v); n.push(0, 1, 0); } };
  tri([0.22, 0, 0], [-0.1, 0, 0.05], [-0.1, 0, -0.05]);          // body (forward = +x)
  tri([0.08, 0, 0.0], [-0.08, 0, 0.0], [-0.02, 0, 0.34]); tri([0.08, 0, 0.0], [-0.02, 0, -0.34], [-0.08, 0, 0.0]);   // wings
  tri([-0.1, 0, 0.04], [-0.28, 0, 0], [-0.1, 0, -0.04]);          // tail
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1); return g;
}

export class Ambient {
  constructor(scene, world, layout) {
    this.world = world; this.group = new THREE.Group(); this.group.name = 'ambient'; scene.add(this.group);
    const rng = mulberry32(31337); this.rng = rng;
    // ---- birds
    this.uTime = { value: 0 };
    const mat = new THREE.MeshBasicMaterial({ color: 0x1c1c20, side: THREE.DoubleSide, fog: true });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11; transformed.y += abs(position.z) * sin(uTime * 9.0 + ph) * 1.1;');
    };
    this.N = 30;
    this.birds = new THREE.InstancedMesh(birdGeometry(), mat, this.N); this.birds.frustumCulled = false; this.birds.count = 0; this.group.add(this.birds);
    this.flock = [];
    for (let i = 0; i < this.N; i++) { const f = Math.floor(i / 6); this.flock.push({ f, cx: 0, cz: 0, r: 25 + rng() * 60, h: 22 + rng() * 45, ph: rng() * 6.28, sp: (0.18 + rng() * 0.22) * (rng() < 0.5 ? -1 : 1), off: rng() * 6.28, big: 0.9 + rng() * 0.6 }); }
    this.centres = []; for (let f = 0; f < 5; f++) this.centres.push({ x: (rng() - 0.5) * 700, z: (rng() - 0.5) * 700 });
    // ---- chimney smoke
    this.chimneys = layout.buildings.filter((b) => b.chimneyPos).map((b) => ({ x: b.chimneyPos[0], y: b.chimneyPos[1], z: b.chimneyPos[2], on: (b.style.seed % 100) < 55 }));
    this.SM = 480;
    const sg = new THREE.BufferGeometry();
    const pos = new Float32Array(this.SM * 3), ph = new Float32Array(this.SM);
    for (let i = 0; i < this.SM; i++) ph[i] = (i % 8) / 8 + rng() * 0.05;
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1)); sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.smokeU = { uTime: { value: 0 }, uAlpha: { value: 0 }, uLight: { value: 1 }, uWind: { value: new THREE.Vector2(1.2, 0.5) } };
    const sm = new THREE.ShaderMaterial({
      uniforms: this.smokeU, transparent: true, depthWrite: false, fog: false,
      vertexShader: `uniform float uTime; uniform vec2 uWind; attribute float aPhase; varying float vA;
        void main(){ float age = fract(uTime * 0.11 + aPhase); vec3 p = position; p.y += age * 7.0; p.xz += uWind * age * age * 9.0 + vec2(sin(age * 9.0 + aPhase * 40.0), cos(age * 7.0 + aPhase * 30.0)) * age * 0.9;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (0.6 + age * 3.4) * 120.0 / max(1.0, -mv.z) * 3.0; vA = smoothstep(0.0, 0.12, age) * (1.0 - age); }`,
      fragmentShader: `uniform float uAlpha; uniform float uLight; varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; float a = smoothstep(1.0, 0.2, d) * vA * uAlpha * 0.55; if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.72, 0.72, 0.74) * uLight, a); }`,
    });
    this.smoke = new THREE.Points(sg, sm); this.smoke.frustumCulled = false; this.smoke.visible = false; this.group.add(this.smoke);
    this._lastSel = -1e9; this._selX = 1e9; this._selZ = 1e9;
  }
  update(dt, time, player, hour, night, weather) {
    this.uTime.value = time; this.smokeU.uTime.value = time;
    // ---- birds: circle around moving centres near the player; only in daylight and not in rain
    const day = hour > 5.8 && hour < 19.3 && weather !== 'rain';
    if (!day) { this.birds.count = 0; }
    else {
      let n = 0;
      for (const b of this.flock) {
        const c = this.centres[b.f % this.centres.length];
        const px = Math.max(-480, Math.min(480, player.x + (c.x % 160))), pz = Math.max(-480, Math.min(480, player.z + (c.z % 160)));
        const a = time * b.sp + b.ph, x = px + Math.cos(a) * b.r + Math.sin(b.off) * 6, z = pz + Math.sin(a) * b.r + Math.cos(b.off) * 6, y = this.world.heightAt(x, z) + b.h + Math.sin(time * 0.5 + b.off) * 3;
        const heading = a + (b.sp > 0 ? Math.PI / 2 : -Math.PI / 2);
        _q.setFromAxisAngle(UPV, -heading); _p.set(x, y, z); _s.set(b.big, b.big, b.big); _m.compose(_p, _q, _s); this.birds.setMatrixAt(n++, _m);
      }
      this.birds.count = n; this.birds.instanceMatrix.needsUpdate = true;
    }
    // ---- smoke: active in cool evenings and mornings
    const want = (hour >= 15.5 || hour < 9.5) ? 1 : 0;
    this.smokeU.uAlpha.value += (want - this.smokeU.uAlpha.value) * Math.min(1, dt * 0.5);
    this.smoke.visible = this.smokeU.uAlpha.value > 0.02;
    this.smokeU.uLight.value = 0.25 + 0.75 * (1 - night);
    if (this.smoke.visible && (Math.hypot(player.x - this._selX, player.z - this._selZ) > 25 || time - this._lastSel > 10)) {
      this._lastSel = time; this._selX = player.x; this._selZ = player.z;
      const near = this.chimneys.filter((c) => c.on).map((c) => ({ c, d: Math.hypot(c.x - player.x, c.z - player.z) })).filter((q) => q.d < 200).sort((a, b) => a.d - b.d).slice(0, this.SM / 8);
      const arr = this.smoke.geometry.attributes.position.array; arr.fill(0);
      near.forEach((q, i) => { for (let k = 0; k < 8; k++) { arr[(i * 8 + k) * 3] = q.c.x; arr[(i * 8 + k) * 3 + 1] = q.c.y; arr[(i * 8 + k) * 3 + 2] = q.c.z; } });
      this.smoke.geometry.attributes.position.needsUpdate = true;
    }
  }
}

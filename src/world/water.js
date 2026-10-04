// Ponds & stream: cheap env-reflective water everywhere + real planar reflection (three Water) on the nearest pond (High/Ultra).
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { makeWaterNormals } from './procedural.js';

export class Waters {
  constructor(scene, world, sky) {
    this.group = new THREE.Group(); this.group.name = 'water'; scene.add(this.group);
    this.scene = scene; this.sky = sky; this.world = world;
    this.normals = makeWaterNormals(256);
    this.cheapMat = new THREE.MeshPhysicalMaterial({ color: 0x1f3f3d, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.93, normalMap: this.normals, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.6, clearcoat: 0, ior: 1.33, specularIntensity: 1 });
    this.cheapMat.normalMap.repeat.set(0.07, 0.07);
    // two counter-moving ripple layers (hides the texture tiling) that calm down with distance (less shimmer on small screens)
    this.wt = { value: 0 };
    this.cheapMat.onBeforeCompile = (sh) => {
      sh.uniforms.uWT = this.wt;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWT;')
        .replace('mapN.xy *= normalScale;', `vec3 mapN2 = texture2D(normalMap, vNormalMapUv * vec2(-2.63, 2.17) + vec2(uWT * 0.021, uWT * -0.017)).xyz * 2.0 - 1.0;
        mapN.xy = (mapN.xy + mapN2.xy * 0.75) * 0.85;
        mapN.xy *= normalScale * mix(1.25, 0.35, clamp(length(vViewPosition) / 140.0, 0.0, 1.0));`);
    };
    this.cheapMat.customProgramCacheKey = () => 'water-cheap-v2';
    this.ponds = [];
    this.reflectSize = 512;
    this.grassRef = null;
    for (const p of world.ponds) {
      const shape = new THREE.Shape(p.pts.map((q) => new THREE.Vector2(q[0], -q[1])));
      for (const h of p.holes || []) shape.holes.push(new THREE.Path(h.map((q) => new THREE.Vector2(q[0], -q[1]))));
      const geo = new THREE.ShapeGeometry(shape);
      const cheap = new THREE.Mesh(geo, this.cheapMat);
      cheap.rotation.x = -Math.PI / 2; cheap.position.y = p.level; cheap.renderOrder = 1; cheap.receiveShadow = true;
      this.group.add(cheap);
      const cx = (p.bb.x0 + p.bb.x1) / 2, cz = (p.bb.z0 + p.bb.z1) / 2;
      this.ponds.push({ p, geo, cheap, cx, cz, real: null });
    }
    // stream ribbons
    for (const s of world.streams) {
      const pos = [], idx = [];
      const pts = s.pts; let n = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L * 1.3, nz = dx / L * 1.3;
        const y = world.baseHeight(pts[i][0], pts[i][1]) - 0.28;
        pos.push(pts[i][0] - nx, y, pts[i][1] - nz, pts[i][0] + nx, y, pts[i][1] + nz);
        if (i > 0) { idx.push(n - 2, n - 1, n, n - 1, n + 1, n); }
        n += 2;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const nrm = g.attributes.normal; for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
      const uv = []; for (let i = 0; i < pos.length / 3; i++) uv.push((i >> 1) * 0.2, i & 1);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const m = new THREE.Mesh(g, this.cheapMat); m.renderOrder = 1; this.group.add(m);
    }
    this.active = null; this.time = 0;
  }
  setGrass(grass) { this.grassRef = grass; }
  setReflection(size) { this.reflectSize = size; this.reflectOn = size > 0; for (const o of this.ponds) { if (o.real) { this.group.remove(o.real); o.real.material.dispose(); o.real.geometry = null; o.real = null; } } this.active = null; for (const o of this.ponds) o.cheap.visible = true; }
  _makeReal(o) {
    const sun = this.sky.sunDir;
    const w = new Water(o.geo, {
      textureWidth: this.reflectSize, textureHeight: this.reflectSize, waterNormals: this.normals, sunDirection: sun.clone(), sunColor: 0xffffff,
      waterColor: 0x16323a, distortionScale: 1.6, fog: true, alpha: 0.96,
    });
    w.rotation.x = -Math.PI / 2; w.position.y = o.p.level + 0.005; w.renderOrder = 1;
    const orig = w.onBeforeRender.bind(w);
    w.onBeforeRender = (r, s, c, g, m, grp) => { const gr = this.grassRef; const vis = gr ? gr.group.visible : true; if (gr) gr.group.visible = false; orig(r, s, c, g, m, grp); if (gr) gr.group.visible = vis; };
    this.group.add(w); o.real = w; return w;
  }
  update(dt, px, pz) {
    this.time += dt; this.wt.value = this.time;
    this.normals.offset.x = (this.time * 0.004) % 1; this.normals.offset.y = (this.time * 0.003) % 1;
    if (!this.reflectOn) return;
    // choose the nearest large pond within 160 m
    let best = null, bd = 160;
    for (const o of this.ponds) { if (o.p.area < 300) continue; const d = Math.hypot(o.cx - px, o.cz - pz) - Math.sqrt(o.p.area) * 0.5; if (d < bd) { bd = d; best = o; } }
    if (best !== this.active) {
      if (this.active) { this.active.cheap.visible = true; if (this.active.real) this.active.real.visible = false; }
      this.active = best;
      if (best) { if (!best.real) this._makeReal(best); best.real.visible = true; best.cheap.visible = false; }
    }
    if (this.active && this.active.real) {
      const u = this.active.real.material.uniforms;
      u.sunDirection.value.copy(this.sky.sunDir.y > -0.05 ? this.sky.sunDir : this.sky.uniforms.uMoon.value);
      u.sunColor.value.copy(this.sky.sun.color).multiplyScalar(Math.min(1, this.sky.sun.intensity / 3));
      u.waterColor.value.setRGB(0.07, 0.17, 0.2).multiplyScalar(0.25 + 0.75 * this.sky.state.day);
      u.time.value = this.time * 0.6;
    }
  }
}

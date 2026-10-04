// Walker: terrain-following character with collision (1 m blocked grid), third/first person camera,
// keyboard + mouse (pointer lock) and touch (virtual joystick + drag-to-look) controls.
import * as THREE from 'three';
import { clamp, lerp } from '../util.js';
import { PLAY_HALF } from '../config.js';

export class Player {
  constructor(world, rasters, camera, dom) {
    this.world = world; this.rasters = rasters; this.camera = camera; this.dom = dom;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = -0.12; this.heading = 0;
    this.thirdPerson = true; this.run = false; this.camDist = 4.6; this.speed = 0; this.phase = 0;
    this.keys = new Set(); this.joy = { x: 0, y: 0 }; this.lookDX = 0; this.lookDY = 0;
    this.avatar = this._makeAvatar(); this.avatar.visible = true;
    this.touch = { joyId: null, lookId: null, jbase: null, lastX: 0, lastY: 0 };
    this._bind();
  }
  _makeAvatar() {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0b08c, roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x3c6e9e, roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x3b3a36, roughness: 0.9 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.9 });
    const mk = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };
    g.add(mk(new THREE.BoxGeometry(0.46, 0.62, 0.26), shirt, 0, 1.2, 0));
    g.add(mk(new THREE.SphereGeometry(0.15, 14, 12), skin, 0, 1.72, 0));
    const cap = mk(new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 1.76, 0); g.add(cap);
    this.legs = [0, 1].map((i) => { const p = new THREE.Group(); p.position.set(i ? 0.11 : -0.11, 0.9, 0); p.add(mk(new THREE.BoxGeometry(0.18, 0.88, 0.2), pants, 0, -0.44, 0)); g.add(p); return p; });
    this.arms = [0, 1].map((i) => { const p = new THREE.Group(); p.position.set(i ? 0.3 : -0.3, 1.48, 0); p.add(mk(new THREE.BoxGeometry(0.13, 0.6, 0.15), shirt, 0, -0.3, 0)); g.add(p); return p; });
    return g;
  }
  teleport(x, z, yaw = this.yaw) { this.pos.set(x, this.world.heightAt(x, z), z); this.yaw = yaw; this.heading = yaw; }
  get forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  toggleView() { this.thirdPerson = !this.thirdPerson; this.avatar.visible = this.thirdPerson; return this.thirdPerson; }

  _bind() {
    const el = this.dom;
    addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT') return; this.keys.add(e.code); if (e.code === 'KeyV') this.toggleView(); if (e.code === 'KeyR') this.run = !this.run; });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // mouse look (pointer lock on desktop)
    el.addEventListener('mousedown', (e) => { if (e.pointerType === 'touch' || this._isTouchDevice) return; if (document.pointerLockElement !== el && el.requestPointerLock) el.requestPointerLock(); });
    addEventListener('mousemove', (e) => { if (document.pointerLockElement === el) { this.lookDX += e.movementX; this.lookDY += e.movementY; } });
    // touch: joystick on the left half, look on the right half
    this._joyUI = document.getElementById('joy'); this._joyKnob = document.getElementById('joy-knob');
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this._isTouchDevice = true;
      const left = e.clientX < innerWidth * 0.5;
      if (left && this.touch.joyId === null) {
        this.touch.joyId = e.pointerId; this.touch.jbase = { x: e.clientX, y: e.clientY };
        if (this._joyUI) { this._joyUI.style.display = 'block'; this._joyUI.style.left = e.clientX + 'px'; this._joyUI.style.top = e.clientY + 'px'; this._joyKnob.style.transform = 'translate(-50%,-50%)'; }
      } else if (!left && this.touch.lookId === null) {
        this.touch.lookId = e.pointerId; this.touch.lastX = e.clientX; this.touch.lastY = e.clientY;
      }
      try { el.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') return;
      if (e.pointerId === this.touch.joyId) {
        const R = 56; let dx = e.clientX - this.touch.jbase.x, dy = e.clientY - this.touch.jbase.y; const l = Math.hypot(dx, dy);
        if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
        this.joy.x = dx / R; this.joy.y = -dy / R;
        if (this._joyKnob) this._joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (e.pointerId === this.touch.lookId) {
        this.lookDX += (e.clientX - this.touch.lastX) * 1.25; this.lookDY += (e.clientY - this.touch.lastY) * 1.25;
        this.touch.lastX = e.clientX; this.touch.lastY = e.clientY;
      }
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerId === this.touch.joyId) { this.touch.joyId = null; this.joy.x = this.joy.y = 0; if (this._joyUI) this._joyUI.style.display = 'none'; }
      if (e.pointerId === this.touch.lookId) this.touch.lookId = null;
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _blocked(x, z, r = 0.32) {
    const R = this.rasters;
    return R.blockedAt(x + r, z) || R.blockedAt(x - r, z) || R.blockedAt(x, z + r) || R.blockedAt(x, z - r)
      || R.pBlockedAt(x + r, z) || R.pBlockedAt(x - r, z) || R.pBlockedAt(x, z + r) || R.pBlockedAt(x, z - r);
  }
  update(dt) {
    const sens = 0.0042;
    this.yaw -= this.lookDX * sens; this.pitch = clamp(this.pitch - this.lookDY * sens, -1.25, 1.25);
    this.lookDX = this.lookDY = 0;
    // input vector
    let ix = this.joy.x, iy = this.joy.y;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) iy += 1; if (k.has('KeyS') || k.has('ArrowDown')) iy -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) ix += 1; if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
    const mag = Math.min(1, Math.hypot(ix, iy));
    const running = this.run || k.has('ShiftLeft') || k.has('ShiftRight');
    const vmax = running ? 7.5 : 3.8;
    let moved = 0;
    if (mag > 0.05) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      let vx = fx * iy + rx * ix, vz = fz * iy + rz * ix; const vl = Math.hypot(vx, vz) || 1; vx /= vl; vz /= vl;
      const sp = vmax * mag * dt;
      let nx = this.pos.x + vx * sp, nz = this.pos.z + vz * sp;
      nx = clamp(nx, -PLAY_HALF + 25, PLAY_HALF - 25); nz = clamp(nz, -PLAY_HALF + 25, PLAY_HALF - 25);
      if (!this._blocked(nx, nz)) { moved = Math.hypot(nx - this.pos.x, nz - this.pos.z); this.pos.x = nx; this.pos.z = nz; }
      else if (!this._blocked(nx, this.pos.z)) { moved = Math.abs(nx - this.pos.x); this.pos.x = nx; }
      else if (!this._blocked(this.pos.x, nz)) { moved = Math.abs(nz - this.pos.z); this.pos.z = nz; }
      if (moved > 0) { const target = Math.atan2(-vx, -vz); let dh = target - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); this.heading += dh * Math.min(1, dt * 12); }
    }
    this.speed = lerp(this.speed, moved / Math.max(dt, 1e-4), Math.min(1, dt * 10));
    const gy = this.world.heightAt(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 16);
    this.phase += moved * (running ? 1.1 : 1.5);
    this._animate();
    this._camera();
  }
  _animate() {
    const a = this.avatar; a.position.copy(this.pos); a.rotation.y = this.heading;
    const amp = Math.min(1, this.speed / 3) * 0.75, s = Math.sin(this.phase * 2.2);
    this.legs[0].rotation.x = s * amp; this.legs[1].rotation.x = -s * amp; this.arms[0].rotation.x = -s * amp * 0.8; this.arms[1].rotation.x = s * amp * 0.8;
    a.position.y += Math.abs(Math.cos(this.phase * 2.2)) * 0.03 * amp;
  }
  _camera() {
    const cam = this.camera, eye = 1.62;
    if (!this.thirdPerson) {
      cam.position.set(this.pos.x, this.pos.y + eye, this.pos.z); cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ'); return;
    }
    const tx = this.pos.x, ty = this.pos.y + 1.55, tz = this.pos.z;
    const cp = Math.cos(this.pitch), dx = Math.sin(this.yaw) * cp, dy = Math.sin(this.pitch), dz = Math.cos(this.yaw) * cp; // vector from target back to camera
    let dist = this.camDist;
    for (let t = 0.6; t <= this.camDist; t += 0.35) { if (this.rasters.blockedAt(tx + dx * t, tz + dz * t)) { dist = Math.max(0.5, t - 0.5); break; } }
    let cx = tx + dx * dist, cy = ty + dy * dist, cz = tz + dz * dist;
    const gh = this.world.heightAt(cx, cz) + 0.35; if (cy < gh) cy = gh;
    cam.position.set(cx, cy, cz); cam.lookAt(tx, ty - 0.1, tz);
    this.avatar.visible = dist > 1.2;
  }
}

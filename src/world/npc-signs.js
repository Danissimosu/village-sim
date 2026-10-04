// Floating text signs ("МАГАЗИН", "ШКОЛА") above the doors of the civic buildings the villagers visit.
import * as THREE from 'three';

function labelTexture(text, bg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 72; const g = c.getContext('2d');
  g.fillStyle = bg; g.beginPath(); g.roundRect(2, 2, 252, 68, 14); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#fff'; g.font = '700 38px -apple-system, "Segoe UI", Roboto, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 38);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; return t;
}
export class CivicSigns {
  constructor(scene, world, nav) {
    this.items = [];
    const mats = { shop: new THREE.SpriteMaterial({ map: labelTexture('МАГАЗИН', '#a8452f'), depthWrite: false, fog: true }), school: new THREE.SpriteMaterial({ map: labelTexture('ШКОЛА', '#2f5f9a'), depthWrite: false, fog: true }) };
    const add = (house, kind) => {
      const p = house.door; const s = new THREE.Sprite(mats[kind]); s.scale.set(3.4, 0.96, 1);
      s.position.set(p.x, world.heightAt(p.x, p.z) + 3.6, p.z); s.renderOrder = 5; scene.add(s); this.items.push(s);
    };
    for (const sh of nav.shops) add(sh.house, 'shop');
    add(nav.school.house, 'school');
  }
  update(cam) { for (const s of this.items) s.visible = Math.hypot(s.position.x - cam.x, s.position.z - cam.z) < 160; }
}

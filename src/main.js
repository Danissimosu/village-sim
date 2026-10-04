// Entry point: boots renderer, loads data/textures, builds the world, runs the loop.
import * as THREE from 'three';
import './style.css';
import { QUALITY, QUALITY_ORDER, TERRAIN_SIZE, POPULATION, TIME_SPEED } from './config.js';
import { clamp, smoothstep } from './util.js';
import { loadWorldData } from './world/data.js';
import { generateLayout } from './world/layout.js';
import { buildRasters } from './world/splat.js';
import { loadMaterials, setAnisotropy } from './world/materials.js';
import { buildTerrain } from './world/terrain.js';
import { BuildingSet, addBuilding, addWell, makeExtraMaterials } from './world/buildings.js';
import { buildFences, buildPoles, buildMast, buildRoadMarkings, buildSigns } from './world/props.js';
import { Trees, Grass, planTrees } from './world/vegetation.js';
import { Sky } from './world/sky.js';
import { Waters } from './world/water.js';
import { Player } from './player/player.js';
import { createHUD } from './ui/hud.js';
import { generatePopulation } from './world/population.js';
import { buildNpcNav } from './world/npc-nav.js';
import { NpcSim } from './world/npc-sim.js';
import { NpcRenderer } from './world/npc-render.js';
import { CivicSigns } from './world/npc-signs.js';
import { createNpcCard } from './ui/npc-card.js';
import { planHeroPlot, buildHeroPlot, filterHeroTrees, HERO_ADDRESS } from './world/hero.js';
import { planHero84, buildHero84, HERO84_ADDRESS } from './world/hero84.js';

const params = new URLSearchParams(location.search);
const $ld = document.getElementById('ld-fill'), $ldt = document.getElementById('ld-text');
const setLoad = (p, t) => { $ld.style.width = Math.round(p * 100) + '%'; if (t) $ldt.textContent = t; };
const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
let qKey = params.get('q') || (isTouch ? 'high' : 'ultra');
if (!QUALITY[qKey]) qKey = 'high';

async function boot() {
  setLoad(0.02, 'Запуск графики…');
  const app = document.getElementById('app');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  if (!renderer.capabilities.isWebGL2) { $ldt.textContent = 'Нужен WebGL2 (Safari 15+)'; return; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = true;
  app.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.15, 3600);
  scene.add(camera);

  let Q = QUALITY[qKey];
  const dpr = window.devicePixelRatio || 1;
  let resScale = 1;
  const applyPR = () => {
    let pr = Math.min(dpr, Q.pr) * resScale;
    const maxPix = 9.5e6; // cap total drawing-buffer pixels (keeps iOS happy)
    pr = Math.min(pr, Math.sqrt(maxPix / (innerWidth * innerHeight)));
    renderer.setPixelRatio(Math.max(0.5, pr)); renderer.setSize(innerWidth, innerHeight);
  };
  applyPR();

  // ---- data
  setLoad(0.05, 'Загрузка данных OpenStreetMap и высот…');
  const world = await loadWorldData(); await tick();
  setLoad(0.12, 'Планировка села…');
  const layout = generateLayout(world);
  const heroPlan = planHeroPlot(world, layout); await tick();      // Польова, 35Б: levels ground, replaces procedural plot
  const heroPlan84 = planHero84(world, layout);                     // Польова, 84 (second hero plot)
  if (heroPlan) heroPlan.houseIdx = layout.buildings.indexOf(heroPlan.houseObj);   // indices may shift when the 2nd plot strips buildings
  setLoad(0.18, 'Растеризация земли, дорог, полей…');
  const rasters = buildRasters(world, layout); await tick();

  setLoad(0.25, 'Загрузка PBR-текстур…');
  const sky = new Sky(renderer, scene);
  const [materials] = await Promise.all([
    loadMaterials(renderer, Q.aniso, (p) => setLoad(0.25 + p * 0.4, 'Загрузка PBR-текстур…')),
    sky.load(),
  ]);
  await tick();

  setLoad(0.68, 'Рельеф…');
  const terrain = buildTerrain(world, rasters, materials.arrays); scene.add(terrain); await tick();

  setLoad(0.74, 'Дома, заборы, колодцы…');
  const extra = makeExtraMaterials();
  const S = new BuildingSet();
  for (const b of layout.buildings) if (!b.hero) addBuilding(S, world, b);
  for (const w of layout.wells) addWell(S, world, w.x, w.z);
  const bgroup = new THREE.Group(); bgroup.name = 'buildings'; scene.add(bgroup);
  const bstat = S.mesh(materials, extra, bgroup);
  const props = new THREE.Group(); props.name = 'props'; scene.add(props);
  const fenceTris = buildFences(world, layout, props);
  const heroPoi = buildHeroPlot(scene, world, layout, materials, extra);
  const heroPoi84 = buildHero84(scene, world, layout, materials, extra);
  buildPoles(world, layout, props); buildMast(world, layout, props); buildRoadMarkings(world, props);
  await tick();

  // ---- spawn: residential road point nearest the centre with several houses around
  let spawn = { x: 0, z: 0, yaw: 0 }, bestScore = 1e9;
  for (const r of world.json.roads) {
    if (!['residential', 'unclassified', 'tertiary'].includes(r.kind)) continue;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i]; const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const near = layout.buildings.filter((q) => q.kind === 'house' && Math.hypot(q.x - mx, q.z - mz) < 45).length;
      if (near < 4) continue;
      const score = Math.hypot(mx, mz);
      if (score < bestScore) { bestScore = score; const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; spawn = { x: mx, z: mz, yaw: Math.atan2(-dx / L, -dz / L), dx: dx / L, dz: dz / L, hw: r.w / 2 }; }
    }
  }
  const sd = spawn.dx !== undefined ? spawn : { dx: 0, dz: -1, hw: 3 };
  buildSigns(world, { signX: spawn.x + sd.dx * 9 - sd.dz * (sd.hw + 1.6), signZ: spawn.z + sd.dz * 9 + sd.dx * (sd.hw + 1.6), signRot: Math.atan2(-sd.dx, -sd.dz) }, props);

  setLoad(0.84, 'Деревья и растительность…');
  const trees = new Trees(scene, Q);
  const treeList = filterHeroTrees([heroPlan, heroPlan84], planTrees(world, layout, rasters));
  trees.build(world, treeList, rasters); await tick();
  const grass = new Grass(scene, world, rasters);
  grass.setQuality(Q);

  setLoad(0.93, 'Вода и небо…');
  const waters = new Waters(scene, world, sky);
  waters.setGrass(grass);
  waters.setReflection(Q.reflect);

  // ---- villagers: navigation graph, population data, simulation, instanced renderer
  setLoad(0.96, 'Жители села…');
  const nav = buildNpcNav(world, layout, rasters); await tick();
  if (heroPlan) { const hh = nav.houses.find((q) => q.id === heroPlan.houseIdx); if (hh) hh.address = HERO_ADDRESS; else console.warn('hero house is not navigable'); }
  if (heroPlan84) { const hh = nav.houses.find((q) => q.id === heroPlan84.houseIdx); if (hh) hh.address = HERO84_ADDRESS; else console.warn('hero84 house is not navigable'); }
  { // hero addresses are fixed: renumber any procedural neighbour that got the same number (+2 keeps the odd/even side)
    const fixed = new Set(nav.houses.filter((h) => h.id === heroPlan?.houseIdx || h.id === heroPlan84?.houseIdx).map((h) => h.address));
    const used = new Set(nav.houses.map((h) => h.address));
    for (const h of nav.houses) {
      if (h.id === heroPlan?.houseIdx || h.id === heroPlan84?.houseIdx || !fixed.has(h.address)) continue;
      const m = /^(.*?)(\d+)$/.exec(h.address); if (!m) continue;
      let n = +m[2]; do { n += 2; } while (used.has(m[1] + n)); h.address = m[1] + n; used.add(h.address);
    }
  }
  const civicIds = new Set(nav.houses.filter((h) => h.civic).map((h) => h.id));
  const pop = generatePopulation(nav.houses.filter((h) => !h.civic).map((h) => ({ id: h.id, x: h.x, z: h.z, address: h.address })), {
    seed: 4207, size: POPULATION, pinHouses: [heroPlan, heroPlan84].filter(Boolean).map((h) => h.houseIdx), centre: nav.centreXZ, shops: nav.shops.map((q) => ({ x: q.x, z: q.z })), school: { x: nav.school.x, z: nav.school.z }, post: nav.post ? { x: nav.post.x, z: nav.post.z } : null,
  });
  void civicIds;
  const sim = new NpcSim(pop, nav, world, rasters, { hoursPerSecond: TIME_SPEED });
  const npcR = new NpcRenderer(scene, sim);
  const signs = new CivicSigns(scene, world, nav);

  // ---- player & HUD
  const player = new Player(world, rasters, camera, renderer.domElement);
  scene.add(player.avatar);
  player.teleport(spawn.x, spawn.z, spawn.yaw);
  if (params.has('x')) player.teleport(parseFloat(params.get('x')), parseFloat(params.get('z') || '0'), parseFloat(params.get('yaw') || '0') );
  if (params.has('pitch')) player.pitch = parseFloat(params.get('pitch'));
  if (params.get('view') === 'fp') player.toggleView();

  let curAniso = Q.aniso;
  let hour = params.has('t') ? parseFloat(params.get('t')) : 10.5;
  let day = params.has('day') ? parseInt(params.get('day'), 10) : 0;           // 0 = Monday
  let auto = params.get('auto') !== '0';

  const applyQuality = (key, first = false) => {
    Q = QUALITY[key]; qKey = key;
    applyPR();
    sky.sun.castShadow = Q.shadows;
    const sh = sky.sun.shadow;
    if (sh.mapSize.x !== Q.shadowMap) { if (sh.map) { sh.map.dispose(); sh.map = null; } sh.mapSize.set(Q.shadowMap, Q.shadowMap); }
    grass.setQuality(Q); grass.shadows = Q.shadows; grass.group.visible = true;
    waters.setReflection(Q.reflect); waters.reflectSize = Q.reflect;
    if (!first && Q.aniso !== curAniso) { // anisotropy only changes on upload; re-upload once when it differs
      curAniso = Q.aniso; setAnisotropy(materials, Q.aniso);
      [...Object.values(materials.mats).flatMap((m) => [m.map, m.normalMap, m.aoMap]), ...Object.values(materials.arrays)].forEach((t) => { if (t) t.needsUpdate = true; });
    }
    hud.setQuality(Q.label);
    npcR.setShadows(Q.shadows);
  };
  const hud = createHUD({
    onTime: (h) => { hour = h; auto = false; document.getElementById('btn-auto').classList.remove('on'); document.getElementById('btn-auto').textContent = 'Пауза'; },
    onAuto: () => (auto = !auto),
    onQuality: () => { resScale = 1; applyQuality(QUALITY_ORDER[(QUALITY_ORDER.indexOf(qKey) + 1) % QUALITY_ORDER.length]); },
    onView: () => player.toggleView(),
    onRun: () => (player.run = !player.run),
    onGoto: () => gotoHero(),
    onGoto84: () => gotoHero84(),
  });
  applyQuality(qKey, true);
  if (params.get('hud') === '0') document.getElementById('hud').style.display = 'none';
  if (!auto) { document.getElementById('btn-auto').classList.remove('on'); document.getElementById('btn-auto').textContent = 'Пауза'; }

  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyPR(); });
  document.addEventListener('visibilitychange', () => { clock.getDelta(); });
  addEventListener('keydown', (e) => { if (e.code === 'KeyQ') hud.el('btn-quality').click(); if (e.code === 'KeyT') hud.el('btn-auto').click(); });

  // initial lighting + first frames
  sky.setHour(hour, camera, 0, true);
  hud.setClock(hour, day); hud.setPop(pop.size, 0);
  extra.winLit.emissiveIntensity = (1 - sky.state.day) * 2.2;
  setLoad(1, 'Готово');

  // ---- villager selection: tap / click (or E at the crosshair) shows a card
  const card = createNpcCard();
  card.onClose(() => { selected = null; });
  const selectAt = (x, y) => {
    const a = npcR.pick(camera, x, y, innerWidth, innerHeight, 70);
    if (a) { selected = a; hiddenSince = time; card.show(a, sim); } else if (card.visible) { card.hide(); selected = null; }
  };
  { let down = null; const dom = renderer.domElement;
    dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; });
    dom.addEventListener('pointerup', (e) => {
      if (!down || down.id !== e.pointerId) return;
      const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 14 && performance.now() - down.t < 450; down = null;
      if (tap) { if (document.pointerLockElement === dom) selectAt(innerWidth / 2, innerHeight / 2); else selectAt(e.clientX, e.clientY); }
    });
    addEventListener('keydown', (e) => { if (e.code === 'KeyE') selectAt(innerWidth / 2, innerHeight / 2); if (e.code === 'Escape' && card.visible) { card.hide(); selected = null; } });
  }

  // ---- main loop
  let lastT = performance.now();
  const clock = { getDelta() { const n = performance.now(); const d = (n - lastT) / 1000; lastT = n; return d; } };
  let lastSign = 0, lastCard = 0, hiddenSince = 0, selected = null; let time = 0, frames = 0, accT = 0, fps = 60, lastTreeUpd = 0, lastSky = 0, adaptT = 0, goodT = 0, lastRes = 0;
  const gotoPoi = (poi) => {
    if (!poi) return;
    const v = poi.view; player.teleport(v.x, v.z, v.yaw); player.pitch = v.pitch;
    if (player.thirdPerson) { player.toggleView(); hud.setView(false); }
    if (card.visible) { card.hide(); selected = null; }
  };
  const gotoHero = () => gotoPoi(heroPoi);
  const gotoHero84 = () => gotoPoi(heroPoi84);
  if (params.get('poi') === '35b') gotoHero();
  if (params.get('poi') === '84') gotoHero84();
  const ftimes = [];
  const info = renderer.info; info.autoReset = true;
  const manual = params.get('manual') === '1';
  function frame(fixedDt) {
    if (!manual) requestAnimationFrame(frame);
    const dt = manual ? fixedDt : Math.min(clock.getDelta(), 0.05);
    time += dt;
    if (auto) { hour += dt * TIME_SPEED; if (hour >= 24) { hour -= 24; day++; } }
    player.update(dt);
    // sky/time (10 Hz while time runs)
    if (time - lastSky > 0.1) { lastSky = time; sky.setHour(hour, camera, time); hud.setClock(hour, day); extra.winLit.emissiveIntensity = clamp((1 - sky.state.day * 1.3) * 2.2, 0, 2.2); }
    sky.dome.position.copy(camera.position);
    if (heroPoi) heroPoi.update(player.pos);
    if (heroPoi84) heroPoi84.update(player.pos);
    sky.uniforms.uTime.value = time;
    if (Q.shadows) sky.followShadow(player.pos.x, player.pos.y, player.pos.z, Q.shadowRange, Q.shadowMap);
    grass.update(player.pos.x, player.pos.z, time, 2);
    if (time - lastTreeUpd > 0.25) { lastTreeUpd = time; trees.update(player.pos.x, player.pos.z, Q.treeDist, Q.shadows); }
    waters.update(dt, player.pos.x, player.pos.z);
    sim.update(dt, day, hour, player.pos);
    npcR.update(camera, Q, time);
    if (time - lastSign > 0.5) { lastSign = time; signs.update(player.pos); hud.setPop(pop.size, sim.stats.outside); }
    if (card.visible) {
      if (!selected || (selected.hidden && time - hiddenSince > 6)) { card.hide(); selected = null; }
      else { if (selected.hidden) { card.mark(0, 0, false); } else { hiddenSince = time; const sp = npcR.screenPos(camera, selected, innerWidth, innerHeight); card.mark(sp.x, sp.y, sp.visible); } if (time - lastCard > 0.4) { lastCard = time; card.refresh(selected, sim); } }
    }
    renderer.render(scene, camera);

    // fps + adaptive resolution
    frames++; accT += dt;
    if (accT >= 1) {
      fps = frames / accT; frames = 0; accT = 0;
      hud.setFps(fps, `${Q.label} · ${(Math.min(dpr, Q.pr) * resScale).toFixed(2)}x · ${Math.round(info.render.calls)} dc · ${(info.render.triangles / 1000) | 0}k△`);
      const nowS = time;
      if (fps < 44 && resScale > 0.55 && nowS - lastRes > 2) { resScale = Math.max(0.55, resScale - 0.12); applyPR(); lastRes = nowS; goodT = 0; }
      else if (fps > 58) { goodT += 1; if (goodT >= 5 && resScale < 1 && nowS - lastRes > 2) { resScale = Math.min(1, resScale + 0.08); applyPR(); lastRes = nowS; goodT = 0; } }
      else goodT = 0;
    }
  }
  if (!manual) frame();
  setTimeout(() => document.getElementById('loader').classList.add('done'), 300);

  window.__village = {
    hero: heroPoi, heroPlan, gotoHero, hero84: heroPoi84, heroPlan84, gotoHero84, THREE, renderer, scene, camera, world, layout, rasters, pop, nav, sim, npcR, card, sky, player, grass, trees, waters, terrain, materials,
    step: (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) frame(dt); }, snap: () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.92); },
    stats: () => ({ npc: { ...npcR.counts, ...sim.stats, total: pop.size }, calls: info.render.calls, tris: info.render.triangles, geos: info.memory.geometries, textures: info.memory.textures, fps, bstat, fenceTris, houses: layout.stats, trees: trees.count }),
    setHour: (h, d) => { hour = h; if (d !== undefined) day = d; auto = false; sky.setHour(h, camera, time, true); hud.setClock(h, day); },
    select: (id) => { const a = sim.actors[id]; selected = a; hiddenSince = time; card.show(a, sim); }, pick: (x, y) => selectAt(x, y), setQuality: (k) => applyQuality(k), get hour() { return hour; },
  };
}
boot().catch((e) => { console.error(e); const t = document.getElementById('ld-text'); if (t) t.textContent = 'Ошибка: ' + e.message; });

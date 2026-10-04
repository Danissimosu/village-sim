// Villager simulation: schedule-driven state machine, graph route following, terrain-following positions and
// distance-based update rates. No rendering — renderer / UI only read the `actors` array.
import { mulberry32, clamp } from '../util.js';
import { clearLine } from './npc-nav.js';
import { buildPlan, describe, walkSpeed, WALK_TYPES } from './npc-schedule.js';

const HIDE_TYPES = new Set(['home', 'shop', 'visit', 'school', 'work_shop', 'work_school', 'busride', 'schoolbus']);
const WANDER_TYPES = new Set(['garden', 'field', 'orchard', 'pasture', 'pond', 'centre', 'post', 'yard']);
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const d2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

export class NpcSim {
  /**
   * @param pop   Population (data)
   * @param nav   result of buildNpcNav
   * @param world WorldData (heightAt)
   * @param rasters Rasters (blockedAt)
   * @param opts  {hoursPerSecond}  game hours per real second (used to time departures)
   */
  constructor(pop, nav, world, rasters, opts = {}) {
    this.pop = pop; this.nav = nav; this.world = world; this.rasters = rasters;
    this.hps = opts.hoursPerSecond ?? 1 / 150;
    this.day = 0; this.hour = 10.5; this._lastAbs = null; this._frame = 0; this.routeBudget = 0;
    this.walkScale = 1;
    this.byHouse = new Map(nav.houses.map((h) => [h.id, h]));
    this.actors = pop.residents.map((r) => this._makeActor(r));
    // neighbours / nearest places per household (computed once)
    this._buildContexts();
    this.stats = { walking: 0, outside: 0, hidden: 0 };
  }

  _makeActor(r) {
    const rng = mulberry32(r.seed);
    const house = this.byHouse.get(r.houseId);
    const a = {
      id: r.id, res: r, house, ctx: null, baseSpeed: walkSpeed(r), rng,
      x: house.door.x, z: house.door.z, y: 0, heading: rng() * 6.28, phase: rng() * 6.28,
      hidden: true, walking: false, path: null, pi: 0, spot: house.door, entry: null, plan: null, planDay: -1,
      amp: 0, work: 0, run: false, lat: 0.5 + rng() * 0.9, stayT: 5 + rng() * 30, acc: rng() * 0.4, moved: 0,
      scale: 1, stoop: 0, speed: 1,
    };
    a.y = this.world.heightAt(a.x, a.z);
    return a;
  }

  _buildContexts() {
    const { pop, nav } = this;
    const occupied = pop.households.map((h) => ({ h, house: this.byHouse.get(h.houseId), host: pop.residents[h.members[0]] }));
    const near = (list, p, key = (q) => q) => { let best = null, bd = 1e18; for (const q of list) { const o = key(q); const d = (o.x - p.x) ** 2 + (o.z - p.z) ** 2; if (d < bd) { bd = d; best = q; } } return best; };
    const ponds = nav.ponds, fields = nav.fields;
    const routeLen = (a, b) => { const r = nav.route(a, b); if (!r) return 1e9; let l = 0; for (let i = 1; i < r.length; i++) l += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]); return l; };
    const ctxByHouse = new Map();
    for (const o of occupied) {
      const hs = o.house;
      // 4 nearest other occupied houses within ~220 m for visits
      const neigh = occupied.filter((q) => q !== o).map((q) => ({ q, d: Math.hypot(q.house.x - hs.x, q.house.z - hs.z) })).filter((q) => q.d < 220).sort((a, b) => a.d - b.d).slice(0, 5).map((q) => ({ door: q.q.house.door, host: q.q.host }));
      const shopC = nav.shops.map((s) => ({ s, d: Math.hypot(s.x - hs.x, s.z - hs.z) })).sort((a, b) => a.d - b.d).slice(0, 2).map((q) => ({ ...q, rl: routeLen(hs.door, q.s.door) })).sort((a, b) => a.rl - b.rl)[0];
      const shop = shopC ? { door: shopC.s.door, forecourt: { spots: shopC.s.spots }, dist: shopC.rl, hub: shopC.s } : null;
      const bus = nav.busStops.length ? near(nav.busStops, hs) : null;
      const sDist = routeLen(hs.door, nav.school.door);
      const pond = ponds.length ? near(ponds, hs) : null;
      const pondOk = pond && Math.hypot(pond.x - hs.x, pond.z - hs.z) < 650 ? pond : null;
      const fld = fields.length ? near(fields, hs) : null;
      const fieldOk = fld && Math.hypot(fld.x - hs.x, fld.z - hs.z) < 420 && !hs.garden ? fld : (fld && Math.hypot(fld.x - hs.x, fld.z - hs.z) < 300 ? fld : null);
      ctxByHouse.set(hs.id, { house: hs, neighbors: neigh, shop, bus, school: nav.school, schoolMode: sDist <= 520 ? 'walk' : 'bus', pond: pondOk, field: fieldOk, post: nav.post });
    }
    for (const a of this.actors) a.ctx = ctxByHouse.get(a.house.id);
    for (const a of this.actors) { // body parameters
      const r = a.res, age = r.age;
      const hm = age >= 18 ? (r.female ? 1.66 : 1.78) : heightAtAge(age, r.female);
      const j = ((r.seed >> 5) % 100) / 100 - 0.5;
      a.scale = (hm * (1 + j * (age >= 18 ? 0.07 : 0.04))) / 1.78;
      a.stoop = clamp((age - 58) / 35, 0, 1) * 0.34 * (0.7 + (r.seed % 7) / 12);
    }
  }

  // ---- time -----------------------------------------------------------------------------------------------------
  /** advance simulation. `cam` = {x,z} observer position (player). */
  update(dt, day, hour, cam) {
    const abs = day * 24 + hour, now = performance.now();
    const first = this._lastAbs === null;
    if (!first && Math.abs(abs - this._lastAbs) > 0.35) this._snapAt = now + 180;     // time slider jump: re-sync after it settles
    this._lastAbs = abs; this.day = day; this.hour = hour;
    if (first || (this._snapAt && now >= this._snapAt)) { this._snapAt = 0; this.snapAll(); }
    this.routeBudget = 10; this._frame++;
    let walking = 0, outside = 0;
    for (const a of this.actors) {
      const dx = a.x - cam.x, dz = a.z - cam.z, dist2 = dx * dx + dz * dz;
      a.dist2 = dist2;
      const interval = a.hidden ? 0.6 : dist2 < 75 * 75 ? 0 : dist2 < 220 * 220 ? 0.07 : 0.4;
      a.acc += dt;
      if (a.acc >= interval) { const step = a.acc; a.acc = a.hidden ? (a.id % 7) * 0.05 : 0; this._step(a, Math.min(step, 4)); }
      if (a.walking) walking++; if (!a.hidden) outside++;
    }
    this.stats.walking = walking; this.stats.outside = outside; this.stats.hidden = this.actors.length - outside;
  }

  _plan(a) {
    if (a.planDay !== this.day || !a.plan) { a.plan = buildPlan(a, this.day, this.hps); a.planDay = this.day; }
    return a.plan;
  }
  _want(a) {
    const p = this._plan(a); let w = p[0];
    for (let i = 1; i < p.length; i++) { if (p[i].t <= this.hour) w = p[i]; else break; }
    return w;
  }

  _step(a, dt) {
    const want = this._want(a);
    if (a.walking) { this._follow(a, dt); return; }
    if (a.entry !== want) { this._depart(a, want); if (a.walking) this._follow(a, 0.0001); return; }
    // staying: wander between spots of the same place, work animation
    a.amp += (0 - a.amp) * Math.min(1, dt * 8);
    const wk = !a.hidden && WALK_TYPES.has(want.type) ? 1 : 0; a.work += (wk - a.work) * Math.min(1, dt * 4);
    if (a.hidden || !want.place || !WANDER_TYPES.has(want.type)) return;
    a.stayT -= dt;
    if (a.stayT <= 0) {
      a.stayT = 18 + a.rng() * 40;
      const sp = want.place.spots; if (!sp || sp.length < 2) return;
      const tgt = sp[Math.floor(a.rng() * sp.length)];
      if (tgt === a.spot || Math.hypot(tgt.x - a.x, tgt.z - a.z) > 40 || !clearLine(this.rasters, a.x, a.z, tgt.x, tgt.z, 0.75)) return;
      a.path = [[tgt.x, tgt.z]]; a.pi = 0; a.walking = true; a.local = true; a.run = false; a.speed = a.baseSpeed * 0.65; a.spot = tgt; a.entry = want;
    }
  }

  _depart(a, want) {
    const target = want.spot;
    a.entry = want; a.local = false;
    if (a.spot === target || (Math.abs(a.spot.x - target.x) < 0.3 && Math.abs(a.spot.z - target.z) < 0.3)) { this._arrive(a, want, target); return; }
    if (this.routeBudget <= 0) { a.entry = null; return; }   // try again next step
    this.routeBudget--;
    const path = this.nav.route(a.spot, target, a.lat);
    if (!path || path.length === 0) { this._arrive(a, want, target); return; }
    a.path = path; a.pi = 0; a.walking = true;
    if (a.hidden) { a.hidden = false; a.x = a.spot.x; a.z = a.spot.z; a.y = this.world.heightAt(a.x, a.z); }
    a.run = a.res.age < 13 && a.res.age >= 4 && ((a.res.seed + this.day) % 3 === 0);
    a.speed = a.baseSpeed * (a.run ? 1.75 : 1) * this.walkScale;
    a.spot = target;
  }

  _arrive(a, entry, target) {
    a.walking = false; a.path = null; a.local = false;
    a.x = target.x; a.z = target.z; a.spot = target; a.y = this.world.heightAt(a.x, a.z);
    a.hidden = HIDE_TYPES.has(entry.type); a.stayT = 5 + a.rng() * 25; a.amp = 0;
    if (!a.hidden && entry.place && entry.place.spots && entry.place.spots[0] && !entry.type.startsWith('work')) a.heading += (a.rng() - 0.5) * 2;
  }

  _follow(a, dt) {
    let move = a.speed * dt, moved = 0; const P = a.path;
    while (move > 0 && a.pi < P.length) {
      const tx = P[a.pi][0], tz = P[a.pi][1], dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
      if (d > 0.01) { const th = Math.atan2(dx, dz); const k = a.local || dt < 0.2 ? Math.min(1, Math.max(dt, 0.016) * 9) : 1; a.heading += angDiff(a.heading, th) * k; }
      if (d <= move) { a.x = tx; a.z = tz; move -= d; moved += d; a.pi++; }
      else { a.x += (dx / d) * move; a.z += (dz / d) * move; moved += move; move = 0; }
    }
    a.y = this.world.heightAt(a.x, a.z);
    a.phase += moved * (a.run ? 4.6 : 3.9) / Math.max(0.55, a.scale);
    const tgtAmp = dt > 0 ? Math.min(1, moved / Math.max(dt, 1e-4) / 1.5) * (a.run ? 1.2 : 1) : 1;
    a.amp += (tgtAmp - a.amp) * Math.min(1, dt * 10);
    a.work += (0 - a.work) * Math.min(1, dt * 6);
    if (a.pi >= P.length) this._arrive(a, a.entry || this._want(a), a.spot);
  }

  /** teleport everybody to where the schedule says they are right now (time jumps, startup) */
  snapAll() {
    for (const a of this.actors) {
      a.plan = null; a.planDay = -1; const want = this._want(a), p = a.plan;
      const prevIdx = p.indexOf(want) - 1; const elapsed = this.hour - want.t;
      a.walking = false; a.path = null; a.entry = want;
      if (prevIdx >= 0 && want.est > 0 && elapsed >= 0 && elapsed < want.est * 0.98) { // still on the way
        const from = p[prevIdx].spot;
        const path = this.nav.route(from, want.spot, a.lat);
        if (path && path.length) {
          let len = 0; for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
          let s = (elapsed / want.est) * len, i = 1, px = path[0][0], pz = path[0][1];
          while (i < path.length) { const L = Math.hypot(path[i][0] - px, path[i][1] - pz); if (L >= s) { const t = L > 0 ? s / L : 0; px += (path[i][0] - px) * t; pz += (path[i][1] - pz) * t; break; } s -= L; px = path[i][0]; pz = path[i][1]; i++; }
          a.x = px; a.z = pz; a.y = this.world.heightAt(px, pz); a.path = path.slice(i); a.pi = 0; a.walking = a.path.length > 0; a.hidden = false; a.local = false;
          a.run = false; a.speed = a.baseSpeed * this.walkScale; a.spot = want.spot; a.amp = 1; if (a.walking) continue;
        }
      }
      this._arrive(a, want, want.spot);
    }
  }

  describe(a) { return describe(a, this.hour); }
  clockText() { return ''; }
}

function heightAtAge(age, female) { // metres
  const T = [[0, 0.5], [1, 0.76], [3, 0.95], [6, 1.15], [10, 1.38], [14, 1.6], [17, female ? 1.65 : 1.76], [18, female ? 1.66 : 1.78]];
  for (let i = 1; i < T.length; i++) if (age <= T[i][0]) { const t = (age - T[i - 1][0]) / (T[i][0] - T[i - 1][0]); return T[i - 1][1] + (T[i][1] - T[i - 1][1]) * t; }
  return 1.7;
}

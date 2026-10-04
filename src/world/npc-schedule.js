// Daily schedules: turns a resident (age, job, household, hobby) + day number into a list of timed visits.
// A plan entry = {t: departure hour, type, spot, place, host, est}. The villager walks to `spot` starting at `t`
// and stays there until the next entry starts. Pure logic (no rendering).
import { mulberry32 } from '../util.js';

export const WALK_TYPES = new Set(['garden', 'field', 'orchard', 'pasture']);
const pickOf = (rng, a) => a[Math.floor(rng() * a.length)];

export function isWeekend(day) { return day % 7 >= 5; }

export function walkSpeed(res) {
  const j = ((res.seed % 1000) / 1000 - 0.5) * 0.22, a = res.age;
  if (a < 3) return 0.7;
  if (a < 7) return 1.15 + j;
  if (a < 14) return 1.55 + j;
  if (a < 18) return 1.6 + j;
  if (a < 60) return (res.female ? 1.42 : 1.52) + j;
  if (a < 72) return 1.2 + j;
  return 0.95 + j * 0.8;
}

class Builder {
  constructor(actor, hps, rng) { this.a = actor; this.hps = hps; this.rng = rng; this.e = []; this.cur = actor.ctx.house.door; this.lastArrive = 0; }
  J(a, b) { return a + this.rng() * (b - a); }
  est(spot) { const c = this.cur; const d = Math.hypot(spot.x - c.x, spot.z - c.z) * 1.35 + 4; return (d / this.a.baseSpeed) * this.hps + 0.01; }
  start() { this.e.push({ t: 0, type: 'home', spot: this.cur, est: 0 }); this.lastArrive = 0; }
  // be at `spot` by hour `arrive`
  at(arrive, type, spot, extra = {}) {
    if (!spot) return this;
    const last = this.e[this.e.length - 1];
    if (last && last.spot === spot && last.type === type) return this;
    const est = this.cur === spot ? 0 : this.est(spot);
    let t = Math.max(arrive - est, this.lastArrive + 0.1);
    if (type === 'home' && t > 23.7) t = 23.7;
    if (t >= 23.85) return this;
    this.e.push({ t, type, spot, est, ...extra }); this.lastArrive = t + est; this.cur = spot; return this;
  }
  // start walking at `depart`
  leave(depart, type, spot, extra = {}) {
    const est = this.cur === spot ? 0 : this.est(spot);
    return this.at(Math.max(depart, this.lastArrive + 0.1) + est, type, spot, extra);
  }
}

function gardenSpot(c, rng) { const h = c.house; if (h.garden && h.garden.length) return { spot: pickOf(rng, h.garden), type: 'garden', place: { spots: h.garden } }; return { spot: h.yard, type: 'yard', place: null }; }
function placeSpot(pl, rng) { return pl ? { spot: pickOf(rng, pl.spots), place: pl } : null; }

/** Build the plan for one resident for the given day number. */
export function buildPlan(actor, day, hps) {
  const res = actor.res, c = actor.ctx;
  const rng = mulberry32((res.seed ^ Math.imul(day + 1, 2654435761)) >>> 0);
  const b = new Builder(actor, hps, rng);
  b.start();
  const wk = !isWeekend(day), age = res.age, f = res.female;
  const home = c.house.door;
  const J = (x, y) => b.J(x, y);
  const gard = () => gardenSpot(c, rng);
  const goGarden = (t) => { const g = gard(); b.at(t, g.type, g.spot, { place: g.place }); };
  const goField = (t) => { const p = placeSpot(c.field, rng); if (p) b.at(t, c.field.kind, p.spot, { place: p.place }); else goGarden(t); };
  const goShop = (t) => { if (c.shop) b.at(t, 'shop', c.shop.door); };
  const goForecourt = (t) => { const p = placeSpot(c.shop && c.shop.forecourt, rng); if (p) b.at(t, 'centre', p.spot, { place: p.place }); else goGarden(t); };
  const goPond = (t) => { const p = placeSpot(c.pond, rng); if (p) b.at(t, 'pond', p.spot, { place: p.place }); else goForecourt(t); };
  const goVisit = (t) => { const n = c.neighbors; if (!n.length) return goGarden(t); const h = pickOf(rng, n); b.at(t, 'visit', h.door, { host: h.host }); };
  const goPost = (t) => { const p = placeSpot(c.post, rng); if (p) b.at(t, 'post', p.spot, { place: p.place }); };
  const goHome = (t) => b.at(t, 'home', home);
  const shopNear = c.shop && c.shop.dist < 650;
  const evening = (t0, t1) => { // 17:30–19:30 free time
    const x = rng();
    if (x < 0.22) goVisit(J(t0, t1)); else if (x < 0.42 && res.hobby === 'fishing') goPond(J(t0, t1)); else if (x < 0.55) goForecourt(J(t0, t1)); else if (x < 0.65 && c.pond) goPond(J(t0, t1)); else goGarden(J(t0, t1));
  };

  switch (res.job) {
    case 'baby': break;
    case 'kid': // preschool: plays in the yard with a family member
      goHome(0); b.at(J(9.6, 10.6), 'yard', c.house.yard); goHome(J(11.9, 12.8)); b.at(J(15, 16.4), 'yard', c.house.yard); goHome(J(17.4, 18.4)); break;
    case 'school': {
      if (wk) {
        if (c.schoolMode === 'walk') { b.at(J(7.8, 8.0), 'school', c.school.door); b.leave(J(13.5, 14.4), 'home', home); }
        else { b.at(J(7.0, 7.5), 'schoolbus', c.bus.spots[0], { place: { spots: c.bus.spots } }); b.leave(J(14.6, 15.4), 'home', home); }
        if (rng() < 0.75) { const x = rng(); if (x < 0.4 && age >= 10) goForecourt(J(16, 17.5)); else if (x < 0.6 && c.pond) goPond(J(16, 17.5)); else if (x < 0.8) goVisit(J(16, 17.5)); else goGarden(J(16, 17.5)); }
        if (age >= 14 && rng() < 0.35) goForecourt(J(19.3, 20.2));
        goHome(J(21.4, 22.4));
      } else {
        goHome(0); const x = rng(); if (x < 0.5) goForecourt(J(10.5, 12)); else if (x < 0.75 && c.pond) goPond(J(10.5, 12)); else goVisit(J(10.5, 12));
        goHome(J(13, 14)); const y = rng(); if (y < 0.5) goForecourt(J(15.2, 17.2)); else goVisit(J(15.2, 17.2)); if (age >= 14 && rng() < 0.4) goForecourt(J(19.3, 20.4)); goHome(J(21.2, 22.4));
      }
      break;
    }
    case 'student': case 'commute': {
      if (wk && !(res.job === 'student' && day % 7 === 4 && rng() < 0.4)) {
        b.at(J(6.6, 7.6), 'busride', c.bus.spots[0], { place: { spots: c.bus.spots } });
        b.leave(J(17.4, 19.2), 'home', home);
        if (rng() < 0.3) evening(19.6, 20.6);
        goHome(J(21.6, 22.8));
      } else { goGarden(J(8.5, 10)); goHome(J(12.3, 13.4)); if (rng() < 0.6) goForecourt(J(15, 17)); else goVisit(J(15, 17)); goHome(J(19.2, 20.6)); }
      break;
    }
    case 'shop':
      if (wk || day % 7 === 5) { b.at(J(7.7, 8.0), 'work_shop', c.shop.door); b.leave(J(18.8, 19.6), 'home', home); goHome(J(20, 21)); }
      else { goGarden(J(8, 9.5)); goHome(J(12, 13)); goGarden(J(15, 16.5)); goHome(J(19, 20.5)); }
      break;
    case 'teacher':
      if (wk) { b.at(J(7.3, 7.7), 'work_school', c.school.door); b.leave(J(15, 16), 'home', home); if (rng() < 0.4) goShop(J(16.4, 17.4)); goGarden(J(17.5, 18.5)); goHome(J(19.8, 21)); }
      else { goGarden(J(8.5, 10)); goHome(J(12.2, 13.4)); goGarden(J(15, 16.5)); goHome(J(19, 20.5)); }
      break;
    case 'post':
      if (wk) { goHome(0); b.at(J(8.8, 9.2), 'post', c.post ? c.post.spots[0] : home, { place: c.post }); b.leave(J(12.4, 13), 'home', home); b.at(J(14, 14.4), 'post', c.post ? c.post.spots[0] : home, { place: c.post }); b.leave(J(17, 17.6), 'home', home); goHome(J(20, 21)); }
      else { goGarden(J(8.5, 10)); goHome(J(12.3, 13.4)); goVisit(J(15, 17)); goHome(J(19, 20.6)); }
      break;
    case 'retired': {
      goGarden(J(6.0, 7.4));
      if (shopNear && rng() < (age > 78 ? 0.3 : 0.55)) { goShop(J(8.8, 10.2)); goGarden(J(10.6, 11.8)); }
      else if (rng() < 0.5) goGarden(J(9.6, 10.6));
      goHome(J(12.4, 13.4));
      const x = rng();
      if (age > 78) { if (x < 0.5) b.at(J(14.6, 15.6), 'yard', c.house.yard); else if (x < 0.75) goVisit(J(14.6, 15.6)); }
      else if (x < 0.3) goVisit(J(14.4, 15.6)); else if (x < 0.5) b.at(J(14.4, 15.6), 'yard', c.house.yard); else if (x < 0.65) goForecourt(J(14.6, 15.8)); else if (x < 0.73 && c.pond) goPond(J(14.6, 15.8)); else goGarden(J(14.4, 15.6));
      if (rng() < 0.65) { if (rng() < 0.25) goVisit(J(17, 18.2)); else goGarden(J(16.8, 18)); }
      goHome(J(19, 20.4));
      break;
    }
    case 'local': {
      goField(J(5.9, 7.1));            // the farm / orchard / allotments, or own garden if none nearby
      if (shopNear && rng() < 0.3) goShop(J(10.3, 11.3));
      goHome(J(12.2, 13.2));
      if (rng() < 0.7) goField(J(14.3, 15.4)); else goGarden(J(14.3, 15.4));
      evening(J(17.6, 18.4), J(18.6, 19.4));
      goHome(J(20, 21.4));
      break;
    }
    case 'homemaker': default: {
      goGarden(J(6.8, 8.2));
      if (shopNear && rng() < 0.6) goShop(J(9.3, 10.8));
      goHome(J(11.6, 12.8));
      if (rng() < 0.4) goVisit(J(14.4, 15.8)); else goGarden(J(14.4, 15.8));
      if (rng() < 0.5) evening(J(17.3, 18), J(18.4, 19.2));
      goHome(J(19.8, 21.3));
    }
  }
  if (b.e[b.e.length - 1].type !== 'home') goHome(23.5);
  return b.e;
}

// ---- Russian descriptions ---------------------------------------------------------------------------------------
const hOf = (h) => Math.floor(h) % 24;
const GARDEN_WORK = ['Копается в огороде', 'Поливает грядки', 'Собирает урожай', 'Пропалывает грядки', 'Копает картошку', 'Подвязывает помидоры'];
export function describe(actor, hour) {
  const e = actor.entry, res = actor.res; if (!e) return 'Дома';
  const hostName = e.host ? `${e.host.first} ${e.host.last}` : '';
  const old = res.age >= 60, kid = res.age < 14;
  if (actor.walking && !actor.local) {
    switch (e.type) {
      case 'home': return 'Идёт домой';
      case 'garden': return 'Идёт в огород';
      case 'yard': return 'Идёт во двор';
      case 'field': return 'Идёт на огороды';
      case 'orchard': return 'Идёт в сад';
      case 'pasture': return 'Идёт на луг';
      case 'pond': return 'Идёт к пруду';
      case 'shop': return 'Идёт в магазин';
      case 'centre': return kid ? 'Бежит к магазину' : 'Идёт к магазину';
      case 'visit': return `Идёт в гости: ${hostName}`;
      case 'school': return 'Идёт в школу';
      case 'schoolbus': return 'Идёт на школьный автобус';
      case 'busride': return 'Идёт на остановку';
      case 'work_shop': return 'Идёт на работу в магазин';
      case 'work_school': return 'Идёт на работу в школу';
      case 'post': return 'Идёт на почту';
      default: return 'Идёт по улице';
    }
  }
  const k = (actor.res.seed + Math.floor(hour * 2)) % 6;
  switch (e.type) {
    case 'home': { const h = hOf(hour); return h >= 22 || h < 6 ? 'Спит' : h < 9 ? 'Завтракает' : h >= 12 && h < 14 ? 'Обедает' : h >= 18 && h < 21 ? 'Ужинает, смотрит телевизор' : res.age < 7 ? 'Играет дома' : 'Занимается домашними делами'; }
    case 'garden': return GARDEN_WORK[k];
    case 'yard': return kid ? 'Играет во дворе' : old ? 'Сидит на лавочке у дома' : 'Кормит кур и возится во дворе';
    case 'field': return 'Работает на огородах';
    case 'orchard': return 'Собирает яблоки в саду';
    case 'pasture': return 'Пасёт козу на лугу';
    case 'pond': return res.hobby === 'fishing' && !res.female ? 'Ловит рыбу на пруду' : kid ? 'Играет у воды' : 'Гуляет у пруда, кормит уток';
    case 'shop': return 'Покупает продукты';
    case 'centre': return kid ? 'Играет с друзьями у магазина' : 'Беседует с соседями у магазина';
    case 'visit': return `В гостях: ${hostName}`;
    case 'school': return 'На уроках в школе';
    case 'schoolbus': return 'Едет в школу на автобусе';
    case 'busride': return 'Работает в городе (Киев)';
    case 'work_shop': return 'Работает за прилавком';
    case 'work_school': return 'Ведёт уроки в школе';
    case 'post': return 'Разносит почту';
    default: return 'Отдыхает';
  }
}

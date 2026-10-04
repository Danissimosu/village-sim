// Village population: 300 deterministic (seeded) residents grouped into households and assigned to houses.
// PURE DATA — no rendering, no THREE. Game mechanics (needs, relationships, economy …) can be layered on top of
// `Population` later; the NPC simulation / renderer only read from it.
import { mulberry32 } from '../util.js';

export const POP_SIZE = 300;
export const CURRENT_YEAR = 2026;

// ---- names (Ukrainian / Russian, written in Russian spelling) -------------------------------------------------
const SURNAMES = [ // [stem, type]  type: k = invariable, a = +а for women, y = -ий → -ая
  ['Коваленко', 'k'], ['Шевченко', 'k'], ['Бондаренко', 'k'], ['Ткаченко', 'k'], ['Кравченко', 'k'], ['Мельник', 'k'], ['Савченко', 'k'],
  ['Мороз', 'k'], ['Олейник', 'k'], ['Лисенко', 'k'], ['Гончаренко', 'k'], ['Петренко', 'k'], ['Руденко', 'k'], ['Марченко', 'k'],
  ['Полищук', 'k'], ['Король', 'k'], ['Кузьменко', 'k'], ['Яковенко', 'k'], ['Тимошенко', 'k'], ['Сидоренко', 'k'], ['Павленко', 'k'],
  ['Гнатюк', 'k'], ['Романюк', 'k'], ['Карпенко', 'k'], ['Захарченко', 'k'], ['Литвиненко', 'k'], ['Черненко', 'k'], ['Дяченко', 'k'],
  ['Мазур', 'k'], ['Кушнир', 'k'], ['Левченко', 'k'], ['Остапенко', 'k'], ['Приходько', 'k'], ['Мищенко', 'k'], ['Ковальчук', 'k'],
  ['Іваненко', 'k'], ['Харченко', 'k'], ['Щербак', 'k'], ['Гринько', 'k'], ['Науменко', 'k'], ['Андрющенко', 'k'], ['Василенко', 'k'],
  ['Ковальский', 'y'], ['Дубовский', 'y'], ['Мельницкий', 'y'], ['Лесной', 'y2'], ['Горбачевский', 'y'],
  ['Иванов', 'a'], ['Петров', 'a'], ['Сидоров', 'a'], ['Волошин', 'a'], ['Федоров', 'a'], ['Попов', 'a'], ['Орлов', 'a'], ['Козлов', 'a'],
].map((s) => (s[0] === 'Іваненко' ? ['Иваненко', 'k'] : s));
const M_OLD = ['Иван', 'Пётр', 'Николай', 'Василий', 'Михаил', 'Григорий', 'Анатолий', 'Владимир', 'Виктор', 'Леонид', 'Степан', 'Юрий', 'Александр', 'Сергей', 'Павел', 'Дмитрий', 'Фёдор', 'Алексей', 'Тарас', 'Андрей'];
const M_MID = ['Сергей', 'Андрей', 'Александр', 'Олег', 'Игорь', 'Виталий', 'Владимир', 'Николай', 'Юрий', 'Роман', 'Богдан', 'Максим', 'Евгений', 'Денис', 'Руслан', 'Дмитрий', 'Михаил', 'Виктор', 'Тарас', 'Степан', 'Вадим', 'Артур'];
const M_YNG = ['Артём', 'Данил', 'Богдан', 'Максим', 'Назар', 'Владислав', 'Кирилл', 'Матвей', 'Тимофей', 'Иван', 'Михаил', 'Макар', 'Ярослав', 'Остап', 'Давид', 'Никита', 'Андрей', 'Дмитрий', 'Егор', 'Илья', 'Роман', 'Марк'];
const F_OLD = ['Мария', 'Галина', 'Нина', 'Валентина', 'Людмила', 'Надежда', 'Анна', 'Татьяна', 'Любовь', 'Лидия', 'Раиса', 'Зоя', 'Ольга', 'Екатерина', 'Тамара', 'Ульяна', 'Вера', 'Прасковья', 'Ганна', 'Софья'];
const F_MID = ['Татьяна', 'Наталья', 'Оксана', 'Ирина', 'Светлана', 'Елена', 'Ольга', 'Людмила', 'Юлия', 'Анна', 'Виктория', 'Инна', 'Лариса', 'Лилия', 'Алла', 'Марина', 'Алёна', 'Галина', 'Яна', 'Екатерина'];
const F_YNG = ['София', 'Анастасия', 'Алина', 'Виктория', 'Дарья', 'Полина', 'Мария', 'Ева', 'Ярина', 'Милана', 'Злата', 'Арина', 'Варвара', 'Василиса', 'Ксения', 'Мирослава', 'Екатерина', 'Диана', 'Анна', 'Богдана'];

function surnameFor(base, female) {
  const [s, t] = base;
  if (!female) return s;
  if (t === 'a') return s + 'а';
  if (t === 'y') return s.replace(/ий$/, 'ая');
  if (t === 'y2') return s.replace(/ой$/, 'ая');
  return s;
}

// ---- helpers ----------------------------------------------------------------------------------------------------
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const ri = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)); // inclusive
function wpick(rng, items) { // items: [[weight, value]]
  let t = 0; for (const it of items) t += it[0];
  let r = rng() * t;
  for (const it of items) { r -= it[0]; if (r <= 0) return it[1]; }
  return items[items.length - 1][1];
}
function givenName(rng, female, age, taken) {
  const by = CURRENT_YEAR - age;
  const pool = female ? (by <= 1960 ? F_OLD : by <= 1995 ? F_MID : F_YNG) : (by <= 1960 ? M_OLD : by <= 1995 ? M_MID : M_YNG);
  for (let k = 0; k < 8; k++) { const n = pick(rng, pool); if (!taken.has(n)) return n; }
  return pick(rng, pool);
}

// household archetypes -> member specs {age, female, rel}
const ARCHETYPES = [
  { w: 17, size: 1, make: (r) => [{ age: ri(r, 62, 92), female: r() < 0.72, rel: 'one' }] },
  { w: 13, size: 2, make: (r) => { const a = ri(r, 60, 86); return [{ age: a, female: false, rel: 'husband' }, { age: Math.max(55, a + ri(r, -6, 4)), female: true, rel: 'wife' }]; } },
  { w: 8, size: 2, make: (r) => { const a = ri(r, 40, 62); return [{ age: a, female: false, rel: 'husband' }, { age: a + ri(r, -5, 3), female: true, rel: 'wife' }]; } },
  { w: 5, size: 2, make: (r) => { const a = ri(r, 21, 36); return [{ age: a, female: false, rel: 'husband' }, { age: a + ri(r, -4, 2), female: true, rel: 'wife' }]; } },
  { w: 5, size: 1, make: (r) => [{ age: ri(r, 24, 61), female: r() < 0.45, rel: 'one' }] },
  { w: 7, size: 2, make: (r) => { const p = ri(r, 56, 86), f = r() < 0.7; return [{ age: p, female: f, rel: f ? 'mother' : 'father' }, { age: p - ri(r, 24, 36), female: r() < 0.5, rel: 'adult_child' }]; } },
  { w: 5, size: 0, kids: true, make: (r) => { const a = ri(r, 44, 62); const n = wpick(r, [[65, 1], [35, 2]]); const out = [{ age: a, female: false, rel: 'husband' }, { age: a + ri(r, -5, 2), female: true, rel: 'wife' }]; for (let i = 0; i < n; i++) out.push({ age: Math.max(18, Math.min(31, a - ri(r, 22, 30))), female: r() < 0.5, rel: 'adult_child' }); return out; } },
  { w: 24, size: 0, kids: true, make: (r) => family(r, false) },
  { w: 12, size: 0, kids: true, make: (r) => family(r, true) },
  { w: 4, size: 0, kids: true, make: (r) => single(r) },
];
function kidsFor(r, parentAge, n) {
  const out = []; let age = Math.min(17, parentAge - ri(r, 20, 28));
  for (let i = 0; i < n; i++) {
    if (age < 0) break;
    out.push({ age, female: r() < 0.49, rel: 'child' });
    age -= ri(r, 1, 6);
  }
  return out;
}
function family(r, threeGen) {
  const m = ri(r, 25, 48), f = Math.max(21, m + ri(r, -3, 7));
  const kids = kidsFor(r, m, wpick(r, [[40, 1], [40, 2], [20, 3]]));
  const mem = [{ age: f, female: false, rel: 'husband' }, { age: m, female: true, rel: 'wife' }, ...kids];
  if (threeGen) { mem.push({ age: m + ri(r, 22, 32), female: r() < 0.75, rel: 'grandparent' }); if (r() < 0.35) mem.push({ age: f + ri(r, 22, 32), female: false, rel: 'grandparent' }); }
  return mem;
}
function single(r) {
  const m = ri(r, 25, 46);
  return [{ age: m, female: true, rel: 'mother' }, ...kidsFor(r, m, wpick(r, [[70, 1], [30, 2]]))];
}

const CITY_JOBS_M = ['Водитель', 'Строитель', 'Электрик', 'Слесарь', 'Охранник', 'Программист', 'Сварщик', 'Механик', 'Таксист', 'Инженер', 'Менеджер', 'Грузчик', 'Повар', 'Монтажник'];
const CITY_JOBS_F = ['Медсестра', 'Бухгалтер', 'Продавец в городе', 'Повар', 'Парикмахер', 'Менеджер', 'Учительница в городе', 'Администратор', 'Швея', 'Врач', 'Кассир', 'Уборщица'];
const LOCAL_JOBS_M = ['Фермер', 'Тракторист', 'Пасечник', 'Лесник', 'Разнорабочий', 'Агроном', 'Скотник'];
const LOCAL_JOBS_F = ['Фермер', 'Доярка', 'Огородница', 'Работница фермы', 'Агроном'];

export class Population {
  constructor() { this.residents = []; this.households = []; this.seed = 0; }
  get size() { return this.residents.length; }
  byHouse(houseId) { const h = this.households.find((q) => q.houseId === houseId); return h ? h.members.map((i) => this.residents[i]) : []; }
  stats() {
    const b = { '0-6': 0, '7-17': 0, '18-29': 0, '30-44': 0, '45-59': 0, '60-74': 0, '75+': 0 };
    let f = 0, sum = 0;
    for (const r of this.residents) {
      const a = r.age; sum += a; if (r.female) f++;
      b[a <= 6 ? '0-6' : a <= 17 ? '7-17' : a <= 29 ? '18-29' : a <= 44 ? '30-44' : a <= 59 ? '45-59' : a <= 74 ? '60-74' : '75+']++;
    }
    return { total: this.residents.length, women: f, men: this.residents.length - f, meanAge: sum / this.residents.length, ageBands: b, households: this.households.length };
  }
}

/**
 * @param houses  eligible houses [{id, x, z, address}]            (order irrelevant)
 * @param opts    {seed, size, centre:{x,z}, shops:[{x,z}], school:{x,z}, post:{x,z}}
 */
export function generatePopulation(houses, opts = {}) {
  const seed = opts.seed ?? 4207;
  const size = opts.size ?? POP_SIZE;
  const rng = mulberry32(seed);
  const pop = new Population(); pop.seed = seed;
  const centre = opts.centre || { x: 0, z: 0 };

  // ---- which houses are occupied: nearer to the centre -> more likely lived in; the rest stay empty
  const order = houses.map((h) => ({ h, k: rng() * 0.5 + Math.min(1.2, Math.hypot(h.x - centre.x, h.z - centre.z) / 650) })).sort((a, b) => a.k - b.k).map((q) => q.h);

  // ---- optional pinned houses (hero plots): first in the order, always a three-generation family
  const pins = [].concat(opts.pinHouses ?? (opts.pinHouse !== undefined && opts.pinHouse !== null ? [opts.pinHouse] : []));
  const pinSpecs = [];
  for (const pid of pins) { const pi = order.findIndex((h) => h.id === pid); if (pi >= 0) { order.splice(pinSpecs.length, 0, order.splice(pi, 1)[0]); pinSpecs.push(family(rng, true)); } }

  // ---- household specs until the head-count reaches `size`
  const specs = [...pinSpecs]; let total = pinSpecs.reduce((a, m) => a + m.length, 0), guard = 0;
  while (total < size && guard++ < 2000) {
    const left = size - total;
    const pool = ARCHETYPES.filter((a) => (a.size ? a.size <= left : true));
    const arch = wpick(rng, pool.map((a) => [a.w, a]));
    let mem = arch.make(rng).filter((m) => m.age >= 0 && m.age <= 95);
    if (mem.length > left) mem = mem.slice(0, left);
    if (!mem.length) continue;
    specs.push(mem); total += mem.length;
  }
  if (specs.length > order.length) specs.length = order.length;

  // ---- materialise residents
  let id = 0;
  specs.forEach((mem, hi) => {
    const house = order[hi];
    const base = pick(rng, SURNAMES);
    const hh = { id: hi, houseId: house.id, surname: base[0], members: [] };
    const taken = new Set();
    // keep the head first: oldest working-age person
    mem.sort((a, b) => (b.age >= 18 ? 1 : 0) - (a.age >= 18 ? 1 : 0) || (a.female ? 1 : 0) - (b.female ? 1 : 0));
    for (const m of mem) {
      const given = givenName(rng, m.female, m.age, taken); taken.add(given);
      const r = {
        id: id++, first: given, last: surnameFor(base, m.female), female: m.female, gender: m.female ? 'f' : 'm', age: m.age, birthYear: CURRENT_YEAR - m.age,
        household: hi, houseId: house.id, rel: m.rel, occupation: '', job: '', address: house.address || '',
        seed: Math.floor(rng() * 1e9), sociable: rng(), hobby: '',
      };
      hh.members.push(r.id); pop.residents.push(r);
    }
    pop.households.push(hh);
  });

  assignOccupations(pop, rng, { ...opts, houses });
  return pop;
}

function nearestHouseHolds(pop, houses, pos) { // households sorted by distance of their house to pos
  const hp = new Map(houses.map((h) => [h.id, h]));
  return pop.households.map((h) => { const p = hp.get(h.houseId); return { h, d: Math.hypot(p.x - pos.x, p.z - pos.z) }; }).sort((a, b) => a.d - b.d).map((q) => q.h);
}

function assignOccupations(pop, rng, opts) {
  const R = pop.residents;
  const taken = new Set();
  const take = (r, job, occ) => { r.job = job; r.occupation = occ; taken.add(r.id); };
  const adults = (h, lo, hi, female) => h.members.map((i) => R[i]).filter((r) => !taken.has(r.id) && r.age >= lo && r.age <= hi && (female === undefined || r.female === female));
  // singular roles near their buildings (coordinates supplied by the caller)
  const houses = opts.houses || [];
  const roles = [
    ...(opts.shops || []).map((pos) => ({ pos, n: 1, lo: 24, hi: 58, f: true, job: 'shop', occ: 'Продавщица в магазине' })),
    { pos: opts.school, n: 3, lo: 26, hi: 58, f: undefined, job: 'teacher', occ: null },
    { pos: opts.post, n: 1, lo: 24, hi: 60, f: undefined, job: 'post', occ: 'Почтальон' },
  ];
  for (const role of roles) {
    if (!role.pos || !houses.length) continue;
    let left = role.n;
    for (const h of nearestHouseHolds(pop, houses, role.pos)) {
      if (left <= 0) break;
      const c = adults(h, role.lo, role.hi, role.f)[0]; if (!c) continue;
      take(c, role.job, role.occ || (c.female ? 'Учительница' : 'Учитель')); left--;
    }
  }
  for (const r of R) {
    if (taken.has(r.id)) continue;
    const a = r.age, f = r.female;
    if (a < 3) { r.job = 'baby'; r.occupation = f ? 'Малышка' : 'Малыш'; }
    else if (a < 7) { r.job = 'kid'; r.occupation = f ? 'Дошкольница' : 'Дошкольник'; }
    else if (a < 18) { r.job = 'school'; r.occupation = f ? 'Школьница' : 'Школьник'; }
    else if (a < 23 && rng() < 0.55) { r.job = 'student'; r.occupation = f ? 'Студентка (Киев)' : 'Студент (Киев)'; }
    else if (a >= (f ? 60 : 62)) { r.job = 'retired'; r.occupation = f ? 'Пенсионерка' : 'Пенсионер'; }
    else {
      const x = rng();
      if (x < 0.34) { r.job = 'commute'; r.occupation = pick(rng, f ? CITY_JOBS_F : CITY_JOBS_M).replace(' в городе', '') + ' (Киев)'; }
      else if (x < 0.72) { r.job = 'local'; r.occupation = pick(rng, f ? LOCAL_JOBS_F : LOCAL_JOBS_M); }
      else { r.job = 'homemaker'; r.occupation = f ? 'Домохозяйка' : 'Подрабатывает по хозяйству'; }
    }
    r.hobby = r.female ? pick(rng, ['', 'chat', 'chat', 'walk']) : pick(rng, ['', 'fishing', 'fishing', 'chat', 'walk']);
    if (r.age >= 60) r.hobby = r.hobby || 'chat';
  }
}

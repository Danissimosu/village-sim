// Gameplay layer: money, inventory, daily clock bar, talking to villagers (Russian lines), a few small quests, shop, save/load.
import * as THREE from 'three';
import { distPointSeg } from '../util.js';
import { createFarm, CROPS, CROP_KEYS } from './farm.js';

const SAVE_KEY = 'lyubimivka-save-v1';
const ITEMS = { eggs: ['Яйца', '🥚'], milk: ['Молоко', '🥛'], bread: ['Хлеб', '🍞'], apples: ['Яблоки', '🍎'], fish: ['Рыба', '🐟'],
  potato: ['Картофель', '🥔'], carrot: ['Морковь', '🥕'], tomato: ['Помидоры', '🍅'],
  seed_potato: ['Семена картофеля', '🌱'], seed_carrot: ['Семена моркови', '🌱'], seed_tomato: ['Семена томатов', '🌱'] };
const BUY = { bread: 25, milk: 45, seed_potato: 15, seed_carrot: 10, seed_tomato: 20 }, SELL = { eggs: 8, milk: 35, apples: 5, fish: 30, potato: 6, carrot: 4, tomato: 10 };
const SHOP_OPEN = 8, SHOP_CLOSE = 20;
const plural = (n, a, b, c) => { const m = n % 100, d = n % 10; return m >= 11 && m <= 14 ? c : d === 1 ? a : d >= 2 && d <= 4 ? b : c; };
const fresh = () => ({ v: 1, money: 40, inv: { eggs: 0, milk: 0, bread: 0, apples: 0, fish: 0, potato: 0, carrot: 0, tomato: 0, seed_potato: 0, seed_carrot: 0, seed_tomato: 0 }, q: { bread: 0, eggs: 0, milk: 0, fish: 0, pets: 0, petsN: 0, borsch: 0, pie: 0, farm: 0, harvests: 0 }, talked: {}, gift: {}, farm: {}, treeDay: {}, day: 0, hour: 10.5, pos: null });

export function createGame(ctx) {
  const { world, nav, sim, fauna, player, layout, camera, hud, getClock, setClock, getWeather, scene } = ctx;
  let S = fresh(), dirty = false;
  const root = document.getElementById('hud');
  const $ = (id) => document.getElementById(id);

  // ---------- load
  let loaded = false;
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { const o = JSON.parse(raw); if (o && o.v === 1) { S = { ...fresh(), ...o, inv: { ...fresh().inv, ...o.inv }, q: { ...fresh().q, ...o.q }, farm: o.farm || {}, gift: o.gift || {} }; loaded = true; } } } catch (e) { /* private mode etc. */ }
  const save = () => { try { const c = getClock(); S.hour = c.hour; S.day = c.day; S.pos = { x: player.pos.x, z: player.pos.z, yaw: player.yaw }; localStorage.setItem(SAVE_KEY, JSON.stringify(S)); dirty = false; return true; } catch (e) { return false; } };

  const farm = createFarm({ scene, world, layout });
  farm.sync(S.farm);
  let lastAbs = null;

  // ---------- quest givers: deterministic villagers who live close to the village centre
  const centre = nav.centreXZ || { x: 0, z: 0 };
  const near = sim.actors.filter((a) => a.house && a.house.door).map((a) => ({ a, d: Math.hypot(a.house.x - centre.x, a.house.z - centre.z) })).sort((p, q) => p.d - q.d).map((p) => p.a);
  const usedHH = new Set();
  const pickG = (f) => { const a = near.find((x) => !usedHH.has(x.res.household) && f(x)); if (a) usedHH.add(a.res.household); return a; };
  const giver = {
    bread: pickG((a) => a.res.job === 'retired' && a.res.female),
    eggs: pickG((a) => a.res.female && a.res.age >= 35 && a.res.job !== 'retired' && a.res.job !== 'shop' && a.res.job !== 'teacher'),
    milk: pickG((a) => !a.res.female && a.res.age >= 50),
    fish: pickG((a) => !a.res.female && a.res.age >= 30 && a.res.age < 75 && a.res.job !== 'shop' && a.res.job !== 'teacher'),
    borsch: pickG((a) => a.res.female && a.res.age >= 40 && a.res.job !== 'shop' && a.res.job !== 'teacher'),
    pie: pickG((a) => a.res.female && a.res.age >= 25 && a.res.age < 70 && a.res.job !== 'shop' && a.res.job !== 'teacher'),
  };
  const fullName = (a) => `${a.res.first} ${a.res.last}`;
  const shopDoor = (from) => { let best = null, bd = 1e9; for (const s of nav.shops) { const d = Math.hypot(s.door.x - from.x, s.door.z - from.z); if (d < bd) { bd = d; best = s; } } return best; };

  // ---------- UI
  const bar = document.createElement('div'); bar.id = 'gbar';
  bar.innerHTML = '<span id="g-money">💰 40 ₴</span><span id="g-inv"></span>';
  root.appendChild(bar);
  const btn = document.createElement('button'); btn.className = 'btn'; btn.id = 'btn-bag'; btn.textContent = '🎒 Рюкзак и дела';
  $('btns').insertBefore(btn, $('btn-hide'));
  const act = document.createElement('button'); act.id = 'act-btn'; act.style.display = 'none'; root.appendChild(act);
  const toastEl = document.createElement('div'); toastEl.id = 'toast'; root.appendChild(toastEl);
  const dlg = document.createElement('div'); dlg.id = 'dlg'; dlg.style.display = 'none';
  dlg.innerHTML = '<button class="x" aria-label="Закрыть">×</button><div class="nm" id="dlg-nm"></div><div class="sub" id="dlg-sub"></div><div class="tx" id="dlg-tx"></div><div class="ch" id="dlg-ch"></div>';
  root.appendChild(dlg);
  const panel = document.createElement('div'); panel.id = 'gpanel'; panel.style.display = 'none';
  panel.innerHTML = '<button class="x" aria-label="Закрыть">×</button><div class="tabs"><button data-t="inv" class="on">Рюкзак</button><button data-t="q">Дела</button><button data-t="sys">Игра</button></div><div id="gp-body"></div>';
  root.appendChild(panel);
  const marks = [0, 1].map(() => { const m = document.createElement('div'); m.className = 'qmark'; m.style.display = 'none'; root.appendChild(m); return m; });
  for (const el of [bar, btn, act, dlg, panel]) ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'mousedown', 'click'].forEach((ev) => el.addEventListener(ev, (e) => e.stopPropagation()));

  let toastT = 0;
  const toast = (t) => { toastEl.textContent = t; toastEl.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.style.opacity = 0; }, 2600); };
  const refreshBar = () => {
    $('g-money').textContent = `💰 ${S.money} ₴`;
    $('g-inv').textContent = Object.keys(ITEMS).filter((k) => S.inv[k] > 0).map((k) => `${ITEMS[k][1]}${S.inv[k]}`).join(' ');
  };
  const addItem = (k, n) => { S.inv[k] = Math.max(0, (S.inv[k] || 0) + n); dirty = true; refreshBar(); };
  const addMoney = (n) => { S.money += n; dirty = true; refreshBar(); };

  // ---------- quests
  const questList = () => {
    const out = [];
    const g = giver;
    const where = (a) => (a ? `${fullName(a)}${a.res.address ? ' (' + a.res.address + ')' : ''}` : '—');
    out.push({ title: 'Хлеб для соседки', st: S.q.bread, text: ['Поговорите с ' + where(g.bread), S.inv.bread > 0 ? 'Хлеб куплен — отнесите ' + where(g.bread) : 'Купите хлеб в магазине (25 ₴, с 8 до 20) и отнесите ' + where(g.bread), 'Выполнено ✔'] });
    out.push({ title: 'Яйца к приезду гостей', st: S.q.eggs, text: ['Поговорите с ' + where(g.eggs), `Соберите 4 яйца у кур во дворах (${Math.min(4, S.inv.eggs)}/4) и отнесите ${where(g.eggs)}`, 'Выполнено ✔'] });
    out.push({ title: 'Парное молоко', st: S.q.milk, text: ['Поговорите с ' + where(g.milk), 'Подоите корову во дворе и отнесите банку молока ' + where(g.milk), 'Выполнено ✔'] });
    out.push({ title: 'Уха на ужин', st: S.q.fish, text: ['Поговорите с ' + where(g.fish), `Наловите 3 рыбы на пруду — встаньте у берега и жмите «Закинуть удочку» (${Math.min(3, S.inv.fish)}/3), отнесите ${where(g.fish)}`, 'Выполнено ✔'] });
    out.push({ title: 'Борщ на обед', st: S.q.borsch, text: ['Поговорите с ' + where(g.borsch), `Вырастите на своей грядке и принесите ${where(g.borsch)}: 🥔2 🥕2 🍅1 (у вас ${Math.min(2, S.inv.potato)}/2, ${Math.min(2, S.inv.carrot)}/2, ${Math.min(1, S.inv.tomato)}/1)`, 'Выполнено ✔'] });
    out.push({ title: 'Яблочный пирог', st: S.q.pie, text: ['Поговорите с ' + where(g.pie), `Соберите 6 яблок с яблонь во дворах (${Math.min(6, S.inv.apples)}/6) и 2 яйца (${Math.min(2, S.inv.eggs)}/2), отнесите ${where(g.pie)}`, 'Выполнено ✔'] });
    out.push({ title: 'Свой огород', st: S.q.farm >= 2 ? 2 : 1, text: ['', 'Купите семена в магазине (🌱 картофель, морковь, томаты) и посадите на грядках участка 35Б или 84 — они подписаны «🌱 Посадить». Дождь ускоряет рост, полив тоже.', 'Выполнено ✔ — первый урожай собран'] });
    out.push({ title: 'Друг животных', st: S.q.pets >= 1 ? 2 : 1, text: ['', `Погладьте 3 собак и 3 кошек (${Math.min(3, S.q.petsD || 0)} соб., ${Math.min(3, S.q.petsC || 0)} кош.)`, 'Выполнено ✔'] });
    return out;
  };
  const renderPanel = (tab) => {
    const body = $('gp-body'); panel.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab)); panel.dataset.tab = tab;
    if (tab === 'inv') {
      const rows = Object.keys(ITEMS).filter((k) => S.inv[k] > 0 || !k.startsWith('seed_')).map((k) => `<div class="r"><span>${ITEMS[k][1]} ${ITEMS[k][0]}</span><b>${S.inv[k]}</b></div>`).join('');
      body.innerHTML = `<div class="r"><span>💰 Деньги</span><b>${S.money} ₴</b></div>${rows}<div class="note">Яйца — у кур, молоко — у коров, яблоки — с яблонь во дворах, овощи — с грядок на участках 35Б и 84 (семена — в магазине). Продавать можно в магазине; цены на продукты меняются изо дня в день.</div>`;
    } else if (tab === 'q') {
      body.innerHTML = questList().map((q) => `<div class="q ${q.st >= 2 ? 'done' : ''}"><b>${q.title}</b><div>${q.text[Math.min(q.st, 2)] || q.text[1]}</div></div>`).join('');
    } else {
      body.innerHTML = '<button class="btn" id="gs-save">💾 Сохранить игру</button><button class="btn" id="gs-new">🗑 Новая игра</button><div class="note">Игра сохраняется автоматически каждые 15 секунд (в браузере этого устройства).</div>';
      $('gs-save').onclick = () => toast(save() ? 'Сохранено' : 'Не удалось сохранить');
      $('gs-new').onclick = () => { if (confirm('Начать заново? Деньги, вещи и задания будут сброшены.')) { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } S = fresh(); dirty = false; farm.sync(S.farm); refreshBar(); toast('Новая игра'); renderPanel('inv'); } };
    }
  };
  let panelOpen = false;
  const openPanel = (tab = 'inv') => { panelOpen = true; panel.style.display = 'block'; renderPanel(tab); };
  const closePanel = () => { panelOpen = false; panel.style.display = 'none'; };
  btn.onclick = () => (panelOpen ? closePanel() : openPanel('inv'));
  panel.querySelector('.x').onclick = closePanel;
  panel.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => renderPanel(b.dataset.t); });

  // ---------- dialogue
  let dlgOpen = false, dlgFor = null;
  const say = (title, sub, text, choices) => {
    dlgOpen = true; dlg.style.display = 'block';
    $('dlg-nm').textContent = title; $('dlg-sub').textContent = sub || ''; $('dlg-tx').textContent = text;
    const ch = $('dlg-ch'); ch.innerHTML = '';
    for (const c of choices.concat([{ label: 'Закрыть' }])) { const b = document.createElement('button'); b.textContent = c.label; if (c.off) b.disabled = true; b.onclick = () => { if (c.fn) c.fn(); else closeDlg(); }; ch.appendChild(b); }
  };
  const closeDlg = () => { dlgOpen = false; dlg.style.display = 'none'; dlgFor = null; };
  dlg.querySelector('.x').onclick = closeDlg;

  const hourNow = () => getClock().hour;
  const part = () => { const h = hourNow(); return h < 5 ? 'night' : h < 11 ? 'morning' : h < 17 ? 'day' : h < 22 ? 'evening' : 'night'; };
  const hello = { morning: ['Доброе утро!', 'С добрым утром!', 'Утро доброе, сосед!'], day: ['Добрый день!', 'Здравствуйте!', 'Добрый день, сосед!'], evening: ['Добрый вечер!', 'Вечер добрый!'], night: ['Не спится?', 'Поздновато гуляете…'] };
  const weatherLine = { rain: ['Дождь льёт — для огорода это хорошо.', 'Мокро сегодня, не гуляется.'], fog: ['Туман какой — соседа не видно.', 'Туман с пруда пошёл.'], clear: ['Погода сегодня хорошая.', 'Солнышко — красота.'] };
  const byJob = {
    retired: ['Огород сам себя не польёт. Пенсия небольшая, а хозяйство кормит.', 'Раньше в селе людей было больше — и школа полная, и клуб работал.', 'Яблони в этом году хорошо уродили, заходите.'],
    commute: ['Каждое утро в Киев — пока доеду, полдня прошло.', 'Хорошо, что трасса рядом, а то автобус не дождёшься.'],
    local: ['Работы в селе хватает, только руки подставляй.', 'То забор подправить, то крышу — хозяйство.'],
    homemaker: ['Дела по дому — вечные. Куры, огород, внуки…', 'Сейчас закрутки делаю, зима придёт — спасибо скажем.'],
    school: ['В школе опять контрольная, не хочу!', 'Мы после уроков на пруд ходим.'],
    kid: ['А у нас в садике новая горка!', 'Я видел большую собаку!'],
    baby: ['Агу!'],
    student: ['Приехал на выходные из Киева, у мамы борщ.', 'Сессия скоро, а я тут по селу гуляю.'],
    shop: ['Хлеб утром привозят, пока свежий — берите.', 'Заходите, у нас и хлеб, и молоко, и конфеты.'],
    teacher: ['Дети у нас хорошие, только шумные.', 'Школа маленькая, но своя.'],
    post: ['Пенсию разношу — каждому своё время.', 'Писем почти нет, всё в телефонах.'],
  };
  const pickR = (a) => a[Math.floor(Math.random() * a.length)];
  const smallTalk = (a) => {
    const r = a.res, w = (getWeather && getWeather()) || 'clear';
    const lines = [pickR(hello[part()])];
    lines.push(Math.random() < 0.5 ? pickR(weatherLine[w] || weatherLine.clear) : pickR(byJob[r.job] || byJob.local));
    if (part() === 'night') lines.push('Идите-ка домой, ночью по селу собаки бегают.');
    return lines.join(' ');
  };

  // ---------- conversations (topics menu; a villager you have talked to a lot becomes a friend and may give a small gift)
  const STREET = (a) => ((a.res.address || '').replace(/[\s,]*\d.*$/, '') || '').trim();
  const gossip = (a) => {
    const st = STREET(a), pool = sim.actors.filter((x) => x !== a && x.res.household !== a.res.household && (!st || STREET(x) === st) && x.res.age >= 16);
    const o = pool.length ? pickR(pool) : pickR(sim.actors);
    const oname = `${o.res.first} ${o.res.last}`;
    const f = o.res.female, ad = o.res.address ? ` (${o.res.address})` : '';
    return pickR([
      `Говорят, ${oname}${ad}: помидоры в этом году — хоть на выставку.`,
      `${oname}${ad} собирается перекрывать крышу — шифер уже заказан.`,
      `${oname}${ad}: куры несутся так, что яйца девать некуда.`,
      `Во дворе у соседей (${oname}) новая собака — лает на всю улицу.`,
      `${oname} вчера ${f ? 'ходила' : 'ходил'} на пруд с удочкой — и ${f ? 'принесла' : 'принёс'} целое ведро карасей!`,
      `${oname}${ad}: забор красят в синий цвет — издалека видно.`,
      `К соседям (${oname}) на выходные приехали гости из Киева.`,
    ]);
  };
  const aboutSelf = (a) => {
    const r = a.res, kin = sim.actors.filter((x) => x.res.household === r.household).length;
    const age = `${r.age} ${plural(r.age, 'год', 'года', 'лет')}`;
    const fam = kin > 1 ? `Семья у нас — ${kin} ${plural(kin, 'человек', 'человека', 'человек')} в доме.` : 'Живу один.';
    const job = { retired: 'На пенсии, хозяйство веду.', commute: 'Езжу на работу в Киев.', local: 'Работаю тут, в селе.', homemaker: 'Дом, огород и дети — вот и вся моя работа.', school: 'Учусь в школе.', kid: 'Я ещё маленький.', baby: 'Агу!', student: 'Учусь в университете.', shop: 'Работаю в магазине.', teacher: 'Преподаю в школе.', post: 'Почту разношу.' }[r.job] || '';
    return `Меня зовут ${r.first}, мне ${age}. ${job} ${fam}`.replace(/\s+/g, ' ');
  };
  const villageLore = [
    'Любимовка — село небольшое, но живое: два пруда, сады, сразу за околицей лес. Раньше тут был колхоз, а теперь у каждого своё хозяйство.',
    'Говорят, пруды ещё деды копали — в них и рыбу водили, и скот поили. Карась там до сих пор хороший.',
    'Дорога на Киев рядом — это и хорошо, и плохо: молодёжь уезжает, зато дачники приезжают.',
    'Весной у нас всё в цвету — вишни, яблони. Посмотрите, как красиво на Польовой.',
    'Колодцы у нас ещё остались, вода холодная, вкусная. Хотя многие давно на водопроводе.',
  ];
  const gardenTips = [
    'Картошку лучше сажать, когда земля прогреется. А вы свою грядку на 35Б или на Польовой, 84 не забыли? Семена в магазине.',
    'Дождь для огорода — лучшая поливалка. Растёт вдвое быстрее. Но и ведром полить не лишнее.',
    'Морковь — самая быстрая: пока в сезон, можно успеть и урожай собрать, и продать. А томаты дольше, но дороже.',
    'Цены в магазине скачут: в один день яйца берут дороже, в другой — яблоки. Следите, когда продавать.',
    'Яблони можно трясти раз в день — потом новые яблоки только завтра.',
  ];
  const advice = (r) => (r.job === 'retired' || r.job === 'homemaker' ? pickR(gardenTips) : pickR(gardenTips.concat(['Совет простой: по утрам клёв лучше, а вечером тише на улицах.'])));
  const chat = (a, name, sub, pre = '') => {
    const r = a.res, c = S.talked[r.id] || 1, friend = c >= 5;
    const open = hourNow() >= SHOP_OPEN && hourNow() < SHOP_CLOSE;
    const intro = pre + (friend ? pickR(['Ну здравствуй, друг! ', 'О, свой человек пришёл! ', 'Давно не виделись! ']) : '') + smallTalk(a);
    const back = () => chat(a, name, sub);
    const ch = [
      { label: 'Как дела в селе?', fn: () => say(name, sub, pickR(['Живём потихоньку. Главное — чтобы было тихо.', 'По-разному. Но село у нас красивое, пруды, сады…', open ? 'Магазин открыт, если что нужно — сходите.' : 'Магазин уже закрыт, до восьми утра ждать.']), [{ label: '← Назад', fn: back }]) },
      { label: 'Расскажите о себе', fn: () => say(name, sub, aboutSelf(a), [{ label: '← Назад', fn: back }]) },
      { label: 'Что слышно?', fn: () => say(name, sub, gossip(a), [{ label: '← Назад', fn: back }]) },
      { label: 'Про село', fn: () => say(name, sub, pickR(villageLore), [{ label: '← Назад', fn: back }]) },
      { label: 'Совет по хозяйству', fn: () => say(name, sub, advice(r), [{ label: '← Назад', fn: back }]) },
    ];
    if (friend && !S.gift[r.id] && r.age >= 14) ch.push({ label: '🎁 Принять угощение', fn: () => { S.gift[r.id] = 1; const g = pickR([['apples', 3, 'яблок'], ['eggs', 2, 'яйца'], ['bread', 1, 'буханку хлеба'], ['milk', 1, 'банку молока']]); addItem(g[0], g[1]); toast(`${r.first} дарит: ${g[1]} ${g[2]}`); say(name, sub, 'Возьми гостинец, не чужие же люди!', []); } });
    say(name, sub, intro, ch);
  };

  const talkTo = (a) => {
    dlgFor = a; const r = a.res, name = fullName(a), sub = `${r.occupation}${r.address ? ' · ' + r.address : ''}`;
    S.talked[r.id] = (S.talked[r.id] || 0) + 1; dirty = true;
    if (a === giver.bread) return questBread(a, name, sub);
    if (a === giver.eggs) return questEggs(a, name, sub);
    if (a === giver.milk) return questMilk(a, name, sub);
    if (a === giver.fish) return questFish(a, name, sub);
    if (a === giver.borsch) return questGeneric('borsch', a, name, sub, QDEF.borsch);
    if (a === giver.pie) return questGeneric('pie', a, name, sub, QDEF.pie);
    chat(a, name, sub);
  };
  const questBread = (a, name, sub) => {
    if (S.q.bread === 0) say(name, sub, 'Ой, внучек, ноги совсем не ходят… Сходишь в магазин за хлебом? Вот тебе тридцать гривен. Булка стоит двадцать пять — сдачу оставь себе.', [{ label: 'Конечно, схожу', fn: () => { S.q.bread = 1; addMoney(30); dirty = true; toast('Задание: купить хлеб'); say(name, sub, 'Вот спасибо! Магазин работает с восьми до восьми.', []); } }]);
    else if (S.q.bread === 1) {
      if (S.inv.bread > 0) say(name, sub, 'Хлебушек! Тёплый ещё. Спасибо, родной, вот тебе за труды.', [{ label: 'Отдать хлеб', fn: () => { addItem('bread', -1); addMoney(45); addItem('apples', 3); S.q.bread = 2; toast('Задание выполнено: +45 ₴, +3 яблока'); closeDlg(); } }]);
      else say(name, sub, 'Ну что, купил хлеб? Магазин ищи по вывеске, он недалеко.', []);
    } else chat(a, name, sub, 'Спасибо тебе ещё раз за хлеб. ');
  };
  const questEggs = (a, name, sub) => {
    if (S.q.eggs === 0) say(name, sub, 'К вечеру гости приедут, а яиц на пироги не хватает. Принесёшь четыре? У кого-нибудь из соседей куры во дворе ходят. Заплачу шестьдесят.', [{ label: 'Принесу', fn: () => { S.q.eggs = 1; dirty = true; toast('Задание: собрать 4 яйца'); closeDlg(); } }]);
    else if (S.q.eggs === 1) {
      if (S.inv.eggs >= 4) say(name, sub, 'Свежие! Вот молодец, держи шестьдесят гривен.', [{ label: 'Отдать 4 яйца', fn: () => { addItem('eggs', -4); addMoney(60); S.q.eggs = 2; toast('Задание выполнено: +60 ₴'); closeDlg(); } }]);
      else say(name, sub, `Пока яиц ${S.inv.eggs} из 4. Куры обычно возле дворов за домами.`, []);
    } else chat(a, name, sub);
  };
  const questMilk = (a, name, sub) => {
    if (S.q.milk === 0) say(name, sub, 'Врач говорит — пить молоко. Только не магазинное, а парное. Подоишь у соседей корову и принесёшь банку? Семьдесят гривен дам.', [{ label: 'Попробую', fn: () => { S.q.milk = 1; dirty = true; toast('Задание: принести парное молоко'); closeDlg(); } }]);
    else if (S.q.milk === 1) {
      if (S.inv.milk > 0) say(name, sub, 'Парное! Спасибо, что не забыл.', [{ label: 'Отдать молоко', fn: () => { addItem('milk', -1); addMoney(70); S.q.milk = 2; toast('Задание выполнено: +70 ₴'); closeDlg(); } }]);
      else say(name, sub, 'Корова — у кого-то во дворе за домом. Подходи к ней и жми на «Подоить».', []);
    } else chat(a, name, sub);
  };

  const questFish = (a, name, sub) => {
    if (S.q.fish === 0) say(name, sub, 'Жена уху просит, а рыбалка у меня не ладится — спина. Сходишь на пруд? Удочку я тебе одолжу. Три рыбины — и заплачу сто гривен.', [{ label: 'Согласиться', fn: () => { S.q.fish = 1; dirty = true; toast('Новое задание: Уха на ужин'); closeDlg(); } }]);
    else if (S.q.fish === 1) {
      if (S.inv.fish >= 3) say(name, sub, 'Вот это улов! Карась, как на подбор. Держи сто гривен.', [{ label: 'Отдать 3 рыбы', fn: () => { addItem('fish', -3); addMoney(100); S.q.fish = 2; toast('Задание выполнено: +100 ₴'); closeDlg(); } }]);
      else say(name, sub, `Пока рыб ${S.inv.fish} из 3. Лучше всего клюёт утром и вечером, у берега.`, []);
    } else chat(a, name, sub);
  };

  const needText = (need) => Object.entries(need).map(([k, n]) => `${ITEMS[k][1]}${n}`).join(' ');
  const QDEF = {
    borsch: { title: 'Борщ на обед', intro: 'Внук приехал, а у меня на борщ ни картошки, ни моркови — спина болит, на огород не выйду. Выручишь? Нужно две картошки, две морковки и помидор. Заплачу сто двадцать.', accept: 'Выручу', need: { potato: 2, carrot: 2, tomato: 1 }, reward: 120, ok: 'Ой, какие красивые! Теперь борщ будет на славу. Держи сто двадцать гривен.', notYet: () => `Пока у тебя 🥔${Math.min(2, S.inv.potato)}/2 🥕${Math.min(2, S.inv.carrot)}/2 🍅${Math.min(1, S.inv.tomato)}/1. Овощи можно вырастить на грядках — семена в магазине.` },
    pie: { title: 'Яблочный пирог', intro: 'Хочу испечь яблочный пирог на воскресенье, а яблок свежих нет. Принесёшь шесть яблок и пару яиц? Заплачу девяносто и пирожком угощу.', accept: 'Принесу', need: { apples: 6, eggs: 2 }, reward: 90, give: { bread: 1 }, ok: 'Яблочки как на подбор! Вот тебе деньги и свежая буханка в придачу.', notYet: () => `Пока 🍎${Math.min(6, S.inv.apples)}/6 и 🥚${Math.min(2, S.inv.eggs)}/2. Яблони — во дворах, куры — там же.` },
  };
  const questGeneric = (key, a, name, sub, d) => {
    const st = S.q[key];
    if (st === 0) say(name, sub, d.intro, [{ label: d.accept, fn: () => { S.q[key] = 1; dirty = true; toast('Новое задание: ' + d.title); closeDlg(); } }]);
    else if (st === 1) {
      if (Object.keys(d.need).every((k) => S.inv[k] >= d.need[k])) say(name, sub, d.ok, [{ label: 'Отдать ' + needText(d.need), fn: () => { for (const k of Object.keys(d.need)) addItem(k, -d.need[k]); addMoney(d.reward); for (const k of Object.keys(d.give || {})) addItem(k, d.give[k]); S.q[key] = 2; toast(`Задание выполнено: +${d.reward} ₴`); closeDlg(); } }]);
      else say(name, sub, d.notYet(), []);
    } else chat(a, name, sub);
  };

  // ---------- shop
  const priceF = (k) => { const c = getClock(), idx = Object.keys(SELL).indexOf(k); const x = Math.sin((Math.floor(c.day) + 1) * 12.9898 + idx * 78.233) * 43758.5453; return (0.75 + 0.55 * (x - Math.floor(x))) * (Math.floor(c.day) % 7 === 5 ? 1.2 : 1); };   // Saturday = market day (+20 %)
  const sellPrice = (k) => Math.max(1, Math.round(SELL[k] * priceF(k)));
  const openShop = (shop) => {
    const h = hourNow(), open = h >= SHOP_OPEN && h < SHOP_CLOSE;
    if (!open) { say('Магазин', 'Закрыто', 'Магазин работает с 8:00 до 20:00. Приходите утром.', []); return; }
    const ch = [];
    for (const k of Object.keys(BUY)) ch.push({ label: `Купить: ${ITEMS[k][1]} ${ITEMS[k][0]} — ${BUY[k]} ₴`, off: S.money < BUY[k], fn: () => { addMoney(-BUY[k]); addItem(k, 1); toast(`Куплено: ${ITEMS[k][0].toLowerCase()}`); openShop(shop); } });
    let all = 0;
    for (const k of Object.keys(SELL)) if (S.inv[k] > 0) { const pr = sellPrice(k), f = priceF(k), tag = f > 1.1 ? ' ▲' : f < 0.9 ? ' ▼' : ''; all += pr * S.inv[k]; ch.push({ label: `Продать: ${ITEMS[k][1]} ${ITEMS[k][0]} ×${S.inv[k]} — ${pr * S.inv[k]} ₴ (${pr}/шт)${tag}`, fn: () => { addMoney(pr * S.inv[k]); addItem(k, -S.inv[k]); toast('Продано'); openShop(shop); } }); }
    if (Object.keys(SELL).filter((k) => S.inv[k] > 0).length > 1) ch.push({ label: `Продать всё — ${all} ₴`, fn: () => { let t = 0; for (const k of Object.keys(SELL)) if (S.inv[k] > 0) { t += sellPrice(k) * S.inv[k]; addItem(k, -S.inv[k]); } addMoney(t); toast(`Продано на ${t} ₴`); openShop(shop); } });
    say('Магазин «Любимівка»', `У вас ${S.money} ₴ · ${Math.floor(getClock().day) % 7 === 5 ? 'Суббота — базарный день, цены выше! · ' : ''}▲ выше обычной, ▼ ниже`, 'Здравствуйте! Что желаете? Продукты принимаю по сегодняшним ценам.', ch);
  };

  const plantMenu = (plot) => {
    const ch = CROP_KEYS.filter((k) => S.inv[CROPS[k].seed] > 0).map((k) => ({ label: `${CROPS[k].icon} ${CROPS[k].name} — созреет за ~${Math.round(CROPS[k].hours * 2.5)} мин (в дождь быстрее)`, fn: () => { addItem(CROPS[k].seed, -1); S.farm[plot.id] = { c: k, p: 0, w: 0 }; farm.redraw(S.farm, plot); dirty = true; toast(`Посажено: ${CROPS[k].name.toLowerCase()}`); closeDlg(); } }));
    say('Грядка', 'Свободна', ch.length ? 'Что посадим?' : 'Семян нет. Купите в магазине «Любимівка» (8–20 ч): картофель, морковь или томаты.', ch);
  };
  const harvest = (plot) => {
    const st = S.farm[plot.id]; if (!st || farm.frac(st) < 1) return;
    const cr = CROPS[st.c], n = cr.yield[0] + Math.floor(Math.random() * (cr.yield[1] - cr.yield[0] + 1));
    addItem(st.c, n); delete S.farm[plot.id]; farm.redraw(S.farm, plot); S.q.harvests = (S.q.harvests || 0) + 1; dirty = true;
    toast(`+${n} ${cr.icon} ${cr.name.toLowerCase()}`);
    if (S.q.farm < 2) { S.q.farm = 2; addMoney(40); setTimeout(() => toast('Первый урожай! +40 ₴'), 1800); }
  };

  // ---------- interaction scan
  let cand = null, lastScan = 0, lastFarm = 0, tStart = performance.now();
  const apples = layout.trees.filter((t) => t.sp === 'apple');
  const nearestApple = (px, pz) => { let best = null, bd = 2.8; for (const t of apples) { const d = Math.hypot(t.x - px, t.z - pz); if (d < bd) { bd = d; best = t; } } return best; };
  const pondDist = (px, pz) => {
    let best = 1e9;
    for (const p of world.ponds || []) { if (!p.bb || px < p.bb.x0 - 8 || px > p.bb.x1 + 8 || pz < p.bb.z0 - 8 || pz > p.bb.z1 + 8) continue; const q = p.pts; for (let i = 0, j = q.length - 1; i < q.length; j = i++) best = Math.min(best, distPointSeg(px, pz, q[j][0], q[j][1], q[i][0], q[i][1])); }
    return best;
  };
  let fishCool = 0, fishWait = 0;
  const fishNow = () => {
    const t = performance.now(); if (fishCool > t) return toast('Поплавок ещё качается… подождите');
    fishCool = t + 6000; const h = hourNow(), good = h < 9 || h > 17, wet = (getWeather && getWeather()) === 'rain';
    const p = 0.45 + (good ? 0.2 : 0) + (wet ? 0.1 : 0);
    toast('🎣 Закинули удочку…');
    setTimeout(() => { if (Math.random() < p) { addItem('fish', 1); toast('🐟 Поймали рыбу!'); } else toast('Сорвалась…'); }, 1500);
  };
  void fishWait;
  const scan = () => {
    const px = player.pos.x, pz = player.pos.z; let best = null, bw = 1e9;
    const offer = (d, w, label, fn, kind) => { if (d + w < bw) { bw = d + w; best = { label, fn, kind }; } };
    for (const an of fauna.animals) {
      if (an.kind === 'chicken' && hourNow() > 21) continue;
      const d = Math.hypot(an.x - px, an.z - pz); if (d > 2.6) continue;
      if (an.kind === 'chicken') offer(d, 0, '🥚 Взять яйцо', () => { if ((an.cool || 0) > performance.now()) return toast('Эта курочка уже снеслась — подождите'); an.cool = performance.now() + 120000; addItem('eggs', 1); toast('+1 яйцо'); }, 'a');
      else if (an.kind === 'cow') offer(d, 0, '🥛 Подоить корову', () => { if ((an.cool || 0) > performance.now()) return toast('Корову уже подоили — подождите'); an.cool = performance.now() + 240000; addItem('milk', 1); toast('+1 банка молока'); }, 'a');
      else offer(d, 0.3, an.kind === 'dog' ? '🐕 Погладить собаку' : '🐈 Погладить кошку', () => { S.q.petsD = S.q.petsD || 0; S.q.petsC = S.q.petsC || 0; if (an.kind === 'dog') S.q.petsD++; else S.q.petsC++; toast(an.kind === 'dog' ? pickR(['Гав!', 'Пёс виляет хвостом', 'Собака довольна']) : pickR(['Мур-р…', 'Кошка мурлычет', 'Мяу!'])); dirty = true; if (!S.q.pets && S.q.petsD >= 3 && S.q.petsC >= 3) { S.q.pets = 1; addMoney(30); toast('Друг животных: +30 ₴'); } }, 'a');
    }
    const fp = farm.plotAt(px, pz);
    if (fp) {
      const st = S.farm[fp.id], c = getClock(), abs = c.day * 24 + c.hour;
      if (!st) offer(0.5, 0, '🌱 Посадить', () => plantMenu(fp), 'g');
      else if (farm.frac(st) >= 1) offer(0.5, 0, `🧺 Собрать: ${CROPS[st.c].icon} ${CROPS[st.c].name.toLowerCase()}`, () => harvest(fp), 'g');
      else offer(0.5, 0, `💧 Полить ${CROPS[st.c].icon} (${Math.floor(farm.frac(st) * 100)}%)`, () => { if (st.w > abs) return toast('Грядка уже политая'); st.w = abs + 4; dirty = true; toast('💧 Полили — растёт быстрее'); }, 'g');
    }
    const ap = nearestApple(px, pz);
    if (ap) { const k = Math.round(ap.x) + ',' + Math.round(ap.z); offer(Math.hypot(ap.x - px, ap.z - pz), 0.5, '🍎 Собрать яблоки', () => { const c = getClock(), absDay = c.day; if (S.treeDay[k] === absDay) return toast('Яблоки на этой яблоне уже собраны'); S.treeDay[k] = absDay; const n = 2 + Math.floor(Math.random() * 3); addItem('apples', n); toast(`+${n} ${plural(n, 'яблоко', 'яблока', 'яблок')}`); }, 't');
    }
    if (S.q.fish >= 1 || S.inv.fish > 0 || performance.now() - tStart > 0) { const pd = pondDist(px, pz); if (pd < 3.2) offer(pd, 0.8, '🎣 Закинуть удочку', () => fishNow(), 'f'); }
    for (const s of nav.shops) { const d = Math.hypot(s.door.x - px, s.door.z - pz); if (d < 5.5) offer(d, -1, '🛒 В магазин', () => openShop(s), 's'); }
    for (const a of sim.actors) {
      if (a.hidden) continue; const d = Math.hypot(a.x - px, a.z - pz); if (d > 3.8) continue;
      offer(d, 0.2, `💬 Поговорить: ${a.res.first}`, () => talkTo(a), 'n');
    }
    for (const key of ['bread', 'eggs', 'milk', 'fish', 'borsch', 'pie']) { const g = giver[key]; if (!g || !g.hidden) continue; const d = Math.hypot(g.house.door.x - px, g.house.door.z - pz); if (d < 3.6) offer(d, 0.5, `🚪 Постучать: ${g.res.first}`, () => talkTo(g), 'd'); }
    cand = best;
    if (best && !dlgOpen) { act.style.display = 'block'; act.textContent = best.label + '  [F]'; } else act.style.display = 'none';
  };
  const doAct = () => { if (dlgOpen || !cand) return; cand.fn(); };
  act.onclick = doAct;
  addEventListener('keydown', (e) => { if (e.code === 'KeyF') doAct(); if (e.code === 'KeyB') (panelOpen ? closePanel() : openPanel('inv')); if (e.code === 'Escape') { closeDlg(); closePanel(); } });

  // ---------- quest markers (projected DOM)
  const v3 = new THREE.Vector3();
  const targets = () => {
    const t = [];
    const g = giver;
    const d = (a) => ({ x: a.house.door.x, z: a.house.door.z });
    if (g.bread) { if (S.q.bread === 0 || (S.q.bread === 1 && S.inv.bread > 0)) t.push({ ...d(g.bread), ic: S.q.bread === 0 ? '❗' : '✔' }); else if (S.q.bread === 1) { const s = shopDoor(player.pos); if (s) t.push({ x: s.door.x, z: s.door.z, ic: '🛒' }); } }
    if (g.eggs && (S.q.eggs === 0 || (S.q.eggs === 1 && S.inv.eggs >= 4))) t.push({ ...d(g.eggs), ic: S.q.eggs === 0 ? '❗' : '✔' });
    if (g.milk && (S.q.milk === 0 || (S.q.milk === 1 && S.inv.milk > 0))) t.push({ ...d(g.milk), ic: S.q.milk === 0 ? '❗' : '✔' });
    if (g.fish && (S.q.fish === 0 || (S.q.fish === 1 && S.inv.fish >= 3))) t.push({ ...d(g.fish), ic: S.q.fish === 0 ? '❗' : '✔' });
    if (g.borsch && (S.q.borsch === 0 || (S.q.borsch === 1 && S.inv.potato >= 2 && S.inv.carrot >= 2 && S.inv.tomato >= 1))) t.push({ ...d(g.borsch), ic: S.q.borsch === 0 ? '❗' : '✔' });
    if (g.pie && (S.q.pie === 0 || (S.q.pie === 1 && S.inv.apples >= 6 && S.inv.eggs >= 2))) t.push({ ...d(g.pie), ic: S.q.pie === 0 ? '❗' : '✔' });
    if (S.q.farm < 2 && (S.inv.seed_potato + S.inv.seed_carrot + S.inv.seed_tomato) > 0 && farm.plots.length) { let bp = null, bd = 1e9; for (const p of farm.plots) { if (S.farm[p.id]) continue; const dd = Math.hypot(p.g.cx - player.pos.x, p.g.cz - player.pos.z); if (dd < bd) { bd = dd; bp = p; } } if (bp) t.push({ x: bp.g.cx, z: bp.g.cz, ic: '🌱' }); }
    for (const p of farm.plots) { const st = S.farm[p.id]; if (st && farm.frac(st) >= 1) t.push({ x: p.g.cx, z: p.g.cz, ic: '🧺' }); }
    return t.map((q) => ({ ...q, dist: Math.hypot(q.x - player.pos.x, q.z - player.pos.z) })).sort((a, b) => a.dist - b.dist).slice(0, 2);
  };
  let lastMark = 0;
  const updateMarkers = (now) => {
    if (now - lastMark < 0.05) return; lastMark = now;
    const ts = targets();
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i], q = ts[i];
      if (!q || q.dist > 260) { m.style.display = 'none'; continue; }
      v3.set(q.x, world.heightAt(q.x, q.z) + 3.1, q.z).project(camera);
      if (v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) { m.style.display = 'none'; continue; }
      m.style.display = 'block'; m.textContent = q.ic + ' ' + Math.round(q.dist) + ' м'; m.style.transform = `translate(${(v3.x * 0.5 + 0.5) * innerWidth}px, ${(-v3.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
    }
  };

  // ---------- save/load plumbing
  setInterval(() => { if (dirty) save(); }, 15000);
  addEventListener('pagehide', () => save());
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  refreshBar();
  if (!loaded && !S.intro && !/[?&]manual=1/.test(location.search) && !/[?&]hud=0/.test(location.search)) setTimeout(() => {
    if (S.intro || dlgOpen) return; S.intro = 1; dirty = true;
    say('Добро пожаловать в Любимівку!', 'Краткая памятка', 'Гуляйте по селу, разговаривайте с жителями (кнопка действия внизу или клавиша F), берите яйца у кур, доите коров, ловите рыбу на прудах. Магазин работает с 8 до 20 ч. Откройте «🎒 Рюкзак и дела» — там задания. А на своих грядках (участки 35Б и 84) можно выращивать овощи: семена — в магазине.', [{ label: '📍 Показать мой участок 35Б', fn: () => { closeDlg(); if (ctx.gotoHome) ctx.gotoHome(); } }]);
  }, 6000);

  return {
    farm, state: () => S, loaded, save, toast, openPanel, closePanel, talkTo, giver, cand: () => cand,
    applyLoaded(hasTimeParam) { // restore clock + position of a saved game (URL ?t=… wins for the clock)
      if (!loaded) return;
      if (!hasTimeParam) setClock(S.hour, S.day);
      if (S.pos && Math.abs(S.pos.x) < 490 && Math.abs(S.pos.z) < 490) { player.teleport(S.pos.x, S.pos.z, S.pos.yaw); }
    },
    update(now) {
      if (now - lastFarm > 1) { lastFarm = now; const c = getClock(), abs = c.day * 24 + c.hour; if (lastAbs !== null && abs > lastAbs && abs - lastAbs < 48 && farm.advance(S.farm, abs - lastAbs, abs, getWeather && getWeather() === 'rain')) dirty = true; lastAbs = abs; for (const pl of farm.plots) { const st = S.farm[pl.id]; if (st && !st.n && farm.frac(st) >= 1) { st.n = 1; toast(`${CROPS[st.c].icon} Созрел урожай: ${CROPS[st.c].name.toLowerCase()}!`); dirty = true; } } }
      if (now - lastScan > 0.2) { lastScan = now; scan(); const ct = $('card-time'); if (ct && ct.offsetParent) bar.style.top = Math.round(ct.getBoundingClientRect().bottom + 6) + 'px'; else bar.style.top = ''; } updateMarkers(now); void tStart; },
    markDirty() { dirty = true; },
  };
}

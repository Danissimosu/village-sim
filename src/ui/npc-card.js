// Small Russian info card for the selected villager + a marker above their head.
const plural = (n, a, b, c) => { const m = n % 100, d = n % 10; return m >= 11 && m <= 14 ? c : d === 1 ? a : d >= 2 && d <= 4 ? b : c; };
export const ageText = (n) => (n < 1 ? 'младенец' : `${n} ${plural(n, 'год', 'года', 'лет')}`);

export function createNpcCard() {
  const root = document.getElementById('hud');
  const card = document.createElement('div'); card.id = 'npc-card'; card.style.display = 'none';
  card.innerHTML = `<button class="x" aria-label="Закрыть">×</button><div class="nm" id="npc-nm"></div><div class="sub" id="npc-sub"></div>
    <div class="r"><span>Сейчас</span><b id="npc-now"></b></div><div class="r"><span>Дом</span><b id="npc-home"></b></div><div class="r"><span>Семья</span><b id="npc-fam"></b></div><button id="npc-talk" class="talk">💬 Поговорить</button>`;
  const mark = document.createElement('div'); mark.id = 'npc-mark'; mark.style.display = 'none'; mark.textContent = '▼';
  root.appendChild(card); root.appendChild(mark);
  const stop = (e) => e.stopPropagation();
  ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'mousedown', 'click'].forEach((ev) => card.addEventListener(ev, stop));
  const $ = (id) => card.querySelector('#' + id);
  let onClose = null, onTalk = null; card.querySelector('#npc-talk').addEventListener('click', () => onTalk && onTalk());
  card.querySelector('.x').addEventListener('click', () => { api.hide(); onClose && onClose(); });
  const api = {
    visible: false,
    onClose(fn) { onClose = fn; },
    onTalk(fn) { onTalk = fn; },
    show(a, sim) {
      const r = a.res; this.visible = true; card.style.display = 'block';
      $('npc-nm').textContent = `${r.first} ${r.last}`;
      $('npc-sub').textContent = `${r.female ? 'Ж' : 'М'}, ${ageText(r.age)} · ${r.occupation}`;
      $('npc-home').textContent = r.address || '—';
      const hh = sim.pop.households[r.household]; $('npc-fam').textContent = `${hh.members.length} ${plural(hh.members.length, 'человек', 'человека', 'человек')}`;
      this.refresh(a, sim);
    },
    refresh(a, sim) { $('npc-now').textContent = sim.describe(a) + (a.hidden ? ' (внутри)' : ''); },
    mark(x, y, vis) { mark.style.display = vis ? 'block' : 'none'; if (vis) mark.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`; },
    hide() { this.visible = false; card.style.display = 'none'; mark.style.display = 'none'; },
  };
  return api;
}

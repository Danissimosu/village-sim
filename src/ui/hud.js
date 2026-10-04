// Minimal Russian HUD: time of day, quality toggle, view toggle, run toggle, fullscreen, FPS.
export function createHUD(handlers) {
  const root = document.getElementById('app');
  const hud = document.createElement('div'); hud.id = 'hud';
  hud.innerHTML = `
    <div class="card" id="card-time">
      <div class="row"><b>Любимівка</b><span id="clock">10:30</span></div>
      <input id="time-slider" type="range" min="0" max="24" step="0.02" value="10.5" aria-label="Время суток">
      <div class="row small"><span id="phase">День</span><button id="btn-auto" class="chip on">Время идёт</button></div>
      <div class="row small pop"><span id="pop">Жителей: —</span><span id="pop-out"></span></div>
    </div>
    <div class="col" id="btns">
      <button id="btn-quality" class="btn">Качество: …</button>
      <button id="btn-view" class="btn">Вид: от 3-го лица</button>
      <button id="btn-run" class="btn">Бег: выкл</button>
      <button id="btn-goto" class="btn poi">📍 Перейти к 35Б</button>
      <button id="btn-goto84" class="btn poi poi84">📍 Перейти к 84</button>
      <button id="btn-hide" class="btn ghost">Скрыть меню</button>
    </div>
    <div id="fps">— fps</div>
    <div id="hint">Джойстик слева — движение · справа — осмотр</div>
    <div id="joy"><div id="joy-knob"></div></div>`;
  root.appendChild(hud);
  const $ = (id) => document.getElementById(id);
  const stop = (e) => e.stopPropagation();
  ['card-time', 'btns'].forEach((id) => { const el = $(id); ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'mousedown'].forEach((ev) => el.addEventListener(ev, stop)); });
  $('time-slider').addEventListener('input', (e) => handlers.onTime(parseFloat(e.target.value)));
  $('btn-auto').addEventListener('click', () => { const on = handlers.onAuto(); $('btn-auto').classList.toggle('on', on); $('btn-auto').textContent = on ? 'Время идёт' : 'Пауза'; });
  $('btn-quality').addEventListener('click', () => handlers.onQuality());
  $('btn-view').addEventListener('click', () => { const tp = handlers.onView(); $('btn-view').textContent = tp ? 'Вид: от 3-го лица' : 'Вид: от 1-го лица'; });
  $('btn-run').addEventListener('click', () => { const r = handlers.onRun(); $('btn-run').textContent = r ? 'Бег: вкл' : 'Бег: выкл'; });
  $('btn-goto').addEventListener('click', () => { handlers.onGoto && handlers.onGoto(); });
  $('btn-goto84').addEventListener('click', () => { handlers.onGoto84 && handlers.onGoto84(); });
  $('btn-hide').addEventListener('click', () => { const h = document.body.classList.toggle('menu-hidden'); $('btn-hide').textContent = h ? 'Меню' : 'Скрыть меню'; });
  setTimeout(() => { $('hint').style.opacity = 0; }, 9000);
  return {
    setPop(total, outside) { $('pop').textContent = `Жителей: ${total}`; $('pop-out').textContent = `на улице: ${outside}`; },
    setClock(h, day = 0) {
      const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
      $('clock').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
      $('time-slider').value = h;
      $('phase').textContent = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][day % 7] + ', день ' + (day + 1) + ' · ' + (h < 4.5 || h >= 21 ? 'Ночь' : h < 6.5 ? 'Рассвет' : h < 11 ? 'Утро' : h < 16 ? 'День' : h < 19 ? 'Вечер' : 'Закат');
    },
    setQuality(label, scale) { $('btn-quality').textContent = `Качество: ${label}`; this._scale = scale; },
    setFps(fps, extra) { $('fps').textContent = `${Math.round(fps)} fps${extra ? ' · ' + extra : ''}`; },
    setView(tp) { $('btn-view').textContent = tp ? 'Вид: от 3-го лица' : 'Вид: от 1-го лица'; },
    el: $,
  };
}

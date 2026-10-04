// Procedural ambience (WebAudio, no asset files): wind, birds, roosters, distant dogs, crickets at night, rain. Muted until the user taps the button.
export function createAmbience(root) {
  let ctx = null, master = null, wind = null, rain = null, crick = null, muted = true;
  const nodes = {}; let nextBird = 2, nextDog = 8, nextRoost = 15, nextCow = 30, t = 0;
  const btn = document.createElement('button'); btn.id = 'btn-mute'; btn.textContent = '🔇'; btn.setAttribute('aria-label', 'Звук: выключен'); root.appendChild(btn);
  ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'mousedown'].forEach((ev) => btn.addEventListener(ev, (e) => e.stopPropagation()));

  const noiseBuf = () => { const len = ctx.sampleRate * 3, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0); let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3.5; } return b; };
  const loopNoise = (type, freq, q) => { const s = ctx.createBufferSource(); s.buffer = nodes.noise; s.loop = true; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7; const g = ctx.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(master); s.start(); return { s, f, g }; };
  const init = () => {
    ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.0; master.connect(ctx.destination);
    nodes.noise = noiseBuf(); wind = loopNoise('lowpass', 500, 0.5); rain = loopNoise('highpass', 1400, 0.4); crick = ctx.createOscillator(); crick.type = 'sine'; crick.frequency.value = 4300;
    const cg = ctx.createGain(); cg.gain.value = 0; const am = ctx.createOscillator(); am.frequency.value = 34; const amg = ctx.createGain(); amg.gain.value = 0.5; am.connect(amg); amg.connect(cg.gain); crick.connect(cg); cg.connect(master); crick.start(); am.start(); nodes.crickG = cg;
  };
  const env = (g, t0, a, d, peak) => { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); };
  const chirp = (when, f0, f1, dur, vol, pan = 0) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(f1, when + dur); env(g, when, 0.01, dur, vol); let out = g; if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; } o.connect(g); out.connect(master); o.start(when); o.stop(when + dur + 0.05); };
  const bird = () => { const n = 2 + Math.floor(Math.random() * 4), base = 2200 + Math.random() * 2200, pan = Math.random() * 1.6 - 0.8, vol = 0.03 + Math.random() * 0.04; for (let i = 0; i < n; i++) chirp(ctx.currentTime + 0.02 + i * (0.09 + Math.random() * 0.05), base * (1 + Math.random() * 0.3), base * (1.2 + Math.random() * 0.7), 0.07, vol, pan); };
  const bark = (vol) => { const w = ctx.currentTime, n = 1 + Math.floor(Math.random() * 3), f = 260 + Math.random() * 200; for (let i = 0; i < n; i++) { const t0 = w + i * 0.32; const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 1.5, t0); o.frequency.exponentialRampToValueAtTime(f * 0.6, t0 + 0.16); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2; env(g, t0, 0.015, 0.16, vol); o.connect(bp); bp.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.22); } };
  const rooster = (vol) => { const w = ctx.currentTime; const seq = [[520, 780, 0.22], [700, 560, 0.12], [640, 900, 0.3], [900, 480, 0.5]]; let t0 = w; for (const [a, b, d] of seq) { const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.setValueAtTime(a, t0); o.frequency.linearRampToValueAtTime(b, t0 + d); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.9; env(g, t0, 0.03, d, vol); o.connect(bp); bp.connect(g); g.connect(master); o.start(t0); o.stop(t0 + d + 0.08); t0 += d + 0.05; } };
  const moo = (vol) => { const t0 = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.setValueAtTime(120, t0); o.frequency.linearRampToValueAtTime(95, t0 + 1.2); lp.type = 'lowpass'; lp.frequency.value = 520; env(g, t0, 0.25, 1.0, vol); o.connect(lp); lp.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 1.4); };

  const api = {
    get muted() { return muted; },
    toggle() {
      if (!ctx) init();
      muted = !muted;
      if (ctx.state === 'suspended') ctx.resume();
      master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.15);
      btn.textContent = muted ? '🔇' : '🔊'; btn.setAttribute('aria-label', muted ? 'Звук: выключен' : 'Звук: включён'); btn.classList.toggle('on', !muted);
      return !muted;
    },
    // state: {hour, night(0..1), rain(0..1), fog, dogNear(bool), cowNear(bool), nearBirds}
    update(dt, st) {
      if (!ctx || muted) return;
      t += dt;
      const day = 1 - st.night;
      wind.g.gain.setTargetAtTime(0.05 + 0.05 * (0.5 + 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.07 + 1)) + 0.06 * st.rain, ctx.currentTime, 0.5);
      wind.f.frequency.setTargetAtTime(380 + 260 * (0.5 + 0.5 * Math.sin(t * 0.13)), ctx.currentTime, 0.6);
      rain.g.gain.setTargetAtTime(0.11 * st.rain, ctx.currentTime, 0.6);
      nodes.crickG.gain.setTargetAtTime(0.012 * Math.max(0, st.night - 0.3) * (1 - st.rain) * (st.hour > 21 || st.hour < 4 ? 1 : 0.6), ctx.currentTime, 1.0);
      if (t > nextBird && day > 0.4 && st.rain < 0.5) { bird(); nextBird = t + 1.5 + Math.random() * (st.hour < 9 ? 3 : 7); }
      if (t > nextDog) { bark(st.dogNear ? 0.16 : 0.035); nextDog = t + (st.dogNear ? 6 + Math.random() * 10 : 14 + Math.random() * 30); if (st.night > 0.5 && Math.random() < 0.4) nextDog = t + 3 + Math.random() * 5; }
      if (t > nextRoost && st.hour > 4.2 && st.hour < 9.5) { rooster(0.035); nextRoost = t + 18 + Math.random() * 40; }
      if (t > nextCow && st.cowNear && day > 0.3) { moo(0.08); nextCow = t + 12 + Math.random() * 25; }
    },
  };
  btn.addEventListener('click', () => api.toggle());
  addEventListener('keydown', (e) => { if (e.code === 'KeyM') api.toggle(); });
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else if (!muted) ctx.resume(); });
  return api;
}

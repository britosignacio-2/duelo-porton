// duel2-sfx.js -- SFX 100% sinteticos por codigo (Web Audio), sin un solo
// asset. Es placeholder de prueba, no la direccion de audio final (esa es la
// Epica 7, con ElevenLabs) -- pero el peso perceptual de un juego de
// destruccion sale del feedback, no del sprite, asi que sin esto el prototipo
// no se puede juzgar jugando.
//
// AMPLIADO 2026-09-06 con los hallazgos de feel de la iteracion 0:
//  - Un golpe de 8 de daño sonaba IGUAL que uno de 37. El jugador tiro 19
//    veces con el arma equivocada sin enterarse. Ahora el impacto cambia de
//    tono, cuerpo y duracion segun lo bueno que fue el matchup, y ademas
//    segun el material: la madera astilla seco, el metal resuena, la piedra
//    revienta grave.
//  - El disparo no tenia carga: soltabas y aparecia un proyectil. Ahora el
//    elastico cruje mientras se estira y chasquea al soltar.
(function (DF) {
  'use strict';

  let ctx = null;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function unlock() { ensureCtx(); }

  function noiseBuffer(c, dur) {
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function env(c, gain, pico, dur) {
    gain.gain.setValueAtTime(pico, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  }

  // --- Impacto -------------------------------------------------------------
  // `calidad` 0..1 es lo bueno que fue el matchup arma-vs-material. Es el
  // parametro mas importante del juego a nivel feedback: es lo unico que le
  // dice al jugador "estas usando el arma equivocada" sin un tutorial.
  function playThud(fuerza, material, calidad) {
    const c = ensureCtx();
    if (!c) return;
    const feel = (DF.Weapons.MATERIAL_FEEL && DF.Weapons.MATERIAL_FEEL[material]) ||
                 { pitch: 1.0, resonancia: 0.2 };
    const q = calidad === undefined ? 0.5 : calidad;

    // Un golpe flojo es corto, agudo y sin cuerpo: rebota. Uno bueno es largo,
    // grave y con peso: rompe.
    const dur = 0.07 + q * 0.26;
    const corte = (200 + (1 - q) * 900) * feel.pitch;

    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, dur);
    const filtro = c.createBiquadFilter();
    filtro.type = q > 0.5 ? 'lowpass' : 'bandpass';
    filtro.frequency.value = corte;
    filtro.Q.value = q > 0.5 ? 1 : 3;
    const g = c.createGain();
    env(c, g, 0.20 + q * 0.55 + fuerza * 0.15, dur);
    src.connect(filtro).connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + dur);

    // Cola metalica: solo el metal resuena despues del golpe.
    if (feel.resonancia > 0.3) {
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520 * feel.pitch, c.currentTime);
      const g2 = c.createGain();
      env(c, g2, 0.10 * feel.resonancia * (0.4 + q), 0.45);
      osc.connect(g2).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + 0.5);
    }

    // Golpe muy bueno: un sub-grave que se siente en el pecho.
    if (q > 0.72) {
      const sub = c.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(120, c.currentTime);
      sub.frequency.exponentialRampToValueAtTime(45, c.currentTime + 0.22);
      const g3 = c.createGain();
      env(c, g3, 0.5, 0.26);
      sub.connect(g3).connect(c.destination);
      sub.start();
      sub.stop(c.currentTime + 0.28);
    }
  }

  // --- Gomera --------------------------------------------------------------
  // Crujido corto mientras se estira. Se llama en escalones de tension, no
  // cada cuadro, para que suene a elastico y no a zumbido.
  function playStretch(tension) {
    const c = ensureCtx();
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 0.05);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700 + tension * 1500;
    f.Q.value = 6;
    const g = c.createGain();
    env(c, g, 0.05 + tension * 0.07, 0.05);
    src.connect(f).connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + 0.06);
  }

  function playShot(weaponKey) {
    const c = ensureCtx();
    if (!c) return;
    const w = DF.Weapons.WEAPONS[weaponKey] || {};
    // Chasquido del elastico: comun a todos.
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(720, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, c.currentTime + 0.10);
    const g = c.createGain();
    env(c, g, 0.24, 0.12);
    osc.connect(g).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.13);

    // El cohete suma su propio encendido, grave y sostenido.
    if (w.kind === 'cohete') {
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c, 0.75);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(300, c.currentTime);
      f.frequency.linearRampToValueAtTime(1200, c.currentTime + 0.7);
      const g2 = c.createGain();
      g2.gain.setValueAtTime(0.0, c.currentTime);
      g2.gain.linearRampToValueAtTime(0.22, c.currentTime + 0.08);
      g2.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.75);
      src.connect(f).connect(g2).connect(c.destination);
      src.start();
      src.stop(c.currentTime + 0.8);
    }
  }

  function playBounce() {
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, c.currentTime + 0.09);
    const g = c.createGain();
    env(c, g, 0.16, 0.10);
    osc.connect(g).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.11);
  }

  function playSplit() {
    const c = ensureCtx();
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 0.12);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1800;
    const g = c.createGain();
    env(c, g, 0.22, 0.13);
    src.connect(f).connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + 0.14);
  }

  function playExplosion() {
    const c = ensureCtx();
    if (!c) return;
    const dur = 0.8;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, dur);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1200, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(60, c.currentTime + dur);
    const g = c.createGain();
    env(c, g, 0.75, dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + dur);
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(90, c.currentTime);
    sub.frequency.exponentialRampToValueAtTime(30, c.currentTime + 0.6);
    const g2 = c.createGain();
    env(c, g2, 0.6, 0.7);
    sub.connect(g2).connect(c.destination);
    sub.start();
    sub.stop(c.currentTime + 0.75);
  }

  // Tell de "interceptable": click cortisimo y agudo, distinto de todo lo
  // demas. Va junto con el destello visual, no en lugar de el: la ventana
  // ocurre cerca de tu torre, del mismo lado donde esta tu pulgar.
  function playInterceptReady() {
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1650, c.currentTime);
    const g = c.createGain();
    env(c, g, 0.10, 0.05);
    osc.connect(g).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.06);
  }

  function playIntercept() {
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1400, c.currentTime + 0.12);
    const g = c.createGain();
    env(c, g, 0.26, 0.18);
    osc.connect(g).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.19);
  }

  function playRepair() {
    const c = ensureCtx();
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 0.09);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 3;
    const g = c.createGain();
    env(c, g, 0.30, 0.10);
    src.connect(f).connect(g).connect(c.destination);
    src.start();
    src.stop(c.currentTime + 0.11);
  }

  // Aviso de la IA antes de disparar. Sin esto el rival es clima: le llueven
  // proyectiles al jugador sin nada que leer. Con esto hay un instante de
  // anticipacion, que es lo minimo para que se sienta que hay ALGUIEN.
  function playAiTell() {
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, c.currentTime);
    osc.frequency.linearRampToValueAtTime(300, c.currentTime + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0, c.currentTime);
    g.gain.linearRampToValueAtTime(0.09, c.currentTime + 0.10);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.22);
    osc.connect(g).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.24);
  }

  // Cierre del duelo. Ganar no se pagaba: colapso y despues un cartel de
  // texto. Tres notas ascendentes al ganar, dos descendentes al perder.
  function playOutcome(gano) {
    const c = ensureCtx();
    if (!c) return;
    const notas = gano ? [392, 523, 659] : [330, 247];
    notas.forEach(function (hz, i) {
      const osc = c.createOscillator();
      osc.type = 'triangle';
      const t0 = c.currentTime + i * 0.13;
      osc.frequency.setValueAtTime(hz, t0);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0, t0);
      g.gain.linearRampToValueAtTime(0.22, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.30);
      osc.connect(g).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    });
  }

  DF.Sfx = {
    unlock: unlock,
    playThud: playThud,
    playShot: playShot,
    playStretch: playStretch,
    playBounce: playBounce,
    playSplit: playSplit,
    playExplosion: playExplosion,
    playInterceptReady: playInterceptReady,
    playIntercept: playIntercept,
    playRepair: playRepair,
    playAiTell: playAiTell,
    playOutcome: playOutcome
  };
})(window.DF = window.DF || {});

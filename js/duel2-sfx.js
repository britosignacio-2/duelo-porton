// duel2-sfx.js -- SFX 100% sintéticos por código (osciladores/ruido vía Web
// Audio API), sin ningún asset ni herramienta de IA -- el prototipo de
// varianza necesita "juice" para poder juzgarse jugando (ver hallazgo de
// arte/audio en critical-review-2026-09-03.md: el peso perceptual sale del
// feedback de impacto, no del sprite). Esto es placeholder de prueba, no la
// dirección de audio final del juego (esa es Épica 7, con ElevenLabs/etc).
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

  // Debe llamarse desde un gesto real del usuario (pointerdown) -- los
  // navegadores bloquean audio sin interacción previa.
  function unlock() {
    ensureCtx();
  }

  function noiseBuffer(c, durationSec) {
    const n = Math.max(1, Math.floor(c.sampleRate * durationSec));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Impacto de proyectil contra un piso -- strength 0..1 (más daño = más grave/fuerte).
  function playThud(strength) {
    const c = ensureCtx();
    if (!c) return;
    const dur = 0.14 + strength * 0.14;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, dur);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280 + strength * 260;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.45 + strength * 0.35, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(filter).connect(gain).connect(c.destination);
    src.start();
    src.stop(c.currentTime + dur);
  }

  function playShot() {
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, c.currentTime + 0.13);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.22, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.14);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.15);
  }

  // Colapso final de una torre -- más largo y grave que un impacto normal.
  function playExplosion() {
    const c = ensureCtx();
    if (!c) return;
    const dur = 0.65;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, dur);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, c.currentTime);
    filter.frequency.exponentialRampToValueAtTime(70, c.currentTime + dur);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.65, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(filter).connect(gain).connect(c.destination);
    src.start();
    src.stop(c.currentTime + dur);
  }

  // Tell de "interceptable" (P2, decidido 2026-09-05). Click cortísimo y
  // agudo, deliberadamente distinto de cualquier otro sonido del juego.
  // Va junto con el destello visual, no en lugar de él: la ventana de
  // intercepción ocurre cerca de TU torre, o sea del mismo lado donde está tu
  // pulgar -- si el dedo tapa la señal visual, el audio la salva. Ese es el
  // motivo entero de que el tell sea multimodal.
  function playInterceptReady() {
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1650, c.currentTime);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.10, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.06);
  }

  // Intercepción lograda -- barrido ascendente corto, "recompensa".
  function playIntercept() {
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1400, c.currentTime + 0.12);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.26, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.19);
  }

  // Reparar -- golpe de martillo sordo sobre chatarra, no un "power-up".
  function playRepair() {
    const c = ensureCtx();
    if (!c) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 0.09);
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 3;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.30, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.10);
    src.connect(filter).connect(gain).connect(c.destination);
    src.start();
    src.stop(c.currentTime + 0.11);
  }

  DF.Sfx = {
    unlock: unlock,
    playThud: playThud,
    playShot: playShot,
    playExplosion: playExplosion,
    playInterceptReady: playInterceptReady,
    playIntercept: playIntercept,
    playRepair: playRepair
  };
})(window.DF = window.DF || {});

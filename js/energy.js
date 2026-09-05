// energy.js -- barra de energía: regeneración por tiempo, costo fijo de disparo,
// chequeo de disponibilidad. Gatea tanto al jugador como a la IA.
(function (DF) {
  'use strict';

  // Ask First (spec): valores exactos de balance. Defaults razonables, ajustables acá.
  const DEFAULTS = {
    max: 100,
    regenPerSecond: 14, // barra llena en ~7s desde vacío
    shotCost: 34        // ~3 disparos por barra llena
  };

  function createEnergy(overrides) {
    const cfg = Object.assign({}, DEFAULTS, overrides || {});
    // `value` no tiene default propio (no está en DEFAULTS): si el caller lo pasa
    // en overrides, arranca ahí; si no, arranca llena (comportamiento previo).
    const startValue = typeof cfg.value === 'number' ? cfg.value : cfg.max;
    return {
      max: cfg.max,
      value: startValue,
      regenPerSecond: cfg.regenPerSecond,
      shotCost: cfg.shotCost,
      insufficientFlashUntil: 0 // timestamp (segundos) hasta el cual mostrar feedback de "sin energía"
    };
  }

  function updateEnergy(energy, dt) {
    energy.value = Math.min(energy.max, energy.value + energy.regenPerSecond * dt);
  }

  function canShoot(energy) {
    return energy.value >= energy.shotCost;
  }

  function spend(energy) {
    energy.value = Math.max(0, energy.value - energy.shotCost);
  }

  function flagInsufficient(energy, nowSeconds) {
    energy.insufficientFlashUntil = nowSeconds + 0.4;
  }

  DF.Energy = {
    DEFAULTS: DEFAULTS,
    createEnergy: createEnergy,
    updateEnergy: updateEnergy,
    canShoot: canShoot,
    spend: spend,
    flagInsufficient: flagInsufficient
  };
})(window.DF = window.DF || {});

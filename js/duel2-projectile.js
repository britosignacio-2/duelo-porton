// duel2-projectile.js -- fork de tower-projectile.js: suma viento (aceleración
// horizontal constante durante toda la ronda, en espacio de mundo -- favorece
// a un lado y perjudica al otro, mismo modelo que Worms) a la integración del
// proyectil. Ver hallazgo #1 de critical-review-2026-09-03.md.
(function (DF) {
  'use strict';

  const RADIUS = 6;
  const MAX_SUBSTEPS = 6;

  function stepProjectile(p, dt, gravity, wind) {
    p.vy += gravity * dt;
    p.vx += (wind || 0) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  // Devuelve { hit, floor } | { outOfBounds: true } | {} si sigue en vuelo.
  function updateProjectileVsTower(p, dt, opts) {
    const gravity = opts.gravity;
    const wind = opts.wind || 0;
    const targetTower = opts.targetTower;
    const bounds = opts.bounds;
    const groundY = opts.groundY;
    const refSize = opts.refSize || 40;

    const speed = Math.hypot(p.vx, p.vy);
    const steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil((speed * dt) / (refSize * 0.5))));
    const subDt = dt / steps;

    for (let i = 0; i < steps; i++) {
      stepProjectile(p, subDt, gravity, wind);

      const hitFloor = DF.Tower2.findHitFloor(targetTower, p.x, p.y, RADIUS);
      if (hitFloor) return { hit: true, floor: hitFloor };

      if (p.x < -50 || p.x > bounds.width + 50 || p.y > groundY + 50) {
        return { outOfBounds: true };
      }
    }
    return {};
  }

  DF.TowerProjectile2 = {
    RADIUS: RADIUS,
    updateProjectileVsTower: updateProjectileVsTower
  };
})(window.DF = window.DF || {});

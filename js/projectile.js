// projectile.js -- física del proyectil (gravedad + velocidad inicial), integración
// de posición y detección de colisión contra la grilla de bloques de la fortaleza rival.
(function (DF) {
  'use strict';

  // Ask First (spec): valores exactos de balance. Arrancan razonables y ajustables acá.
  const DEFAULTS = {
    radius: 6,              // px, radio visual/colisión del proyectil
    splashRadiusCells: 1.3, // radio de destrucción en celdas de grilla (ver fortress.js)
    maxSubsteps: 6          // sub-pasos por frame para no atravesar bloques finos a alta velocidad
  };

  function createProjectile(x, y, vx, vy, owner) {
    return { x: x, y: y, vx: vx, vy: vy, owner: owner };
  }

  function stepProjectile(p, dt, gravity) {
    p.vy += gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  // Avanza un proyectil por dt usando sub-pasos (evita "tunneling" a través de
  // bloques) y chequea colisión contra targetFortress luego de cada sub-paso.
  // Devuelve { hit, cell } | { outOfBounds: true } | {} si sigue en vuelo.
  function updateProjectile(p, dt, opts) {
    const gravity = opts.gravity;
    const targetFortress = opts.targetFortress;
    const bounds = opts.bounds;
    const groundY = opts.groundY;
    const blockSize = opts.blockSize || 20;

    const speed = Math.hypot(p.vx, p.vy);
    const steps = Math.max(1, Math.min(DEFAULTS.maxSubsteps, Math.ceil((speed * dt) / (blockSize * 0.5))));
    const subDt = dt / steps;

    for (let i = 0; i < steps; i++) {
      stepProjectile(p, subDt, gravity);

      const hitCell = DF.Fortress.findHitCell(targetFortress, p.x, p.y, DEFAULTS.radius);
      if (hitCell) {
        return { hit: true, cell: hitCell };
      }

      if (p.x < -50 || p.x > bounds.width + 50 || p.y > groundY + 50) {
        return { outOfBounds: true };
      }
    }
    return {};
  }

  // Muestrea una trayectoria (sin colisión, solo para la previsualización punteada)
  // con el mismo esquema de integración que updateProjectile/stepProjectile, así
  // la curva mostrada coincide visualmente con la que seguirá el disparo real.
  function predictTrajectory(x, y, vx, vy, gravity, groundY, bounds, sampleDt, maxPoints) {
    const points = [];
    let px = x, py = y, pvx = vx, pvy = vy;
    for (let i = 0; i < maxPoints; i++) {
      pvy += gravity * sampleDt;
      px += pvx * sampleDt;
      py += pvy * sampleDt;
      if (py > groundY || px < 0 || px > bounds.width) break;
      points.push({ x: px, y: py });
    }
    return points;
  }

  DF.Projectile = {
    DEFAULTS: DEFAULTS,
    createProjectile: createProjectile,
    updateProjectile: updateProjectile,
    predictTrajectory: predictTrajectory
  };
})(window.DF = window.DF || {});

// ai.js -- la IA dispara solo cuando tiene energía propia suficiente, apuntando
// al núcleo del jugador con error aleatorio perceptible en ángulo y potencia.
(function (DF) {
  'use strict';

  // Ask First (spec): magnitud del error de la IA. Defaults razonables, ajustables acá.
  const DEFAULTS = {
    speedMin: 500,
    speedMax: 1100,
    angleErrorMax: 0.18,   // radianes (~10°) de error de puntería sumado al ángulo ideal
    speedErrorRatio: 0.12  // +/-12% de variación de potencia
  };

  function createAI(overrides) {
    return Object.assign({}, DEFAULTS, overrides || {});
  }

  // Resuelve el ángulo de lanzamiento (radianes, "arriba" positivo) necesario para
  // que un disparo a velocidad `speed` recorra una distancia horizontal D y una
  // diferencia de altura H (positiva = target más alto). D siempre >= 0.
  // Devuelve null si no hay solución real a esa velocidad.
  function solveAngle(D, H, speed, gravity) {
    if (D <= 0) return null;
    const v2 = speed * speed;
    const a = (gravity * D * D) / (2 * v2);
    if (a === 0) return null;

    // a*t^2 - D*t + (a + H) = 0, con t = tan(theta)
    const A = a;
    const B = -D;
    const C = a + H;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;

    const sq = Math.sqrt(disc);
    const t1 = (-B + sq) / (2 * A);
    const t2 = (-B - sq) / (2 * A);
    const theta1 = Math.atan(t1);
    const theta2 = Math.atan(t2);

    // Preferir el arco más plano (|theta| menor) entre las dos soluciones válidas.
    const candidates = [theta1, theta2].filter(function (th) { return th > -1.3 && th < 1.45; });
    if (!candidates.length) return null;
    candidates.sort(function (x, y) { return Math.abs(x) - Math.abs(y); });
    return candidates[0];
  }

  // Calcula (vx, vy) en espacio de pantalla (y hacia abajo) para que un disparo
  // desde `origin` impacte `target`, probando velocidades dentro del rango
  // configurado y agregando error aleatorio de ángulo/potencia al resultado.
  function computeAimVelocity(ai, origin, target, gravity) {
    const dx = target.x - origin.x;
    const dy = -(target.y - origin.y); // convertir a "arriba positivo"
    const D = Math.abs(dx);
    const forward = dx >= 0 ? 1 : -1;

    let speed = ai.speedMin;
    let theta = null;
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      speed = ai.speedMin + ((ai.speedMax - ai.speedMin) * i) / steps;
      theta = solveAngle(D, dy, speed, gravity);
      if (theta !== null) break;
    }
    if (theta === null) {
      // Sin solución exacta en el rango de velocidades (target muy cerca/lejos):
      // arco de 45° a máxima potencia como mejor esfuerzo.
      speed = ai.speedMax;
      theta = 0.78;
    }

    theta += (Math.random() * 2 - 1) * ai.angleErrorMax;
    speed *= 1 + (Math.random() * 2 - 1) * ai.speedErrorRatio;

    const vx = forward * speed * Math.cos(theta);
    const vy = -speed * Math.sin(theta);
    return { vx: vx, vy: vy };
  }

  // ctx: { energy, muzzle, targetFortress, gravity, onFire(vx, vy) }
  function updateAI(ai, dt, ctx) {
    if (!DF.Energy.canShoot(ctx.energy)) return;
    const target = DF.Fortress.coreWorldPosition(ctx.targetFortress);
    const v = computeAimVelocity(ai, ctx.muzzle, target, ctx.gravity);
    DF.Energy.spend(ctx.energy);
    ctx.onFire(v.vx, v.vy);
  }

  DF.AI = {
    DEFAULTS: DEFAULTS,
    createAI: createAI,
    solveAngle: solveAngle,
    computeAimVelocity: computeAimVelocity,
    updateAI: updateAI
  };
})(window.DF = window.DF || {});

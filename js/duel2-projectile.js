// duel2-projectile.js -- integracion de proyectiles con SEIS arquetipos de
// movimiento (2026-09-06).
//
// Antes: todos los proyectiles volaban el mismo arco balistico y se
// diferenciaban en escalares. El diagnostico de la iteracion 0 mostro que eso
// colapsa -- el jugador encuentra el mejor numero y deja de elegir. Ver el
// encabezado de duel2-weapons.js para el razonamiento completo.
//
// Ahora cada arma tiene un `kind` y se integra distinto:
//
//   balistico  gravedad y viento, nada mas.
//   cohete     empuje sostenido en la direccion INICIAL mientras dura el
//              combustible; el arco arranca cayendo y se endereza.
//   mortero    gravedad aumentada en la bajada -> cae casi a plomo.
//   rebote     pica en el suelo con perdida de energia, hasta N veces.
//   perfora    atraviesa el primer piso y sigue hacia el de atras.
//   racimo     al llegar al punto mas alto se parte en fragmentos.
//
// La integracion sigue siendo manual con sub-pasos anti-tunneling (FR4): a
// velocidades altas un paso entero puede saltearse un piso entero.
(function (DF) {
  'use strict';

  const RADIUS = 6;
  const MAX_SUBSTEPS = 8;

  // Escala global de velocidad inicial. Junto con la gravedad mas baja de
  // duel2-main, alarga el tiempo de vuelo ~30% SIN cambiar el alcance
  // (alcance ~ v²/g, tiempo ~ v/g: bajando v a 0.75 y g a 0.57 el alcance
  // queda igual y el vuelo se estira). Es la respuesta a "todo fluye muy
  // rapido": el jugador actuaba cada 1.79 s y su eleccion de arma dio 0.51
  // de calidad promedio -- o sea, azar. A ese ritmo no hay decision posible,
  // solo reflejo. Un arco mas largo tambien se LEE mejor, que es lo que hace
  // visibles a los arquetipos.
  const ESCALA_VELOCIDAD = 0.75;

  // Un proyectil recien nacido. Centraliza los campos que cada arquetipo
  // necesita para que main no tenga que acordarse de inicializarlos.
  function createProjectile(cfg) {
    const w = DF.Weapons.WEAPONS[cfg.weaponKey];
    const speed = Math.hypot(cfg.vx, cfg.vy) || 1;
    return {
      x: cfg.x, y: cfg.y, vx: cfg.vx, vy: cfg.vy,
      owner: cfg.owner,
      weaponKey: cfg.weaponKey,
      kind: w.kind,
      ageMs: 0,
      // Direccion inicial congelada: el empuje del cohete va SIEMPRE hacia
      // donde apuntaste, no hacia donde el proyectil esta yendo ahora. Si
      // siguiera la velocidad actual, la gravedad lo curvaria hacia abajo y el
      // empuje la acompañaria -- se clavaria en el piso en vez de enderezarse.
      dirX: cfg.vx / speed,
      dirY: cfg.vy / speed,
      // Velocidad con la que nacio: el empuje del cohete se calcula sobre
      // esto, asi un tiro flojo acelera poco y uno fuerte acelera mucho.
      speed0: speed,
      rebotesRestantes: w.rebotes || 0,
      pisosRestantes: w.pisosQueAtraviesa || 1,
      pisosGolpeados: [],
      esFragmento: !!cfg.esFragmento,
      yaSeDividio: !!cfg.esFragmento, // un fragmento no se vuelve a dividir
      // Estado del tell de intercepcion (lo maneja main).
      impactEtaMs: Infinity, etaFullAt: 0, etaTickAt: 0,
      interceptable: false, tellPlayed: false,
      // Rastro para el render: puntos recientes por los que paso.
      estela: []
    };
  }

  function stepProjectile(p, dt, gravity, wind) {
    const w = DF.Weapons.WEAPONS[p.weaponKey];

    // El viento pega distinto segun el arma. El cohete es el MAS afectado a
    // proposito: es lento y con superficie. Si fuera inmune al viento seria el
    // arma sin desventaja y volveriamos al problema que este rediseño ataca.
    const vientoEfectivo = (wind || 0) * (w.windMul === undefined ? 1 : w.windMul);

    // El mortero cae mas rapido de lo que sube: por eso baja casi vertical.
    let g = gravity;
    if (p.kind === 'mortero' && p.vy > 0) g *= (w.gravedadCaida || 1.3);

    p.vy += g * dt;
    p.vx += vientoEfectivo * dt;

    // Empuje del cohete, solo mientras dura el combustible y proporcional a
    // la fuerza con la que se lanzo (ver thrustFactor en duel2-weapons.js).
    if (p.kind === 'cohete' && p.ageMs < (w.thrustMs || 0)) {
      const emp = (w.thrustFactor || 0) * (p.speed0 || 0);
      p.vx += p.dirX * emp * dt;
      p.vy += p.dirY * emp * dt;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ageMs += dt * 1000;
  }

  // Igual que Tower2.findHitFloor pero ignorando los pisos que este proyectil
  // ya atraveso -- si no, el perforador vuelve a "impactar" el mismo piso en
  // el sub-paso siguiente y no avanza nunca.
  function findHitFloorExcluding(tower, px, py, radius, excluidos) {
    for (let i = 0; i < tower.floors.length; i++) {
      const f = tower.floors[i];
      if (!f.alive || f.collapsing) continue;
      if (excluidos.indexOf(f) !== -1) continue;
      if (DF.Tower2.floorRect && circleRectOverlap(px, py, radius, DF.Tower2.floorRect(tower, f))) return f;
    }
    return null;
  }

  function circleRectOverlap(cx, cy, r, rect) {
    const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    const dx = cx - closestX, dy = cy - closestY;
    return (dx * dx + dy * dy) <= r * r;
  }

  // Devuelve uno de:
  //   { hit: true, floor, sigue }   impacto (sigue=true si el perforador continua)
  //   { rebote: true, x, y }        pico en el suelo
  //   { divide: true }              el racimo llego al apice
  //   { outOfBounds: true }
  //   {}                            sigue en vuelo
  function updateProjectileVsTower(p, dt, opts) {
    const gravity = opts.gravity;
    const wind = opts.wind || 0;
    const targetTower = opts.targetTower;
    const bounds = opts.bounds;
    const groundY = opts.groundY;
    const refSize = opts.refSize || 40;
    const w = DF.Weapons.WEAPONS[p.weaponKey];

    const speed = Math.hypot(p.vx, p.vy);
    const steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil((speed * dt) / (refSize * 0.5))));
    const subDt = dt / steps;

    for (let i = 0; i < steps; i++) {
      const vyAntes = p.vy;
      stepProjectile(p, subDt, gravity, wind);

      // Rastro, para que el render pueda dibujar la estela del cohete y ver
      // de un vistazo que este proyectil NO vuela como los demas.
      p.estela.push({ x: p.x, y: p.y });
      if (p.estela.length > 18) p.estela.shift();

      // Racimo: el apice es cuando la velocidad vertical cruza de subir a bajar.
      if (p.kind === 'racimo' && !p.yaSeDividio && vyAntes < 0 && p.vy >= 0) {
        p.yaSeDividio = true;
        return { divide: true };
      }

      const hitFloor = findHitFloorExcluding(targetTower, p.x, p.y, RADIUS, p.pisosGolpeados);
      if (hitFloor) {
        p.pisosGolpeados.push(hitFloor);
        p.pisosRestantes--;
        const sigue = p.kind === 'perfora' && p.pisosRestantes > 0;
        if (sigue) {
          // Atraviesa: pierde velocidad y sigue de largo hacia el piso de atras.
          p.vx *= 0.82;
          p.vy *= 0.82;
        }
        return { hit: true, floor: hitFloor, sigue: sigue, golpeNumero: p.pisosGolpeados.length };
      }

      // Rebote en el suelo, antes del chequeo de fuera de rango.
      if (p.kind === 'rebote' && p.y >= groundY - RADIUS && p.vy > 0) {
        if (p.rebotesRestantes > 0) {
          p.rebotesRestantes--;
          p.y = groundY - RADIUS;
          p.vy = -p.vy * (w.reboteVertical || 0.55);
          p.vx *= (w.reboteHorizontal || 0.8);
          return { rebote: true, x: p.x, y: p.y };
        }
        return { outOfBounds: true, explotaEnSuelo: true, x: p.x, y: groundY };
      }

      if (p.x < -50 || p.x > bounds.width + 50 || p.y > groundY + 50) {
        return { outOfBounds: true };
      }
    }
    return {};
  }

  // Fragmentos del racimo: se abren en abanico desde el punto de division,
  // conservando la velocidad pero girada.
  function splitCluster(p) {
    const w = DF.Weapons.WEAPONS[p.weaponKey];
    const n = w.fragmentos || 3;
    const disp = w.dispersion || 0.35;
    const speed = Math.hypot(p.vx, p.vy);
    const base = Math.atan2(p.vy, p.vx);
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1 .. 1
      const ang = base + t * disp;
      out.push(createProjectile({
        x: p.x, y: p.y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        owner: p.owner,
        weaponKey: p.weaponKey,
        esFragmento: true
      }));
    }
    return out;
  }

  // Velocidad inicial ya transformada por el arquetipo. El mortero reparte el
  // arrastre distinto (mucho hacia arriba, poco hacia adelante) para que suba
  // muchisimo con el mismo gesto; los demas solo escalan.
  function initialVelocity(weaponKey, vx, vy) {
    const w = DF.Weapons.WEAPONS[weaponKey];
    const e = ESCALA_VELOCIDAD;
    if (w.kind === 'mortero') {
      return {
        vx: vx * w.speedMul * (w.arcoHorizontal || 0.6) * e,
        vy: vy * w.speedMul * (w.arcoVertical || 1.5) * e
      };
    }
    return { vx: vx * w.speedMul * e, vy: vy * w.speedMul * e };
  }

  DF.TowerProjectile2 = {
    RADIUS: RADIUS,
    ESCALA_VELOCIDAD: ESCALA_VELOCIDAD,
    createProjectile: createProjectile,
    updateProjectileVsTower: updateProjectileVsTower,
    splitCluster: splitCluster,
    initialVelocity: initialVelocity,
    stepProjectile: stepProjectile
  };
})(window.DF = window.DF || {});

// duel2-main.js -- loop del prototipo de validación de varianza (2026-09-05).
// Fork de tower-main.js. Implementa las 2 hipótesis más caras de
// critical-review-2026-09-03.md para jugarlas ANTES de escribir épicas:
//
//   Hallazgo #1 (el tiro correcto es UNO y se memoriza): arma-vs-material
//     (duel2-weapons.js) + viento por ronda + gomera con altura variable
//     entre partidas. Sin previsualización de trayectoria -- flecha de
//     dirección/potencia en su lugar (duel2-render.js).
//   Hallazgo #2 (núcleo nunca jugado): SIN núcleo -- vida total (bajada
//     respecto al modelo anterior para volver a apuntar a 2-3 min, ajustar
//     jugando) + colapso final dramático como presentación.
//
// AMPLIADO 2026-09-05 (segunda pasada) para poder correr el Portón de
// Retención (_bmad-output/playtest-plan.md). Precondiciones P1-P4:
//   P1 Reparar con "cicatriz permanente" -- el tope de FR25.
//   P2 Interceptar con tell multimodal (destello + click).
//   P3 Timeout de 3:00 con escalada de regeneración desde 1:30 (FR23+FR47).
//   P4 Telemetría de conducta a localStorage (duel2-telemetry.js).
// Más dos arreglos encontrados leyendo: la IA cobraba costo fijo sin importar
// el arma, y los materiales estaban en la paleta vieja.
//
// No toca tower-main.js ni ninguno de sus módulos -- ese sigue siendo la
// referencia validada (torre con núcleo + trayectoria previsualizada) para
// comparar lado a lado si hace falta.
(function (DF) {
  'use strict';

  const GRAVITY = 1400;
  const FLOOR_W_MIN = 46;
  const FLOOR_W_MAX = 90;
  const MARGIN_RATIO = 0.06;
  const MUZZLE_PAD = 26;
  const MIN_GAP_RATIO = 0.32;
  const MIN_GAP_PX = 140;
  let FLOOR_W = 70;

  // Ask First (spec): vida total bajada respecto al modelo con núcleo del
  // prototipo original (60 solo en el núcleo) y respecto al "sin núcleo" sin
  // ajustar que auditó critical-review-2026-09-03.md (~260, 4-8x más largo).
  // Este valor es la hipótesis de partida para volver a apuntar a 2-3 min --
  // el criterio C3 del portón lo mide jugando, no a ciegas.
  const FLOOR_HP = { torreta: 30, muro: 35 };
  const FLOOR_H_MAX = 40;
  const FLOOR_H_MIN = 18;
  // Alto real de piso, recalculado en cada layout() segun la altura disponible.
  // Antes era fijo en 40 px: en un celular horizontal (~360 px de alto util)
  // la torre sola ocupaba el 56% de la pantalla y el HUD le caia encima.
  let FLOOR_H_CUR = FLOOR_H_MAX;

  // --- Bandas del HUD -----------------------------------------------------
  // El mundo (suelo, torres, gomeras) vive ENTRE estas dos bandas, nunca
  // debajo. Es la regla que evita las tres colisiones que aparecieron al
  // probar en celular: leyenda sobre la torre, barra de energia sobre la
  // torre, y botones de arma tapados por la barra del navegador.
  const HUD_TOP = 44;
  const HUD_BOTTOM = 60;
  // Sin rol 'nucleo' -- 5 pisos, alternando muro/torreta (hallazgo #2).
  const LAYOUT = ['muro', 'torreta', 'muro', 'torreta', 'muro'];

  const STARTING_ENERGY = 51;
  const WIND_MAX = 260; // px/s^2 -- viento por ronda, mismo signo para ambos lados (favorece a uno, perjudica al otro, como en Worms)
  const MUZZLE_HEIGHT_MIN = 0.42;
  const MUZZLE_HEIGHT_MAX = 0.78; // gomera con altura variable entre partidas (hallazgo #1)

  // --- P1: reparar -------------------------------------------------------
  // FR25: mismo costo que el arma Estándar, y comparte pool con el ataque
  // (FR26) -- "cada reparación es un ataque que no hiciste". El tope lo pone
  // la cicatriz permanente de duel2-tower.js, no un cooldown.
  const REPAIR_COST = 34;
  const REPAIR_AMOUNT = 14; // ~40% de un muro: repara de verdad, no lo deja nuevo
  // Como el costo es fijo, reparar un piso casi lleno es un mal negocio que el
  // jugador no puede anticipar (dia 1: 34 de energia por 3,9 de vida). En vez
  // de cobrarselo y que lo descubra despues, un piso solo se ofrece como
  // reparable cuando devuelve al menos esto. No cambia el balance de reparar:
  // saca del menu la opcion que nadie elegiria informado.
  const REPAIR_MIN_USEFUL = REPAIR_AMOUNT * 0.5;

  // --- P2: interceptar ---------------------------------------------------
  const INTERCEPT_WINDOW_MS = 400;  // ventana antes del impacto previsto
  const INTERCEPT_TAP_RADIUS = 40;  // qué tan cerca hay que tocar para acertar
  const INTERCEPT_TRY_RADIUS = 60;  // radio más generoso: cuenta como INTENTO aunque falle (criterio C4)
  const ETA_REFRESH_MS = 150;       // cada cuánto se recalcula el impacto previsto

  // --- P3: timeout + escalada temporal -----------------------------------
  const ROUND_LIMIT_MS = 180000;      // 3:00 duro (FR47)
  const ESCALATION_START_MS = 90000;  // 1:30 -- desde acá la regen acelera (FR23)
  const ESCALATION_MAX_MULT = 2.0;    // al llegar al límite, el doble de regen
  const BASE_REGEN = DF.Energy.DEFAULTS.regenPerSecond;

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  let playerTower, aiTower;
  let playerEnergy, aiEnergy;
  let playerMuzzle = { x: 0, y: 0 };
  let aiMuzzle = { x: 0, y: 0 };
  let groundY = 0;
  let projectiles = [];
  const aiController = DF.AI.createAI();
  const state = { phase: 'playing', winner: null };
  let input = null;
  let lastT = null;
  let wind = 0;
  let muzzleHeightFactor = 0.6;
  let currentWeaponKey = 'estandar';
  let roundStartMs = 0;
  let weaponButtons = [];
  let particles = [];
  let shakeMag = 0;
  let playerWasDestroyed = false;
  let aiWasDestroyed = false;
  let viewW = 800, viewH = 450; // tamano VISIBLE en px CSS (no el backing store)
  let duelIndex = 0;
  let duelLogged = false; // evita registrar dos veces el fin del mismo duelo
  let started = false;

  function triggerShake(mag) {
    shakeMag = Math.max(shakeMag, mag);
  }

  function materialRGB(floor) {
    // mismos colores que MATERIAL_COLOR/torreta, pero como r,g,b para las
    // partículas (que necesitan variar la alpha por separado).
    if (floor.role === 'torreta') return { r: 209, g: 82, b: 31 };
    const hex = DF.Weapons.MATERIAL_COLOR[floor.material] || '#e8a23a';
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  }

  function spawnImpactParticles(x, y, rgb, count) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 180;
      particles.push({
        x: x, y: y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 60,
        life: 0.35 + Math.random() * 0.25, maxLife: 0.6, size: 2 + Math.random() * 3,
        r: rgb.r, g: rgb.g, b: rgb.b
      });
    }
  }

  function spawnExplosionParticles(x, y) {
    for (let i = 0; i < 26; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 90 + Math.random() * 260;
      const warm = Math.random() < 0.6;
      particles.push({
        x: x, y: y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 140,
        life: 0.5 + Math.random() * 0.5, maxLife: 1.0, size: 3 + Math.random() * 5,
        r: warm ? 255 : 90, g: warm ? 150 + Math.random() * 80 : 80, b: warm ? 60 : 70
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 500 * dt; // gravedad liviana, no la real del proyectil -- solo "peso" visual
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function randomMaterial() {
    const list = DF.Weapons.MATERIALS;
    return list[Math.floor(Math.random() * list.length)];
  }

  function buildFloors() {
    return LAYOUT.map(function (r) {
      return {
        role: r,
        material: r === 'muro' ? randomMaterial() : null,
        maxHp: FLOOR_HP[r],
        width: FLOOR_W,
        height: FLOOR_H_CUR
      };
    });
  }

  function buildTowers() {
    playerTower = DF.Tower2.createTower({ floors: buildFloors(), originX: 0, groundY: 0 });
    aiTower = DF.Tower2.createTower({ floors: buildFloors(), originX: 0, groundY: 0 });
  }

  function towerHeight() {
    return LAYOUT.length * FLOOR_H_CUR;
  }

  // Tamano realmente VISIBLE. En mobile `window.innerHeight` incluye la franja
  // que tapan las barras del navegador, asi que la parte de abajo del juego
  // quedaba dibujada debajo de la barra de navegacion y no se veia.
  // `visualViewport` da el area visible de verdad.
  function viewportSize() {
    const vv = window.visualViewport;
    return {
      w: Math.max(320, Math.round(vv ? vv.width : window.innerWidth)),
      h: Math.max(240, Math.round(vv ? vv.height : window.innerHeight))
    };
  }

  function layout() {
    const vp = viewportSize();
    viewW = vp.w;
    viewH = vp.h;

    // Backing store en pixeles fisicos y transform por devicePixelRatio: en un
    // celular de pantalla densa, dibujar 1:1 se veia borroso -- y el prototipo
    // existe justamente para juzgar como se ve y se siente.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // El suelo se apoya sobre la banda inferior del HUD, no en un % fijo de la
    // altura: asi el mundo nunca invade el espacio de los botones.
    groundY = viewH - HUD_BOTTOM - 4;

    // La torre se escala para entrar en la banda jugable con aire arriba.
    const availH = groundY - HUD_TOP;
    FLOOR_H_CUR = Math.max(FLOOR_H_MIN, Math.min(FLOOR_H_MAX,
      Math.floor((availH * 0.70) / LAYOUT.length)));

    const margin = Math.round(viewW * MARGIN_RATIO);
    const minGap = Math.max(viewW * MIN_GAP_RATIO, MIN_GAP_PX);
    const widthBudget = (viewW - 2 * margin - 2 * MUZZLE_PAD - minGap) / 2;
    FLOOR_W = Math.max(FLOOR_W_MIN, Math.min(FLOOR_W_MAX, widthBudget));

    for (const f of playerTower.floors) { f.width = FLOOR_W; f.height = FLOOR_H_CUR; }
    for (const f of aiTower.floors) { f.width = FLOOR_W; f.height = FLOOR_H_CUR; }

    playerTower.originX = margin;
    playerTower.groundY = groundY;
    aiTower.originX = viewW - margin - FLOOR_W;
    aiTower.groundY = groundY;
    DF.Tower2.layoutTower(playerTower);
    DF.Tower2.layoutTower(aiTower);
    for (const f of playerTower.floors) f.renderY = f.y;
    for (const f of aiTower.floors) f.renderY = f.y;

    const th = towerHeight();
    playerMuzzle = { x: playerTower.originX + FLOOR_W + MUZZLE_PAD, y: groundY - th * muzzleHeightFactor };
    aiMuzzle = { x: aiTower.originX - MUZZLE_PAD, y: groundY - th * muzzleHeightFactor };

    const bw = 42, bh = 26, gap = 5;
    weaponButtons = DF.Weapons.ORDER.map(function (key, i) {
      return { key: key, x: 12 + i * (bw + gap), y: viewH - 30, w: bw, h: bh };
    });
  }

  function spawnProjectile(x, y, vx, vy, owner, weaponKey) {
    projectiles.push({
      x: x, y: y, vx: vx, vy: vy, owner: owner, weaponKey: weaponKey,
      impactEtaMs: Infinity, etaFullAt: 0, etaTickAt: 0, interceptable: false, tellPlayed: false
    });
  }

  function canShootWeapon(energy, weaponKey) {
    return energy.value >= DF.Weapons.WEAPONS[weaponKey].cost;
  }

  function spendWeapon(energy, weaponKey) {
    energy.value = Math.max(0, energy.value - DF.Weapons.WEAPONS[weaponKey].cost);
  }

  // --- P2: predicción de impacto -----------------------------------------
  // Simula el proyectil hacia adelante con el MISMO integrador que usa el
  // vuelo real, para saber cuántos ms faltan para el impacto. Es lo que
  // define la ventana de intercepción. Se recalcula cada ETA_REFRESH_MS y no
  // cada frame: la torre objetivo puede cambiar de forma (un piso colapsa) y
  // la predicción tiene que seguirla, pero 480 pasos por proyectil cada
  // frame sería tirar CPU al pedo con 1-2 proyectiles en vuelo.
  function predictImpactMs(p, targetTower) {
    const dt = 1 / 120;
    const sim = { x: p.x, y: p.y, vx: p.vx, vy: p.vy };
    for (let i = 0; i < 480; i++) {
      sim.vy += GRAVITY * dt;
      sim.vx += wind * dt;
      sim.x += sim.vx * dt;
      sim.y += sim.vy * dt;
      if (DF.Tower2.findHitFloor(targetTower, sim.x, sim.y, DF.TowerProjectile2.RADIUS)) {
        return i * dt * 1000;
      }
      if (sim.x < -50 || sim.x > viewW + 50 || sim.y > groundY + 50) return Infinity;
    }
    return Infinity;
  }

  function updateInterceptWindows(nowMs) {
    for (const p of projectiles) {
      if (p.owner !== 'ai') continue; // solo los del rival se interceptan
      // Dos relojes distintos a propósito: `etaFullAt` marca el último
      // recálculo completo (cada ETA_REFRESH_MS) y `etaTickAt` el último
      // frame. Con un solo campo, actualizarlo en la interpolación hacía que
      // la condición de recálculo no se cumpliera nunca más.
      if (nowMs - p.etaFullAt >= ETA_REFRESH_MS) {
        p.impactEtaMs = predictImpactMs(p, playerTower);
        p.etaFullAt = nowMs;
        p.etaTickAt = nowMs;
      } else if (isFinite(p.impactEtaMs)) {
        p.impactEtaMs -= (nowMs - p.etaTickAt); // interpolación entre recálculos
        p.etaTickAt = nowMs;
      }
      const nowInterceptable = isFinite(p.impactEtaMs) && p.impactEtaMs <= INTERCEPT_WINDOW_MS;
      if (nowInterceptable && !p.tellPlayed) {
        // El tell suena UNA vez, al entrar en ventana. Es la mitad auditiva
        // del tell multimodal: la ventana ocurre del lado de tu pulgar.
        DF.Sfx.playInterceptReady();
        p.tellPlayed = true;
      }
      p.interceptable = nowInterceptable;
    }
  }

  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      const targetTower = p.owner === 'player' ? aiTower : playerTower;
      const result = DF.TowerProjectile2.updateProjectileVsTower(p, dt, {
        gravity: GRAVITY, wind: wind, targetTower: targetTower,
        bounds: { width: viewW, height: viewH }, groundY: groundY, refSize: FLOOR_H_CUR
      });
      if (result.hit) {
        const now = performance.now();
        const objetivoEsJugador = p.owner === 'ai';
        const hitX = p.x, hitY = p.y;
        const dmg = DF.Weapons.computeDamage(p.weaponKey, result.floor);
        DF.Tower2.applyDamage(targetTower, result.floor, dmg, now);
        if (DF.Weapons.WEAPONS[p.weaponKey].splash) {
          DF.Tower2.applySplash(targetTower, result.floor, dmg * 0.4, now);
        }
        result.floor.hitFlashAt = now;
        const strength = Math.min(1, dmg / 30);
        spawnImpactParticles(hitX, hitY, materialRGB(result.floor), 7 + Math.round(strength * 6));
        DF.Sfx.playThud(strength);
        triggerShake(3 + strength * 7);
        if (objetivoEsJugador) logAiShot(p.weaponKey, true, result.floor);
        else logShot(p.weaponKey, true, result.floor);
        projectiles.splice(i, 1);
      } else if (result.outOfBounds) {
        if (p.owner === 'ai') logAiShot(p.weaponKey, false, null);
        else logShot(p.weaponKey, false, null);
        projectiles.splice(i, 1);
      }
    }
  }

  function logShot(weaponKey, hit, floor) {
    DF.Telemetry.log('shot', {
      duelIndex: duelIndex,
      weapon: weaponKey,
      costo: DF.Weapons.WEAPONS[weaponKey].cost,
      hit: hit,
      materialObjetivo: floor ? (floor.material || floor.role) : null,
      pisoImpactado: floor ? aiTower.floors.indexOf(floor) : null // 0 = piso de abajo
    });
  }

  // Los disparos de la IA van en su propio tipo de evento, no en `shot`: si
  // se mezclaran, contaminarian B1 (diversidad de armas) y B2 (punteria), que
  // miden al JUGADOR. Se registran porque el dia 1 dejo una pregunta sin
  // responder -- los duelos duraron 70 s y se ganaron con 54% y 79% de vida
  // propia, y sin este dato no se puede saber si la IA es un rival de verdad
  // o si simplemente no llega a disparar.
  function logAiShot(weaponKey, hit, floor) {
    DF.Telemetry.log('ai_shot', {
      duelIndex: duelIndex,
      weapon: weaponKey,
      costo: DF.Weapons.WEAPONS[weaponKey].cost,
      hit: hit,
      materialObjetivo: floor ? (floor.material || floor.role) : null
    });
  }

  function randomAliveFloor(tower) {
    const alive = tower.floors.filter(function (f) { return f.alive && !f.collapsing; });
    if (!alive.length) return null;
    return alive[Math.floor(Math.random() * alive.length)];
  }

  function floorCenter(tower, floor) {
    return { x: tower.originX + floor.width / 2, y: floor.y + floor.height / 2 };
  }

  // --- P3: escalada temporal de regeneración (FR23) ----------------------
  // Igual para ambos bandos, a propósito: no es una ventaja, es un acelerador
  // de la partida. Existe para que el duelo se resuelva por destrucción y el
  // timeout sea la excepción -- que es exactamente lo que mide el criterio C2.
  function regenMultiplier(elapsedMs) {
    if (elapsedMs <= ESCALATION_START_MS) return 1;
    const t = Math.min(1, (elapsedMs - ESCALATION_START_MS) / (ROUND_LIMIT_MS - ESCALATION_START_MS));
    return 1 + (ESCALATION_MAX_MULT - 1) * t;
  }

  function endRound(motivo, winner) {
    if (state.phase === 'roundover') return;
    state.phase = 'roundover';
    state.winner = winner;
    projectiles = [];
    if (!duelLogged) {
      duelLogged = true;
      DF.Telemetry.log('duel_end', {
        duelIndex: duelIndex,
        motivo: motivo,
        duracionMs: Math.round(performance.now() - roundStartMs),
        ganador: winner,
        hpPctPropio: +DF.Tower2.totalHpPercent(playerTower).toFixed(3),
        hpPctRival: +DF.Tower2.totalHpPercent(aiTower).toFixed(3)
      });
      DF.Telemetry.countDuel();
    }
  }

  function checkRoundEnd() {
    if (playerTower.destroyed && aiTower.destroyed) { endRound('destruction', 'draw'); return; }
    if (playerTower.destroyed) { endRound('destruction', 'ai'); return; }
    if (aiTower.destroyed) { endRound('destruction', 'player'); return; }

    const elapsed = performance.now() - roundStartMs;
    if (elapsed >= ROUND_LIMIT_MS) {
      endRound('timeout', timeoutWinner(
        DF.Tower2.totalHpPercent(playerTower),
        DF.Tower2.totalHpPercent(aiTower)
      ));
    }
  }

  // Resolución por timeout (FR47): gana quien conserva más % de su vida
  // ORIGINAL -- o sea, quien bajó menos. Empate si están a menos de medio
  // punto porcentual, para que un empate real no lo decida el redondeo.
  function timeoutWinner(playerPct, aiPct) {
    if (Math.abs(playerPct - aiPct) < 0.005) return 'draw';
    return playerPct > aiPct ? 'player' : 'ai';
  }

  // Abandono (criterio A3): irse a mitad de un duelo. No hay botón de
  // "abandonar" -- la señal honesta es guardar el teléfono con el duelo
  // empezado, así que se escucha el evento de la pestaña yéndose a segundo
  // plano. Solo cuenta pasados 10s, para no marcar como abandono el reflejo
  // de mirar una notificación apenas arranca.
  function onHidden() {
    if (state.phase !== 'playing' || duelLogged) return;
    if (performance.now() - roundStartMs < 10000) return;
    duelLogged = true;
    DF.Telemetry.log('duel_end', {
      duelIndex: duelIndex,
      motivo: 'abandon',
      duracionMs: Math.round(performance.now() - roundStartMs),
      ganador: null,
      hpPctPropio: +DF.Tower2.totalHpPercent(playerTower).toFixed(3),
      hpPctRival: +DF.Tower2.totalHpPercent(aiTower).toFixed(3)
    });
    DF.Telemetry.countDuel();
  }

  function resetGame() {
    wind = (Math.random() * 2 - 1) * WIND_MAX;
    muzzleHeightFactor = MUZZLE_HEIGHT_MIN + Math.random() * (MUZZLE_HEIGHT_MAX - MUZZLE_HEIGHT_MIN);
    buildTowers();
    layout();
    playerEnergy = DF.Energy.createEnergy({ value: STARTING_ENERGY });
    aiEnergy = DF.Energy.createEnergy({ value: 0 });
    projectiles = [];
    particles = [];
    shakeMag = 0;
    playerWasDestroyed = false;
    aiWasDestroyed = false;
    state.phase = 'playing';
    state.winner = null;
    roundStartMs = performance.now();
    duelIndex = DF.Telemetry.nextDuelIndex();
    duelLogged = false;
    DF.Telemetry.log('duel_start', {
      duelIndex: duelIndex,
      preset: LAYOUT.join('-'),
      wind: Math.round(wind),
      muzzleHeight: +muzzleHeightFactor.toFixed(3),
      materialesPropios: playerTower.floors.map(function (f) { return f.material || f.role; }),
      materialesRival: aiTower.floors.map(function (f) { return f.material || f.role; })
    });
  }

  function hitWeaponButton(x, y) {
    for (const b of weaponButtons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.key;
    }
    return null;
  }

  // --- P2: intento de intercepción ---------------------------------------
  // Devuelve true si el toque se consumió como intento (acertado o no).
  function tryIntercept(x, y) {
    let best = null, bestD = Infinity;
    for (const p of projectiles) {
      if (p.owner !== 'ai') continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best || bestD > INTERCEPT_TRY_RADIUS) return false;

    const success = best.interceptable && bestD <= INTERCEPT_TAP_RADIUS;
    DF.Telemetry.log('intercept_try', {
      duelIndex: duelIndex,
      success: success,
      msAntesDeImpacto: isFinite(best.impactEtaMs) ? Math.round(best.impactEtaMs) : null,
      distanciaPx: Math.round(bestD)
    });
    if (success) {
      // Sin costo de energía (FR30): el límite es el costo de atención, no el pool.
      spawnImpactParticles(best.x, best.y, { r: 255, g: 210, b: 63 }, 14);
      DF.Sfx.playIntercept();
      triggerShake(4);
      projectiles.splice(projectiles.indexOf(best), 1);
    }
    return true;
  }

  // Unico criterio de "este piso se puede reparar y vale la pena". Lo usan
  // la pista verde, el aviso de onboarding y el toque, para que lo que se
  // ofrece y lo que se cobra no puedan discrepar nunca.
  function valeReparar(floor) {
    return DF.Tower2.repairableAmount(floor) >= REPAIR_MIN_USEFUL;
  }

  // --- P1: reparar -------------------------------------------------------
  // Devuelve true si el toque se consumió.
  function tryRepair(x, y) {
    // El radio de agarre de la gomera GANA sobre reparar: dentro de esos 60px
    // el toque tiene que poder empezar un arrastre, si no el disparo se vuelve
    // impredecible cerca de la torre. Regla explícita, no accidente (FR32).
    if (Math.hypot(x - playerMuzzle.x, y - playerMuzzle.y) <= DF.Input.MUZZLE_GRAB_RADIUS) return false;

    const floor = DF.Tower2.findHitFloor(playerTower, x, y, 10);
    if (!floor) return false;
    if (DF.Tower2.repairableAmount(floor) < REPAIR_MIN_USEFUL) return false;
    if (playerEnergy.value < REPAIR_COST) {
      DF.Energy.flagInsufficient(playerEnergy, performance.now() / 1000);
      return true;
    }
    const healed = DF.Tower2.repairFloor(playerTower, floor, REPAIR_AMOUNT);
    if (healed <= 0) return false; // no cobrar por un toque que no hizo nada
    playerEnergy.value = Math.max(0, playerEnergy.value - REPAIR_COST);
    floor.repairFlashAt = performance.now();
    DF.Sfx.playRepair();
    DF.Telemetry.log('repair', {
      duelIndex: duelIndex,
      energia: REPAIR_COST,
      curado: +healed.toFixed(1),
      material: floor.material || floor.role,
      techoRestantePct: +(floor.repairCeiling / floor.maxHp).toFixed(3)
    });
    return true;
  }

  function setupInput() {
    // Router de gestos (FR32). Registrado ANTES de DF.Input para que un toque
    // sobre HUD / proyectil rival / piso propio nunca se lea como el arrastre
    // de disparo (stopImmediatePropagation corta el segundo listener sobre el
    // mismo canvas/evento). Orden deliberado: HUD > interceptar > reparar >
    // arrastrar. Interceptar va antes que reparar porque es sensible al
    // tiempo -- perder la ventana por 80ms lo vuelve inservible.
    canvas.addEventListener('pointerdown', function (evt) {
      const rect = canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left, y = evt.clientY - rect.top;
      DF.Sfx.unlock(); // primer gesto real del usuario -- desbloquea audio

      if (state.phase !== 'playing') return;

      const key = hitWeaponButton(x, y);
      if (key) {
        if (key !== currentWeaponKey) {
          DF.Telemetry.log('weapon_switch', { duelIndex: duelIndex, from: currentWeaponKey, to: key });
        }
        currentWeaponKey = key;
        evt.preventDefault();
        evt.stopImmediatePropagation();
        return;
      }
      if (tryIntercept(x, y)) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
        return;
      }
      if (tryRepair(x, y)) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
      }
    }, { passive: false });

    window.addEventListener('keydown', function (evt) {
      const found = DF.Weapons.ORDER.find(function (k) { return DF.Weapons.WEAPONS[k].key === evt.key; });
      if (found) {
        if (found !== currentWeaponKey) {
          DF.Telemetry.log('weapon_switch', { duelIndex: duelIndex, from: currentWeaponKey, to: found });
        }
        currentWeaponKey = found;
      }
    });

    input = DF.Input.createInputController(canvas, {
      getMuzzle: function () { return playerMuzzle; },
      isPlaying: function () { return state.phase === 'playing'; },
      canShoot: function () { return canShootWeapon(playerEnergy, currentWeaponKey); },
      onFire: function (vx, vy) {
        const w = DF.Weapons.WEAPONS[currentWeaponKey];
        spendWeapon(playerEnergy, currentWeaponKey);
        spawnProjectile(playerMuzzle.x, playerMuzzle.y, vx * w.speedMul, vy * w.speedMul, 'player', currentWeaponKey);
        DF.Sfx.playShot();
      },
      onInsufficientEnergy: function () {
        DF.Energy.flagInsufficient(playerEnergy, performance.now() / 1000);
      }
    });
    canvas.addEventListener('pointerdown', function () {
      if (state.phase === 'roundover') resetGame();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') onHidden();
    });
    window.addEventListener('pagehide', onHidden);
  }

  function frame(ts) {
    if (lastT === null) lastT = ts;
    let dt = (ts - lastT) / 1000;
    lastT = ts;
    dt = Math.max(0, Math.min(dt, 0.033));

    if (state.phase === 'playing') {
      const elapsed = performance.now() - roundStartMs;
      const mult = regenMultiplier(elapsed);
      playerEnergy.regenPerSecond = BASE_REGEN * mult;
      aiEnergy.regenPerSecond = BASE_REGEN * mult;

      DF.Energy.updateEnergy(playerEnergy, dt);
      DF.Energy.updateEnergy(aiEnergy, dt);

      // La IA elige arma por material y ahora PAGA esa arma. Antes cobraba el
      // shotCost fijo de energy.js (34) disparara lo que disparara, así que su
      // cadencia real no tenía nada que ver con lo que elegía -- y el criterio
      // C3 mide justamente duración de duelo.
      const targetFloor = randomAliveFloor(playerTower);
      if (targetFloor) {
        const aiWeaponKey = DF.Weapons.bestWeaponAgainst(targetFloor);
        if (canShootWeapon(aiEnergy, aiWeaponKey)) {
          const target = floorCenter(playerTower, targetFloor);
          const w = DF.Weapons.WEAPONS[aiWeaponKey];
          const v = DF.AI.computeAimVelocity(aiController, aiMuzzle, target, GRAVITY);
          spendWeapon(aiEnergy, aiWeaponKey);
          spawnProjectile(aiMuzzle.x, aiMuzzle.y, v.vx * w.speedMul, v.vy * w.speedMul, 'ai', aiWeaponKey);
          DF.Sfx.playShot();
        }
      }

      updateProjectiles(dt);
      updateInterceptWindows(performance.now());
      DF.Tower2.updateCollapses(playerTower, performance.now());
      DF.Tower2.updateCollapses(aiTower, performance.now());
      if (playerTower.destroyed && !playerWasDestroyed) {
        playerWasDestroyed = true;
        spawnExplosionParticles(playerTower.originX + 35, playerTower.groundY);
        triggerShake(18);
        DF.Sfx.playExplosion();
      }
      if (aiTower.destroyed && !aiWasDestroyed) {
        aiWasDestroyed = true;
        spawnExplosionParticles(aiTower.originX + 35, aiTower.groundY);
        triggerShake(18);
        DF.Sfx.playExplosion();
      }
      checkRoundEnd();
    }

    updateParticles(dt);
    shakeMag = Math.max(0, shakeMag - 40 * dt);
    DF.TowerRender2.updateRenderPositions(playerTower, dt);
    DF.TowerRender2.updateRenderPositions(aiTower, dt);
    render();
    requestAnimationFrame(frame);
  }

  function render() {
    const now = performance.now();

    // Sacude solo el MUNDO (fondo/torres/proyectiles), nunca el HUD -- si el
    // HUD tiembla se vuelve ilegible justo cuando más importa (impacto grande).
    const sx = (Math.random() * 2 - 1) * shakeMag;
    const sy = (Math.random() * 2 - 1) * shakeMag * 0.6;
    ctx.save();
    ctx.translate(sx, sy);

    ctx.fillStyle = '#1d120b';
    ctx.fillRect(-20, -20, viewW + 40, viewH + 40);
    // Suelo neutro oscuro a propósito: despega las torres del cielo cálido.
    ctx.fillStyle = '#150f0b';
    ctx.fillRect(-20, groundY, viewW + 40, viewH - groundY + 20);
    ctx.strokeStyle = '#4a2a16';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-20, groundY); ctx.lineTo(viewW + 20, groundY); ctx.stroke();

    DF.TowerRender2.drawTower(ctx, playerTower, now);
    DF.TowerRender2.drawTower(ctx, aiTower, now);
    if (state.phase === 'playing') {
      DF.TowerRender2.drawRepairHints(ctx, playerTower, playerEnergy.value >= REPAIR_COST, now, valeReparar);
    }
    DF.TowerRender2.drawParticles(ctx, particles);
    DF.TowerRender2.drawProjectiles(ctx, projectiles, now);

    if (state.phase === 'playing' && !(input && input.isDragging())) {
      DF.Render.drawMuzzle(ctx, playerMuzzle, DF.Input.MUZZLE_GRAB_RADIUS);
    }
    if (input && input.isDragging()) {
      const preview = input.getDragPreview();
      const v = DF.Input.velocityFromDrag(preview.startX, preview.startY, preview.currentX, preview.currentY);
      if (v) {
        const w = DF.Weapons.WEAPONS[currentWeaponKey];
        const ok = canShootWeapon(playerEnergy, currentWeaponKey);
        DF.TowerRender2.drawAimArrow(ctx, preview.startX, preview.startY, v.vx * w.speedMul, v.vy * w.speedMul, DF.Input.SPEED_MAX * 1.4, ok);
      }
    }
    ctx.restore();

    // HUD: sin shake, siempre legible. Todo vive en las dos bandas reservadas
    // (HUD_TOP arriba, HUD_BOTTOM abajo) y nunca encima del mundo.
    DF.Render.drawEnergyBar(ctx, 12, viewH - 48, 120, 12, playerEnergy, 'Vos', 'left');
    // Corrida a la izquierda para no chocar con el boton HTML del panel de
    // sesion, que vive arriba a la derecha fuera del canvas.
    DF.Render.drawEnergyBar(ctx, viewW - 176, 20, 120, 12, aiEnergy, 'IA', 'right');
    drawWeaponButtons(ctx);
    drawWeaponInfo(ctx);
    drawMaterialLegend(ctx);
    drawWindIndicator(ctx);
    drawTimer(ctx, now);
    drawRepairTip(ctx);

    if (state.phase === 'roundover') {
      const text = state.winner === 'player' ? 'Ganaste' : state.winner === 'ai' ? 'Ganó la IA' : 'Empate';
      // drawBanner solo lee .width/.height -- se le pasa el viewport y no el
      // canvas, porque el canvas ahora esta en pixeles fisicos (DPR).
      DF.Render.drawBanner(ctx, { width: viewW, height: viewH }, text, 'Toca para jugar de nuevo');
    }
  }

  function drawWeaponButtons(ctx) {
    weaponButtons.forEach(function (b) {
      const w = DF.Weapons.WEAPONS[b.key];
      const active = b.key === currentWeaponKey;
      ctx.fillStyle = active ? DF.TowerRender2.UI.aim : 'rgba(255,255,255,0.12)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = active ? '#fff3c4' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = active ? '#241005' : '#e8ecff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(w.short, b.x + b.w / 2, b.y + 19);
    });
  }

  // Panel de info del arma seleccionada -- el usuario marcó que los botones
  // EST/PRE/PES/RAP no explicaban nada. Muestra nombre, costo, y a qué le
  // pega mejor/peor (calculado desde la matriz real, no un texto suelto).
  function drawWeaponInfo(ctx) {
    const w = DF.Weapons.WEAPONS[currentWeaponKey];
    const eff = DF.Weapons.effectivenessText(currentWeaponKey);
    const last = weaponButtons[weaponButtons.length - 1];
    const x = last ? last.x + last.w + 12 : 210;
    ctx.textAlign = 'left';
    ctx.fillStyle = DF.TowerRender2.UI.aim;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(w.label + ' · ' + w.cost + '⚡', x, viewH - 38);
    // El texto de sabor ("Generalista, arco medio") se cayo a proposito: en una
    // banda de 60 px es la linea que menos informa, y la efectividad
    // arma-vs-material es justo lo que el criterio B1 necesita que se lea.
    const parts = [eff.strong, eff.weak, eff.splash].filter(Boolean).join('   ');
    if (parts) {
      ctx.fillStyle = '#9fd6a0';
      ctx.font = '11px sans-serif';
      ctx.fillText(parts, x, viewH - 23);
    }
    // Reparar comparte el mismo pool y la misma puerta de gasto (FR26): se
    // muestra al lado del arma, no en otra parte de la pantalla, justamente
    // para que se lea como la alternativa al tiro que es.
    ctx.fillStyle = DF.TowerRender2.UI.repair;
    ctx.font = '11px sans-serif';
    ctx.fillText('Tocá un piso verde para reparar · ' + REPAIR_COST + '⚡', x, viewH - 8);
  }

  // Aviso de onboarding para reparar: solo en los dos primeros duelos y solo
  // mientras haya algo reparable. Si el jugador no sabe que reparar existe, el
  // criterio C1 mide desconocimiento en vez de balance -- pero dejarlo fijo en
  // pantalla seria ruido para siempre.
  function drawRepairTip(ctx) {
    if (state.phase !== 'playing' || duelIndex > 2) return;
    if (playerEnergy.value < REPAIR_COST) return;
    if (!playerTower.floors.some(valeReparar)) return;
    ctx.fillStyle = DF.TowerRender2.UI.repair;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Tocá un piso con borde verde para repararlo', viewW / 2, HUD_TOP + 22);
  }

  // Leyenda de materiales -- sin esto los colores de los muros son
  // decorativos y nadie sabe qué arma conviene contra cuál.
  // Fila HORIZONTAL en la banda superior. Antes era una columna en x=16,y=60,
  // que en celular horizontal caia justo encima de la torre del jugador.
  function drawMaterialLegend(ctx) {
    const corto = viewW < 700;
    let x = 12;
    const y = 10;
    ctx.textAlign = 'left';
    ctx.font = '11px sans-serif';
    DF.Weapons.MATERIALS.forEach(function (m) {
      ctx.fillStyle = DF.Weapons.MATERIAL_COLOR[m];
      ctx.fillRect(x, y, 12, 12);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, 12, 12);
      const label = corto ? DF.Weapons.MATERIAL_LABEL[m].slice(0, 3) : DF.Weapons.MATERIAL_LABEL[m];
      ctx.fillStyle = '#c9bda8';
      ctx.fillText(label, x + 16, y + 10);
      x += 16 + ctx.measureText(label).width + 12;
    });
  }

  function drawWindIndicator(ctx) {
    const arrow = wind >= 0 ? '→' : '←';
    ctx.fillStyle = '#c9bda8';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Viento ' + arrow + ' ' + Math.abs(wind).toFixed(0), viewW / 2, 18);
  }

  // Cuenta REGRESIVA, no cronómetro: si el jugador no ve cuánto falta, el
  // timeout llega como una sorpresa y la escalada de energía no se lee como
  // parte de un arco. Se pone en ámbar al entrar la escalada y en rojo en los
  // últimos 30s.
  function drawTimer(ctx, nowMs) {
    const elapsed = Math.max(0, nowMs - roundStartMs);
    const left = Math.max(0, ROUND_LIMIT_MS - elapsed);
    const secs = Math.ceil(left / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    const escalando = elapsed >= ESCALATION_START_MS;
    ctx.fillStyle = left <= 30000 ? '#ff5a6e' : (escalando ? DF.TowerRender2.UI.aim : '#c9bda8');
    ctx.font = escalando ? 'bold 15px sans-serif' : '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(m + ':' + (s < 10 ? '0' : '') + s, viewW / 2, 36);
    if (escalando && state.phase === 'playing') {
      ctx.font = '10px sans-serif';
      ctx.fillText('⚡ energía acelerada', viewW / 2, HUD_TOP + 8);
    }
  }

  function onResize() { layout(); }

  // Arranca de verdad. Se llama desde la pantalla de inicio de sesión
  // (tower-proto-v2.html), no al cargar: el portón necesita saber si abriste
  // por ganas o por obligación ANTES de que juegues (criterio A1).
  function start() {
    if (started) return;
    started = true;
    resetGame();
    setupInput();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    // En mobile, mostrar/ocultar las barras del navegador cambia el area
    // visible SIN disparar un `resize` de window. Sin esto, al colapsarse la
    // barra el juego seguia dibujando contra el alto viejo y la banda inferior
    // del HUD quedaba fuera de pantalla.
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize);
      window.visualViewport.addEventListener('scroll', onResize);
    }
    requestAnimationFrame(frame);
  }

  DF.TowerMain2 = {
    start: start,
    _debugSnapshot: function () {
      return {
        phase: state.phase, winner: state.winner,
        playerAlive: DF.Tower2.countAliveFloors(playerTower), aiAlive: DF.Tower2.countAliveFloors(aiTower),
        playerHpPct: DF.Tower2.totalHpPercent(playerTower), aiHpPct: DF.Tower2.totalHpPercent(aiTower),
        projectileCount: projectiles.length, playerMuzzle: playerMuzzle, aiMuzzle: aiMuzzle,
        wind: wind, muzzleHeightFactor: muzzleHeightFactor, currentWeaponKey: currentWeaponKey,
        elapsedSec: (performance.now() - roundStartMs) / 1000,
        regenMult: regenMultiplier(performance.now() - roundStartMs),
        duelIndex: duelIndex,
        interceptables: projectiles.filter(function (p) { return p.interceptable; }).length
      };
    },
    // Expuesto para poder probar las funciones puras y el router de gestos sin
    // depender del loop de render (que el navegador pausa en pestaña oculta).
    _internals: {
      regenMultiplier: regenMultiplier,
      timeoutWinner: timeoutWinner,
      predictImpactMs: function (p) { return predictImpactMs(p, playerTower); },
      towers: function () { return { player: playerTower, ai: aiTower }; },
      energies: function () { return { player: playerEnergy, ai: aiEnergy }; },
      projectiles: function () { return projectiles; },
      state: function () { return state; }
    }
  };
})(window.DF = window.DF || {});

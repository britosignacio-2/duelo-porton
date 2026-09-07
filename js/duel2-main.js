// duel2-main.js -- loop del prototipo de varianza.
//
// ITERACION 1 (2026-09-06). La iteracion 0 se jugo y dejo ocho hallazgos; este
// archivo implementa los que viven en el loop. El diagnostico completo esta en
// el encabezado de duel2-weapons.js, pero el resumen es:
//
//   El jugador uso un arma en 19 disparos seguidos contra el material donde
//   era la PEOR opcion, y gano comodo. Dos causas, las dos atacadas aca:
//   (a) las armas se diferenciaban en escalares, no en como se mueven ->
//       seis arquetipos de movimiento (duel2-projectile.js);
//   (b) el juego nunca te decia que estabas pegando mal -> el feedback de
//       impacto ahora escala con la CALIDAD del matchup, no solo con el daño.
//
// Ademas: cadencia separada del costo (antes el arma barata se podia
// spamear), aviso previo de la IA (antes el rival era clima), carga de la
// gomera (antes soltabas y aparecia un proyectil) y pago de la victoria.
(function (DF) {
  'use strict';

  const GRAVITY = 1400;
  const FLOOR_W_MIN = 46;
  const FLOOR_W_MAX = 90;
  const MARGIN_RATIO = 0.06;
  const MUZZLE_PAD = 30;
  const MIN_GAP_RATIO = 0.32;
  const MIN_GAP_PX = 140;
  let FLOOR_W = 70;

  const FLOOR_HP = { torreta: 30, muro: 35 };
  const FLOOR_H_MAX = 40;
  const FLOOR_H_MIN = 18;
  let FLOOR_H_CUR = FLOOR_H_MAX;

  // El mundo vive ENTRE estas dos bandas, nunca debajo.
  const HUD_TOP = 44;
  const HUD_BOTTOM = 62;

  const LAYOUT = ['muro', 'torreta', 'muro', 'torreta', 'muro'];

  const STARTING_ENERGY = 51;
  const WIND_MAX = 260;
  const MUZZLE_HEIGHT_MIN = 0.42;
  const MUZZLE_HEIGHT_MAX = 0.78;

  const REPAIR_COST = 34;
  const REPAIR_AMOUNT = 14;
  const REPAIR_MIN_USEFUL = REPAIR_AMOUNT * 0.5;

  const INTERCEPT_WINDOW_MS = 400;
  const INTERCEPT_TAP_RADIUS = 40;
  const INTERCEPT_TRY_RADIUS = 60;
  const ETA_REFRESH_MS = 150;

  const ROUND_LIMIT_MS = 180000;
  const ESCALATION_START_MS = 90000;
  const ESCALATION_MAX_MULT = 2.0;
  const BASE_REGEN = DF.Energy.DEFAULTS.regenPerSecond;

  // La IA telegrafia el disparo antes de soltarlo. Sin esto el rival no se
  // lee: le llueven proyectiles al jugador como si fuera clima.
  const AI_TELL_MS = 480;

  // Cuanto espera el banner tras terminar el duelo, para que el colapso final
  // se pueda disfrutar en vez de taparlo con un cartel de texto.
  const BANNER_DELAY_MS = 900;

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  let playerTower, aiTower;
  let playerEnergy, aiEnergy;
  let playerMuzzle = { x: 0, y: 0 };
  let aiMuzzle = { x: 0, y: 0 };
  let groundY = 0;
  let projectiles = [];
  const aiController = DF.AI.createAI();
  const state = { phase: 'playing', winner: null, roundoverAt: 0 };
  let input = null;
  let lastT = null;
  let wind = 0;
  let muzzleHeightFactor = 0.6;
  let currentWeaponKey = 'piedra';
  let roundStartMs = 0;
  let weaponButtons = [];
  let particles = [];
  let hitMarks = [];
  let shakeMag = 0;
  let flashMag = 0;
  let playerWasDestroyed = false;
  let aiWasDestroyed = false;
  let viewW = 800, viewH = 450;
  let duelIndex = 0;
  let duelLogged = false;
  let started = false;
  // Cadencia por arma: separa el ritmo del costo. Antes el costo hacia los dos
  // trabajos y por eso el arma barata se podia disparar sin parar.
  let weaponReadyAt = {};
  let aiPending = null;   // { at, weaponKey, target }
  let lastStretchStep = -1;
  let previewPoints = null;

  function triggerShake(mag) { shakeMag = Math.max(shakeMag, mag); }

  function materialRGB(floor) {
    if (floor.role === 'torreta') return { r: 209, g: 82, b: 31 };
    const hex = DF.Weapons.MATERIAL_COLOR[floor.material] || '#e8a23a';
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  }

  function spawnImpactParticles(x, y, rgb, count, fuerza) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (40 + Math.random() * 150) * (0.5 + fuerza);
      particles.push({
        x: x, y: y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 60,
        life: 0.3 + Math.random() * 0.3, maxLife: 0.6, size: 1.5 + Math.random() * 3 * (0.5 + fuerza),
        r: rgb.r, g: rgb.g, b: rgb.b
      });
    }
  }

  function spawnExplosionParticles(x, y) {
    for (let i = 0; i < 34; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 90 + Math.random() * 300;
      const calido = Math.random() < 0.6;
      particles.push({
        x: x, y: y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 150,
        life: 0.5 + Math.random() * 0.6, maxLife: 1.1, size: 3 + Math.random() * 5,
        r: calido ? 255 : 90, g: calido ? 150 + Math.random() * 80 : 80, b: calido ? 60 : 70
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 500 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    const ahora = performance.now();
    hitMarks = hitMarks.filter(function (m) { return ahora - m.at < m.duracion; });
  }

  function randomMaterial() {
    const l = DF.Weapons.MATERIALS;
    return l[Math.floor(Math.random() * l.length)];
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

  function towerHeight() { return LAYOUT.length * FLOOR_H_CUR; }

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

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    groundY = viewH - HUD_BOTTOM - 4;
    const availH = groundY - HUD_TOP;
    FLOOR_H_CUR = Math.max(FLOOR_H_MIN, Math.min(FLOOR_H_MAX,
      Math.floor((availH * 0.70) / LAYOUT.length)));

    const margin = Math.round(viewW * MARGIN_RATIO);
    const minGap = Math.max(viewW * MIN_GAP_RATIO, MIN_GAP_PX);
    const budget = (viewW - 2 * margin - 2 * MUZZLE_PAD - minGap) / 2;
    FLOOR_W = Math.max(FLOOR_W_MIN, Math.min(FLOOR_W_MAX, budget));

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
    const my = groundY - th * muzzleHeightFactor;
    playerMuzzle.x = playerTower.originX + FLOOR_W + MUZZLE_PAD;
    playerMuzzle.y = my;
    aiMuzzle = { x: aiTower.originX - MUZZLE_PAD, y: my, disparoAt: aiMuzzle.disparoAt };

    // Seis botones: el ancho sale del espacio disponible, no de un fijo.
    const n = DF.Weapons.ORDER.length;
    const gap = 4;
    const anchoTotal = Math.min(viewW * 0.54, n * 46 + (n - 1) * gap);
    const bw = (anchoTotal - (n - 1) * gap) / n;
    weaponButtons = DF.Weapons.ORDER.map(function (key, i) {
      return { key: key, x: 10 + i * (bw + gap), y: viewH - 32, w: bw, h: 27 };
    });
  }

  function spawnProjectile(x, y, vx, vy, owner, weaponKey) {
    projectiles.push(DF.TowerProjectile2.createProjectile({
      x: x, y: y, vx: vx, vy: vy, owner: owner, weaponKey: weaponKey
    }));
  }

  function puedePagar(energy, weaponKey) {
    return energy.value >= DF.Weapons.WEAPONS[weaponKey].cost;
  }

  function enCooldown(weaponKey) {
    return performance.now() < (weaponReadyAt[weaponKey] || 0);
  }

  function cooldownRestante(weaponKey) {
    const w = DF.Weapons.WEAPONS[weaponKey];
    const falta = (weaponReadyAt[weaponKey] || 0) - performance.now();
    return Math.max(0, Math.min(1, falta / w.cooldownMs));
  }

  function puedeDisparar(energy, weaponKey) {
    return puedePagar(energy, weaponKey) && !enCooldown(weaponKey);
  }

  function gastar(energy, weaponKey) {
    const w = DF.Weapons.WEAPONS[weaponKey];
    energy.value = Math.max(0, energy.value - w.cost);
    weaponReadyAt[weaponKey] = performance.now() + w.cooldownMs;
  }

  // --- Impacto -------------------------------------------------------------

  function resolverImpacto(p, floor, targetTower, now) {
    const w = DF.Weapons.WEAPONS[p.weaponKey];
    const dmg = DF.Weapons.computeDamage(p.weaponKey, floor);
    const calidad = DF.Weapons.matchupQuality(p.weaponKey, floor);
    // El perforador pega mas flojo en el segundo piso que atraviesa.
    const factor = (p.golpeNumero > 1) ? (w['dañoAlSegundo'] || 0.55) : 1;
    const dmgFinal = dmg * factor;

    DF.Tower2.applyDamage(targetTower, floor, dmgFinal, now);
    if (w.splash) DF.Tower2.applySplash(targetTower, floor, dmgFinal * 0.4, now);

    floor.hitFlashAt = now;
    floor.hitFlashFuerza = calidad;

    // ESTE es el arreglo del hallazgo principal de la iteracion 0. Antes,
    // 8 de daño y 37 de daño se veian y sonaban identicos, asi que se podian
    // tirar 19 disparos con el arma equivocada sin enterarse. Ahora la
    // sacudida, las particulas, el sonido y el cartel escalan con la CALIDAD
    // del matchup: el juego te contradice cuando pegas mal.
    const fuerza = Math.min(1, dmgFinal / 30);
    const feel = DF.Weapons.MATERIAL_FEEL[floor.material] || { particulas: 1 };
    spawnImpactParticles(p.x, p.y, materialRGB(floor),
      Math.round((3 + calidad * 14) * feel.particulas), calidad);
    DF.Sfx.playThud(fuerza, floor.material, calidad);
    triggerShake(1 + calidad * 11);
    if (calidad > 0.72) flashMag = Math.max(flashMag, 0.18);

    hitMarks.push({
      x: p.x, y: p.y, at: now, duracion: 800, calidad: calidad,
      // El juicio ("¡SÓLIDO!" / "rebota…") solo se muestra si el arma tiene
      // identidad de material real. Si no, se muestra el numero: gritar "arma
      // equivocada" cuando estas haciendo el 83% del daño maximo entrena al
      // jugador a desconfiar del feedback.
      texto: DF.Weapons.daSenalDeMatchup(p.weaponKey)
        ? (calidad > 0.66 ? '¡SÓLIDO!' : calidad < 0.34 ? 'rebota…' : String(Math.round(dmgFinal)))
        : String(Math.round(dmgFinal))
    });
    return { dmg: dmgFinal, calidad: calidad };
  }

  function updateProjectiles(dt) {
    const nuevos = [];
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      const targetTower = p.owner === 'player' ? aiTower : playerTower;
      const r = DF.TowerProjectile2.updateProjectileVsTower(p, dt, {
        gravity: GRAVITY, wind: wind, targetTower: targetTower,
        bounds: { width: viewW, height: viewH }, groundY: groundY, refSize: FLOOR_H_CUR
      });

      if (r.hit) {
        const now = performance.now();
        p.golpeNumero = r.golpeNumero;
        const res = resolverImpacto(p, r.floor, targetTower, now);
        if (p.owner === 'player') logShot(p.weaponKey, true, r.floor, res.calidad);
        else logAiShot(p.weaponKey, true, r.floor);
        if (!r.sigue) projectiles.splice(i, 1);
      } else if (r.rebote) {
        DF.Sfx.playBounce();
        spawnImpactParticles(r.x, r.y, { r: 120, g: 100, b: 80 }, 5, 0.3);
      } else if (r.divide) {
        DF.Sfx.playSplit();
        DF.TowerProjectile2.splitCluster(p).forEach(function (f) { nuevos.push(f); });
        projectiles.splice(i, 1);
      } else if (r.outOfBounds) {
        if (r.explotaEnSuelo) {
          spawnImpactParticles(r.x, r.y, { r: 120, g: 100, b: 80 }, 8, 0.4);
          DF.Sfx.playBounce();
        }
        if (!p.esFragmento) {
          if (p.owner === 'player') logShot(p.weaponKey, false, null, null);
          else logAiShot(p.weaponKey, false, null);
        }
        projectiles.splice(i, 1);
      }
    }
    nuevos.forEach(function (f) { projectiles.push(f); });
  }

  function logShot(weaponKey, hit, floor, calidad) {
    DF.Telemetry.log('shot', {
      duelIndex: duelIndex,
      weapon: weaponKey,
      kind: DF.Weapons.WEAPONS[weaponKey].kind,
      costo: DF.Weapons.WEAPONS[weaponKey].cost,
      hit: hit,
      materialObjetivo: floor ? (floor.material || floor.role) : null,
      pisoImpactado: floor ? aiTower.floors.indexOf(floor) : null,
      // Calidad del matchup 0..1. Es el dato que dice si el jugador ESTA
      // ELIGIENDO bien el arma, no solo si acerto.
      calidad: (calidad === null || calidad === undefined) ? null : +calidad.toFixed(2)
    });
  }

  function logAiShot(weaponKey, hit, floor) {
    DF.Telemetry.log('ai_shot', {
      duelIndex: duelIndex, weapon: weaponKey,
      costo: DF.Weapons.WEAPONS[weaponKey].cost, hit: hit,
      materialObjetivo: floor ? (floor.material || floor.role) : null
    });
  }

  function randomAliveFloor(tower) {
    const vivos = tower.floors.filter(function (f) { return f.alive && !f.collapsing; });
    if (!vivos.length) return null;
    return vivos[Math.floor(Math.random() * vivos.length)];
  }

  function floorCenter(tower, floor) {
    return { x: tower.originX + floor.width / 2, y: floor.y + floor.height / 2 };
  }

  function regenMultiplier(elapsedMs) {
    if (elapsedMs <= ESCALATION_START_MS) return 1;
    const t = Math.min(1, (elapsedMs - ESCALATION_START_MS) / (ROUND_LIMIT_MS - ESCALATION_START_MS));
    return 1 + (ESCALATION_MAX_MULT - 1) * t;
  }

  function timeoutWinner(playerPct, aiPct) {
    if (Math.abs(playerPct - aiPct) < 0.005) return 'draw';
    return playerPct > aiPct ? 'player' : 'ai';
  }

  function endRound(motivo, winner) {
    if (state.phase === 'roundover') return;
    state.phase = 'roundover';
    state.winner = winner;
    state.roundoverAt = performance.now();
    projectiles = [];
    aiPending = null;
    DF.Sfx.playOutcome(winner === 'player');
    if (!duelLogged) {
      duelLogged = true;
      DF.Telemetry.log('duel_end', {
        duelIndex: duelIndex, motivo: motivo,
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
    if (performance.now() - roundStartMs >= ROUND_LIMIT_MS) {
      endRound('timeout', timeoutWinner(
        DF.Tower2.totalHpPercent(playerTower), DF.Tower2.totalHpPercent(aiTower)));
    }
  }

  function onHidden() {
    if (state.phase !== 'playing' || duelLogged) return;
    if (performance.now() - roundStartMs < 10000) return;
    duelLogged = true;
    DF.Telemetry.log('duel_end', {
      duelIndex: duelIndex, motivo: 'abandon',
      duracionMs: Math.round(performance.now() - roundStartMs), ganador: null,
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
    hitMarks = [];
    shakeMag = 0;
    flashMag = 0;
    weaponReadyAt = {};
    aiPending = null;
    playerWasDestroyed = false;
    aiWasDestroyed = false;
    state.phase = 'playing';
    state.winner = null;
    state.roundoverAt = 0;
    roundStartMs = performance.now();
    duelIndex = DF.Telemetry.nextDuelIndex();
    duelLogged = false;
    DF.Telemetry.log('duel_start', {
      duelIndex: duelIndex, preset: LAYOUT.join('-'),
      wind: Math.round(wind), muzzleHeight: +muzzleHeightFactor.toFixed(3),
      materialesPropios: playerTower.floors.map(function (f) { return f.material || f.role; }),
      materialesRival: aiTower.floors.map(function (f) { return f.material || f.role; })
    });
  }

  function hitWeaponButton(x, y) {
    for (const b of weaponButtons) {
      if (x >= b.x - 3 && x <= b.x + b.w + 3 && y >= b.y - 8 && y <= b.y + b.h + 8) return b.key;
    }
    return null;
  }

  function tryIntercept(x, y) {
    let best = null, bestD = Infinity;
    for (const p of projectiles) {
      if (p.owner !== 'ai') continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best || bestD > INTERCEPT_TRY_RADIUS) return false;
    const exito = best.interceptable && bestD <= INTERCEPT_TAP_RADIUS;
    DF.Telemetry.log('intercept_try', {
      duelIndex: duelIndex, success: exito,
      msAntesDeImpacto: isFinite(best.impactEtaMs) ? Math.round(best.impactEtaMs) : null,
      distanciaPx: Math.round(bestD)
    });
    if (exito) {
      spawnImpactParticles(best.x, best.y, { r: 255, g: 210, b: 63 }, 16, 0.8);
      DF.Sfx.playIntercept();
      triggerShake(5);
      hitMarks.push({ x: best.x, y: best.y, at: performance.now(), duracion: 700, calidad: 1, texto: '¡AL VUELO!' });
      projectiles.splice(projectiles.indexOf(best), 1);
    }
    return true;
  }

  function valeReparar(floor) {
    return DF.Tower2.repairableAmount(floor) >= REPAIR_MIN_USEFUL;
  }

  function tryRepair(x, y) {
    if (Math.hypot(x - playerMuzzle.x, y - playerMuzzle.y) <= DF.Input.MUZZLE_GRAB_RADIUS) return false;
    const floor = DF.Tower2.findHitFloor(playerTower, x, y, 10);
    if (!floor) return false;
    if (!valeReparar(floor)) return false;
    if (playerEnergy.value < REPAIR_COST) {
      DF.Energy.flagInsufficient(playerEnergy, performance.now() / 1000);
      return true;
    }
    const curado = DF.Tower2.repairFloor(playerTower, floor, REPAIR_AMOUNT);
    if (curado <= 0) return false;
    playerEnergy.value = Math.max(0, playerEnergy.value - REPAIR_COST);
    floor.repairFlashAt = performance.now();
    DF.Sfx.playRepair();
    hitMarks.push({
      x: playerTower.originX + floor.width / 2, y: floor.y,
      at: performance.now(), duracion: 700, calidad: 0.5, texto: '+' + Math.round(curado)
    });
    DF.Telemetry.log('repair', {
      duelIndex: duelIndex, energia: REPAIR_COST, curado: +curado.toFixed(1),
      material: floor.material || floor.role,
      techoRestantePct: +(floor.repairCeiling / floor.maxHp).toFixed(3)
    });
    return true;
  }

  // Previsualizacion: simula hacia adelante con el MISMO integrador del vuelo
  // real, sobre una copia. Solo para los arquetipos no intuitivos.
  function computePreview(vx, vy) {
    const w = DF.Weapons.WEAPONS[currentWeaponKey];
    if (!w.preview) return null;
    const sim = DF.TowerProjectile2.createProjectile({
      x: playerMuzzle.x, y: playerMuzzle.y, vx: vx, vy: vy,
      owner: 'player', weaponKey: currentWeaponKey
    });
    const pts = [{ x: sim.x, y: sim.y }];
    const dt = 1 / 60;
    for (let i = 0; i < 150; i++) {
      const r = DF.TowerProjectile2.updateProjectileVsTower(sim, dt, {
        gravity: GRAVITY, wind: wind, targetTower: aiTower,
        bounds: { width: viewW, height: viewH }, groundY: groundY, refSize: FLOOR_H_CUR
      });
      pts.push({ x: sim.x, y: sim.y });
      if (r.hit || r.outOfBounds) break;
      if (r.divide) break; // de ahi en mas se abre en tres: no se promete nada
    }
    return pts;
  }

  function setupInput() {
    // Router de gestos (FR32): HUD > interceptar > reparar > arrastrar.
    canvas.addEventListener('pointerdown', function (evt) {
      const rect = canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left, y = evt.clientY - rect.top;
      DF.Sfx.unlock();
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
      if (tryIntercept(x, y)) { evt.preventDefault(); evt.stopImmediatePropagation(); return; }
      if (tryRepair(x, y)) { evt.preventDefault(); evt.stopImmediatePropagation(); }
    }, { passive: false });

    window.addEventListener('keydown', function (evt) {
      const f = DF.Weapons.ORDER.find(function (k) { return DF.Weapons.WEAPONS[k].key === evt.key; });
      if (f && f !== currentWeaponKey) {
        DF.Telemetry.log('weapon_switch', { duelIndex: duelIndex, from: currentWeaponKey, to: f });
        currentWeaponKey = f;
      }
    });

    input = DF.Input.createInputController(canvas, {
      getMuzzle: function () { return playerMuzzle; },
      isPlaying: function () { return state.phase === 'playing'; },
      canShoot: function () { return puedeDisparar(playerEnergy, currentWeaponKey); },
      onFire: function (vx, vy) {
        const v = DF.TowerProjectile2.initialVelocity(currentWeaponKey, vx, vy);
        gastar(playerEnergy, currentWeaponKey);
        spawnProjectile(playerMuzzle.x, playerMuzzle.y, v.vx, v.vy, 'player', currentWeaponKey);
        DF.Sfx.playShot(currentWeaponKey);
        playerMuzzle.disparoAt = performance.now();
        lastStretchStep = -1;
        previewPoints = null;
      },
      onInsufficientEnergy: function () {
        DF.Energy.flagInsufficient(playerEnergy, performance.now() / 1000);
      }
    });

    canvas.addEventListener('pointerdown', function () {
      if (state.phase === 'roundover' && performance.now() - state.roundoverAt > BANNER_DELAY_MS) resetGame();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') onHidden();
    });
    window.addEventListener('pagehide', onHidden);
  }

  function predictImpactMs(p, targetTower) {
    const dt = 1 / 120;
    const sim = Object.assign({}, p, { estela: [], pisosGolpeados: (p.pisosGolpeados || []).slice() });
    for (let i = 0; i < 480; i++) {
      DF.TowerProjectile2.stepProjectile(sim, dt, GRAVITY, wind);
      if (DF.Tower2.findHitFloor(targetTower, sim.x, sim.y, DF.TowerProjectile2.RADIUS)) return i * dt * 1000;
      if (sim.x < -50 || sim.x > viewW + 50 || sim.y > groundY + 50) return Infinity;
    }
    return Infinity;
  }

  function updateInterceptWindows(nowMs) {
    for (const p of projectiles) {
      if (p.owner !== 'ai') continue;
      if (nowMs - p.etaFullAt >= ETA_REFRESH_MS) {
        p.impactEtaMs = predictImpactMs(p, playerTower);
        p.etaFullAt = nowMs;
        p.etaTickAt = nowMs;
      } else if (isFinite(p.impactEtaMs)) {
        p.impactEtaMs -= (nowMs - p.etaTickAt);
        p.etaTickAt = nowMs;
      }
      const ahora = isFinite(p.impactEtaMs) && p.impactEtaMs <= INTERCEPT_WINDOW_MS;
      if (ahora && !p.tellPlayed) { DF.Sfx.playInterceptReady(); p.tellPlayed = true; }
      p.interceptable = ahora;
    }
  }

  // La IA carga el disparo y recien despues lo suelta. El aviso dura
  // AI_TELL_MS y es visible (la gomera rival se tensa) y audible.
  function updateAI(nowMs) {
    if (aiPending) {
      if (nowMs - aiPending.at >= AI_TELL_MS) {
        const target = aiPending.target;
        if (target && target.alive && !target.collapsing) {
          const c = floorCenter(playerTower, target);
          const v0 = DF.AI.computeAimVelocity(aiController, aiMuzzle, c, GRAVITY);
          const v = DF.TowerProjectile2.initialVelocity(aiPending.weaponKey, v0.vx, v0.vy);
          gastar(aiEnergy, aiPending.weaponKey);
          spawnProjectile(aiMuzzle.x, aiMuzzle.y, v.vx, v.vy, 'ai', aiPending.weaponKey);
          DF.Sfx.playShot(aiPending.weaponKey);
          aiMuzzle.disparoAt = nowMs;
        }
        aiPending = null;
      }
      return;
    }
    const target = randomAliveFloor(playerTower);
    if (!target) return;
    const key = DF.Weapons.bestWeaponAgainst(target);
    if (!puedeDisparar(aiEnergy, key)) return;
    aiPending = { at: nowMs, weaponKey: key, target: target };
    DF.Sfx.playAiTell();
  }

  function frame(ts) {
    if (lastT === null) lastT = ts;
    let dt = (ts - lastT) / 1000;
    lastT = ts;
    dt = Math.max(0, Math.min(dt, 0.033));
    const now = performance.now();

    if (state.phase === 'playing') {
      const elapsed = now - roundStartMs;
      const mult = regenMultiplier(elapsed);
      playerEnergy.regenPerSecond = BASE_REGEN * mult;
      aiEnergy.regenPerSecond = BASE_REGEN * mult;
      DF.Energy.updateEnergy(playerEnergy, dt);
      DF.Energy.updateEnergy(aiEnergy, dt);

      updateAI(now);
      updateProjectiles(dt);
      updateInterceptWindows(now);
      DF.Tower2.updateCollapses(playerTower, now);
      DF.Tower2.updateCollapses(aiTower, now);

      if (playerTower.destroyed && !playerWasDestroyed) {
        playerWasDestroyed = true;
        spawnExplosionParticles(playerTower.originX + 35, playerTower.groundY);
        triggerShake(22); flashMag = 0.5;
        DF.Sfx.playExplosion();
      }
      if (aiTower.destroyed && !aiWasDestroyed) {
        aiWasDestroyed = true;
        spawnExplosionParticles(aiTower.originX + 35, aiTower.groundY);
        triggerShake(22); flashMag = 0.5;
        DF.Sfx.playExplosion();
      }
      checkRoundEnd();

      // Crujido del elastico mientras se estira, en escalones para que suene a
      // goma y no a zumbido continuo.
      if (input && input.isDragging()) {
        const pv = input.getDragPreview();
        const v = DF.Input.velocityFromDrag(pv.startX, pv.startY, pv.currentX, pv.currentY);
        if (v) {
          const pot = Math.min(1, Math.hypot(v.vx, v.vy) / DF.Input.SPEED_MAX);
          const paso = Math.floor(pot * 7);
          if (paso !== lastStretchStep) { lastStretchStep = paso; DF.Sfx.playStretch(pot); }
          const iv = DF.TowerProjectile2.initialVelocity(currentWeaponKey, v.vx, v.vy);
          previewPoints = computePreview(iv.vx, iv.vy);
        }
      } else {
        previewPoints = null;
        lastStretchStep = -1;
      }
    }

    updateParticles(dt);
    shakeMag = Math.max(0, shakeMag - 46 * dt);
    flashMag = Math.max(0, flashMag - 1.6 * dt);
    DF.TowerRender2.updateRenderPositions(playerTower, dt);
    DF.TowerRender2.updateRenderPositions(aiTower, dt);
    render(now);
    requestAnimationFrame(frame);
  }

  function dragState() {
    if (!input || !input.isDragging()) return null;
    const pv = input.getDragPreview();
    const v = DF.Input.velocityFromDrag(pv.startX, pv.startY, pv.currentX, pv.currentY);
    if (!v) return null;
    return {
      dx: pv.currentX - playerMuzzle.x,
      dy: pv.currentY - playerMuzzle.y,
      potencia: Math.min(1, Math.hypot(v.vx, v.vy) / DF.Input.SPEED_MAX),
      v: v
    };
  }

  function render(now) {
    const sx = (Math.random() * 2 - 1) * shakeMag;
    const sy = (Math.random() * 2 - 1) * shakeMag * 0.6;
    ctx.save();
    ctx.translate(sx, sy);

    DF.TowerRender2.drawArena(ctx, viewW, viewH, groundY);
    DF.TowerRender2.drawTower(ctx, playerTower, now);
    DF.TowerRender2.drawTower(ctx, aiTower, now);
    if (state.phase === 'playing') {
      DF.TowerRender2.drawRepairHints(ctx, playerTower, playerEnergy.value >= REPAIR_COST, now, valeReparar);
    }
    DF.TowerRender2.drawParticles(ctx, particles);

    const arr = dragState();
    if (arr && previewPoints) {
      DF.TowerRender2.drawPreview(ctx, previewPoints, puedeDisparar(playerEnergy, currentWeaponKey));
    }
    DF.TowerRender2.drawProjectiles(ctx, projectiles, now);

    const w = DF.Weapons.WEAPONS[currentWeaponKey];
    if (state.phase === 'playing') {
      DF.TowerRender2.drawSlingshot(ctx, playerMuzzle, DF.Input.MUZZLE_GRAB_RADIUS, arr, w, now);
      // Gomera rival: se tensa mientras la IA carga, para que el aviso sea
      // visible ademas de audible.
      const tensionIA = aiPending ? Math.min(1, (now - aiPending.at) / AI_TELL_MS) : 0;
      DF.TowerRender2.drawSlingshot(ctx, aiMuzzle, 0,
        tensionIA > 0 ? { dx: 18 * tensionIA, dy: -6, potencia: tensionIA } : null,
        DF.Weapons.WEAPONS[aiPending ? aiPending.weaponKey : 'piedra'], now);
    }
    if (arr) {
      DF.TowerRender2.drawAimArrow(ctx, playerMuzzle.x, playerMuzzle.y,
        arr.v.vx, arr.v.vy, DF.Input.SPEED_MAX, puedeDisparar(playerEnergy, currentWeaponKey));
    }
    DF.TowerRender2.drawHitMarks(ctx, hitMarks, now);
    ctx.restore();

    if (flashMag > 0.01) {
      ctx.fillStyle = 'rgba(255,240,210,' + flashMag.toFixed(3) + ')';
      ctx.fillRect(0, 0, viewW, viewH);
    }

    // HUD sin shake.
    DF.Render.drawEnergyBar(ctx, 12, viewH - 50, 120, 12, playerEnergy, 'Vos', 'left');
    DF.Render.drawEnergyBar(ctx, viewW - 176, 20, 120, 12, aiEnergy, 'IA', 'right');
    drawWeaponButtons(ctx, now);
    drawWeaponInfo(ctx);
    drawMaterialLegend(ctx);
    drawWindIndicator(ctx);
    drawTimer(ctx, now);
    drawRepairTip(ctx);

    if (state.phase === 'roundover' && now - state.roundoverAt > BANNER_DELAY_MS) {
      const txt = state.winner === 'player' ? '¡Ganaste!' : state.winner === 'ai' ? 'Ganó la IA' : 'Empate';
      const pct = Math.round(DF.Tower2.totalHpPercent(playerTower) * 100);
      DF.Render.drawBanner(ctx, { width: viewW, height: viewH }, txt,
        'Te quedó ' + pct + '% de fortaleza · tocá para otra');
    }
  }

  function drawWeaponButtons(ctx, now) {
    weaponButtons.forEach(function (b) {
      const w = DF.Weapons.WEAPONS[b.key];
      const activo = b.key === currentWeaponKey;
      const sinPlata = playerEnergy.value < w.cost;
      const cd = cooldownRestante(b.key);

      ctx.fillStyle = activo ? DF.TowerRender2.UI.aim : 'rgba(255,255,255,0.10)';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      // Cooldown: se vacia de abajo hacia arriba.
      if (cd > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(b.x, b.y, b.w, b.h * cd);
      }
      ctx.strokeStyle = activo ? '#fff3c4' : 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      // Cinta del color del arma: el proyectil sale de ese color.
      ctx.fillStyle = w.color;
      ctx.fillRect(b.x, b.y - 4, b.w, 3);

      ctx.fillStyle = activo ? '#241005' : (sinPlata ? 'rgba(232,236,255,0.35)' : '#e8ecff');
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(w.short, b.x + b.w / 2, b.y + 12);
      ctx.font = '9px sans-serif';
      ctx.fillText(w.cost + '⚡', b.x + b.w / 2, b.y + 23);
    });
  }

  function drawWeaponInfo(ctx) {
    const w = DF.Weapons.WEAPONS[currentWeaponKey];
    const eff = DF.Weapons.effectivenessText(currentWeaponKey);
    const last = weaponButtons[weaponButtons.length - 1];
    const x = last ? last.x + last.w + 12 : 210;
    ctx.textAlign = 'left';
    ctx.fillStyle = DF.TowerRender2.UI.aim;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(w.label, x, viewH - 40);
    // El ROL es lo que hace que la eleccion sea espacial y no aritmetica.
    ctx.fillStyle = '#c9bda8';
    ctx.font = '10px sans-serif';
    ctx.fillText(w.rol, x, viewH - 28);
    const partes = [eff.strong, eff.weak, eff.splash].filter(Boolean).join('  ');
    if (partes) {
      ctx.fillStyle = '#9fd6a0';
      ctx.fillText(partes, x, viewH - 16);
    }
    ctx.fillStyle = DF.TowerRender2.UI.repair;
    ctx.fillText('Tocá un piso verde: reparar ' + REPAIR_COST + '⚡', x, viewH - 5);
  }

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
      const lbl = corto ? DF.Weapons.MATERIAL_LABEL[m].slice(0, 3) : DF.Weapons.MATERIAL_LABEL[m];
      ctx.fillStyle = '#c9bda8';
      ctx.fillText(lbl, x + 16, y + 10);
      x += 16 + ctx.measureText(lbl).width + 12;
    });
  }

  function drawWindIndicator(ctx) {
    const flecha = wind >= 0 ? '→' : '←';
    ctx.fillStyle = '#c9bda8';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Viento ' + flecha + ' ' + Math.abs(wind).toFixed(0), viewW / 2, 18);
  }

  function drawTimer(ctx, nowMs) {
    const elapsed = Math.max(0, nowMs - roundStartMs);
    const left = Math.max(0, ROUND_LIMIT_MS - elapsed);
    const secs = Math.ceil(left / 1000);
    const m = Math.floor(secs / 60), s = secs % 60;
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

  function drawRepairTip(ctx) {
    if (state.phase !== 'playing' || duelIndex > 2) return;
    if (playerEnergy.value < REPAIR_COST) return;
    if (!playerTower.floors.some(valeReparar)) return;
    ctx.fillStyle = DF.TowerRender2.UI.repair;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Tocá un piso con borde verde para repararlo', viewW / 2, HUD_TOP + 22);
  }

  function onResize() { layout(); }

  function start() {
    if (started) return;
    started = true;
    resetGame();
    setupInput();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
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
        interceptables: projectiles.filter(function (p) { return p.interceptable; }).length,
        aiCargando: !!aiPending
      };
    },
    _internals: {
      regenMultiplier: regenMultiplier,
      timeoutWinner: timeoutWinner,
      predictImpactMs: function (p) { return predictImpactMs(p, playerTower); },
      computePreview: computePreview,
      towers: function () { return { player: playerTower, ai: aiTower }; },
      energies: function () { return { player: playerEnergy, ai: aiEnergy }; },
      projectiles: function () { return projectiles; },
      state: function () { return state; },
      setWeapon: function (k) { currentWeaponKey = k; },
      cooldownRestante: cooldownRestante,
      weaponReadyAt: function () { return weaponReadyAt; }
    }
  };
})(window.DF = window.DF || {});

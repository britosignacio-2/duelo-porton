// duel2-render.js -- fork de tower-render.js para el prototipo de varianza
// (2026-09-05). Cambios: color por MATERIAL en los muros (no un color de rol
// fijo), sin caso especial de núcleo, un colapso final más dramático cuando la
// torre entera queda destruida (hallazgo #2, presentación pura), y la flecha
// de dirección/potencia que reemplaza la trayectoria punteada (hallazgo #1).
(function (DF) {
  'use strict';

  const STATE_TINT = {
    intacto: null,
    rajado: 'rgba(0,0,0,0.18)',
    humo: 'rgba(60,40,20,0.32)',
    fuego: 'rgba(178,58,58,0.30)'
  };

  // Paleta "Atardecer de Deshuesadero" (ver duel2-weapons.js para los
  // materiales). Naranja quemado = torretas, contorno único para todo.
  const ROLE_COLOR = { torreta: '#d1521f' };
  const OUTLINE = '#241005';

  // Colores de UI -- deliberadamente FUERA de la paleta de materiales, para
  // que nunca se confunda un elemento de interfaz con un muro (decisión de
  // arte del 2026-09-05).
  const UI = {
    aim: '#ffd23f',       // amarillo: apuntado / energía / selección
    aimBad: '#ff5a6e',
    repair: '#5fd08a',    // verde: reparar
    intercept: '#ffd23f'  // amarillo: proyectil interceptable
  };

  function ensureRenderY(floor) {
    if (floor.renderY === undefined) floor.renderY = floor.y;
  }

  function updateRenderPositions(tower, dt) {
    for (const f of tower.floors) {
      if (!f.alive) continue;
      ensureRenderY(f);
      const targetY = f.y;
      const speed = 10;
      f.renderY += (targetY - f.renderY) * Math.min(1, speed * dt);
    }
  }

  function floorColor(floor) {
    if (floor.role === 'muro') return DF.Weapons.MATERIAL_COLOR[floor.material] || '#8a7a53';
    return ROLE_COLOR[floor.role] || '#8a7a53';
  }

  function drawFloor(ctx, tower, floor, nowMs) {
    if (!floor.alive) return;
    ensureRenderY(floor);

    let collapseT = 0;
    if (floor.collapsing) {
      collapseT = Math.min(1, (nowMs - floor.collapseStart) / DF.Tower2.DEFAULTS.collapseDurationMs);
    }

    ctx.save();
    const cx = tower.originX + floor.width / 2;
    const cy = floor.renderY + floor.height / 2;
    ctx.translate(cx, cy);
    if (collapseT > 0) {
      ctx.translate(0, collapseT * floor.height * 0.9);
      ctx.rotate(collapseT * 0.35);
      ctx.globalAlpha = 1 - collapseT;
      const s = 1 - collapseT * 0.3;
      ctx.scale(s, s);
    }
    ctx.translate(-floor.width / 2, -floor.height / 2);

    ctx.fillStyle = floorColor(floor);
    ctx.fillRect(1, 1, floor.width - 2, floor.height - 2);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(1, 1, floor.width - 2, floor.height - 2);

    // Cicatriz permanente: la franja de arriba es la porción del piso que ya
    // NO se puede recuperar reparando (repairCeiling bajó con cada impacto).
    // Se dibuja como material arrancado -- el bloque se ve literalmente más
    // corto de lo que era, que es exactamente lo que significa la mecánica.
    const lostPct = 1 - Math.min(1, floor.repairCeiling / floor.maxHp);
    if (lostPct > 0.001) {
      const bandH = (floor.height - 2) * lostPct;
      ctx.fillStyle = 'rgba(20,15,11,0.72)';
      ctx.fillRect(1, 1, floor.width - 2, bandH);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(1, 1 + bandH);
      ctx.lineTo(floor.width - 1, 1 + bandH);
      ctx.stroke();
    }

    const state = DF.Tower2.damageState(floor);
    const tint = STATE_TINT[state];
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(1, 1, floor.width - 2, floor.height - 2);
    }
    if (state === 'rajado' || state === 'humo' || state === 'fuego') {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(floor.width * 0.25, floor.height * 0.15);
      ctx.lineTo(floor.width * 0.5, floor.height * 0.55);
      ctx.lineTo(floor.width * 0.35, floor.height * 0.85);
      ctx.stroke();
    }

    // Flash blanco breve al recibir un impacto -- "juice" barato, se nota
    // aunque el arte siga siendo un rectángulo (ver feedback del usuario
    // 2026-09-05: sin esto no se puede juzgar nada jugando).
    if (floor.hitFlashAt && nowMs - floor.hitFlashAt < 120) {
      const fa = 1 - (nowMs - floor.hitFlashAt) / 120;
      ctx.fillStyle = 'rgba(255,255,255,' + (fa * 0.75).toFixed(2) + ')';
      ctx.fillRect(1, 1, floor.width - 2, floor.height - 2);
    }

    if (floor.role === 'torreta') {
      ctx.fillStyle = '#233634';
      ctx.beginPath();
      ctx.arc(floor.width / 2, floor.height / 2, Math.min(floor.width, floor.height) * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff3c4';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();

    if (state === 'humo' || state === 'fuego') {
      drawSmoke(ctx, tower.originX + floor.width / 2, floor.renderY, nowMs, state === 'fuego');
    }
  }

  function drawSmoke(ctx, x, y, nowMs, withFire) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const phase = (nowMs / 900 + i / n) % 1;
      const px = x + Math.sin((nowMs / 400) + i) * 8;
      const py = y - phase * 34;
      const alpha = (1 - phase) * 0.5;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(80,80,80,' + alpha.toFixed(2) + ')';
      ctx.arc(px, py, 5 + phase * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (withFire) {
      const flick = 0.7 + 0.3 * Math.sin(nowMs / 90);
      ctx.beginPath();
      ctx.fillStyle = 'rgba(224,167,46,' + (0.8 * flick).toFixed(2) + ')';
      ctx.arc(x, y + 2, 6 * flick, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = 'rgba(178,58,58,' + (0.7 * flick).toFixed(2) + ')';
      ctx.arc(x, y - 3, 4 * flick, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Colapso final dramático: onda expansiva + flash una sola vez, en la base de
  // donde estaba la torre. Presentación pura (hallazgo #2) -- no es una regla
  // nueva, no reintroduce el riesgo geométrico del núcleo (nada de esto es
  // impactable, es solo dibujo).
  function drawFinalCollapse(ctx, tower, nowMs) {
    const t = (nowMs - tower.finalCollapseAt) / 1000;
    if (t > 1) return;
    const cx = tower.originX + 35;
    const cy = tower.groundY;
    ctx.save();
    // Flash blanco instantáneo, se apaga rápido -- el "golpe" del momento.
    if (t < 0.12) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.85 * (1 - t / 0.12)).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(cx, cy, 140, 0, Math.PI * 2);
      ctx.fill();
    }
    // Dos anillos de onda expansiva a velocidades distintas.
    [0, 0.18].forEach(function (delay) {
      const rt = Math.max(0, Math.min(1, (t - delay) / (1 - delay)));
      if (rt <= 0 || t < delay) return;
      ctx.globalAlpha = 1 - rt;
      ctx.strokeStyle = '#ffcf6b';
      ctx.lineWidth = 5 * (1 - rt) + 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 20 + rt * 150, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = 'rgba(255, 150, 80, ' + (0.5 * (1 - t)).toFixed(2) + ')';
    ctx.beginPath();
    ctx.arc(cx, cy, 12 + t * 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Partículas simples (escombros/chispas) -- círculos con gravedad liviana,
  // se van desvaneciendo. r/g/b separados de la alpha para poder recalcularla
  // cada frame según la vida restante.
  function drawParticles(ctx, particles) {
    particles.forEach(function (p) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + a.toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, p.size * a), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawTower(ctx, tower, nowMs) {
    for (let i = 0; i < tower.floors.length; i++) {
      drawFloor(ctx, tower, tower.floors[i], nowMs);
    }
    if (tower.destroyed && tower.finalCollapseAt) {
      drawFinalCollapse(ctx, tower, nowMs);
    }
  }

  // Flecha de dirección/potencia -- reemplaza la trayectoria punteada
  // (hallazgo #1: sacarla sin agregar varianza no sumaba nada; ahora se
  // combina con arma-vs-material/viento/gomera variable, así que tiene
  // sentido volver a sacarla y probar si el jugador la extraña o no).
  function drawAimArrow(ctx, startX, startY, vx, vy, maxSpeed, ok) {
    const speed = Math.hypot(vx, vy);
    const len = 30 + Math.min(1, speed / maxSpeed) * 110;
    const ang = Math.atan2(vy, vx);
    const endX = startX + Math.cos(ang) * len;
    const endY = startY + Math.sin(ang) * len;
    ctx.strokeStyle = ok ? '#ffd23f' : '#ff5a6e';
    ctx.fillStyle = ok ? '#ffd23f' : '#ff5a6e';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    const headLen = 16;
    const headAng = 0.5;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - headLen * Math.cos(ang - headAng), endY - headLen * Math.sin(ang - headAng));
    ctx.lineTo(endX - headLen * Math.cos(ang + headAng), endY - headLen * Math.sin(ang + headAng));
    ctx.closePath();
    ctx.fill();
  }

  // Marca los pisos propios que se pueden reparar ahora mismo. Solo se dibuja
  // sobre la torre del jugador: sin esto, reparar es una mecánica invisible y
  // el criterio C1 del portón mediría "nadie sabía que existía" en vez de
  // "reparar está mal balanceado".
  function drawRepairHints(ctx, tower, canAfford, nowMs) {
    if (!canAfford) return;
    const pulse = 0.45 + 0.35 * Math.sin(nowMs / 260);
    ctx.save();
    ctx.strokeStyle = UI.repair;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    for (const f of tower.floors) {
      if (!DF.Tower2.canRepair(f)) continue;
      ensureRenderY(f);
      ctx.strokeRect(tower.originX - 1, f.renderY - 1, f.width + 2, f.height + 2);
    }
    ctx.restore();
  }

  // Proyectiles + tell de intercepción (P2). Un proyectil rival entra en
  // ventana ~400 ms antes del impacto: cambia al amarillo de UI y le late un
  // halo. El sonido lo dispara duel2-main una sola vez al entrar (acá no, esto
  // se llama cada frame).
  function drawProjectiles(ctx, projectiles, nowMs) {
    projectiles.forEach(function (p) {
      const r = DF.TowerProjectile2.RADIUS;
      if (p.interceptable) {
        const pulse = 0.5 + 0.5 * Math.sin(nowMs / 90);
        ctx.save();
        ctx.globalAlpha = 0.35 + pulse * 0.45;
        ctx.strokeStyle = UI.intercept;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 8 + pulse * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = UI.intercept;
      } else {
        ctx.fillStyle = p.owner === 'player' ? '#f07a2d' : '#e8d7c3';
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  DF.TowerRender2 = {
    UI: UI,
    OUTLINE: OUTLINE,
    updateRenderPositions: updateRenderPositions,
    drawTower: drawTower,
    drawAimArrow: drawAimArrow,
    drawParticles: drawParticles,
    drawRepairHints: drawRepairHints,
    drawProjectiles: drawProjectiles
  };
})(window.DF = window.DF || {});

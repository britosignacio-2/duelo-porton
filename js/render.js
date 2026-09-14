// render.js -- dibuja ambas fortalezas, proyectiles, trayectoria previsualizada
// punteada, barra de energía y estado de ronda. Placeholder visual (formas/colores).
(function (DF) {
  'use strict';

  function clear(ctx, canvas) {
    ctx.fillStyle = '#101726';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawGround(ctx, canvas, groundY) {
    ctx.fillStyle = '#232d47';
    ctx.fillRect(0, groundY, canvas.width, canvas.height - groundY);
    ctx.strokeStyle = '#48568a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(canvas.width, groundY);
    ctx.stroke();
  }

  function drawFortress(ctx, fortress) {
    for (let row = 0; row < fortress.rows; row++) {
      for (let col = 0; col < fortress.cols; col++) {
        const cell = fortress.blocks[row][col];
        if (!cell.alive) continue;
        const rect = DF.Fortress.blockRect(fortress, row, col);
        ctx.fillStyle = cell.isCore ? fortress.coreColor : fortress.color;
        ctx.fillRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
        if (cell.isCore) {
          ctx.strokeStyle = '#fff3c4';
          ctx.lineWidth = 2;
          ctx.strokeRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
        }
      }
    }
  }

  // Marca visible el punto de disparo del jugador (la "gomera") y el radio en el
  // que hay que empezar a tocar/clickear para agarrarla. Sin esto no hay forma de
  // adivinar dónde arranca el gesto central del juego (feedback real de playtest).
  function drawMuzzle(ctx, muzzle, grabRadius) {
    ctx.beginPath();
    ctx.arc(muzzle.x, muzzle.y, grabRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(muzzle.x, muzzle.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawProjectiles(ctx, projectiles) {
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      ctx.beginPath();
      ctx.fillStyle = p.owner === 'player' ? '#ffb703' : '#ef476f';
      ctx.arc(p.x, p.y, DF.Projectile.DEFAULTS.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ok=false tiñe la previsualización de rojo -- feedback de "sin energía" en vivo,
  // durante el arrastre mismo (no solo al soltar).
  function drawTrajectoryPreview(ctx, points, ok) {
    ctx.fillStyle = ok ? 'rgba(255,255,255,0.85)' : 'rgba(255,90,110,0.85)';
    for (let i = 0; i < points.length; i += 2) {
      const pt = points[i];
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // `costMark` (opcional) marca sobre la barra cuanto cuesta el arma elegida.
  // Playtest externo 2026-09-08: "sin tutorial les costo entender la energia".
  // El costo ya estaba escrito en cada boton de arma, pero la barra vivia lejos
  // y habia que comparar dos lugares distintos de memoria. Con la marca encima,
  // "cuanto tengo" y "cuanto necesito" se leen de un vistazo y en un solo lugar
  // -- que es lo que un tutorial tendria que explicar con palabras.
  function drawEnergyBar(ctx, x, y, w, h, energy, label, align, costMark, labelSide) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y, w, h);

    const pct = energy.value / energy.max;
    const flashing = energy.insufficientFlashUntil && (performance.now() / 1000) < energy.insufficientFlashUntil;
    ctx.fillStyle = flashing ? '#ff4d6d' : '#4dd6ff';
    const fillW = w * pct;
    ctx.fillRect(align === 'right' ? x + w - fillW : x, y, fillW, h);

    if (costMark > 0 && costMark <= energy.max) {
      const alcanza = energy.value >= costMark;
      const mx = align === 'right'
        ? x + w - w * (costMark / energy.max)
        : x + w * (costMark / energy.max);
      ctx.beginPath();
      ctx.moveTo(mx, y - 2);
      ctx.lineTo(mx, y + h + 2);
      ctx.strokeStyle = alcanza ? '#ffd23f' : '#ff4d6d';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Cuando no alcanza, el tramo que falta se raya: la barra dice sola
      // cuanto hay que esperar en vez de solo negar el disparo.
      if (!alcanza) {
        ctx.save();
        ctx.globalAlpha = 0.30;
        ctx.fillStyle = '#ff4d6d';
        const faltaW = w * ((costMark - energy.value) / energy.max);
        ctx.fillRect(align === 'right' ? mx : x + fillW, y, faltaW, h);
        ctx.restore();
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeRect(x, y, w, h);

    // `labelSide`: etiqueta al costado en vez de arriba. La franja superior del
    // duelo mide 44 px y tiene que entrar la leyenda de materiales ademas de
    // las dos barras; apilando etiqueta-sobre-barra no entra, y el resultado
    // real fue que la leyenda y la barra se dibujaron una encima de la otra.
    ctx.fillStyle = '#e8ecff';
    ctx.textAlign = align === 'right' ? 'right' : 'left';
    if (labelSide) {
      ctx.font = '11px sans-serif';
      ctx.textAlign = align === 'right' ? 'right' : 'left';
      ctx.fillText(label, align === 'right' ? x - 7 : x + w + 7, y + h - 2);
    } else {
      ctx.font = '13px sans-serif';
      ctx.fillText(label, align === 'right' ? x + w : x, y - 6);
    }
  }

  function drawBanner(ctx, canvas, text, subtext) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, canvas.height / 2 - 60, canvas.width, 120);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 5);
    ctx.font = '16px sans-serif';
    ctx.fillText(subtext, canvas.width / 2, canvas.height / 2 + 26);
  }

  DF.Render = {
    clear: clear,
    drawGround: drawGround,
    drawFortress: drawFortress,
    drawMuzzle: drawMuzzle,
    drawProjectiles: drawProjectiles,
    drawTrajectoryPreview: drawTrajectoryPreview,
    drawEnergyBar: drawEnergyBar,
    drawBanner: drawBanner
  };
})(window.DF = window.DF || {});

// duel2-render.js -- dibujo del prototipo de varianza.
//
// REESCRITO 2026-09-06 con los hallazgos de feel de la iteracion 0:
//
//  - Los tres materiales eran el MISMO rectangulo pintado distinto. Ahora
//    madera son tablones, metal es chapa remachada y piedra son bloques
//    irregulares: la forma dice de que esta hecho, no solo el color.
//  - La torre no se deformaba, solo se acortaba. Ahora cada piso se raja, se
//    le rompen las esquinas y se inclina a medida que pierde vida. La silueta
//    cambia con cada impacto, que es el Pilar 1 del GDD.
//  - La gomera era un circulo flotante sin ficcion. Ahora es un objeto con
//    horquilla y elastico que se estira, resiste y chasquea.
//  - Todos los proyectiles se veian iguales. Ahora cada arquetipo tiene su
//    estela: el cohete deja fuego, el mortero humo, el racimo chispas.
//  - El espacio entre las torres estaba vacio. Ahora hay cerros de chatarra
//    de fondo que dan profundidad sin interferir (sin colision: los
//    obstaculos reales siguen siendo post-MVP).
(function (DF) {
  'use strict';

  // Paleta "Atardecer de Deshuesadero". Contorno unico para todo.
  const ROLE_COLOR = { torreta: '#d1521f' };
  const OUTLINE = '#241005';

  // Colores de UI -- deliberadamente FUERA de la paleta de materiales, para
  // que nunca se confunda un elemento de interfaz con un muro.
  const UI = {
    aim: '#ffd23f',
    aimBad: '#ff5a6e',
    repair: '#5fd08a',
    intercept: '#ffd23f'
  };

  const CIELO = { alto: '#3a1d0e', bajo: '#7d3312' };

  function sombra(hex, k) {
    const r = Math.round(parseInt(hex.slice(1, 3), 16) * k);
    const g = Math.round(parseInt(hex.slice(3, 5), 16) * k);
    const b = Math.round(parseInt(hex.slice(5, 7), 16) * k);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // Ruido determinista por piso: la misma pieza tiene siempre las mismas
  // vetas y las mismas roturas, cuadro a cuadro. Con Math.random() la textura
  // hervia y parecia estatica de TV.
  function rnd(semilla) {
    const x = Math.sin(semilla * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  // Buffer reutilizado para pintar un piso antes de estamparlo. Uno solo para
  // todos: los pisos comparten tamaño y se dibujan de a uno.
  let _buf = null;
  function bufferDePiso(w, h) {
    const bw = Math.max(1, Math.ceil(w)), bh = Math.max(1, Math.ceil(h));
    if (!_buf) _buf = document.createElement('canvas');
    if (_buf.width !== bw || _buf.height !== bh) { _buf.width = bw; _buf.height = bh; }
    return _buf;
  }

  function ensureRenderY(floor) {
    if (floor.renderY === undefined) floor.renderY = floor.y;
    if (floor.semilla === undefined) floor.semilla = Math.floor(Math.random() * 9999);
  }

  function updateRenderPositions(tower, dt) {
    for (const f of tower.floors) {
      if (!f.alive) continue;
      ensureRenderY(f);
      f.renderY += (f.y - f.renderY) * Math.min(1, 10 * dt);
    }
  }

  function floorColor(floor) {
    if (floor.role === 'muro') return DF.Weapons.MATERIAL_COLOR[floor.material] || '#8a7a53';
    return ROLE_COLOR[floor.role] || '#8a7a53';
  }

  // --- Fondo ---------------------------------------------------------------

  // Cerros de chatarra a dos profundidades. Sin colision: solo existen para
  // que el hueco entre las torres deje de ser un vacio negro. El proyectil
  // los cruza por delante.
  function drawArena(ctx, viewW, viewH, groundY) {
    const cielo = ctx.createLinearGradient(0, 0, 0, groundY);
    cielo.addColorStop(0, CIELO.alto);
    cielo.addColorStop(1, CIELO.bajo);
    ctx.fillStyle = cielo;
    ctx.fillRect(-20, -20, viewW + 40, groundY + 20);

    // Sol bajo, detras de todo.
    ctx.fillStyle = 'rgba(255, 190, 90, 0.16)';
    ctx.beginPath();
    ctx.arc(viewW * 0.5, groundY - viewH * 0.10, viewH * 0.30, 0, Math.PI * 2);
    ctx.fill();

    // Dos cadenas de cerros: la de atras mas clara y mas chata.
    [{ k: 0.30, alto: 0.16, semilla: 3 }, { k: 0.55, alto: 0.10, semilla: 11 }].forEach(function (capa) {
      ctx.fillStyle = 'rgba(26, 14, 8, ' + capa.k + ')';
      ctx.beginPath();
      ctx.moveTo(-20, groundY);
      const picos = 9;
      for (let i = 0; i <= picos; i++) {
        const x = -20 + ((viewW + 40) * i) / picos;
        const h = viewH * capa.alto * (0.45 + rnd(capa.semilla + i) * 0.75);
        ctx.lineTo(x, groundY - h);
      }
      ctx.lineTo(viewW + 20, groundY);
      ctx.closePath();
      ctx.fill();
    });

    ctx.fillStyle = '#150f0b';
    ctx.fillRect(-20, groundY, viewW + 40, viewH - groundY + 20);
    ctx.strokeStyle = '#4a2a16';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-20, groundY);
    ctx.lineTo(viewW + 20, groundY);
    ctx.stroke();
  }

  // --- Materiales ----------------------------------------------------------
  // Cada material se dibuja con su propia FORMA, no solo su color: en pantalla
  // chica la forma se lee antes que el tono, y arma-vs-material exige
  // reconocer el material de un vistazo (FR8 / NFR12).

  function pintarMadera(ctx, w, h, base, semilla) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const tablones = 3;
    for (let i = 0; i < tablones; i++) {
      const y = (h / tablones) * i;
      ctx.fillStyle = i % 2 ? sombra(base, 0.88) : base;
      ctx.fillRect(0, y, w, h / tablones);
      // Veta
      ctx.strokeStyle = 'rgba(80,45,15,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const vy = y + (h / tablones) * (0.3 + rnd(semilla + i) * 0.4);
      ctx.moveTo(w * 0.1, vy);
      ctx.lineTo(w * 0.9, vy);
      ctx.stroke();
      // Junta entre tablones
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  function pintarMetal(ctx, w, h, base, semilla) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // Brillo horizontal de chapa
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.03)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Remaches en las cuatro esquinas
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    [[0.14, 0.22], [0.86, 0.22], [0.14, 0.78], [0.86, 0.78]].forEach(function (pt) {
      ctx.beginPath();
      ctx.arc(w * pt[0], h * pt[1], Math.max(1.2, h * 0.055), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, 2);
    ctx.lineTo(w * 0.5, h - 2);
    ctx.stroke();
  }

  function pintarPiedra(ctx, w, h, base, semilla) {
    ctx.fillStyle = sombra(base, 0.82);
    ctx.fillRect(0, 0, w, h);
    const filas = 2, cols = 3;
    for (let r = 0; r < filas; r++) {
      const desfase = r % 2 ? w / (cols * 2) : 0;
      for (let c = -1; c <= cols; c++) {
        const bx = desfase + (w / cols) * c;
        const by = (h / filas) * r;
        const bw = w / cols - 2;
        const bh = h / filas - 2;
        if (bx + bw < 0 || bx > w) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.clip();
        const k = 0.86 + rnd(semilla + r * 7 + c * 3) * 0.28;
        ctx.fillStyle = sombra(base, Math.min(1.05, k));
        ctx.fillRect(bx + 1, by + 1, bw, bh);
        ctx.strokeStyle = 'rgba(0,0,0,0.30)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 1, by + 1, bw, bh);
        ctx.restore();
      }
    }
  }

  function pintarTorreta(ctx, w, h, base) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0.24)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Ojo de buey de la torreta
    ctx.fillStyle = '#233634';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff3c4';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,243,196,0.4)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.34, 0, Math.PI * 2);
    ctx.stroke();
  }

  // --- Daño ----------------------------------------------------------------
  // El GDD dice que la variedad la genera la destruccion. Para que eso sea
  // cierto, la SILUETA tiene que cambiar con cada impacto -- no alcanza con
  // teñir el bloque, que era lo que pasaba antes.

  function pintarRoturas(ctx, w, h, floor, nivel) {
    // `nivel` 0..3 -- cuantas rajaduras y esquinas rotas.
    const s = floor.semilla;
    ctx.strokeStyle = 'rgba(0,0,0,0.62)';
    ctx.lineCap = 'round';
    for (let i = 0; i < nivel; i++) {
      const x0 = w * (0.15 + rnd(s + i * 5) * 0.7);
      ctx.lineWidth = 1.5 + rnd(s + i) * 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      let x = x0;
      for (let seg = 1; seg <= 3; seg++) {
        x += (rnd(s + i * 3 + seg) - 0.5) * w * 0.35;
        ctx.lineTo(x, (h / 3) * seg);
      }
      ctx.stroke();
    }
    // Esquinas arrancadas: se pintan del color del fondo, asi el bloque
    // literalmente pierde material y la silueta se rompe.
    if (nivel >= 2) {
      const muescas = nivel - 1;
      for (let i = 0; i < muescas; i++) {
        const esq = Math.floor(rnd(s + 40 + i) * 4);
        const mw = w * (0.16 + rnd(s + 50 + i) * 0.14);
        const mh = h * (0.22 + rnd(s + 60 + i) * 0.2);
        const mx = (esq % 2) ? w - mw : 0;
        const my = (esq < 2) ? 0 : h - mh;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + mw, my + (esq < 2 ? mh : 0));
        ctx.lineTo(mx + (esq % 2 ? 0 : mw), my + mh);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function nivelDeRotura(floor) {
    const pct = floor.hp / floor.maxHp;
    if (pct >= 0.999) return 0;
    if (pct > 0.60) return 1;
    if (pct > 0.30) return 2;
    return 3;
  }

  function drawFloor(ctx, tower, floor, nowMs) {
    if (!floor.alive) return;
    ensureRenderY(floor);

    let collapseT = 0;
    if (floor.collapsing) {
      collapseT = Math.min(1, (nowMs - floor.collapseStart) / DF.Tower2.DEFAULTS.collapseDurationMs);
    }

    const w = floor.width, h = floor.height;
    const nivel = nivelDeRotura(floor);

    ctx.save();
    ctx.translate(tower.originX + w / 2, floor.renderY + h / 2);

    if (collapseT > 0) {
      ctx.translate(0, collapseT * h * 0.9);
      ctx.rotate(collapseT * 0.35);
      ctx.globalAlpha = 1 - collapseT;
      const k = 1 - collapseT * 0.3;
      ctx.scale(k, k);
    } else if (nivel >= 2) {
      // Un piso muy dañado se asienta torcido. Chico a proposito: comunica
      // inestabilidad sin romper la lectura de la columna.
      const lado = rnd(floor.semilla) > 0.5 ? 1 : -1;
      ctx.rotate(lado * 0.012 * (nivel - 1));
      ctx.translate(lado * (nivel - 1), 0);
    }

    ctx.translate(-w / 2, -h / 2);

    // Cuerpo segun material. Se pinta en un buffer aparte y recien despues se
    // estampa: las esquinas rotas se recortan con `destination-out`, que BORRA
    // pixeles -- si se hiciera directo sobre el canvas principal agujerearia
    // tambien el atardecer y los cerros que ya estan dibujados detras, y por el
    // hueco se veria el fondo de la pagina en vez del cielo.
    const base = floorColor(floor);
    const buf = bufferDePiso(w, h);
    const bctx = buf.getContext('2d');
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, buf.width, buf.height);
    if (floor.role === 'torreta') pintarTorreta(bctx, w, h, base);
    else if (floor.material === 'madera') pintarMadera(bctx, w, h, base, floor.semilla);
    else if (floor.material === 'metal') pintarMetal(bctx, w, h, base, floor.semilla);
    else pintarPiedra(bctx, w, h, base, floor.semilla);
    if (nivel > 0) pintarRoturas(bctx, w, h, floor, nivel);
    ctx.drawImage(buf, 0, 0, w, h, 0, 0, w, h);

    // Cicatriz permanente: la franja de arriba es la porcion que ya NO se
    // puede recuperar reparando. El bloque se ve literalmente mas corto.
    const perdido = 1 - Math.min(1, floor.repairCeiling / floor.maxHp);
    if (perdido > 0.001) {
      const bandH = h * perdido;
      ctx.fillStyle = 'rgba(20,15,11,0.78)';
      ctx.fillRect(0, 0, w, bandH);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, bandH);
      ctx.lineTo(w, bandH);
      ctx.stroke();
    }

    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    // Flash al recibir impacto, con intensidad segun lo bueno que fue el golpe.
    if (floor.hitFlashAt && nowMs - floor.hitFlashAt < 140) {
      const t = 1 - (nowMs - floor.hitFlashAt) / 140;
      const fuerza = floor.hitFlashFuerza === undefined ? 0.5 : floor.hitFlashFuerza;
      ctx.fillStyle = 'rgba(255,255,255,' + (t * (0.25 + fuerza * 0.6)).toFixed(2) + ')';
      ctx.fillRect(0, 0, w, h);
    }
    // Reparado: destello verde corto.
    if (floor.repairFlashAt && nowMs - floor.repairFlashAt < 260) {
      const t = 1 - (nowMs - floor.repairFlashAt) / 260;
      ctx.strokeStyle = 'rgba(95,208,138,' + (t * 0.9).toFixed(2) + ')';
      ctx.lineWidth = 3;
      ctx.strokeRect(1, 1, w - 2, h - 2);
    }

    ctx.restore();

    const estado = DF.Tower2.damageState(floor);
    if (estado === 'humo' || estado === 'fuego') {
      drawSmoke(ctx, tower.originX + w / 2, floor.renderY, nowMs, estado === 'fuego');
    }
  }

  function drawSmoke(ctx, x, y, nowMs, conFuego) {
    for (let i = 0; i < 3; i++) {
      const fase = (nowMs / 900 + i / 3) % 1;
      const px = x + Math.sin((nowMs / 400) + i) * 8;
      const py = y - fase * 34;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(80,80,80,' + ((1 - fase) * 0.5).toFixed(2) + ')';
      ctx.arc(px, py, 5 + fase * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (conFuego) {
      const f = 0.7 + 0.3 * Math.sin(nowMs / 90);
      ctx.beginPath();
      ctx.fillStyle = 'rgba(224,167,46,' + (0.8 * f).toFixed(2) + ')';
      ctx.arc(x, y + 2, 6 * f, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = 'rgba(178,58,58,' + (0.7 * f).toFixed(2) + ')';
      ctx.arc(x, y - 3, 4 * f, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFinalCollapse(ctx, tower, nowMs) {
    const t = (nowMs - tower.finalCollapseAt) / 1000;
    if (t > 1.2) return;
    const cx = tower.originX + 35, cy = tower.groundY;
    ctx.save();
    if (t < 0.12) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.85 * (1 - t / 0.12)).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(cx, cy, 160, 0, Math.PI * 2);
      ctx.fill();
    }
    [0, 0.18, 0.34].forEach(function (delay) {
      const rt = Math.max(0, Math.min(1, (t - delay) / (1.2 - delay)));
      if (rt <= 0 || t < delay) return;
      ctx.globalAlpha = 1 - rt;
      ctx.strokeStyle = '#ffcf6b';
      ctx.lineWidth = 5 * (1 - rt) + 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 20 + rt * 190, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }

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
    for (let i = 0; i < tower.floors.length; i++) drawFloor(ctx, tower, tower.floors[i], nowMs);
    if (tower.destroyed && tower.finalCollapseAt) drawFinalCollapse(ctx, tower, nowMs);
  }

  function drawRepairHints(ctx, tower, canAfford, nowMs, vale) {
    if (!canAfford) return;
    const pulso = 0.45 + 0.35 * Math.sin(nowMs / 260);
    ctx.save();
    ctx.strokeStyle = UI.repair;
    ctx.globalAlpha = pulso;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    for (const f of tower.floors) {
      if (!(vale ? vale(f) : DF.Tower2.canRepair(f))) continue;
      ensureRenderY(f);
      ctx.strokeRect(tower.originX - 1, f.renderY - 1, f.width + 2, f.height + 2);
    }
    ctx.restore();
  }

  // --- Gomera --------------------------------------------------------------
  // Antes era un circulo flotante sin ficcion: no habia nadie disparando, habia
  // un cursor. Ahora es una horquilla con elastico que se estira y resiste, y
  // el proyectil se ve cargado en la badana ANTES de salir. La mitad del placer
  // de una gomera esta antes del disparo, no despues.

  function drawSlingshot(ctx, muzzle, radioAgarre, arrastre, weapon, nowMs) {
    const x = muzzle.x, y = muzzle.y;
    const escala = 1;
    const brazoY = 16 * escala, brazoX = 9 * escala;

    // Retroceso: apenas suelta, la horquilla vibra un instante.
    let sacudida = 0;
    if (muzzle.disparoAt && nowMs - muzzle.disparoAt < 180) {
      const t = 1 - (nowMs - muzzle.disparoAt) / 180;
      sacudida = Math.sin((nowMs - muzzle.disparoAt) / 12) * 3 * t;
    }

    ctx.save();
    ctx.translate(x + sacudida, y);

    // Radio de agarre: apenas visible, solo para saber donde se puede empezar.
    if (!arrastre) {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, radioAgarre, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Poste
    ctx.strokeStyle = '#6b4a2a';
    ctx.lineCap = 'round';
    ctx.lineWidth = 5 * escala;
    ctx.beginPath();
    ctx.moveTo(0, brazoY + 14 * escala);
    ctx.lineTo(0, 0);
    ctx.stroke();

    // Horquilla
    ctx.lineWidth = 4 * escala;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-brazoX, -brazoY);
    ctx.moveTo(0, 0);
    ctx.lineTo(brazoX, -brazoY);
    ctx.stroke();

    // Elastico. Sin arrastre queda flojo; con arrastre se estira hasta el dedo
    // y se AFINA a medida que se tensa -- el grosor comunica la tension.
    const anclaA = { x: -brazoX, y: -brazoY };
    const anclaB = { x: brazoX, y: -brazoY };
    let bolsa = { x: 0, y: -brazoY + 6 * escala };
    let tension = 0;

    if (arrastre) {
      bolsa = { x: arrastre.dx, y: arrastre.dy };
      tension = Math.min(1, arrastre.potencia);
    }

    ctx.strokeStyle = tension > 0 ? '#8a5a3a' : '#7a4f34';
    ctx.lineWidth = Math.max(1.4, (3.2 - tension * 1.6)) * escala;
    ctx.beginPath();
    ctx.moveTo(anclaA.x, anclaA.y);
    ctx.lineTo(bolsa.x, bolsa.y);
    ctx.lineTo(anclaB.x, anclaB.y);
    ctx.stroke();

    // Proyectil cargado en la badana, del color de su arma.
    if (arrastre && weapon) {
      ctx.fillStyle = weapon.color || UI.aim;
      ctx.beginPath();
      ctx.arc(bolsa.x, bolsa.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Chispas de tension cuando esta cerca del maximo.
      if (tension > 0.75) {
        const n = Math.round((tension - 0.75) * 12);
        for (let i = 0; i < n; i++) {
          const a = rnd(Math.floor(nowMs / 60) + i) * Math.PI * 2;
          const d = 9 + rnd(Math.floor(nowMs / 60) + i * 3) * 7;
          ctx.fillStyle = 'rgba(255,210,63,0.75)';
          ctx.fillRect(bolsa.x + Math.cos(a) * d, bolsa.y + Math.sin(a) * d, 2, 2);
        }
      }
    }
    ctx.restore();
  }

  // --- Proyectiles ---------------------------------------------------------

  const ESTELA = {
    fuego: { r: 255, g: 140, b: 50, ancho: 5 },
    humo: { r: 190, g: 180, b: 165, ancho: 4 },
    chispa: { r: 255, g: 220, b: 120, ancho: 2.5 },
    estela: { r: 255, g: 210, b: 63, ancho: 2 }
  };

  // Forma propia por arquetipo, rotada hacia donde va. Eran todos circulos de
  // radio 6 con distinto color: "los proyectiles son muy parecidos
  // esteticamente, solo cambian un poco el color". La silueta se lee antes que
  // el tono, y en un juego donde la eleccion de arma ES la decision, tener que
  // distinguirlas por matiz es pedirle demasiado al jugador.
  function dibujarForma(ctx, forma, r, color, ageMs) {
    ctx.fillStyle = color;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    if (forma === 'misil') {
      // Cuerpo largo con ojiva y aletas traseras.
      ctx.moveTo(r * 1.9, 0);
      ctx.lineTo(r * 0.5, -r * 0.62);
      ctx.lineTo(-r * 1.3, -r * 0.62);
      ctx.lineTo(-r * 1.3, r * 0.62);
      ctx.lineTo(r * 0.5, r * 0.62);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, -r * 0.6); ctx.lineTo(-r * 1.9, -r * 1.3);
      ctx.lineTo(-r * 1.2, -r * 0.2);
      ctx.moveTo(-r * 0.9, r * 0.6); ctx.lineTo(-r * 1.9, r * 1.3);
      ctx.lineTo(-r * 1.2, r * 0.2);
      ctx.fill(); ctx.stroke();
      return;
    }

    if (forma === 'bomba') {
      // Panzona, con cola. Se ve pesada.
      ctx.ellipse(0, 0, r * 1.25, r * 1.05, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 1.1, 0);
      ctx.lineTo(-r * 2.0, -r * 0.85);
      ctx.lineTo(-r * 1.7, 0);
      ctx.lineTo(-r * 2.0, r * 0.85);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      return;
    }

    if (forma === 'dardo') {
      // Punta afilada: se lee que atraviesa.
      ctx.moveTo(r * 2.2, 0);
      ctx.lineTo(-r * 0.9, -r * 0.5);
      ctx.lineTo(-r * 1.6, 0);
      ctx.lineTo(-r * 0.9, r * 0.5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      return;
    }

    if (forma === 'granada') {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();  // palanca
      ctx.rect(-r * 0.25, -r * 1.5, r * 0.5, r * 0.7);
      ctx.fillStyle = '#c9bda8';
      ctx.fill(); ctx.stroke();
      return;
    }

    if (forma === 'racimo') {
      // Tres esferas atadas: se ve que se va a partir.
      [[0, -r * 0.75], [-r * 0.7, r * 0.5], [r * 0.7, r * 0.5]].forEach(function (c) {
        ctx.beginPath();
        ctx.arc(c[0], c[1], r * 0.62, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      });
      return;
    }

    // 'roca': peñasco irregular, gira lento con la edad.
    const giro = (ageMs || 0) / 420;
    const puntas = 7;
    for (let i = 0; i < puntas; i++) {
      const a = giro + (i / puntas) * Math.PI * 2;
      const rr = r * (0.78 + rnd(i * 3.1) * 0.5);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  function drawProjectiles(ctx, projectiles, nowMs) {
    projectiles.forEach(function (p) {
      const w = DF.Weapons.WEAPONS[p.weaponKey];
      const r = DF.TowerProjectile2.RADIUS * (p.esFragmento ? 0.65 : 1);

      // Estela: dice de un vistazo que este proyectil NO vuela como los otros.
      const tipo = ESTELA[w.trail];
      if (tipo && p.estela && p.estela.length > 1) {
        for (let i = 1; i < p.estela.length; i++) {
          const a = (i / p.estela.length) * 0.55;
          ctx.strokeStyle = 'rgba(' + tipo.r + ',' + tipo.g + ',' + tipo.b + ',' + a.toFixed(2) + ')';
          ctx.lineWidth = tipo.ancho * (i / p.estela.length);
          ctx.beginPath();
          ctx.moveTo(p.estela[i - 1].x, p.estela[i - 1].y);
          ctx.lineTo(p.estela[i].x, p.estela[i].y);
          ctx.stroke();
        }
      }

      // Llama del cohete mientras hay combustible.
      if (p.kind === 'cohete' && p.ageMs < (w.thrustMs || 0)) {
        const f = 0.7 + 0.3 * Math.sin(nowMs / 40);
        ctx.fillStyle = 'rgba(255,180,60,' + (0.85 * f).toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(p.x - p.dirX * 11, p.y - p.dirY * 11, 5.5 * f, 0, Math.PI * 2);
        ctx.fill();
      }

      // Halo de interceptable: circular a proposito, alrededor de cualquier
      // forma, para que la señal sea la misma siempre.
      if (p.interceptable) {
        const pulso = 0.5 + 0.5 * Math.sin(nowMs / 90);
        ctx.save();
        ctx.globalAlpha = 0.35 + pulso * 0.45;
        ctx.strokeStyle = UI.intercept;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 9 + pulso * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      // El racimo y la roca no apuntan: van cayendo. Los demas se orientan.
      const forma = p.esFragmento ? 'racimo' : (w.forma || 'roca');
      if (forma !== 'roca' && forma !== 'racimo') {
        ctx.rotate(Math.atan2(p.vy, p.vx));
      }
      const color = p.interceptable ? UI.intercept
                  : (p.owner === 'player' ? (w.color || '#f07a2d') : '#e8d7c3');
      dibujarForma(ctx, forma, r, color, p.ageMs);
      ctx.restore();
    });
  }

  // Previsualizacion de trayectoria, SOLO para los arquetipos cuya fisica no
  // es intuitiva (cohete, mortero, granada, racimo). La regla no es "todas o
  // ninguna": se muestra lo que el sentido comun no te dice. Una piedra que
  // cae la predice cualquiera; un cohete que acelera, no.
  // `preview` es { principal, division, ramas } -- ver computePreview en
  // duel2-main.js. Se acepta tambien un array suelto por si alguna vez se
  // dibuja una trayectoria sin division.
  function drawPreview(ctx, preview, ok) {
    if (!preview) return;
    const principal = preview.principal || preview;
    if (!principal || principal.length < 2) return;
    const base = ok ? '255,210,63' : '255,90,110';

    function linea(pts, alpha, ancho, guion) {
      if (!pts || pts.length < 2) return;
      ctx.save();
      ctx.setLineDash(guion);
      ctx.strokeStyle = 'rgba(' + base + ',' + alpha + ')';
      ctx.lineWidth = ancho;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.restore();
      const fin = pts[pts.length - 1];
      ctx.fillStyle = 'rgba(' + base + ',' + Math.min(1, alpha + 0.15) + ')';
      ctx.beginPath();
      ctx.arc(fin.x, fin.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    linea(principal, 0.55, 2, [2, 7]);

    // La division del racimo: el punto donde se abre en tres es LA decision de
    // esa arma (partirse cerca del blanco o lejos cambia de 0-1 impactos a
    // 2-3), asi que se dibuja como un evento, no como un vertice mas.
    const ramas = preview.ramas || [];
    ramas.forEach(function (r) { linea(r, 0.34, 1.5, [2, 5]); });

    if (preview.division) {
      const d = preview.division;
      ctx.save();
      ctx.strokeStyle = 'rgba(' + base + ',0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      // Cuatro chispas cortas hacia afuera: se lee como "acá se abre".
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 4) + i * (Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(d.x + Math.cos(a) * 8, d.y + Math.sin(a) * 8);
        ctx.lineTo(d.x + Math.cos(a) * 12, d.y + Math.sin(a) * 12);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // --- Viento ---------------------------------------------------------------
  //
  // Venia siendo una linea de texto de 14 px ("Viento <- 77") y el usuario
  // pidio algo que se vea. No es cosmetico: el viento se sortea una vez por
  // duelo, no cambia mas, y el criterio B3 del porton es literalmente "el
  // viento se lee". Una fuerza que hay que ir a leer en numeritos no se lee.
  //
  // Dos capas, las dos escaladas por la fuerza:
  //   - rachas en el cielo, que dan la sensacion y la direccion de un vistazo;
  //   - un medidor de galones en el HUD, que da el numero exacto cuando hace
  //     falta afinar el tiro.
  // Con viento 0 no se dibuja NADA: la ausencia tambien es informacion.

  // Ruido determinista: la misma racha cae siempre en la misma altura, asi el
  // cielo no titila entre cuadros.
  function hash01(i) {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  // Se dibujan ANTES que las torres: son fondo, no interfaz. Horizontales y
  // finas a proposito, para no confundirse nunca con un proyectil (que vuela
  // en arco y es un cuerpo solido).
  function drawWindStreaks(ctx, viewW, topY, bottomY, wind, windMax, nowMs) {
    const f = Math.min(1, Math.abs(wind) / (windMax || 1));
    if (f < 0.02) return;
    const dir = wind >= 0 ? 1 : -1;
    const n = Math.round(3 + 11 * f);
    const largo = 16 + 78 * f;
    const vel = 30 + 300 * f;              // px/s
    const alto = Math.max(10, bottomY - topY);
    const ciclo = viewW + largo + 200;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const y = topY + hash01(i * 3.1) * alto;
      const desfase = hash01(i * 7.7) * ciclo;
      const avance = (nowMs / 1000) * vel * (0.7 + hash01(i * 5.3) * 0.6);
      let x = ((desfase + avance) % ciclo) - 100;
      if (dir < 0) x = viewW - x;
      const l = largo * (0.55 + hash01(i * 11.9) * 0.45);
      const a = (0.06 + 0.20 * f) * (0.5 + hash01(i * 2.3) * 0.5);
      ctx.strokeStyle = 'rgba(232,220,200,' + a.toFixed(3) + ')';
      ctx.lineWidth = 1 + 1.6 * f * hash01(i * 4.7);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + l * dir, y);
      ctx.stroke();
      // Punta: dos trazos cortos que marcan hacia donde sopla.
      const px = x + l * dir;
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px - 5 * dir, y - 2.5);
      ctx.moveTo(px, y);
      ctx.lineTo(px - 5 * dir, y + 2.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Medidor del HUD: galones que crecen en cantidad y en tamaño con la fuerza,
  // apuntando hacia donde sopla, y el numero al lado.
  function drawWindGauge(ctx, cx, cy, wind, windMax) {
    const f = Math.min(1, Math.abs(wind) / (windMax || 1));
    const dir = wind >= 0 ? 1 : -1;
    const valor = Math.abs(wind).toFixed(0);
    const galones = f < 0.02 ? 0 : 1 + Math.round(3 * f);
    const paso = 6 + 4 * f;
    const alturaGalon = 4 + 5 * f;
    const anchoGalones = galones ? (galones - 1) * paso + 7 : 0;

    ctx.save();
    ctx.font = 'bold 15px sans-serif';
    const anchoNum = ctx.measureText(valor).width;
    const sep = galones ? 9 : 0;
    const total = anchoGalones + sep + anchoNum;
    // El grupo entero queda centrado, y adentro el numero va del lado
    // CONTRARIO a donde sopla: asi los galones siempre apuntan hacia afuera y
    // la direccion se lee sin pensarla.
    let x = cx - total / 2;
    const xNum = dir > 0 ? x : x + anchoGalones + sep;
    const xGal = dir > 0 ? x + anchoNum + sep : x;

    ctx.fillStyle = f < 0.02 ? 'rgba(201,189,168,0.55)' : 'rgb(232,220,200)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(valor, xNum, cy);

    ctx.strokeStyle = 'rgba(232,220,200,' + (0.45 + 0.5 * f).toFixed(2) + ')';
    ctx.lineWidth = 1.5 + f;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < galones; i++) {
      const gx = xGal + i * paso;
      const punta = gx + (dir > 0 ? 7 : 0);
      const cola = gx + (dir > 0 ? 0 : 7);
      ctx.beginPath();
      ctx.moveTo(cola, cy - alturaGalon);
      ctx.lineTo(punta, cy);
      ctx.lineTo(cola, cy + alturaGalon);
      ctx.stroke();
    }
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  // Escudo chiquito del rival. Lleno = puede interceptar; se vacia mientras
  // esta en enfriamiento. Naranja de torreta, que ya es el color del rival.
  function drawShieldGauge(ctx, cx, cy, enfriamiento) {
    const listo = enfriamiento <= 0;
    const r = 7;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.85, cy - r * 0.45);
    ctx.lineTo(cx + r * 0.85, cy + r * 0.35);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r * 0.85, cy + r * 0.35);
    ctx.lineTo(cx - r * 0.85, cy - r * 0.45);
    ctx.closePath();
    ctx.fillStyle = listo ? 'rgba(209,82,31,0.85)' : 'rgba(209,82,31,0.18)';
    ctx.fill();
    ctx.strokeStyle = listo ? 'rgba(255,190,120,0.95)' : 'rgba(209,82,31,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawAimArrow(ctx, startX, startY, vx, vy, maxSpeed, ok) {
    const speed = Math.hypot(vx, vy);
    const len = 26 + Math.min(1, speed / maxSpeed) * 90;
    const ang = Math.atan2(vy, vx);
    const ex = startX + Math.cos(ang) * len, ey = startY + Math.sin(ang) * len;
    ctx.strokeStyle = ok ? UI.aim : UI.aimBad;
    ctx.fillStyle = ok ? UI.aim : UI.aimBad;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 14 * Math.cos(ang - 0.5), ey - 14 * Math.sin(ang - 0.5));
    ctx.lineTo(ex - 14 * Math.cos(ang + 0.5), ey - 14 * Math.sin(ang + 0.5));
    ctx.closePath();
    ctx.fill();
  }

  // Marcas flotantes de impacto: dicen SI EL GOLPE FUE BUENO O MALO. Es el
  // arreglo del hallazgo mas importante de la iteracion 0 -- pegarle 8 de daño
  // y pegarle 37 se veian exactamente igual, y por eso se pudieron tirar 19
  // disparos con el arma equivocada sin enterarse nunca.
  function drawHitMarks(ctx, marcas, nowMs) {
    marcas.forEach(function (m) {
      const t = (nowMs - m.at) / m.duracion;
      if (t > 1) return;
      const subir = t * 26;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.textAlign = 'center';
      ctx.font = 'bold ' + (m.calidad > 0.66 ? 15 : m.calidad < 0.34 ? 11 : 13) + 'px sans-serif';
      ctx.fillStyle = m.calidad > 0.66 ? '#9fe870' : m.calidad < 0.34 ? '#ff8b8b' : '#e8d7c3';
      ctx.fillText(m.texto, m.x, m.y - subir);
      ctx.restore();
    });
  }

  // --- Defensa con la mano derecha ----------------------------------------
  // Dos botones fijos abajo a la derecha. El motivo no es comodidad: todo el
  // juego vivia en el pulgar izquierdo -- la gomera, reparar y interceptar
  // caian los tres sobre la torre propia, en la misma esquina y con el mismo
  // dedo. Con un boton fijo, interceptar deja de ser un problema de punteria
  // (tocar un objeto chico y rapido) y pasa a ser uno de TIMING, que es lo que
  // el diseño siempre dijo que era. Y el boton ES el aviso: antes el destello
  // estaba en el proyectil, lejos y tapado por la propia mano.
  function drawDefenseButtons(ctx, botones, estado, nowMs) {
    if (!botones) return;

    function base(b, activo, apagado) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = activo ? 'rgba(255,210,63,0.20)' : 'rgba(36,16,5,0.72)';
      ctx.fill();
      ctx.lineWidth = activo ? 3 : 2;
      ctx.strokeStyle = apagado ? 'rgba(255,255,255,0.16)'
                                : (activo ? UI.aim : 'rgba(255,255,255,0.34)');
      ctx.stroke();
    }

    // --- Interceptar ---
    const bi = botones.interceptar;
    const armado = estado.interceptar.armado && estado.interceptar.cooldownPct <= 0;
    const pulso = 0.6 + 0.4 * Math.sin(nowMs / 90);
    base(bi, armado, estado.interceptar.cooldownPct > 0);
    if (armado) {
      // Halo latiendo: se ve incluso con el ojo en la torre.
      ctx.globalAlpha = 0.35 * pulso;
      ctx.beginPath();
      ctx.arc(bi.x, bi.y, bi.r + 6 + pulso * 4, 0, Math.PI * 2);
      ctx.strokeStyle = UI.aim;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Anillo que se cierra: cuanto queda de ventana.
      ctx.beginPath();
      ctx.arc(bi.x, bi.y, bi.r - 5, -Math.PI / 2,
              -Math.PI / 2 + Math.PI * 2 * estado.interceptar.ventanaPct);
      ctx.strokeStyle = UI.aim;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    if (estado.interceptar.cooldownPct > 0) {
      // Barrido de recarga.
      ctx.beginPath();
      ctx.moveTo(bi.x, bi.y);
      ctx.arc(bi.x, bi.y, bi.r, -Math.PI / 2,
              -Math.PI / 2 + Math.PI * 2 * (1 - estado.interceptar.cooldownPct));
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = armado ? UI.aim : 'rgba(232,215,195,0.6)';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('✋', bi.x, bi.y + 1);
    ctx.font = '9px sans-serif';
    ctx.fillText('PARAR', bi.x, bi.y + 16);

    // --- Reparar ---
    const br = botones.reparar;
    const rDisp = estado.reparar.hayAlgo && estado.reparar.alcanzaEnergia;
    base(br, false, !rDisp);
    ctx.fillStyle = rDisp ? UI.repair : 'rgba(95,208,138,0.32)';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('🔧', br.x, br.y + 1);
    ctx.font = '9px sans-serif';
    ctx.fillText(estado.reparar.costo + '⚡', br.x, br.y + 16);
  }

  // Marca en la torre rival contra que pisos el arma elegida es fuerte o floja.
  // "No termino de entender para que sirve un arma u otra": la matriz existia
  // solo como texto abstracto abajo. Aca se ve DONDE se toma la decision.
  function drawWeaponMarkers(ctx, tower, weaponKey, nowMs) {
    if (!DF.Weapons.daSenalDeMatchup(weaponKey)) return;
    const pulso = 0.55 + 0.45 * Math.sin(nowMs / 400);
    for (const f of tower.floors) {
      if (!f.alive || f.collapsing) continue;
      ensureRenderY(f);
      // Mismo criterio que effectivenessText(), a proposito: si el texto dice
      // "+ Metal/Piedra", la torre tiene que marcar metal Y piedra. Con un
      // umbral normalizado (0.66) el material del medio caia en 0.64 y no se
      // marcaba, asi que el cartel y la torre se contradecian.
      const w = DF.Weapons.WEAPONS[weaponKey];
      const mul = f.role === 'torreta' ? w.turretBonus : (w.materialMul[f.material] || 1);
      if (mul >= 0.95 && mul <= 1.05) continue; // neutro: no se marca
      const bueno = mul > 1.05;
      const x = tower.originX + f.width + 7;
      const y = f.renderY + f.height / 2;
      ctx.save();
      ctx.globalAlpha = bueno ? pulso : 0.5;
      ctx.fillStyle = bueno ? '#9fe870' : '#ff8b8b';
      ctx.beginPath();
      if (bueno) {           // doble punta hacia el piso: "pegale aca"
        ctx.moveTo(x + 9, y - 6); ctx.lineTo(x, y); ctx.lineTo(x + 9, y + 6);
      } else {               // cruz chica: "aca no"
        ctx.moveTo(x + 1, y - 4); ctx.lineTo(x + 7, y + 4);
        ctx.lineTo(x + 5, y + 5); ctx.lineTo(x - 1, y - 3);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Cartel grande al cambiar de arma. El rol estaba en gris de 10 px al pie y
  // nadie lo leia.
  function drawWeaponToast(ctx, viewW, hudTop, weapon, t) {
    const a = t < 0.15 ? t / 0.15 : (t > 0.75 ? (1 - t) / 0.25 : 1);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.textAlign = 'center';
    ctx.fillStyle = weapon.color;
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText(weapon.label, viewW / 2, hudTop + 40);
    ctx.fillStyle = '#e8d7c3';
    ctx.font = '12px sans-serif';
    ctx.fillText(weapon.rol, viewW / 2, hudTop + 58);
    ctx.restore();
  }

  DF.TowerRender2 = {
    UI: UI,
    OUTLINE: OUTLINE,
    updateRenderPositions: updateRenderPositions,
    drawArena: drawArena,
    drawTower: drawTower,
    drawAimArrow: drawAimArrow,
    drawPreview: drawPreview,
    drawShieldGauge: drawShieldGauge,
    drawWindStreaks: drawWindStreaks,
    drawWindGauge: drawWindGauge,
    drawParticles: drawParticles,
    drawRepairHints: drawRepairHints,
    drawProjectiles: drawProjectiles,
    drawSlingshot: drawSlingshot,
    drawHitMarks: drawHitMarks,
    drawDefenseButtons: drawDefenseButtons,
    drawWeaponMarkers: drawWeaponMarkers,
    drawWeaponToast: drawWeaponToast,
    nivelDeRotura: nivelDeRotura
  };
})(window.DF = window.DF || {});

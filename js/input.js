// input.js -- input táctil/mouse: arrastrar desde el punto de disparo del jugador
// (la "gomera"), calcular ángulo/potencia, disparar al soltar. Pointer Events cubre
// mouse + touch + pen con el mismo código (táctil primero, pero funciona en desktop).
(function (DF) {
  'use strict';

  // Ask First (spec): valores exactos de balance/feel del arrastre. Ajustables acá.
  const MAX_DRAG = 170;          // px de arrastre que dan potencia máxima
  const MIN_DRAG_TO_FIRE = 6;    // px, ignora taps accidentales / jitter
  const MUZZLE_GRAB_RADIUS = 60; // px, qué tan cerca de la gomera hay que empezar el arrastre
  const SPEED_MIN = 350;         // px/s a potencia mínima
  const SPEED_MAX = 1050;        // px/s a potencia máxima

  // Función pura compartida por el disparo real y la previsualización de render.js,
  // así ambos coinciden exactamente (criterio de aceptación: la trayectoria mostrada
  // durante el arrastre coincide con la que sigue el proyectil real).
  function velocityFromDrag(startX, startY, currentX, currentY) {
    const dragVecX = startX - currentX;
    const dragVecY = startY - currentY;
    const dist = Math.hypot(dragVecX, dragVecY);
    if (dist < MIN_DRAG_TO_FIRE) return null;

    const clamped = Math.min(dist, MAX_DRAG);
    const power = clamped / MAX_DRAG;
    const nx = dragVecX / dist;
    const ny = dragVecY / dist;
    const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * power;
    return { vx: nx * speed, vy: ny * speed };
  }

  // opts: { getMuzzle, isPlaying, canShoot, onFire(vx,vy), onInsufficientEnergy }
  function createInputController(canvas, opts) {
    const state = {
      dragging: false,
      pointerId: null,
      startX: 0, startY: 0,
      currentX: 0, currentY: 0
    };

    function pointerPos(evt) {
      const rect = canvas.getBoundingClientRect();
      return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
    }

    function onPointerDown(evt) {
      if (!opts.isPlaying()) return;
      if (state.dragging) return; // ya hay un arrastre en curso -- un segundo dedo no lo pisa
      if (evt.isPrimary === false) return; // segundo/tercer puntero simultáneo
      if (evt.pointerType === 'mouse' && evt.button !== 0) return; // solo click primario (no derecho/medio)

      const p = pointerPos(evt);
      const muzzle = opts.getMuzzle();
      const d = Math.hypot(p.x - muzzle.x, p.y - muzzle.y);
      if (d > MUZZLE_GRAB_RADIUS) return;

      state.dragging = true;
      state.pointerId = evt.pointerId;
      state.startX = muzzle.x;
      state.startY = muzzle.y;
      state.currentX = p.x;
      state.currentY = p.y;

      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(evt.pointerId); } catch (e) { /* Safari viejo: ignorar */ }
      }
      evt.preventDefault();
    }

    function onPointerMove(evt) {
      if (!state.dragging || evt.pointerId !== state.pointerId) return;
      const p = pointerPos(evt);
      state.currentX = p.x;
      state.currentY = p.y;
      evt.preventDefault();
    }

    function release(evt) {
      if (!state.dragging) return;
      if (evt && evt.pointerId !== state.pointerId) return;

      const v = velocityFromDrag(state.startX, state.startY, state.currentX, state.currentY);
      state.dragging = false;
      state.pointerId = null;

      if (!v) return; // arrastre demasiado corto, no cuenta como disparo

      if (!opts.canShoot()) {
        opts.onInsufficientEnergy();
        return;
      }

      opts.onFire(v.vx, v.vy);
    }

    function onPointerUp(evt) { release(evt); }
    function onPointerCancel(evt) {
      if (!evt || evt.pointerId !== state.pointerId) return; // cancel de OTRO puntero no corta el arrastre activo
      state.dragging = false;
      state.pointerId = null;
    }

    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: false });
    window.addEventListener('pointercancel', onPointerCancel, { passive: false });

    return {
      isDragging: function () { return state.dragging; },
      getDragPreview: function () {
        return { startX: state.startX, startY: state.startY, currentX: state.currentX, currentY: state.currentY };
      }
    };
  }

  DF.Input = {
    MAX_DRAG: MAX_DRAG,
    MIN_DRAG_TO_FIRE: MIN_DRAG_TO_FIRE,
    MUZZLE_GRAB_RADIUS: MUZZLE_GRAB_RADIUS,
    SPEED_MIN: SPEED_MIN,
    SPEED_MAX: SPEED_MAX,
    velocityFromDrag: velocityFromDrag,
    createInputController: createInputController
  };
})(window.DF = window.DF || {});

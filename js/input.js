// input.js -- input táctil/mouse: arrastrar desde el punto de disparo del jugador
// (la "gomera"), calcular ángulo/potencia, disparar al soltar. Pointer Events cubre
// mouse + touch + pen con el mismo código (táctil primero, pero funciona en desktop).
(function (DF) {
  'use strict';

  // Ask First (spec): valores exactos de balance/feel del arrastre. Ajustables acá.
  const MAX_DRAG = 170;          // px de arrastre que dan potencia máxima
  const MUZZLE_GRAB_RADIUS = 60; // px, radio visual de la gomera (y agarre por defecto)
  const SPEED_MIN = 350;         // px/s a potencia mínima
  const SPEED_MAX = 1050;        // px/s a potencia máxima

  // Zona de cancelación (playtest externo 2026-09-14, 5 de 5 lo pidieron):
  // "una vez que hiciste click no hay forma de cancelar el disparo, estás
  // obligado a disparar". Era literal -- este umbral valía 6 px, menos que el
  // jitter de un dedo apoyado, así que cualquier roce disparaba y no existía
  // ninguna vía de escape.
  //
  // Con 30 px la zona se vuelve USABLE a propósito: arrastrás de vuelta hacia
  // la gomera y soltás sin disparar, como en Angry Birds (que los propios
  // testers citaron). El precio sería perder el tramo más débil de potencia,
  // así que la potencia se remapea sobre [MIN_DRAG_TO_FIRE, MAX_DRAG] en vez de
  // [0, MAX_DRAG]: los dos extremos (SPEED_MIN y SPEED_MAX) se conservan
  // exactos y sólo cambia la curva intermedia. El alcance del arma no se toca.
  const MIN_DRAG_TO_FIRE = 30;   // px, por debajo de esto el disparo se CANCELA

  // Función pura compartida por el disparo real y la previsualización de render.js,
  // así ambos coinciden exactamente (criterio de aceptación: la trayectoria mostrada
  // durante el arrastre coincide con la que sigue el proyectil real).
  function velocityFromDrag(startX, startY, currentX, currentY) {
    const dragVecX = startX - currentX;
    const dragVecY = startY - currentY;
    const dist = Math.hypot(dragVecX, dragVecY);
    if (dist < MIN_DRAG_TO_FIRE) return null;

    const clamped = Math.min(dist, MAX_DRAG);
    // Remapeo: la zona muerta no come rango de potencia (ver MIN_DRAG_TO_FIRE).
    const power = (clamped - MIN_DRAG_TO_FIRE) / (MAX_DRAG - MIN_DRAG_TO_FIRE);
    const nx = dragVecX / dist;
    const ny = dragVecY / dist;
    const speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * power;
    return { vx: nx * speed, vy: ny * speed };
  }

  // opts: { getMuzzle, isPlaying, canShoot, onFire(vx,vy), onInsufficientEnergy,
  //         puedeEmpezar(x,y) }
  //
  // `puedeEmpezar` es opcional y habilita el APUNTADO LIBRE (playtest externo
  // 2026-09-14): "¿se podría apuntar desde cualquier parte de la pantalla y no
  // necesariamente dentro de la gomera?". Sin ella se mantiene el agarre viejo
  // por radio, que es lo que siguen usando los dos prototipos anteriores.
  //
  // Soltar la restricción es casi gratis porque el vector YA se calcula desde
  // la gomera y no desde el punto de contacto (startX/startY = muzzle): tocar
  // lejos no mueve el origen del tiro, sólo habilita el gesto. Quién puede
  // empezar un arrastre lo decide el juego, que es el único que sabe qué hay
  // debajo del dedo (botones, piso reparable, proyectil interceptable).
  function createInputController(canvas, opts) {
    const state = {
      dragging: false,
      pointerId: null,
      startX: 0, startY: 0,
      currentX: 0, currentY: 0,
      anclaLibre: false
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
      const dMuzzle = Math.hypot(p.x - muzzle.x, p.y - muzzle.y);
      if (opts.puedeEmpezar) {
        if (!opts.puedeEmpezar(p.x, p.y)) return;
      } else {
        if (dMuzzle > MUZZLE_GRAB_RADIUS) return;
      }

      state.dragging = true;
      state.pointerId = evt.pointerId;
      // Ancla del arrastre. Dentro de la gomera se ancla EN la gomera, que es
      // el gesto de siempre: tirar del elastico. Fuera, el ancla es el punto
      // que se toco.
      //
      // La diferencia no es cosmetica, es un bug que se come el juego: el
      // arrastre se mide desde el ancla, asi que anclando siempre en la gomera
      // un simple toque a 150 px de ella YA cuenta como arrastre de 150 px y
      // dispara casi a potencia plena sin mover el dedo. Con apuntado libre eso
      // convierte la pantalla entera en un gatillo, y empeora justo la queja
      // que la zona de cancelacion venia a resolver ("si sin querer hiciste
      // click, estas obligado a disparar"). Anclando donde se toca, soltar sin
      // arrastrar no dispara nunca, toque donde toque.
      const libre = dMuzzle > MUZZLE_GRAB_RADIUS;
      state.anclaLibre = libre;
      state.startX = libre ? p.x : muzzle.x;
      state.startY = libre ? p.y : muzzle.y;
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
        return { startX: state.startX, startY: state.startY,
                 currentX: state.currentX, currentY: state.currentY,
                 anclaLibre: state.anclaLibre };
      },
      // El render necesita saberlo para AVISAR que soltar acá no dispara. Una
      // zona de cancelación que no se ve no sirve de nada: el jugador tiene que
      // enterarse antes de soltar, no después.
      enCancelacion: function () {
        if (!state.dragging) return false;
        return Math.hypot(state.startX - state.currentX,
                          state.startY - state.currentY) < MIN_DRAG_TO_FIRE;
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

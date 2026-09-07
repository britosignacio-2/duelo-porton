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

  // Gravedad bajada de 1400. Con la escala de velocidad de duel2-projectile
  // el alcance queda igual y el vuelo se estira ~30%: los arcos se leen, y
  // cada disparo deja de ser un reflejo.
  const GRAVITY = 800;
  const FLOOR_W_MIN = 46;
  const FLOOR_W_MAX = 90;
  const MARGIN_RATIO = 0.06;
  const MUZZLE_PAD = 30;
  const MIN_GAP_RATIO = 0.32;
  const MIN_GAP_PX = 140;
  // Techo de la distancia entre gomeras, en px. 470 es la geometria con la que
  // se calibro el viento en la it.4 (un viewport de 800 daba 464). Ver el
  // comentario en layout(): sin tope, una pantalla mas ancha exige un alcance
  // que las armas no tienen.
  const GAP_MAX = 470;
  let FLOOR_W = 70;

  // Vida por piso x2,9 (venia de muro 35 / torreta 30). No es un ajuste de
  // duracion suelto: viene atado a la bajada de 8 pisos a 5 (ver LAYOUT).
  // Menos pisos = menos vida total = duelos aun mas cortos, y C3 ya venia
  // fallando con 78 s contra un objetivo de 120-210. Con 4 muros de 100 y una
  // torreta de 85 la torre queda en 485 hp, x1,8 de los 270 que tenia: el
  // factor que el banco calculo que hace falta para llegar al objetivo.
  //
  // Efecto de diseño que interesa mas que la duracion: si bajar un piso cuesta
  // cuatro o cinco tiros en vez de dos, elegir el arma correcta para ESE
  // material se acumula en vez de decidirse en un tiro suelto. Recien ahi el
  // material es una decision.
  const FLOOR_HP = { torreta: 85, muro: 100 };
  const FLOOR_H_MAX = 40;
  const FLOOR_H_MIN = 18;
  let FLOOR_H_CUR = FLOOR_H_MAX;

  // El mundo vive ENTRE estas dos bandas, nunca debajo. La banda inferior
  // crecio a 78 para alojar los dos botones de defensa de la derecha.
  const HUD_TOP = 44;
  const HUD_BOTTOM = 78;

  // CINCO pisos. La iteracion 2 los habia subido de 5 a 8 "porque los
  // arquetipos necesitan espacio vertical para diferenciarse". El razonamiento
  // era bueno y la medicion estaba mal hecha: se decidio mirando un canvas de
  // escritorio. En un telefono EN HORIZONTAL no hay espacio vertical.
  //
  // `layout()` reparte el 70% del alto disponible entre los pisos:
  //   FLOOR_H = clamp(floor((viewH - 126) * 0.70 / n), 18, 40)
  // Hacen falta 583 px de alto para pisos de 40 con n=8. Un telefono en
  // horizontal con la barra del navegador da ~215: el reparto se rinde, clava
  // el minimo de 18 px, y la torre de 144 px se pasa del techo del HUD.
  //
  // Consecuencia medida (tools/banco/piso-objetivo.js): de cada diez impactos,
  // DOS caen en el piso al que se apunto. Y ahi se cae toda la promesa de
  // arma-vs-material, porque el material vive en un piso y el piso no se puede
  // elegir -- la calidad de eleccion de arma dio 0,54 (azar) en la sesion 5
  // aunque el jugador estuviera eligiendo a proposito.
  //
  // Pegarle AL piso que se apunta, en horizontal a pantalla completa:
  //   8 pisos (20 px) 23%  ·  6 (27 px) 32%  ·  5 (32 px) 36%  ·  4 (40 px) 44%
  //
  // Cinco es el punto donde el blanco vuelve a ser elegible sin que la torre
  // deje de ser una torre. La torreta va en el medio, nunca en un extremo,
  // para que haya que atravesar muro para llegarle. Los cuatro muros mantienen
  // la variedad de materiales, que con menos pisos es lo que hay que cuidar.
  //
  // El GDD deja la cantidad de slots de muro como `[ASUNCION: pendiente de
  // balanceo]`; esto es la primera respuesta medida a esa asuncion.
  const LAYOUT = ['muro', 'muro', 'torreta', 'muro', 'muro'];

  const STARTING_ENERGY = 51;
  // Bajado de 260. El desvio del viento crece con el CUADRADO del tiempo de
  // vuelo, asi que al alargar el vuelo ~30% en la iteracion 3 el viento se
  // volvio ~69% mas fuerte sin tocarle el numero. Medido: con viento maximo
  // en contra, el cohete llegaba a 436 px y el mortero a 435 cuando la torre
  // rival esta a 458 -- no llegaban ni a potencia plena. Y de paso empujaba
  // al jugador al perforador, que es el arma que menos sufre el viento
  // (windMul 0.7) y se llevo el 57.7% de los disparos.
  // Bajado de 150 (it.6). Con el arena ya capado por GAP_MAX, en el peor caso
  // -- viento maximo en contra y gomera en su posicion mas baja -- el cohete
  // llegaba justo al 1,02x de la distancia necesaria: reachable en la teoria,
  // un solo angulo a potencia plena en la practica. Por la leccion del mortero
  // de la it.1, eso se juega igual que "no llega". Margen del cohete por nivel
  // de viento: 150 -> 1,02x · 110 -> 1,12x · 90 -> 1,18x · 75 -> 1,22x.
  // A 90 el viento le sigue comiendo el 21% del alcance, o sea sigue pesando
  // fuerte, pero desaparece la zona muerta. Elegido por el usuario.
  const WIND_MAX = 90;
  const MUZZLE_HEIGHT_MIN = 0.42;
  const MUZZLE_HEIGHT_MAX = 0.78;

  const REPAIR_COST = 34;
  const REPAIR_AMOUNT = 14;
  const REPAIR_MIN_USEFUL = REPAIR_AMOUNT * 0.5;

  // Ventana de intercepcion. Venia de 400 ms, que es el filo del papel: la
  // reaccion humana simple es ~250 ms y con decision de por medio ~350. Con el
  // gesto viejo (tocar el proyectil) era directamente injugable -- 1 acierto en
  // 5 intentos, y dos de esos intentos fueron sobre proyectiles que ni siquiera
  // iban a pegar. Con el boton fijo de la derecha, 700 ms es exigente pero
  // jugable.
  const INTERCEPT_WINDOW_MS = 700;
  const INTERCEPT_TAP_RADIUS = 40;   // sigue valiendo tocar el proyectil directo
  const INTERCEPT_TRY_RADIUS = 60;
  // Sin limite, un boton grande volveria la intercepcion automatica y aburrida.
  // Con cooldown, la IA dispara mas seguido de lo que se puede frenar y aparece
  // la decision real: cual parás. Sigue sin costar energia (FR30).
  const INTERCEPT_COOLDOWN_MS = 3500;
  const ETA_REFRESH_MS = 150;

  const ROUND_LIMIT_MS = 180000;
  const ESCALATION_START_MS = 90000;
  const ESCALATION_MAX_MULT = 2.0;
  // Bajada de los 14/s que trae energy.js (que se deja intacto porque lo
  // comparte el prototipo validado). Con 14 se podia actuar cada ~1.8 s, y a
  // ese ritmo la eleccion de arma dio 0.51 de calidad: azar. Con 10 un
  // disparo pasa a ser un compromiso.
  const BASE_REGEN = 10;

  // La IA telegrafia el disparo antes de soltarlo. Sin esto el rival no se
  // lee: le llueven proyectiles al jugador como si fuera clima.
  const AI_TELL_MS = 650;
  // Piso duro entre disparos de la IA. En la iteracion 2 tiraba cada 1.83 s y
  // el jugador sentia que tenia que correrle: "apretas botones y tiras rapido
  // sin pensar". El intervalo no reemplaza al costo ni al cooldown, los
  // complementa: es el techo de agresividad del rival.
  const AI_MIN_INTERVAL_MS = 2400;

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
  // Error de punteria de la IA. Se sobreescribe aca en vez de tocar ai.js,
  // que lo comparte el prototipo validado. Con el apuntado por simulacion la
  // IA paso de acertar 13 de 77 a ~85%, mas que el propio jugador (73% en el
  // ultimo log): habia que subirle el error, no bajarle la punteria. Este es
  // el parametro que FR35 va a exponer como niveles de dificultad.
  // `speedErrorRatio` 0,22 -> 0,15 (it.6). Medido en `tools/banco/ia-perillas.js`:
  // de las dos perillas, la del ANGULO casi no mueve la aguja y la de la
  // POTENCIA manda. Desde el ajuste anterior, llevar el angulo a 0 subia el
  // acierto 11 puntos; llevar la potencia a 0 lo subia 30. Por eso se toca una
  // sola: ademas de ser la que sirve, deja el proximo log atribuible.
  //
  // Con 485 hp de torre y viento 90, la IA pasa de 52% de acierto y 107 s para
  // tumbarte a 63% y 86 s. Sobre eso hay que descontar lo que la sesion 6
  // midio jugando: le interceptaste 20 de 73 disparos y la torre se achica a
  // medida que avanza el duelo, asi que su numero efectivo es ~la mitad. El
  // objetivo es que pueda cerrar en ~150 s -- que sea una pelea, no que gane.
  //
  // FR35 debe exponer ESTA perilla, no `angleErrorMax`.
  // DISPERSION DEL PUNTO DE IMPACTO, en pixeles. Reemplaza al error angular
  // (0,30 rad) y de potencia (0,15) de las iteraciones anteriores.
  //
  // El error angular producia dificultades distintas segun la distancia, y por
  // lo tanto segun como estuviera agarrado el telefono. Medido dentro del
  // juego en vertical (gomeras a 140 px): el cohete de la IA acertaba 95% y la
  // piedra 10%. Causa: el alcance va con sin(2t), y a corta distancia la
  // solucion es un tiro casi plano -- 11,7 grados de media, que el error
  // abria de -5,2 a 28,9. A 12 grados un error de 17 MAS QUE DUPLICA el
  // alcance; a 45, que es la solucion tipica en horizontal, casi no lo mueve.
  //
  // Dispersando el BLANCO en pixeles, la dificultad significa lo mismo a
  // cualquier distancia y en cualquier orientacion, y se puede expresar en una
  // unidad que un diseñador entiende: "le erra por 75 px". Es la perilla que
  // FR35 tiene que exponer.
  //
  // 75 px sale del simulador de duelo completo (`tools/banco/duelo-completo.js`),
  // que modela a ESTE jugador con sus numeros medidos y busca el objetivo de
  // diseño de que la IA gane el 30-40%: 50 px -> gana 53%, 70 px -> 33%,
  // 90 px -> 29%, 110 px -> 19%.
  const AI_DISPERSION_PX = 75;
  // Registro de disparos: un gatillo, un evento. Ver duel2-shotlog.js.
  const shotLog = DF.ShotLog.createShotLog({
    log: function (type, data) { DF.Telemetry.log(type, data); },
    duelIndex: function () { return duelIndex; },
    pisoIndex: function (floor) { return aiTower.floors.indexOf(floor); },
    weaponInfo: function (key) { return DF.Weapons.WEAPONS[key]; }
  });
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
  // Intencion de la IA: a que piso le quiere pegar y con que. Sobrevive entre
  // cuadros hasta que puede disparar. Ver updateAI.
  let aiIntent = null;    // { target, weaponKey }
  let aiLastShotAt = 0;
  let lastStretchStep = -1;
  let previewPoints = null;
  // Botones de defensa, abajo a la derecha: son para el pulgar DERECHO, que
  // hasta ahora no hacia nada. Todo el juego vivia en el pulgar izquierdo --
  // la gomera, reparar y interceptar caian los tres sobre la torre propia, en
  // la misma esquina y con el mismo dedo.
  let defenseButtons = null;
  let interceptReadyAt = 0;
  // Cartel grande al cambiar de arma: el rol estaba en gris de 10 px abajo y
  // nadie lo leia. "No termino de entender para que sirve un arma u otra."
  let weaponToast = null;

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

    // TOPE de la distancia entre gomeras. Sin esto, todo el ancho que sobra se
    // va al hueco del medio, y entonces cada telefono juega un juego distinto:
    // el alcance de las armas es fijo (lo dan la gravedad y SPEED_MAX) pero la
    // distancia a cubrir crece con la pantalla.
    //
    // Lo destapo la pantalla completa de la it.5: el viewport paso de ~800 a
    // 915 px de ancho y las gomeras de 464 a 565 px. Medido con la gomera en su
    // posicion mas baja y viento maximo en contra, el cohete llegaba a 510 px y
    // el mortero a 532 contra los 595 que hacian falta: **no llegaban**. Es el
    // mismo modo de falla que el mortero al que le faltaba un pixel en la it.1
    // -- un arma que no llega no es dificil, es imposible, y eso nunca es una
    // decision de diseño.
    //
    // El GDD ya lo pedia: "la proporcion geometrica gomera-a-gomera que
    // garantiza tiempo de vuelo real no cambia entre arenas". El ancho que
    // sobra pasa a ser margen a los costados.
    const margenExtra = Math.max(0,
      (viewW - 2 * margin - 2 * FLOOR_W - 2 * MUZZLE_PAD - GAP_MAX) / 2);
    const margenReal = margin + margenExtra;

    playerTower.originX = margenReal;
    playerTower.groundY = groundY;
    aiTower.originX = viewW - margenReal - FLOOR_W;
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

    // Banda inferior, de izquierda a derecha: energia + armas, despues el
    // texto del arma, y a la derecha del todo los dos botones de defensa.
    const n = DF.Weapons.ORDER.length;
    const gap = 4;
    const anchoTotal = Math.min(viewW * 0.46, n * 44 + (n - 1) * gap);
    const bw = (anchoTotal - (n - 1) * gap) / n;
    weaponButtons = DF.Weapons.ORDER.map(function (key, i) {
      return { key: key, x: 10 + i * (bw + gap), y: viewH - 58, w: bw, h: 26 };
    });

    // 60 px de diametro: por encima del minimo comodo de toque en mobile.
    const r = 30;
    defenseButtons = {
      interceptar: { x: viewW - 116, y: viewH - 40, r: r },
      reparar:     { x: viewW - 46,  y: viewH - 40, r: r }
    };
  }

  function spawnProjectile(x, y, vx, vy, owner, weaponKey) {
    const p = DF.TowerProjectile2.createProjectile({
      x: x, y: y, vx: vx, vy: vy, owner: owner, weaponKey: weaponKey
    });
    // Un gatillo abre UN registro. Ver duel2-shotlog.js: antes se logueaba por
    // impacto y el perforador escribia dos disparos por tiro.
    p.shotId = shotLog.abrir(owner, weaponKey);
    projectiles.push(p);
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
    // Splash VISIBLE. Antes se aplicaba en silencio: el mortero hacia ~47 de
    // daño real por 34 de energia (casi el doble de eficiente que el
    // perforador) y el jugador lo usaba la mitad, porque solo veia UN impacto.
    // Estaba optimizando por impacto percibido en vez de daño real. Ahora cada
    // vecino golpeado tiene su flash, sus particulas y su numero.
    if (w.splash) {
      const idx = targetTower.floors.indexOf(floor);
      [idx - 1, idx + 1].forEach(function (i) {
        const vecino = targetTower.floors[i];
        if (!vecino || !vecino.alive || vecino.collapsing) return;
        const dmgVecino = dmgFinal * 0.4;
        DF.Tower2.applyDamage(targetTower, vecino, dmgVecino, now);
        vecino.hitFlashAt = now;
        vecino.hitFlashFuerza = 0.35;
        const cx = targetTower.originX + vecino.width / 2;
        const cy = vecino.y + vecino.height / 2;
        spawnImpactParticles(cx, cy, materialRGB(vecino), 5, 0.35);
        hitMarks.push({
          x: cx, y: cy, at: now, duracion: 650, calidad: 0.5,
          texto: String(Math.round(dmgVecino))
        });
      });
    }

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
        shotLog.impacto(p.shotId, r.floor, res.calidad);
        // El perforador SIGUE volando hacia el piso de atras: el disparo
        // todavia no termino, y por eso no se cierra el registro aca.
        if (!r.sigue) { shotLog.cerrarUno(p.shotId); projectiles.splice(i, 1); }
      } else if (r.rebote) {
        DF.Sfx.playBounce();
        spawnImpactParticles(r.x, r.y, { r: 120, g: 100, b: 80 }, 5, 0.3);
      } else if (r.divide) {
        DF.Sfx.playSplit();
        const frags = DF.TowerProjectile2.splitCluster(p);
        // Los fragmentos son el MISMO disparo: heredan el registro en vez de
        // abrir uno nuevo (o de desaparecer del log, que es lo que pasaba).
        frags.forEach(function (f) { f.shotId = p.shotId; nuevos.push(f); });
        shotLog.dividir(p.shotId, frags.length);
        projectiles.splice(i, 1);
      } else if (r.outOfBounds) {
        if (r.explotaEnSuelo) {
          spawnImpactParticles(r.x, r.y, { r: 120, g: 100, b: 80 }, 8, 0.4);
          DF.Sfx.playBounce();
        }
        shotLog.cerrarUno(p.shotId);
        projectiles.splice(i, 1);
      }
    }
    nuevos.forEach(function (f) { projectiles.push(f); });
  }

  // Apuntado de la IA POR SIMULACION, no por formula.
  //
  // `DF.AI.computeAimVelocity` resuelve una parabola balistica pura: ignora la
  // escala global de velocidad (0.75), el speedMul de cada arma, el empuje del
  // cohete, el reparto de arco del mortero, los rebotes de la granada y el
  // viento. Como despues `initialVelocity` multiplica ese resultado, la IA
  // apuntaba bien y el juego le acortaba el tiro: en la iteracion 3 acerto 13
  // de 77 disparos (piedra 1/23, mortero 1/19, cohete 0/14) y el jugador gano
  // los tres duelos con 61%, 66% y 72% de su torre intacta.
  //
  // Aca la IA barre angulos y potencias con el MISMO integrador que usa el
  // vuelo real, y se queda con la combinacion que pasa mas cerca del blanco.
  // Sale correcta para los seis arquetipos sin casos especiales, y sigue
  // siendo correcta si la fisica vuelve a cambiar. Despues se le suma el error
  // de punteria, que es lo que gradua la dificultad.
  function apuntarPorSimulacion(weaponKey, desde, objetivo) {
    const dir = objetivo.x < desde.x ? -1 : 1;
    let mejor = null;
    const NA = 11, NP = 9;
    for (let ia = 0; ia < NA; ia++) {
      const ang = (12 + (ia / (NA - 1)) * 68) * Math.PI / 180;
      for (let ip = 0; ip < NP; ip++) {
        const S = DF.Input.SPEED_MIN + (ip / (NP - 1)) * (DF.Input.SPEED_MAX - DF.Input.SPEED_MIN);
        const iv = DF.TowerProjectile2.initialVelocity(weaponKey, dir * Math.cos(ang) * S, -Math.sin(ang) * S);
        const sim = DF.TowerProjectile2.createProjectile({
          x: desde.x, y: desde.y, vx: iv.vx, vy: iv.vy, owner: 'ai', weaponKey: weaponKey
        });
        let dmin = Infinity;
        for (let i = 0; i < 300; i++) {
          // Torre vacia a proposito: se busca la distancia minima al PUNTO,
          // no el primer choque.
          const r = DF.TowerProjectile2.updateProjectileVsTower(sim, 1 / 60, {
            gravity: GRAVITY, wind: wind, targetTower: { floors: [] },
            bounds: { width: viewW, height: viewH }, groundY: groundY, refSize: FLOOR_H_CUR
          });
          const d = Math.hypot(sim.x - objetivo.x, sim.y - objetivo.y);
          if (d < dmin) dmin = d;
          if (r.outOfBounds || r.divide) break;
        }
        if (!mejor || dmin < mejor.d) mejor = { d: dmin, ang: ang, S: S };
      }
    }
    if (!mejor) return null;
    return { vx: dir * Math.cos(mejor.ang) * mejor.S, vy: -Math.sin(mejor.ang) * mejor.S };
  }

  // Corre el blanco un poco al azar ANTES de resolver, en vez de ensuciar la
  // solucion despues. Ver AI_DISPERSION_PX: es la perilla de dificultad.
  // Disco uniforme (sqrt del radio), no cuadrado: sin eso los tiros se
  // amontonarian en las esquinas del error.
  function objetivoConDispersion(objetivo) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * AI_DISPERSION_PX;
    return { x: objetivo.x + Math.cos(a) * r, y: objetivo.y + Math.sin(a) * r };
  }

  // Elige el arma de la IA. BUG CORREGIDO (iteracion 2): antes filtraba por
  // cooldown ANTES de rankear, y como la granada tiene el cooldown mas corto
  // de todas era casi siempre lo unico disponible -- resultado: 169 granadas
  // de 171 disparos, el 98.8%. Le habia armado un bucle, y ese bucle era la
  // fuente de la presion que hacia sentir el juego apurado.
  //
  // Ahora rankea TODAS por valor, elige entre las dos mejores, y si esa no
  // esta lista, ESPERA en vez de caer en la mas barata. La IA dispara menos y
  // mejor, que es exactamente lo que hace falta.
  function armaDeLaIA(floor) {
    const ranking = DF.Weapons.ORDER
      .map(function (k) {
        const w = DF.Weapons.WEAPONS[k];
        const mul = floor.role === 'torreta' ? w.turretBonus : (w.materialMul[floor.material] || 1);
        return { k: k, valor: w.baseDamage * mul };
      })
      .sort(function (a, b) { return b.valor - a.valor; });
    const top = ranking.slice(0, 2);
    return top[Math.floor(Math.random() * top.length)].k;
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
    // Antes de vaciar el aire: los disparos en vuelo existieron como gatillo y
    // se emiten con lo que tengan. Tirarlos sesgaria la punteria a la baja.
    shotLog.cerrarTodos();
    projectiles = [];
    aiPending = null;
    aiIntent = null;
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
    // Red de seguridad: si algo quedo abierto, se emite ANTES de rearmar las
    // torres -- despues, `pisoImpactado` apuntaria a una torre que ya no existe.
    shotLog.cerrarTodos();
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
    aiLastShotAt = 0;
    interceptReadyAt = 0;
    weaponToast = null;
    aiPending = null;
    aiIntent = null;
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
      // La geometria cambia el juego mas que casi cualquier constante: a
      // 800x450 las gomeras quedan a 464 px y en un telefono vertical a 140,
      // y con eso se mueven el alcance, la dificultad y hasta que arma sirve.
      // Sin esto en el log, ningun numero de punteria se puede comparar entre
      // sesiones -- ni contra el banco, que hay que correr en el mismo viewport.
      viewW: viewW, viewH: viewH,
      distanciaGomeras: Math.round(aiMuzzle.x - playerMuzzle.x),
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
      shotLog.cerrarUno(best.shotId, { interceptado: true });
      projectiles.splice(projectiles.indexOf(best), 1);
    }
    return true;
  }

  function valeReparar(floor) {
    return DF.Tower2.repairableAmount(floor) >= REPAIR_MIN_USEFUL;
  }

  // --- Defensa con la mano derecha ---------------------------------------

  function interceptCooldown() {
    return Math.max(0, Math.min(1, (interceptReadyAt - performance.now()) / INTERCEPT_COOLDOWN_MS));
  }

  // El proyectil interceptable mas inminente. Con el boton no hay que apuntar:
  // la habilidad pasa a ser CUANDO, no DONDE, que es lo que el diseño siempre
  // dijo que era ("ventana de timing").
  function proyectilInterceptable() {
    let best = null;
    for (const p of projectiles) {
      if (p.owner !== 'ai' || !p.interceptable) continue;
      if (!best || p.impactEtaMs < best.impactEtaMs) best = p;
    }
    return best;
  }

  // El piso propio mas urgente de reparar. La decision que importa es SI gastas
  // energia en reparar en vez de disparar, no CUAL piso -- eso casi siempre es
  // el mas roto. Sacar la eleccion tonta deja la interesante.
  function pisoMasUrgente(tower) {
    let best = null, peor = Infinity;
    for (const f of (tower || playerTower).floors) {
      if (!valeReparar(f)) continue;
      const pct = f.hp / f.maxHp;
      if (pct < peor) { peor = pct; best = f; }
    }
    return best;
  }

  function apretarInterceptar() {
    if (interceptCooldown() > 0) return;
    const p = proyectilInterceptable();
    DF.Telemetry.log('intercept_try', {
      duelIndex: duelIndex, success: !!p, via: 'boton',
      msAntesDeImpacto: p && isFinite(p.impactEtaMs) ? Math.round(p.impactEtaMs) : null,
      enVuelo: projectiles.filter(function (q) { return q.owner === 'ai'; }).length
    });
    if (!p) return;
    interceptReadyAt = performance.now() + INTERCEPT_COOLDOWN_MS;
    spawnImpactParticles(p.x, p.y, { r: 255, g: 210, b: 63 }, 18, 0.9);
    DF.Sfx.playIntercept();
    triggerShake(6);
    hitMarks.push({ x: p.x, y: p.y, at: performance.now(), duracion: 700, calidad: 1, texto: '¡AL VUELO!' });
    shotLog.cerrarUno(p.shotId, { interceptado: true });
    projectiles.splice(projectiles.indexOf(p), 1);
  }

  function apretarReparar() {
    const f = pisoMasUrgente();
    if (!f) return;
    if (playerEnergy.value < REPAIR_COST) {
      DF.Energy.flagInsufficient(playerEnergy, performance.now() / 1000);
      return;
    }
    aplicarReparacion(playerTower, playerEnergy, f, true);
  }

  function hitDefenseButton(x, y) {
    if (!defenseButtons) return null;
    for (const k in defenseButtons) {
      const b = defenseButtons[k];
      if (Math.hypot(x - b.x, y - b.y) <= b.r + 6) return k;
    }
    return null;
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
    return aplicarReparacion(playerTower, playerEnergy, floor, true);
  }

  // Compartido por el toque sobre el piso y por el boton de la derecha.
  // Sirve para las dos torres: desde la it.7 la IA tambien repara. La
  // asimetria anterior era grande y silenciosa -- el jugador gastaba ~13% de
  // su energia reparando y el rival no reparaba nunca, o sea competia con una
  // herramienta menos. Darsela es lo simetrico; el elastico de regalarle
  // punteria cuando va perdiendo, no.
  function aplicarReparacion(tower, energy, floor, esJugador) {
    const curado = DF.Tower2.repairFloor(tower, floor, REPAIR_AMOUNT);
    if (curado <= 0) return false;
    energy.value = Math.max(0, energy.value - REPAIR_COST);
    floor.repairFlashAt = performance.now();
    DF.Sfx.playRepair();
    hitMarks.push({
      x: tower.originX + floor.width / 2, y: floor.y,
      at: performance.now(), duracion: 700, calidad: 0.5, texto: '+' + Math.round(curado)
    });
    DF.Telemetry.log(esJugador ? 'repair' : 'ai_repair', {
      duelIndex: duelIndex, energia: REPAIR_COST, curado: +curado.toFixed(1),
      material: floor.material || floor.role,
      techoRestantePct: +(floor.repairCeiling / floor.maxHp).toFixed(3)
    });
    return true;
  }

  // Previsualizacion: simula hacia adelante con el MISMO integrador del vuelo
  // real, sobre una copia. Solo para los arquetipos no intuitivos.
  // Previsualizacion. Antes cortaba el dibujo justo en la division del racimo
  // ("de ahi en mas se abre en tres: no se promete nada") -- y ese era
  // exactamente el dato que hace util al arma. Medido: si el racimo se parte a
  // mas de 350 px de la torre, pegan 0 o 1 fragmentos; si se parte a 180-220,
  // pegan 2 o 3. O sea que hay un tiro bueno, depende enteramente de DONDE se
  // parte, y el jugador no tenia forma de verlo. Reporte textual suyo: "se
  // divide en 3 pero casi siempre solo uno impacta". Tenia razon, y la causa
  // no era la dispersion: era que estaba tirando el tiro equivocado a ciegas.
  //
  // Devuelve { principal, division, ramas } -- el tramo hasta la division, el
  // punto donde se abre, y las tres trayectorias hijas.
  function simularTramo(p, pasos) {
    const pts = [{ x: p.x, y: p.y }];
    const dt = 1 / 60;
    for (let i = 0; i < pasos; i++) {
      const r = DF.TowerProjectile2.updateProjectileVsTower(p, dt, {
        gravity: GRAVITY, wind: wind, targetTower: aiTower,
        bounds: { width: viewW, height: viewH }, groundY: groundY, refSize: FLOOR_H_CUR
      });
      pts.push({ x: p.x, y: p.y });
      if (r.hit || r.outOfBounds) return { pts: pts, fin: r };
      if (r.divide) return { pts: pts, fin: r };
    }
    return { pts: pts, fin: {} };
  }

  function computePreview(vx, vy) {
    const w = DF.Weapons.WEAPONS[currentWeaponKey];
    if (!w.preview) return null;
    const sim = DF.TowerProjectile2.createProjectile({
      x: playerMuzzle.x, y: playerMuzzle.y, vx: vx, vy: vy,
      owner: 'player', weaponKey: currentWeaponKey
    });
    const tramo = simularTramo(sim, 150);
    const out = { principal: tramo.pts, division: null, ramas: [] };
    if (tramo.fin.divide) {
      out.division = { x: sim.x, y: sim.y };
      DF.TowerProjectile2.splitCluster(sim).forEach(function (f) {
        out.ramas.push(simularTramo(f, 150).pts);
      });
    }
    return out;
  }

  function setupInput() {
    // Router de gestos (FR32): HUD > interceptar > reparar > arrastrar.
    canvas.addEventListener('pointerdown', function (evt) {
      const rect = canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left, y = evt.clientY - rect.top;
      DF.Sfx.unlock();
      if (state.phase !== 'playing') return;

      // Los botones de defensa van primero: son el destino del pulgar derecho
      // y no deben competir con nada.
      const def = hitDefenseButton(x, y);
      if (def) {
        if (def === 'interceptar') apretarInterceptar(); else apretarReparar();
        evt.preventDefault();
        evt.stopImmediatePropagation();
        return;
      }

      const key = hitWeaponButton(x, y);
      if (key) {
        if (key !== currentWeaponKey) {
          DF.Telemetry.log('weapon_switch', { duelIndex: duelIndex, from: currentWeaponKey, to: key });
          weaponToast = { key: key, at: performance.now() };
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
        weaponToast = { key: f, at: performance.now() };
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
          const v0 = apuntarPorSimulacion(aiPending.weaponKey, aiMuzzle, objetivoConDispersion(c));
          if (!v0) { aiPending = null; return; }
          const v = DF.TowerProjectile2.initialVelocity(aiPending.weaponKey, v0.vx, v0.vy);
          gastar(aiEnergy, aiPending.weaponKey);
          spawnProjectile(aiMuzzle.x, aiMuzzle.y, v.vx, v.vy, 'ai', aiPending.weaponKey);
          DF.Sfx.playShot(aiPending.weaponKey);
          aiMuzzle.disparoAt = nowMs;
          aiLastShotAt = nowMs;
        }
        aiPending = null;
      }
      return;
    }
    if (nowMs - aiLastShotAt < AI_MIN_INTERVAL_MS) return;

    // La IA repara. Misma regla que el jugador -- el piso mas urgente, mismo
    // costo -- y le cuesta el turno, igual que a el: reparar es en vez de
    // disparar. Umbral al 60% de vida para que no gaste el turno por un
    // rasguño. Medido en el simulador de duelo completo: alarga los duelos de
    // ~87 s a ~101 s (el criterio C3 pide 120-210) y le BAJA un poco las
    // victorias, porque cada reparacion es un disparo que no hace. Se elige
    // igual: la asimetria de que el rival no tuviera la herramienta era mas
    // grande que el efecto.
    if (DF.Tower2.totalHpPercent(aiTower) < 0.6 && aiEnergy.value >= REPAIR_COST) {
      const piso = pisoMasUrgente(aiTower);
      if (piso && Math.random() < 0.5) {
        if (aplicarReparacion(aiTower, aiEnergy, piso, false)) {
          aiLastShotAt = nowMs;   // le cuesta el turno
          return;
        }
      }
    }

    // La IA ESPERA por el arma que eligio. El comentario de armaDeLaIA decia
    // que ya lo hacia y no era cierto: `puedeDisparar` devolvia null y en el
    // cuadro siguiente se volvia a sortear objetivo Y arma, asi que en la
    // practica ganaba lo que estuviera disponible -- o sea lo barato. Medido:
    // el ranking puro da mortero 42% / cohete 37% / piedra 12% / granada 9%,
    // con la puerta daba mortero 32% / cohete 27% / granada 23% / piedra 18%,
    // y jugando salio mortero 33% / granada 29% / piedra 19% / cohete 18%.
    // Es el mismo bicho que el bucle de las 169 granadas de la it.2, mas
    // suave. Con la intencion guardada, la IA junta la energia y tira el arma
    // que de verdad eligio.
    if (aiIntent && (!aiIntent.target.alive || aiIntent.target.collapsing)) aiIntent = null;
    if (!aiIntent) {
      const target = randomAliveFloor(playerTower);
      if (!target) return;
      aiIntent = { target: target, weaponKey: armaDeLaIA(target) };
    }
    if (!puedeDisparar(aiEnergy, aiIntent.weaponKey)) return;   // junta y espera
    const key = aiIntent.weaponKey, target = aiIntent.target;
    aiIntent = null;
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
    // Rachas de viento: fondo, no interfaz. Van antes de las torres para que
    // pasen por detras y nunca se confundan con un proyectil.
    DF.TowerRender2.drawWindStreaks(ctx, viewW, HUD_TOP + 6, groundY - 10, wind, WIND_MAX, now);
    DF.TowerRender2.drawTower(ctx, playerTower, now);
    DF.TowerRender2.drawTower(ctx, aiTower, now);
    if (state.phase === 'playing') {
      DF.TowerRender2.drawRepairHints(ctx, playerTower, playerEnergy.value >= REPAIR_COST, now, valeReparar);
    }
    if (state.phase === 'playing') {
      DF.TowerRender2.drawWeaponMarkers(ctx, aiTower, currentWeaponKey, now);
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
    DF.Render.drawEnergyBar(ctx, 12, viewH - 74, 120, 11, playerEnergy, 'Vos', 'left');
    DF.Render.drawEnergyBar(ctx, viewW - 176, 20, 120, 12, aiEnergy, 'IA', 'right');

    // Botones de defensa: el destino del pulgar derecho.
    const objetivo = proyectilInterceptable();
    DF.TowerRender2.drawDefenseButtons(ctx, defenseButtons, {
      interceptar: {
        armado: !!objetivo,
        ventanaPct: objetivo && isFinite(objetivo.impactEtaMs)
          ? Math.max(0, Math.min(1, objetivo.impactEtaMs / INTERCEPT_WINDOW_MS)) : 0,
        cooldownPct: interceptCooldown()
      },
      reparar: {
        hayAlgo: !!pisoMasUrgente(),
        alcanzaEnergia: playerEnergy.value >= REPAIR_COST,
        costo: REPAIR_COST
      }
    }, now);

    if (weaponToast) {
      const t = (now - weaponToast.at) / 1600;
      if (t >= 1) weaponToast = null;
      else DF.TowerRender2.drawWeaponToast(ctx, viewW, HUD_TOP, DF.Weapons.WEAPONS[weaponToast.key], t);
    }

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
    // Corta antes de los botones de defensa, que viven en la esquina derecha.
    const limite = (defenseButtons ? defenseButtons.interceptar.x - defenseButtons.interceptar.r : viewW) - 14;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, viewH - 78, Math.max(0, limite - x), 78);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.fillStyle = DF.TowerRender2.UI.aim;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(w.label, x, viewH - 46);
    // El ROL es lo que hace que la eleccion sea espacial y no aritmetica.
    ctx.fillStyle = '#c9bda8';
    ctx.font = '10px sans-serif';
    ctx.fillText(w.rol, x, viewH - 33);
    const partes = [eff.strong, eff.weak, eff.splash].filter(Boolean).join('   ');
    if (partes) {
      ctx.fillStyle = '#9fd6a0';
      ctx.fillText(partes, x, viewH - 20);
    }
    ctx.restore();
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
    DF.TowerRender2.drawWindGauge(ctx, viewW / 2, 15, wind, WIND_MAX);
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
    ctx.fillText(m + ':' + (s < 10 ? '0' : '') + s, viewW / 2, 37);
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
    ctx.fillText('🔧 abajo a la derecha repara el piso más dañado', viewW / 2, HUD_TOP + 22);
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
      weaponReadyAt: function () { return weaponReadyAt; },
      defenseButtons: function () { return defenseButtons; },
      apretarInterceptar: apretarInterceptar,
      apretarReparar: apretarReparar,
      pisoMasUrgente: pisoMasUrgente,
      proyectilInterceptable: proyectilInterceptable,
      interceptCooldown: interceptCooldown,
      armaDeLaIA: armaDeLaIA,
      updateAI: updateAI,
      apuntarPorSimulacion: apuntarPorSimulacion,
      objetivoConDispersion: objetivoConDispersion,
      AI_DISPERSION_PX: AI_DISPERSION_PX,
      WIND_MAX: WIND_MAX,
      LAYOUT: LAYOUT
    }
  };
})(window.DF = window.DF || {});

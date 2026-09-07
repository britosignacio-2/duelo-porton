// duel2-weapons.js -- catalogo de armas del prototipo de varianza.
//
// REESCRITO 2026-09-06 tras el diagnostico de la iteracion 0. El log mostro
// que el jugador uso "rapido" en 19 disparos seguidos contra una torre de
// PIEDRA, donde era la peor opcion posible -- y gano comodo. Diagnostico:
//
//   Las cuatro armas viejas hacian todas LO MISMO (volar un arco balistico) y
//   se diferenciaban solo en escalares: velocidad, daño, costo, multiplicador
//   por material. Una diferencia escalar la resuelve la aritmetica: el jugador
//   encuentra el numero que le conviene y DEJA DE ELEGIR. Encima, como fallar
//   es la norma (65% de acierto), el arma barata ganaba por otra via -- un
//   fallo costaba 16 en vez de 55, asi que la cantidad de intentos valia mas
//   que el daño por intento.
//
// La respuesta son arquetipos de MOVIMIENTO, no de numero. Un arma que llega a
// donde las otras no llegan no es "mejor": es otra herramienta. Y de paso
// resuelve dos agujeros viejos:
//   - critical-review §1.4 ("los muros no protegen nada"): si cada arma alcanza
//     una parte distinta de la torre, el ORDEN vertical de los materiales pasa
//     a ser una decision real, que es lo que le falta a la Epica 6.
//   - criterio C4 (interceptar casi no se uso): un cohete lento y visible es la
//     presa natural del gesto de interceptar.
//
// Dos cambios estructurales que vienen con esto:
//   1. `cooldownMs` -- la cadencia se separa del costo. Antes el costo hacia
//      dos trabajos (presupuesto de poder Y limitador de ritmo) y por eso el
//      arma barata se podia spamear. Ahora cada arma tiene su propio ritmo.
//   2. Matriz de materiales aplanada a 0.75-1.35 (venia de 0.55-1.7). El eje
//      principal de decision pasa a ser el movimiento; el material es el
//      desempate, no al reves. Menos superficie de balance duplicada.
//
// Ask First (spec): TODOS los numeros de aca son hipotesis a ajustar jugando.
(function (DF) {
  'use strict';

  const MATERIALS = ['madera', 'metal', 'piedra'];

  // Paleta "Atardecer de Deshuesadero" (direccion de arte cerrada 2026-09-05,
  // ver design-mockups/direccion-arte-final.html). Cada color esta atado a UN
  // material a proposito: el jugador tiene que reconocerlo de un vistazo en
  // pantalla chica (FR8 / NFR12). Los colores de UI estan deliberadamente
  // FUERA de esta paleta.
  const MATERIAL_COLOR = {
    madera: '#e8a23a', // dorado
    metal: '#3f7a6e',  // verde patina
    piedra: '#9c2b2b'  // rojo ladrillo
  };

  const MATERIAL_LABEL = { madera: 'Madera', metal: 'Metal', piedra: 'Piedra' };

  // Cuanto "aguanta" visual y sonoramente cada material al ser golpeado.
  // Alimenta el feedback de impacto: madera astilla y suena seco, metal
  // resuena, piedra estalla en polvo.
  const MATERIAL_FEEL = {
    madera: { pitch: 1.25, resonancia: 0.10, particulas: 1.2 },
    metal:  { pitch: 1.75, resonancia: 0.55, particulas: 0.8 },
    piedra: { pitch: 0.80, resonancia: 0.05, particulas: 1.5 }
  };

  // --- Arquetipos de movimiento -------------------------------------------
  //
  // `kind` es lo que duel2-projectile.js usa para integrar distinto. Es el eje
  // real de diferenciacion; todo lo demas es ajuste.
  //
  //   balistico -- arco de toda la vida, gravedad y nada mas.
  //   cohete    -- sale lento y ACELERA en la direccion del disparo; el arco
  //                se endereza. Llega a los pisos altos.
  //   mortero   -- sube muchisimo y cae casi a plomo. Pega desde arriba.
  //   rebote    -- pica en el suelo antes de explotar. Llega a la base.
  //   perfora   -- atraviesa el primer piso y daña el de atras.
  //   racimo    -- en el punto mas alto se parte en tres.
  //
  // `preview` marca las armas cuya trayectoria NO es intuitiva. La regla no es
  // "todas o ninguna": se muestra lo que la fisica de sentido comun no te dice.
  // Una piedra que cae la predice cualquiera; un cohete que acelera, no.
  const WEAPONS = {
    piedra: {
      label: 'Piedra', short: 'PIE', key: '1',
      flavor: 'Arco de toda la vida. Predecible.',
      rol: 'La referencia: sin sorpresas, sirve para todo y no brilla en nada.',
      kind: 'balistico',
      speedMul: 1.0, cost: 26, baseDamage: 18, cooldownMs: 600,
      splash: false, preview: false,
      color: '#e8d7c3', trail: 'none', forma: 'roca',
      materialMul: { madera: 1.0, metal: 1.0, piedra: 1.0 },
      turretBonus: 1.0
    },

    cohete: {
      label: 'Cohete', short: 'COH', key: '2',
      flavor: 'Sale lento y acelera. El arco se endereza.',
      rol: 'Los pisos ALTOS: es el unico que no cae mientras cruza.',
      kind: 'cohete',
      speedMul: 0.45, cost: 38, baseDamage: 24, cooldownMs: 1400,
      splash: false, preview: true,
      // Empuje sostenido en la direccion inicial. La gravedad lo dobla al
      // principio, el empuje lo endereza despues.
      // Empuje PROPORCIONAL a la velocidad inicial, no una constante. Con un
      // valor fijo (1800) el empuje no dependia del arrastre: a potencia
      // minima el cohete llegaba a 2104 px cuando la torre rival esta a 458 --
      // se iba 4.6 veces de largo en el disparo mas debil posible, o sea era
      // inapuntable. Proporcional, el arrastre vuelve a decidir cuanto vuela.
      thrustFactor: 2.2, thrustMs: 600,
      // Mas afectado por el viento que nadie: lento y con superficie. Es a
      // proposito -- si fuera inmune al viento seria el arma sin desventaja y
      // volveriamos al problema de "rapido" con otro nombre.
      windMul: 1.6,
      color: '#ff8b3d', trail: 'fuego', forma: 'misil',
      materialMul: { madera: 0.80, metal: 1.35, piedra: 1.15 },
      turretBonus: 1.0
    },

    mortero: {
      label: 'Mortero', short: 'MOR', key: '3',
      flavor: 'Sube muchisimo y cae a plomo.',
      rol: 'Pega DESDE ARRIBA, ignorando la silueta de la torre.',
      kind: 'mortero',
      speedMul: 0.95, cost: 34, baseDamage: 22, cooldownMs: 1600,
      splash: true, preview: true,
      // Reparte el arrastre: mucho hacia arriba, poco hacia adelante.
      //
      // `arcoHorizontal` valia 0.6 y eso le recortaba el 40% del empuje hacia
      // adelante: medido en la iteracion 1, su alcance MAXIMO a potencia plena
      // y barriendo todos los angulos era de 581 px contra 582 que hay hasta la
      // torre rival. Le faltaba UN pixel: era matematicamente imposible de
      // acertar, y por eso su punteria real fue 3 de 13 mientras el resto de
      // las armas iba de 60% a 100%. Con 0.80 el alcance queda en ~720 px:
      // llega, pero exige casi maxima potencia. Un tiro comprometido.
      arcoVertical: 1.4, arcoHorizontal: 0.80, gravedadCaida: 1.3,
      windMul: 1.2,
      color: '#c9bda8', trail: 'humo', forma: 'bomba',
      materialMul: { madera: 1.20, metal: 0.80, piedra: 1.35 },
      turretBonus: 1.0
    },

    granada: {
      label: 'Granada', short: 'GRA', key: '4',
      flavor: 'Pica en el suelo antes de estallar.',
      rol: 'La BASE de la torre, con un tiro rasante y barato.',
      kind: 'rebote',
      speedMul: 0.95, cost: 24, baseDamage: 16, cooldownMs: 900,
      splash: true, preview: true,
      // Perdia 45% de la velocidad vertical en cada rebote y solo tenia dos:
      // picaba y se moria antes de llegar a la torre. Ahora patina como piedra
      // en el agua.
      // Con la gravedad mas baja los rebotes conservan mas energia y la
      // granada se iba de largo (587 px con potencia minima, contra 458 que
      // hacen falta). Se recortan un poco respecto de la iteracion 2.
      rebotes: 3, reboteVertical: 0.45, reboteHorizontal: 0.75,
      windMul: 1.0,
      color: '#5fd08a', trail: 'chispa', forma: 'granada',
      materialMul: { madera: 1.35, metal: 0.80, piedra: 0.85 },
      turretBonus: 1.0
    },

    perforador: {
      label: 'Perforador', short: 'PER', key: '5',
      flavor: 'No explota en el primero: lo atraviesa.',
      rol: 'Hace que el ORDEN importe: si ponés blando adelante, regalás el paso.',
      kind: 'perfora',
      // Iteracion 1: se llevo el 47.7% de los disparos con una racha de 22
      // seguidos -- peor que el arma dominante de la iteracion 0. No por
      // acertar mas (68%, por debajo del cohete y el racimo) sino por pegar el
      // doble: 20 de daño por dos pisos, mas un bonus de 1.3 contra torretas.
      // Era el arma con mas daño Y la mas facil de apuntar.
      //
      // Ahora es CONDICIONAL: 14 por un solo piso (pesimo para 40 de energia)
      // y 28 si atraviesa dos (muy bueno). Deja de ser el mejor siempre y pasa
      // a premiar enfilar dos pisos, que es su identidad de diseño.
      speedMul: 1.3, cost: 40, baseDamage: 14, cooldownMs: 2600,
      splash: false, preview: false,
      pisosQueAtraviesa: 2, dañoAlSegundo: 1.0,
      windMul: 0.7, // tenso y rapido: el viento casi no lo dobla
      color: '#ffd23f', trail: 'estela', forma: 'dardo',
      materialMul: { madera: 1.30, metal: 1.10, piedra: 0.75 },
      turretBonus: 1.0
    },

    racimo: {
      label: 'Racimo', short: 'RAC', key: '6',
      flavor: 'En el punto mas alto se parte en tres.',
      rol: 'Cobertura ancha cuando no sabés dónde va a quedar la torre.',
      kind: 'racimo',
      speedMul: 0.9, cost: 36, baseDamage: 10, cooldownMs: 1600,
      splash: false, preview: true,
      fragmentos: 3, dispersion: 0.35,
      windMul: 1.3,
      color: '#d98cff', trail: 'chispa', forma: 'racimo',
      materialMul: { madera: 1.25, metal: 0.85, piedra: 0.80 },
      turretBonus: 1.0
    }
  };

  const ORDER = ['piedra', 'cohete', 'mortero', 'granada', 'perforador', 'racimo'];

  function computeDamage(weaponKey, floor) {
    const w = WEAPONS[weaponKey];
    let dmg = w.baseDamage;
    if (floor.role === 'muro' && floor.material) dmg *= (w.materialMul[floor.material] || 1.0);
    if (floor.role === 'torreta') dmg *= w.turretBonus;
    return dmg;
  }

  // Cuan bueno fue ESTE impacto comparado con el mejor y el peor posible de
  // esa misma arma. Es el numero que alimenta el feedback: sin esto, pegarle
  // 8 de daño y pegarle 37 se ven exactamente igual en pantalla, y el jugador
  // puede tirar 19 veces con el arma equivocada sin enterarse nunca.
  // Devuelve 0 (el peor matchup posible) a 1 (el mejor).
  function matchupQuality(weaponKey, floor) {
    const w = WEAPONS[weaponKey];
    const muls = MATERIALS.map(function (m) { return w.materialMul[m]; }).concat([w.turretBonus]);
    const min = Math.min.apply(null, muls);
    const max = Math.max.apply(null, muls);
    let actual = 1.0;
    if (floor.role === 'muro' && floor.material) actual = w.materialMul[floor.material] || 1.0;
    else if (floor.role === 'torreta') actual = w.turretBonus;
    if (max - min < 0.001) return 0.5; // arma neutra (la piedra): ni bien ni mal
    return Math.max(0, Math.min(1, (actual - min) / (max - min)));
  }

  // Cuanta diferencia REAL hay entre el mejor y el peor matchup de un arma.
  // `matchupQuality` normaliza contra el rango de cada arma, asi que una
  // diferencia de 17% se veria igual de dramatica que una de 70%. Sin esta
  // puerta, el juego gritaria "arma equivocada" cuando en realidad estas
  // haciendo el 83% del daño maximo -- y un jugador que lo nota deja de
  // creerle al feedback, que es exactamente lo que vinimos a arreglar.
  function matchupSpread(weaponKey) {
    const w = WEAPONS[weaponKey];
    const muls = MATERIALS.map(function (m) { return w.materialMul[m]; });
    const min = Math.min.apply(null, muls);
    const max = Math.max.apply(null, muls);
    return max <= 0 ? 0 : (max - min) / max;
  }

  // Umbral debajo del cual el arma no tiene identidad de material y el juego
  // muestra el numero de daño en vez de un juicio.
  const SPREAD_MINIMO = 0.25;

  function daSenalDeMatchup(weaponKey) {
    return matchupSpread(weaponKey) >= SPREAD_MINIMO;
  }

  // Arma con mejor multiplicador contra el material de ese piso -- la usa la IA
  // para que el sistema tambien se note "del otro lado".
  function bestWeaponAgainst(floor) {
    let best = 'piedra', bestMul = -Infinity;
    ORDER.forEach(function (k) {
      const w = WEAPONS[k];
      const mul = floor.role === 'torreta'
        ? w.turretBonus
        : (w.materialMul[floor.material] || 1.0);
      if (mul > bestMul) { bestMul = mul; best = k; }
    });
    return best;
  }

  function effectivenessText(key) {
    const w = WEAPONS[key];
    const strong = [], weak = [];
    MATERIALS.forEach(function (m) {
      const mul = w.materialMul[m];
      if (mul > 1.05) strong.push(MATERIAL_LABEL[m]);
      else if (mul < 0.95) weak.push(MATERIAL_LABEL[m]);
    });
    if (w.turretBonus > 1.05) strong.push('Torretas');
    return {
      strong: strong.length ? '+ ' + strong.join('/') : null,
      weak: weak.length ? '- ' + weak.join('/') : null,
      splash: w.splash ? 'Daña vecinos' : null
    };
  }

  DF.Weapons = {
    MATERIALS: MATERIALS,
    MATERIAL_COLOR: MATERIAL_COLOR,
    MATERIAL_LABEL: MATERIAL_LABEL,
    MATERIAL_FEEL: MATERIAL_FEEL,
    WEAPONS: WEAPONS,
    ORDER: ORDER,
    computeDamage: computeDamage,
    matchupQuality: matchupQuality,
    matchupSpread: matchupSpread,
    daSenalDeMatchup: daSenalDeMatchup,
    bestWeaponAgainst: bestWeaponAgainst,
    effectivenessText: effectivenessText
  };
})(window.DF = window.DF || {});

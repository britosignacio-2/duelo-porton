// duel2-weapons.js -- catalogo de armas y matriz arma-vs-material del prototipo
// de validacion de varianza (2026-09-05). Nace de critical-review-2026-09-03.md,
// hallazgo #1 ("el tiro correcto es UNO y se memoriza") -- inspirado en Angry
// Birds (cada pajaro fuerte contra un material) y Worms (potencia/trayectoria
// por arma). Ver critical-review para el detalle de la discusion.
//
// Ask First (spec): TODOS los numeros de acá son hipotesis a ajustar jugando,
// no un balance final.
(function (DF) {
  'use strict';

  const MATERIALS = ['madera', 'metal', 'piedra'];

  // Paleta "Atardecer de Deshuesadero" (dirección de arte cerrada 2026-09-05,
  // ver design-mockups/direccion-arte-final.html). Cada color está atado a UN
  // material a propósito: arma-vs-material solo funciona si el jugador
  // reconoce el material de un vistazo en pantalla chica (FR8 / NFR12).
  // Los colores de UI (amarillo de apuntado, verde de reparar, naranja de
  // proyectil) están deliberadamente FUERA de esta paleta, para que nunca se
  // confunda un elemento de interfaz con un material.
  const MATERIAL_COLOR = {
    madera: '#e8a23a', // dorado
    metal: '#3f7a6e',  // verde pátina
    piedra: '#9c2b2b'  // rojo ladrillo
  };

  const MATERIAL_LABEL = {
    madera: 'Madera',
    metal: 'Metal',
    piedra: 'Piedra'
  };

  // speedMul escala la velocidad que sale del arrastre (mismo gesto, distinto
  // resultado) -- así "lento y arco alto" / "veloz y arco bajo" no necesitan
  // un sistema de apuntado nuevo, solo cambian cuánto empuja el mismo arrastre.
  const WEAPONS = {
    estandar: {
      label: 'Estándar', short: 'EST', key: '1', flavor: 'Generalista, arco medio',
      speedMul: 1.0, cost: 34, baseDamage: 18, splash: false,
      materialMul: { madera: 1.0, metal: 1.0, piedra: 1.0 },
      turretBonus: 1.0
    },
    precision: {
      label: 'Precisión', short: 'PRE', key: '2', flavor: 'Rápido y plano, barato',
      speedMul: 1.2, cost: 22, baseDamage: 14, splash: false,
      materialMul: { madera: 1.0, metal: 1.0, piedra: 1.0 },
      turretBonus: 1.6 // fuerte contra torretas expuestas -- "snipear" del GDD
    },
    pesado: {
      label: 'Pesado', short: 'PES', key: '3', flavor: 'Lento, arco alto, caro -- splash',
      speedMul: 0.62, cost: 55, baseDamage: 22, splash: true,
      materialMul: { madera: 1.0, metal: 1.7, piedra: 1.7 },
      turretBonus: 1.0
    },
    rapido: {
      label: 'Rápido', short: 'RAP', key: '4', flavor: 'Veloz, arco bajo, muy barato',
      speedMul: 1.4, cost: 16, baseDamage: 12, splash: false,
      materialMul: { madera: 1.7, metal: 0.55, piedra: 0.7 },
      turretBonus: 1.0
    }
  };

  const ORDER = ['estandar', 'precision', 'pesado', 'rapido'];

  function computeDamage(weaponKey, floor) {
    const w = WEAPONS[weaponKey];
    let dmg = w.baseDamage;
    if (floor.role === 'muro' && floor.material) dmg *= (w.materialMul[floor.material] || 1.0);
    if (floor.role === 'torreta') dmg *= w.turretBonus;
    return dmg;
  }

  // Arma con mejor multiplicador contra el material de ese piso -- usada por
  // la IA para que el sistema también se note "del otro lado" (ver hallazgo #1).
  function bestWeaponAgainst(floor) {
    if (floor.role === 'torreta') return 'precision';
    let best = 'estandar', bestMul = 1.0;
    ORDER.forEach(function (k) {
      const mul = WEAPONS[k].materialMul[floor.material] || 1.0;
      if (mul > bestMul) { bestMul = mul; best = k; }
    });
    return best;
  }

  // Texto legible de a qué le pega mejor/peor cada arma -- el usuario marcó
  // que el selector no explicaba nada, esto alimenta el panel de info.
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
      strong: strong.length ? '+ contra ' + strong.join('/') : null,
      weak: weak.length ? '- contra ' + weak.join('/') : null,
      splash: w.splash ? 'Daña pisos vecinos' : null
    };
  }

  DF.Weapons = {
    MATERIALS: MATERIALS,
    MATERIAL_COLOR: MATERIAL_COLOR,
    MATERIAL_LABEL: MATERIAL_LABEL,
    WEAPONS: WEAPONS,
    ORDER: ORDER,
    computeDamage: computeDamage,
    bestWeaponAgainst: bestWeaponAgainst,
    effectivenessText: effectivenessText
  };
})(window.DF = window.DF || {});

// duel2-tower.js -- fork de tower.js para el prototipo de validacion de
// varianza (2026-09-05, ver critical-review-2026-09-03.md). Cambios respecto
// al original (que sigue intacto en tower.js, como referencia):
//   - SIN rol 'nucleo': la torre se destruye cuando el ULTIMO piso muere
//     (vida total), no por un punto especial protegido -- hallazgo #2.
//   - cada piso 'muro' tiene un `material` (madera/metal/piedra) que
//     duel2-weapons.js usa para variar el daño -- hallazgo #1 y #4.
//   - `applySplash` -- el eje "radio" del arma Pesado daña también a los
//     pisos vecinos (ya confirmado en game-architecture.md como el
//     mecanismo real del eje "radio de destrucción").
//   - `finalCollapseAt` marca cuándo la torre quedó destruida del todo, para
//     que el render dispare un colapso final más dramático -- presentación,
//     no una regla nueva (hallazgo #2).
(function (DF) {
  'use strict';

  const DEFAULTS = {
    collapseDurationMs: 420,
    smokeThreshold: 0.40,
    fireThreshold: 0.15,
    // "Cicatriz permanente" (P1, decidido 2026-09-05): cada impacto recibido
    // baja de forma IRREVERSIBLE el techo hasta el que ese piso puede
    // repararse. Es el tope de FR25 -- sin tope, reparar le gana a atacar por
    // matemática y un jugador defensivo gana el timeout por construcción
    // (critical-review-2026-09-03.md §1.5). De los tres topes considerados es
    // el único que GARANTIZA que el duelo termina, porque la vida máxima de la
    // fortaleza solo puede bajar: protege directo a los criterios C2 y C3 del
    // portón. Encima calza con el tema: lo remendado con chatarra nunca vuelve
    // a estar entero.
    scarPerHit: 0.15,   // fracción de maxHp que pierde el techo por impacto
    scarFloorPct: 0.25  // el techo nunca baja de este % de maxHp
  };

  function createTower(config) {
    const floors = config.floors.map(function (f) {
      return {
        role: f.role,
        material: f.material || null,
        maxHp: f.maxHp,
        hp: f.maxHp,
        repairCeiling: f.maxHp, // baja con cada impacto, nunca sube
        hitsTaken: 0,
        width: f.width,
        height: f.height,
        color: f.color,
        alive: true,
        collapsing: false,
        collapseStart: 0,
        fallOffset: 0
      };
    });
    return {
      floors: floors,
      originX: config.originX,
      groundY: config.groundY,
      destroyed: false,
      finalCollapseAt: 0,
      // Vida original de la torre entera. `totalHpPercent` tiene que dividir
      // por esto y no por la vida de los pisos que siguen vivos -- si no, una
      // torre de un solo piso intacto reporta 100% igual que una entera, y la
      // resolución por timeout (FR47, "gana quien bajó menos % de vida") mide
      // cualquier cosa.
      maxTotalHp: floors.reduce(function (s, f) { return s + f.maxHp; }, 0)
    };
  }

  function layoutTower(tower) {
    let y = tower.groundY;
    for (let i = 0; i < tower.floors.length; i++) {
      const f = tower.floors[i];
      if (!f.alive) continue;
      if (f.collapsing) continue;
      f.y = y - f.height;
      y = f.y;
    }
  }

  function floorRect(tower, floor) {
    return { x: tower.originX, y: floor.y, w: floor.width, h: floor.height };
  }

  function circleRectOverlap(cx, cy, r, rect) {
    const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    const dx = cx - closestX, dy = cy - closestY;
    return (dx * dx + dy * dy) <= r * r;
  }

  function findHitFloor(tower, px, py, radius) {
    for (let i = 0; i < tower.floors.length; i++) {
      const f = tower.floors[i];
      if (!f.alive || f.collapsing) continue;
      if (circleRectOverlap(px, py, radius, floorRect(tower, f))) return f;
    }
    return null;
  }

  function damageState(floor) {
    if (!floor.alive) return 'gone';
    const pct = floor.hp / floor.maxHp;
    if (floor.collapsing) return 'collapsing';
    if (pct <= DEFAULTS.fireThreshold) return 'fuego';
    if (pct <= DEFAULTS.smokeThreshold) return 'humo';
    if (pct < 1) return 'rajado';
    return 'intacto';
  }

  function applyDamage(tower, floor, amount, nowMs) {
    if (!floor.alive || floor.collapsing) return false;
    floor.hp = Math.max(0, floor.hp - amount);
    // Cicatriz: el techo de reparación baja y NUNCA vuelve a subir.
    floor.hitsTaken++;
    floor.repairCeiling = Math.max(
      floor.maxHp * DEFAULTS.scarFloorPct,
      floor.repairCeiling - floor.maxHp * DEFAULTS.scarPerHit
    );
    if (floor.hp === 0) {
      floor.collapsing = true;
      floor.collapseStart = nowMs;
      layoutTower(tower);
      return true;
    }
    return false;
  }

  // "splash a pisos vecinos" -- ver game-architecture.md, Decision Summary,
  // eje "radio" de las armas.
  function applySplash(tower, hitFloor, splashAmount, nowMs) {
    const idx = tower.floors.indexOf(hitFloor);
    if (idx < 0) return;
    [idx - 1, idx + 1].forEach(function (i) {
      const f = tower.floors[i];
      if (f && f.alive && !f.collapsing) applyDamage(tower, f, splashAmount, nowMs);
    });
  }

  function updateCollapses(tower, nowMs) {
    let changed = false;
    for (let i = 0; i < tower.floors.length; i++) {
      const f = tower.floors[i];
      if (f.collapsing && nowMs - f.collapseStart >= DEFAULTS.collapseDurationMs) {
        f.collapsing = false;
        f.alive = false;
        changed = true;
      }
    }
    if (changed) {
      layoutTower(tower);
      if (!tower.destroyed && countAliveFloors(tower) === 0) {
        tower.destroyed = true;
        tower.finalCollapseAt = nowMs;
      }
    }
    return changed;
  }

  function countAliveFloors(tower) {
    let n = 0;
    for (const f of tower.floors) if (f.alive) n++;
    return n;
  }

  // Repara un piso hasta su techo de cicatriz. Devuelve cuánta vida se
  // restauró de verdad: si ya está en el techo devuelve 0, y el caller NO
  // debe cobrar energía (tocar un piso irreparable no puede costarte un tiro).
  function repairFloor(tower, floor, amount) {
    if (!floor.alive || floor.collapsing) return 0;
    const ceiling = Math.min(floor.maxHp, floor.repairCeiling);
    if (floor.hp >= ceiling) return 0;
    const before = floor.hp;
    floor.hp = Math.min(ceiling, floor.hp + amount);
    return floor.hp - before;
  }

  function canRepair(floor) {
    if (!floor.alive || floor.collapsing) return false;
    return floor.hp < Math.min(floor.maxHp, floor.repairCeiling);
  }

  // Cuanta vida se puede recuperar realmente en este piso. El dia 1 del porton
  // mostro el problema: reparar cobra precio fijo, asi que un piso a punto de
  // tocar su techo devolvia 3,9 de vida por los mismos 34 de energia que antes
  // habia devuelto 14. El jugador no tenia forma de saberlo antes de tocar.
  function repairableAmount(floor) {
    if (!floor.alive || floor.collapsing) return 0;
    return Math.max(0, Math.min(floor.maxHp, floor.repairCeiling) - floor.hp);
  }

  // % de la vida ORIGINAL de la fortaleza que sigue en pie. Los pisos muertos
  // cuentan como 0, no se excluyen del denominador (ver maxTotalHp).
  function totalHpPercent(tower) {
    let hp = 0;
    for (const f of tower.floors) {
      if (!f.alive && !f.collapsing) continue;
      hp += f.hp;
    }
    return tower.maxTotalHp === 0 ? 0 : hp / tower.maxTotalHp;
  }

  DF.Tower2 = {
    DEFAULTS: DEFAULTS,
    createTower: createTower,
    layoutTower: layoutTower,
    floorRect: floorRect,
    findHitFloor: findHitFloor,
    damageState: damageState,
    applyDamage: applyDamage,
    applySplash: applySplash,
    repairFloor: repairFloor,
    canRepair: canRepair,
    repairableAmount: repairableAmount,
    updateCollapses: updateCollapses,
    countAliveFloors: countAliveFloors,
    totalHpPercent: totalHpPercent
  };
})(window.DF = window.DF || {});

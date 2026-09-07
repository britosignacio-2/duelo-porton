// duel2-shotlog.js -- un gatillo, UN evento de telemetria.
//
// DEFECTO QUE ARREGLA (medido 2026-09-07 en banco headless sobre este mismo
// codigo). `duel2-main.js` logueaba en cada IMPACTO, no en cada disparo:
//
//   - El perforador atraviesa dos pisos, y cada travesia entraba al log como
//     un evento `shot` propio con `hit: true`. Medido: 1.81 eventos por
//     gatillo, y un acierto aparente de 68% cuando el real por gatillo es 81%.
//   - Cada fragmento del racimo que pegaba escribia su propio evento, pero la
//     rama de fallo tenia guarda `!esFragmento`: si fallaban los tres, no se
//     escribia NADA. Resultado: 0.97 eventos por gatillo y un acierto
//     reportado de 100% contra un 87% real.
//
// No es cosmetico: `duel2-telemetry.js` calcula tres criterios del Porton con
// estos eventos.
//   B1 arma dominante  -> el perforador inflado ~1.8x contra las demas. La
//                         lectura de "57.7% de los disparos" era mas cerca del
//                         43% real.
//   B2 punteria        -> impactos de mas y fallos de menos.
//   C1 reparar         -> `energiaAtaque` suma `costo` por EVENTO, asi que un
//                         perforador de 40 se contaba como 80. Con el
//                         perforador en ~43% de los gatillos, la energia de
//                         ataque quedaba ~35% inflada y el % de reparar,
//                         hundido en la misma proporcion.
//
// El registro vive aparte de main a proposito: main no se puede cargar en
// Node (arranca un canvas real) y esta matematica decide numeros del Porton,
// asi que tiene que poder testearse.
//
// Modelo: un gatillo abre UN registro. El racimo suma proyectiles al mismo
// registro cuando se divide. Cada proyectil que deja de volar -- por impactar,
// por irse de rango o por ser interceptado -- lo cierra un poco. Cuando no
// queda ninguno en vuelo, se emite el unico evento.
(function (DF) {
  'use strict';

  function createShotLog(opts) {
    const cfg = opts || {};
    const log = cfg.log || function () {};
    // Como traducir un piso a su indice en la torre rival (solo para el log
    // del jugador). Se inyecta porque las torres se rearman en cada duelo.
    const pisoIndex = cfg.pisoIndex || function () { return null; };
    const duelIndex = cfg.duelIndex || function () { return null; };
    const weaponInfo = cfg.weaponInfo || function () { return {}; };

    let seq = 0;
    const abiertos = new Map();

    function abrir(owner, weaponKey) {
      const id = ++seq;
      abiertos.set(id, {
        owner: owner, weaponKey: weaponKey,
        enVuelo: 1, impactos: 0,
        primerPiso: null, mejorCalidad: null, interceptado: false
      });
      return id;
    }

    // El racimo se parte: el proyectil padre desaparece y nacen N fragmentos,
    // todos del MISMO disparo. Neto: enVuelo += n - 1.
    function dividir(id, n) {
      const reg = abiertos.get(id);
      if (!reg) return;
      reg.enVuelo += (n - 1);
      if (reg.enVuelo <= 0) emitir(id);
    }

    function impacto(id, floor, calidad) {
      const reg = abiertos.get(id);
      if (!reg) return;
      reg.impactos++;
      if (!reg.primerPiso) reg.primerPiso = floor;
      if (typeof calidad === 'number') {
        reg.mejorCalidad = reg.mejorCalidad === null ? calidad : Math.max(reg.mejorCalidad, calidad);
      }
    }

    // Un proyectil de este disparo dejo de volar.
    function cerrarUno(id, extra) {
      const reg = abiertos.get(id);
      if (!reg) return;
      if (extra && extra.interceptado) reg.interceptado = true;
      reg.enVuelo--;
      if (reg.enVuelo <= 0) emitir(id);
    }

    // Fin de duelo con proyectiles todavia en el aire: el gatillo existio, asi
    // que el evento se emite con lo que haya. Tirarlos sesgaria B2 a la baja.
    function cerrarTodos() {
      Array.from(abiertos.keys()).forEach(emitir);
    }

    function emitir(id) {
      const reg = abiertos.get(id);
      if (!reg) return;
      abiertos.delete(id);
      const info = weaponInfo(reg.weaponKey) || {};
      const base = {
        duelIndex: duelIndex(),
        weapon: reg.weaponKey,
        costo: info.cost,
        hit: reg.impactos > 0,
        // Cuantos pisos toco ESTE disparo. Es el dato que antes se colaba como
        // disparos de mas: ahora esta explicito y no contamina el denominador.
        impactos: reg.impactos,
        materialObjetivo: reg.primerPiso ? (reg.primerPiso.material || reg.primerPiso.role) : null
      };
      if (reg.interceptado) base.interceptado = true;
      if (reg.owner === 'player') {
        base.kind = info.kind;
        base.pisoImpactado = reg.primerPiso ? pisoIndex(reg.primerPiso) : null;
        base.calidad = reg.mejorCalidad === null ? null : +reg.mejorCalidad.toFixed(2);
        log('shot', base);
      } else {
        log('ai_shot', base);
      }
      return base;
    }

    function pendientes() { return abiertos.size; }

    return {
      abrir: abrir, dividir: dividir, impacto: impacto,
      cerrarUno: cerrarUno, cerrarTodos: cerrarTodos, pendientes: pendientes
    };
  }

  DF.ShotLog = { createShotLog: createShotLog };
})(window.DF = window.DF || {});

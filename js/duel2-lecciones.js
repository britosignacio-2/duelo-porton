// duel2-lecciones.js -- enseñanza contextual ("just-in-time").
//
// POR QUE EXISTE, con la evidencia que lo pidio:
// Cinco personas ajenas jugaron el prototipo el 2026-09-08 y el veredicto sobre
// onboarding fue textual: *"al no tener como un tutorial les costo entender el
// tema de energia, saber que se podian interceptar proyectiles"*. Dos de las
// cuatro mecanicas fueron INVISIBLES. Aprendieron a tirar, no a jugar.
//
// El dato que decidio el diseño: el prototipo ya tenia UN tip contextual, el de
// reparar (`drawRepairTip`), y reparar es justamente la unica de las tres
// mecanicas no obvias que NADIE reporto no entender. Las dos que fallaron son
// exactamente las dos que no tenian tip. Asi que esto no inventa un mecanismo:
// generaliza el que ya funcionaba y lo aplica donde la evidencia dice que falta.
//
// POR QUE NO ES UN TUTORIAL GUIADO DE DUELOS:
// El GDD tiene una campaña PvE recortada a "tutorial de 3-5 duelos", y sigue
// vigente -- pero es para el juego completo (introduce piezas de la anatomia de
// fortaleza: muros, torretas, comandante), nada de lo cual existe en el
// prototipo. Lo que el prototipo tiene que enseñar son cuatro verbos, y un verbo
// se aprende usandolo en el momento en que hace falta, no leyendolo antes.
// Ademas una pantalla de instrucciones previa no la lee nadie, y los mismos
// cinco ya demostraron que ABREN Y JUEGAN sin que nadie les explique.
//
// DOS REGLAS DE DISEÑO, y la segunda es la que corrige al tip que ya existia:
//  1. La leccion aparece SOLO cuando la mecanica es relevante ahora mismo (hay
//     un proyectil para interceptar, falta energia, hay un piso roto).
//  2. Se deja de mostrar cuando el jugador USO la mecanica, no cuando pasaron N
//     duelos. `drawRepairTip` se apagaba en el duelo 3 usaras o no reparar: al
//     que no habia entendido, el juego le dejaba de explicar justo por haber
//     tardado. Al reves: se apaga cuando aprendio, y se insiste mientras no.
//     El tope por duelos queda igual como red de seguridad, para no hostigar a
//     alguien que decidio no usar la mecanica.
(function (DF) {
  'use strict';

  // Tope de insistencia: si a esta altura no la uso, es que no quiere.
  const MAX_DUELOS_INSISTIENDO = 6;
  // No mostrar dos lecciones a la vez ni cambiar de una a otra a los saltos.
  const MIN_MS_EN_PANTALLA = 1200;
  // Una leccion ENSEÑA y se va; no se queda de guardia. Verificado jugando:
  // sin este tope el cartel de reparar aparecia en 49 de 50 muestras, porque su
  // condicion (hay piso roto y alcanza la energia) es casi permanente una vez
  // que la IA pega una vez. Un cartel que esta siempre deja de leerse a los
  // treinta segundos y encima tapa el juego. Aparece, se muestra, se va, y
  // vuelve mas tarde SOLO si la mecanica sigue sin usarse.
  const MAX_MS_VISIBLE = 4200;
  const MS_ENTRE_APARICIONES = 14000;

  // El orden ES la prioridad: si dos aplican a la vez gana la de arriba.
  // Interceptar va primero porque su ventana dura menos de un segundo -- si
  // pierde contra otra leccion, se pierde la oportunidad de enseñarla.
  const LECCIONES = [
    {
      id: 'interceptar',
      texto: '¡TOCÁ ✋ PARA FRENARLO!',
      zona: 'defensa',
      urgente: true,
      aplica: function (e) { return e.hayInterceptable && e.interceptarListo; }
    },
    {
      id: 'energia',
      texto: 'Sin energía no podés disparar · se recarga sola',
      zona: 'energia',
      aplica: function (e) { return e.faltoEnergia; }
    },
    {
      id: 'reparar',
      texto: '🔧 abajo a la derecha repara el piso más dañado',
      zona: 'centro',
      aplica: function (e) { return e.hayQueReparar && e.alcanzaReparar; }
    },
    {
      id: 'arma',
      texto: 'Cada arma pega distinto según el material',
      zona: 'centro',
      aplica: function (e) { return e.puedeElegirArma && !e.hayInterceptable; }
    }
  ];

  function crear(estadoGuardado) {
    const aprendidas = {};
    if (estadoGuardado) {
      for (const k in estadoGuardado) if (estadoGuardado[k]) aprendidas[k] = true;
    }
    let actual = null;      // { id, texto, zona, desde }
    const ultimaVez = {};   // id -> ms en que termino de mostrarse

    function marcarAprendida(id) { aprendidas[id] = true; }

    // `e` describe el momento; devuelve la leccion a dibujar, o null.
    function evaluar(e) {
      const ahora = e.nowMs || 0;

      // Una leccion que ya se esta mostrando se sostiene un minimo de tiempo,
      // aunque su condicion deje de cumplirse: un cartel que parpadea medio
      // segundo no se lee, y el de interceptar vive en ventanas cortisimas.
      if (actual && ahora - actual.desde < MIN_MS_EN_PANTALLA) {
        if (!aprendidas[actual.id]) return actual;
      }
      // Se cumplio su turno en pantalla: se retira. Se anota el momento en que
      // DEBIO retirarse, no el de ahora: si el juego estuvo un rato sin evaluar
      // (otra leccion en pantalla, pausa, un duelo entero), contar desde "ahora"
      // arrancaria el enfriamiento tarde y la leccion no volveria nunca.
      if (actual && ahora - actual.desde >= MAX_MS_VISIBLE) {
        ultimaVez[actual.id] = actual.desde + MAX_MS_VISIBLE;
        actual = null;
      }

      for (let i = 0; i < LECCIONES.length; i++) {
        const L = LECCIONES[i];
        if (aprendidas[L.id]) continue;
        if (e.duelIndex > MAX_DUELOS_INSISTIENDO) continue;
        if (!L.aplica(e)) continue;
        const desc = ultimaVez[L.id];
        if (desc !== undefined && ahora - desc < MS_ENTRE_APARICIONES) continue;
        if (!actual || actual.id !== L.id) {
          actual = { id: L.id, texto: L.texto, zona: L.zona, urgente: !!L.urgente, desde: ahora };
        }
        return actual;
      }
      if (actual) ultimaVez[actual.id] = Math.min(ahora, actual.desde + MAX_MS_VISIBLE);
      actual = null;
      return null;
    }

    return {
      evaluar: evaluar,
      marcarAprendida: marcarAprendida,
      // Para persistir entre sesiones: lo que ya aprendio no se re-explica.
      exportar: function () { return Object.assign({}, aprendidas); },
      yaAprendio: function (id) { return !!aprendidas[id]; },
      pendientes: function () {
        return LECCIONES.filter(function (L) { return !aprendidas[L.id]; })
                        .map(function (L) { return L.id; });
      }
    };
  }

  DF.Lecciones = {
    crear: crear,
    LECCIONES: LECCIONES,
    MAX_DUELOS_INSISTIENDO: MAX_DUELOS_INSISTIENDO,
    MIN_MS_EN_PANTALLA: MIN_MS_EN_PANTALLA,
    MAX_MS_VISIBLE: MAX_MS_VISIBLE,
    MS_ENTRE_APARICIONES: MS_ENTRE_APARICIONES
  };
})(window.DF = window.DF || {});

// duel2-telemetry.js -- instrumentación del Portón de Retención
// (ver _bmad-output/playtest-plan.md).
//
// Por qué existe: el portón mide CONDUCTA, no opinión. Un diseñador no puede
// contestar honestamente "¿te gustó?" sobre su propio juego -- pero no puede
// falsear cuántas veces abrió la app sin que se lo pidieran, cuántos duelos
// abandonó, ni con qué arma disparó de verdad. Todo lo que registra este
// módulo alimenta directamente un criterio numérico del plan:
//
//   A1 apertura espontánea  <- session_start.prompted
//   A2 "una más"            <- session_start.duelosPropuestos vs session_end.duelosJugados
//   A3 abandono             <- duel_end.motivo === 'abandon'
//   A4 el interés no decae  <- session_start.ganasAntes por día
//   B1 diversidad de armas  <- shot.weapon
//   B2 puntería no satura   <- shot.hit por día
//   C1 reparar equilibrado  <- repair.energia vs shot (energía gastada)
//   C2 duelos que resuelven <- duel_end.motivo === 'timeout'
//   C3 duración objetivo    <- duel_end.duracionMs
//   C4 interceptar visible  <- intercept_try por duelo
//
// Sin backend, sin cuentas, sin red: todo a localStorage, exportable a mano.
(function (DF) {
  'use strict';

  const STORAGE_KEY = 'df_telemetry_v1';
  const SCHEMA = 1;

  let events = [];
  let sessionId = null;
  let sessionStartMs = 0;
  let duelosPropuestos = 0;
  let duelosJugados = 0;

  function loadAll() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      // Modo incógnito, cookies bloqueadas, cuota llena. Nunca romper el juego
      // por un problema de telemetría -- el portón puede seguir a mano.
      return [];
    }
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch (e) { /* ver loadAll */ }
  }

  function log(type, data) {
    if (!sessionId) return; // nada antes de arrancar sesión
    const ev = Object.assign({
      type: type,
      ts: new Date().toISOString(),
      sessionId: sessionId,
      tMs: Math.round(performance.now() - sessionStartMs)
    }, data || {});
    events.push(ev);
    persist();
    return ev;
  }

  // prompted === false es el dato más importante de todo el portón (criterio
  // A1): distingue "abrí porque tenía ganas" de "abrí porque el plan lo pedía".
  // Se contesta ANTES de jugar, nunca después.
  function startSession(opts) {
    events = loadAll();
    sessionId = 's' + Date.now().toString(36);
    sessionStartMs = performance.now();
    duelosPropuestos = opts.duelosPropuestos || 0;
    duelosJugados = 0;
    log('session_start', {
      schema: SCHEMA,
      prompted: !!opts.prompted,
      ganasAntes: opts.ganasAntes || null,
      duelosPropuestos: duelosPropuestos,
      ua: navigator.userAgent,
      viewport: window.innerWidth + 'x' + window.innerHeight
    });
    return sessionId;
  }

  function countDuel() {
    duelosJugados++;
  }

  function endSession(opts) {
    if (!sessionId) return;
    log('session_end', {
      duelosJugados: duelosJugados,
      duelosPropuestos: duelosPropuestos,
      // A2: jugó más de lo que se había propuesto
      unaMas: duelosPropuestos > 0 && duelosJugados > duelosPropuestos,
      ganasDespues: (opts && opts.ganasDespues) || null
    });
    sessionId = null;
  }

  function hasOpenSession() {
    return sessionId !== null;
  }

  // --- Exportación -------------------------------------------------------

  function exportJson() {
    return JSON.stringify({
      schema: SCHEMA,
      exportedAt: new Date().toISOString(),
      events: loadAll()
    }, null, 2);
  }

  function download() {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'porton-log-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copyToClipboard() {
    const text = exportJson();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error('sin clipboard API'));
  }

  function clearAll() {
    events = [];
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ver loadAll */ }
  }

  // --- Resumen en vivo ---------------------------------------------------
  // Para poder mirar los criterios sin exportar nada. Deliberadamente NO se
  // muestra durante el duelo: ver los números mientras jugás cambia cómo jugás.

  function summary() {
    const all = loadAll();
    const sessions = all.filter(function (e) { return e.type === 'session_start'; });
    const duels = all.filter(function (e) { return e.type === 'duel_end'; });
    const shots = all.filter(function (e) { return e.type === 'shot'; });
    const repairs = all.filter(function (e) { return e.type === 'repair'; });
    const intercepts = all.filter(function (e) { return e.type === 'intercept_try'; });

    const porArma = {};
    shots.forEach(function (s) { porArma[s.weapon] = (porArma[s.weapon] || 0) + 1; });
    const maxArma = Object.keys(porArma).reduce(function (a, k) {
      return porArma[k] > (porArma[a] || 0) ? k : a;
    }, Object.keys(porArma)[0] || null);

    const energiaAtaque = shots.reduce(function (s, e) { return s + (e.costo || 0); }, 0);
    const energiaReparo = repairs.reduce(function (s, e) { return s + (e.energia || 0); }, 0);
    const duraciones = duels.map(function (d) { return d.duracionMs; }).sort(function (a, b) { return a - b; });

    function pct(n, d) { return d === 0 ? 0 : Math.round((n / d) * 100); }

    return {
      sesiones: sessions.length,
      espontaneas: sessions.filter(function (s) { return s.prompted === false; }).length,
      duelos: duels.length,
      // A3
      abandonoPct: pct(duels.filter(function (d) { return d.motivo === 'abandon'; }).length, duels.length),
      // C2
      timeoutPct: pct(duels.filter(function (d) { return d.motivo === 'timeout'; }).length, duels.length),
      // C3 -- mediana, no promedio: un duelo abandonado a los 5s no debe arrastrar el dato
      duracionMedianaSeg: duraciones.length
        ? Math.round(duraciones[Math.floor(duraciones.length / 2)] / 1000)
        : 0,
      // B1
      armaDominante: maxArma,
      armaDominantePct: pct(porArma[maxArma] || 0, shots.length),
      // B2
      aciertoPct: pct(shots.filter(function (s) { return s.hit; }).length, shots.length),
      // C1
      reparoPctEnergia: pct(energiaReparo, energiaAtaque + energiaReparo),
      // C4
      interceptosPorDuelo: duels.length ? +(intercepts.length / duels.length).toFixed(2) : 0
    };
  }

  DF.Telemetry = {
    STORAGE_KEY: STORAGE_KEY,
    startSession: startSession,
    endSession: endSession,
    hasOpenSession: hasOpenSession,
    countDuel: countDuel,
    log: log,
    exportJson: exportJson,
    download: download,
    copyToClipboard: copyToClipboard,
    clearAll: clearAll,
    summary: summary
  };
})(window.DF = window.DF || {});

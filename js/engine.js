/**
 * PE DECISION TOOL — MOTORE DI CALCOLO (logica pura, senza interfaccia)
 * ─────────────────────────────────────────────────────────────────────────────
 * Tutti i calcoli clinici dell'app passano da qui: punteggi, soglie del D-Dimero,
 * scelta della regola, controlli di coerenza dell'albero.
 * Nessun accesso a DOM, rete o storage: le stesse funzioni sono eseguite sia nel
 * browser sia dai test automatici (tests/tree.test.js).
 *
 * NON contiene contenuti clinici: criteri, punti e soglie restano in decision_tree.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PEEngine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const AGE_MIN = 18, AGE_MAX = 120;
  // Fattori di conversione verso ng/mL (= µg/L), unità in cui sono espresse le soglie.
  const DDIMER_UNITS = {
    ng: { label: "ng/mL (= µg/L)", short: "ng/mL", factor: 1 },
    mg: { label: "mg/L (= µg/mL)", short: "mg/L",  factor: 1000 }
  };
  // Intervallo di plausibilità (in ng/mL) usato solo per AVVISARE, mai per decidere.
  const DDIMER_PLAUSIBLE_MIN = 50, DDIMER_PLAUSIBLE_MAX = 100000;

  /* ── Punteggi ─────────────────────────────────────────────────────────── */

  /** Totale ricalcolato da zero dalle voci spuntate (mai aggiornato in modo incrementale). */
  function computeTotal(node, itemsState) {
    const sum = (node.items || []).reduce((t, it) => t + (itemsState && itemsState[it.id] ? it.points : 0), 0);
    return Math.round(sum * 10) / 10;   // i punti hanno al più un decimale
  }

  /** Inverte una voce rispettando i gruppi mutuamente esclusivi. Restituisce un nuovo stato. */
  function toggleItem(node, itemsState, itemId) {
    const next = Object.assign({}, itemsState || {});
    const item = (node.items || []).find(it => it.id === itemId);
    if (!item) return next;
    if (next[itemId]) { delete next[itemId]; return next; }
    if (item.exclusive_group) {
      (node.items || []).forEach(it => {
        if (it.exclusive_group === item.exclusive_group) delete next[it.id];
      });
    }
    next[itemId] = true;
    return next;
  }

  /* ── D-Dimero ─────────────────────────────────────────────────────────── */

  function isValidAge(age) {
    return typeof age === "number" && Number.isFinite(age) && Number.isInteger(age) && age >= AGE_MIN && age <= AGE_MAX;
  }

  /** Valore inserito → ng/mL. Restituisce null se valore o unità non sono validi. */
  function ddimerToNgMl(value, unit) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    const u = DDIMER_UNITS[unit];
    if (!u) return null;
    return Math.round(value * u.factor * 1000) / 1000;
  }

  /** Soglia età-corretta: < 50 anni → 500; ≥ 50 anni → età × 10 (ng/mL). */
  function ageAdjustedThreshold(age) {
    return age >= 50 ? age * 10 : 500;
  }

  function yearsRuleApplies(rule, yearsCount) {
    return (rule.years === 0 && yearsCount === 0) || (rule.years === ">=1" && yearsCount >= 1);
  }

  /**
   * Stato del nodo D-Dimero dato l'input corrente.
   * dd = { value:number, unit:"ng"|"mg", age:number, mode:"fixed"|"age" }
   * Restituisce:
   *   errors[]        → motivi per cui non si può procedere (input mancante/non valido)
   *   warnings[]      → avvisi non bloccanti (es. valore fuori intervallo plausibile)
   *   needsMode       → true se va scelta esplicitamente soglia fissa / età-corretta
   *   threshold       → soglia applicata in ng/mL (null se non determinabile)
   *   thresholdLabel  → descrizione leggibile della soglia
   *   valueNg         → valore convertito in ng/mL
   *   rule            → regola risultante (null se errors non è vuoto)
   */
  function evaluateDdimer(node, interpIdx, yearsCount, dd) {
    dd = dd || {};
    const out = { errors: [], warnings: [], needsMode: false, threshold: null, thresholdLabel: "", valueNg: null, rule: null };
    const interp = (node.interpretation || [])[interpIdx || 0];
    if (!interp) { out.errors.push("Interpretazione non disponibile."); return out; }

    if (!isValidAge(dd.age)) out.errors.push("Inserisci l'età del paziente (numero intero tra " + AGE_MIN + " e " + AGE_MAX + " anni).");
    if (!DDIMER_UNITS[dd.unit]) out.errors.push("Seleziona l'unità di misura del D-Dimero riportata sul referto.");
    if (typeof dd.value !== "number" || !Number.isFinite(dd.value) || dd.value < 0) out.errors.push("Inserisci il valore del D-Dimero.");

    const candidates = interp.rules.filter(r => yearsRuleApplies(r, yearsCount));
    if (!candidates.length) { out.errors.push("Nessuna regola applicabile."); return out; }

    const adjustable = candidates.some(r => r.age_adjustable);
    const base = candidates[0].ddimer_val;
    out.baseThreshold = base;
    // La scelta è rilevante solo oltre i 50 anni: fino a 50 le due soglie coincidono (500).
    if (adjustable && isValidAge(dd.age) && ageAdjustedThreshold(dd.age) !== base) {
      out.needsMode = true;
      if (dd.mode !== "fixed" && dd.mode !== "age") {
        out.errors.push("Scegli quale soglia applicare: fissa (" + base + " ng/mL) oppure età-corretta (" + ageAdjustedThreshold(dd.age) + " ng/mL).");
      }
    }
    if (isValidAge(dd.age)) {
      if (adjustable && out.needsMode && dd.mode === "age") {
        out.threshold = ageAdjustedThreshold(dd.age);
        out.thresholdLabel = out.threshold + " ng/mL (età-corretta: età × 10)";
      } else if (!out.needsMode || dd.mode === "fixed") {
        out.threshold = base;
        out.thresholdLabel = base + " ng/mL" + (adjustable ? " (soglia fissa)" : "");
      }
    }

    out.valueNg = ddimerToNgMl(dd.value, dd.unit);
    if (out.valueNg !== null && (out.valueNg < DDIMER_PLAUSIBLE_MIN || out.valueNg > DDIMER_PLAUSIBLE_MAX)) {
      out.warnings.push("Valore insolito (" + out.valueNg + " ng/mL): verifica di aver selezionato l'unità di misura corretta.");
    }
    if (out.errors.length || out.threshold === null || out.valueNg === null) return out;

    const matches = candidates.filter(r =>
      (r.ddimer_op === "<" && out.valueNg < out.threshold) ||
      (r.ddimer_op === ">=" && out.valueNg >= out.threshold));
    if (matches.length !== 1) { out.errors.push("Errore interno: regola non univoca."); return out; }
    out.rule = matches[0];
    return out;
  }

  /* ── Regola risultante di un nodo score ───────────────────────────────── */

  function getScoreResult(node, state, dd) {
    if (!node.interpretation) return null;
    state = state || { items: {}, interpIdx: 0 };
    const interp = node.interpretation[state.interpIdx || 0];
    if (!interp) return null;
    const total = computeTotal(node, state.items);
    if (node.scoreType === "years") return evaluateDdimer(node, state.interpIdx || 0, total, dd).rule;
    const matches = interp.rules.filter(r => total >= r.range[0] && total <= r.range[1]);
    return matches.length === 1 ? matches[0] : null;
  }

  /** Colore del banner: severity della regola, altrimenti del nodo di destinazione. */
  function severityFor(tree, rule) {
    if (!rule) return "warning";
    if (rule.severity) return rule.severity;
    const target = tree[rule.next];
    return (target && target.type === "result" && target.severity) ? target.severity : "warning";
  }

  /* ── Struttura dell'albero ────────────────────────────────────────────── */

  function nextIds(node) {
    const out = [];
    if (node.next) out.push(node.next);
    (node.options || []).forEach(o => out.push(o.next));
    (node.interpretation || []).forEach(i => (i.rules || []).forEach(r => out.push(r.next)));
    return out;
  }

  /** Numero massimo di passi ancora possibili da un nodo (per la barra di avanzamento). */
  function maxDepthFrom(tree, id, memo, stack) {
    memo = memo || {}; stack = stack || {};
    if (memo[id] !== undefined) return memo[id];
    if (stack[id] || !tree[id]) return 0;
    stack[id] = true;
    const d = nextIds(tree[id]).reduce((m, n) => Math.max(m, 1 + maxDepthFrom(tree, n, memo, stack)), 0);
    stack[id] = false;
    return (memo[id] = d);
  }

  /** Tutte le combinazioni di voci ammesse (rispettando i gruppi esclusivi). */
  function allItemStates(node) {
    const items = node.items || [];
    const states = [];
    for (let mask = 0; mask < (1 << items.length); mask++) {
      const st = {}, groups = {};
      let ok = true;
      items.forEach((it, i) => {
        if (!(mask & (1 << i))) return;
        if (it.exclusive_group) { if (groups[it.exclusive_group]) ok = false; groups[it.exclusive_group] = true; }
        st[it.id] = true;
      });
      if (ok) states.push(st);
    }
    return states;
  }

  /**
   * Controllo di coerenza dell'albero. Restituisce l'elenco degli errori (vuoto = OK).
   * Eseguito all'avvio dell'app (che non parte in caso di errori) e dai test.
   */
  function validateTree(tree, startId) {
    const errors = [];
    const TYPES = ["info", "question", "score", "result", "ctpa_check"];
    if (!tree[startId]) return ["Nodo iniziale '" + startId + "' inesistente."];

    Object.keys(tree).forEach(id => {
      const n = tree[id];
      if (n.id !== id) errors.push(id + ": campo id non coincide con la chiave.");
      if (TYPES.indexOf(n.type) < 0) errors.push(id + ": tipo sconosciuto '" + n.type + "'.");
      nextIds(n).forEach(t => { if (!tree[t]) errors.push(id + ": destinazione inesistente '" + t + "'."); });
      if (n.type === "info" && !n.next) errors.push(id + ": nodo info senza next.");
      if (n.type === "question" && !(n.options || []).length) errors.push(id + ": nodo question senza opzioni.");

      if (n.type === "score") {
        if (!(n.interpretation || []).length) errors.push(id + ": nodo score senza interpretazione.");
        const ids = (n.items || []).map(it => it.id);
        if (new Set(ids).size !== ids.length) errors.push(id + ": id delle voci duplicati.");
        (n.interpretation || []).forEach((interp, ii) => {
          if (n.scoreType === "years") {
            // Senza voci (es. D-Dimero ESC) il conteggio dei criteri è sempre 0
            ((n.items || []).length ? [0, 1] : [0]).forEach(y => {
              const c = interp.rules.filter(r => yearsRuleApplies(r, y));
              const lt = c.filter(r => r.ddimer_op === "<"), ge = c.filter(r => r.ddimer_op === ">=");
              if (lt.length !== 1 || ge.length !== 1 || lt[0].ddimer_val !== ge[0].ddimer_val ||
                  !!lt[0].age_adjustable !== !!ge[0].age_adjustable) {
                errors.push(id + " [" + interp.label + "]: regole D-Dimero incomplete o incoerenti per " + (y ? "≥1" : "0") + " criteri.");
              }
            });
          } else {
            allItemStates(n).forEach(st => {
              const total = computeTotal(n, st);
              const m = interp.rules.filter(r => total >= r.range[0] && total <= r.range[1]).length;
              if (m !== 1) errors.push(id + " [" + interp.label + "]: il punteggio " + total + " ricade in " + m + " regole (attesa: 1).");
            });
          }
        });
      }

      if (n.type === "ctpa_check") {
        const none = n.no_contraindications_option;
        const cis = [].concat((n.contraindications || {}).absolute || [], (n.contraindications || {}).relative || []);
        if (!none || !none.id) errors.push(id + ": opzione 'nessuna controindicazione' mancante.");
        const known = cis.map(c => c.id).concat(none ? [none.id] : []);
        (n.alternatives || []).forEach(a => (a.best_for || []).forEach(b => {
          if (known.indexOf(b) < 0) errors.push(id + ": alternativa " + a.id + " riferita a controindicazione inesistente '" + b + "'.");
        }));
        known.forEach(k => {
          if (!(n.alternatives || []).some(a => (a.best_for || []).indexOf(k) >= 0)) errors.push(id + ": nessuna alternativa per '" + k + "'.");
        });
      }
    });

    // Raggiungibilità: ogni nodo deve essere raggiungibile dal nodo iniziale
    const seen = {};
    (function walk(id) { if (seen[id] || !tree[id]) return; seen[id] = true; nextIds(tree[id]).forEach(walk); })(startId);
    Object.keys(tree).forEach(id => { if (!seen[id]) errors.push(id + ": nodo non raggiungibile dal nodo iniziale."); });

    return Array.from(new Set(errors));
  }

  return {
    AGE_MIN, AGE_MAX, DDIMER_UNITS,
    computeTotal, toggleItem, isValidAge, ddimerToNgMl, ageAdjustedThreshold,
    evaluateDdimer, getScoreResult, severityFor, nextIds, maxDepthFrom, allItemStates, validateTree
  };
});

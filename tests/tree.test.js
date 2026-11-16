/**
 * TEST AUTOMATICI — albero decisionale, motore di calcolo, regole di sicurezza.
 * Esecuzione:  node --test tests/tree.test.js   (Node.js ≥ 18, nessuna dipendenza)
 *
 * Ogni modifica a decision_tree.js o engine.js deve lasciare questi test verdi.
 * I "casi di riferimento" in fondo vanno riletti e firmati dal responsabile clinico:
 * sono la traduzione eseguibile di ciò che le linee guida prescrivono.
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const E = require("../js/engine.js");
const { PE_DECISION_TREE: T, ECHO_RV_TABLE, TREE_METADATA } = require("../js/decision_tree.js");
const ROOT = path.join(__dirname, "..");

const pick = (nodeId, ids) => Object.fromEntries(ids.map(i => [i, true]));
const scoreNext = (nodeId, ids, interpIdx = 0) => {
  const r = E.getScoreResult(T[nodeId], { items: pick(nodeId, ids), interpIdx });
  return r && r.next;
};
const dd = (nodeId, years, d) => E.evaluateDdimer(T[nodeId], 0, years, d);

/* ── 1. Coerenza strutturale ─────────────────────────────────────────── */
test("l'albero supera il controllo di coerenza (stesso controllo eseguito all'avvio dell'app)", () => {
  assert.deepEqual(E.validateTree(T, "start"), []);
});

test("il controllo di coerenza rileva davvero gli errori", () => {
  const broken = JSON.parse(JSON.stringify(T));
  broken.wells_score.interpretation[0].rules[2].range = [7, 99];      // buco tra 6 e 7
  broken.start.next = "nodo_inesistente";
  const errs = E.validateTree(broken, "start");
  assert.ok(errs.some(e => /wells_score/.test(e) && /0 regole/.test(e)));
  assert.ok(errs.some(e => /nodo_inesistente/.test(e)));
});

test("ogni combinazione di voci di ogni score porta a un solo esito, per ogni schema", () => {
  let checked = 0;
  for (const [id, n] of Object.entries(T)) {
    if (n.type !== "score" || n.scoreType === "years") continue;
    n.interpretation.forEach((interp, ii) => {
      for (const st of E.allItemStates(n)) {
        const r = E.getScoreResult(n, { items: st, interpIdx: ii });
        assert.ok(r, `${id} [${interp.label}] punteggio ${E.computeTotal(n, st)} senza esito`);
        assert.ok(T[r.next], `${id}: destinazione ${r.next}`);
        checked++;
      }
    });
  }
  assert.ok(checked > 2000);
});

test("nodi D-Dimero: per ogni età, valore, unità e modalità valida esiste un solo esito", () => {
  for (const id of ["ddimer_years", "esc_ddimer_test"]) {
    const maxYears = T[id].items.length ? 3 : 0;
    for (let y = 0; y <= maxYears; y++)
      for (const age of [18, 35, 49, 50, 51, 64, 77, 90, 120])
        for (const value of [0, 120, 499, 499.9, 500, 500.1, 640, 770, 999, 1000, 1200, 5000])
          for (const mode of ["fixed", "age"]) {
            const ev = dd(id, y, { age, value, unit: "ng", mode });
            assert.ok(ev.rule, `${id} y=${y} età=${age} val=${value} ${mode}: ${ev.errors.join(" | ")}`);
          }
  }
});

test("percorsi terminali: ogni cammino finisce su un esito finale o sulla scelta dell'imaging", () => {
  for (const [id, n] of Object.entries(T)) {
    if (E.nextIds(n).length === 0) assert.ok(["result", "ctpa_check"].includes(n.type), `${id} è un vicolo cieco`);
  }
});

/* ── 2. Motore di calcolo ────────────────────────────────────────────── */
test("le due fasce di frequenza cardiaca del Geneva non si sommano mai", () => {
  for (const [id, a, b] of [["geneva_score", "g7", "g8"], ["geneva_simple_score", "sg7", "sg8"], ["esc_geneva_score", "eg2", "eg3"]]) {
    let st = E.toggleItem(T[id], {}, a);
    st = E.toggleItem(T[id], st, b);
    assert.deepEqual(Object.keys(st), [b], id);
    st = E.toggleItem(T[id], st, b);
    assert.deepEqual(Object.keys(st), [], id);
  }
});

test("il totale è ricalcolato dalle voci (nessuna deriva con i mezzi punti)", () => {
  assert.equal(E.computeTotal(T.wells_score, pick("wells_score", ["w3", "w4", "w5"])), 4.5);
  assert.equal(E.computeTotal(T.wells_score, pick("wells_score", ["w1", "w2", "w3", "w4", "w5", "w6", "w7"])), 12.5);
});

test("conversione delle unità del D-Dimero e rifiuto degli input non validi", () => {
  assert.equal(E.ddimerToNgMl(0.45, "mg"), 450);
  assert.equal(E.ddimerToNgMl(450, "ng"), 450);
  assert.equal(E.ddimerToNgMl(450, undefined), null);
  assert.equal(E.ddimerToNgMl(-1, "ng"), null);
  assert.equal(E.ddimerToNgMl(NaN, "ng"), null);
  for (const bad of [NaN, 0, 17, 121, 45.5, undefined]) assert.equal(E.isValidAge(bad), false, String(bad));
  const ev = dd("ddimer_years", 0, { age: 40, value: 300 });          // unità non indicata
  assert.equal(ev.rule, null);
  assert.ok(ev.errors.some(e => /unità/.test(e)));
});

test("un valore fuori dall'intervallo abituale genera un avviso (es. mg/L digitati come ng/mL)", () => {
  const ev = dd("ddimer_years", 1, { age: 40, value: 1.2, unit: "ng" });
  assert.equal(ev.warnings.length, 1);
  assert.equal(dd("ddimer_years", 1, { age: 40, value: 1.2, unit: "mg" }).warnings.length, 0);
});

test("oltre i 50 anni la scelta soglia fissa / età-corretta è obbligatoria; fino a 50 no", () => {
  const noMode = dd("ddimer_years", 1, { age: 70, value: 600, unit: "ng" });
  assert.equal(noMode.rule, null);
  assert.equal(noMode.needsMode, true);
  assert.equal(dd("ddimer_years", 1, { age: 50, value: 400, unit: "ng" }).needsMode, false);
  assert.equal(dd("ddimer_years", 0, { age: 70, value: 600, unit: "ng" }).needsMode, false);   // 0 criteri: soglia 1000
});

/* ── 3. Casi di riferimento clinici (da validare e firmare) ──────────── */
test("AHA · Wells: <2 → PERC, 2–6 → D-Dimero+YEARS, >6 → imaging diretto", () => {
  assert.equal(scoreNext("wells_score", []), "perc_check");
  assert.equal(scoreNext("wells_score", ["w3"]), "perc_check");                      // 1.5
  assert.equal(scoreNext("wells_score", ["w6", "w7"]), "ddimer_years");              // 2
  assert.equal(scoreNext("wells_score", ["w1", "w2"]), "ddimer_years");              // 6
  assert.equal(scoreNext("wells_score", ["w1", "w2", "w6"]), "diagnostic_imaging_direct"); // 7
});

test("AHA · Wells dicotomico: PERC solo se punteggio < 2 (mai con 2–4)", () => {
  assert.equal(scoreNext("wells_score", ["w3"], 1), "perc_check");                   // 1.5
  assert.equal(scoreNext("wells_score", ["w1"], 1), "ddimer_years");                 // 3
  assert.equal(scoreNext("wells_score", ["w1", "w6"], 1), "ddimer_years");           // 4
  assert.equal(scoreNext("wells_score", ["w1", "w3"], 1), "diagnostic_imaging_direct"); // 4.5
});

test("AHA · Revised Geneva: 0–3 bassa, 4–10 intermedia, ≥11 alta", () => {
  assert.equal(scoreNext("geneva_score", ["g7"]), "perc_check");                     // 3
  assert.equal(scoreNext("geneva_score", ["g1", "g7"]), "ddimer_years");             // 4
  assert.equal(scoreNext("geneva_score", ["g8", "g5", "g6"]), "ddimer_years");       // 10
  assert.equal(scoreNext("geneva_score", ["g8", "g5", "g2"]), "diagnostic_imaging_direct"); // 11
});

test("AHA · Geneva semplificato: 0–1 bassa, 2–4 intermedia, ≥5 alta (anche con 8 voci)", () => {
  assert.equal(scoreNext("geneva_simple_score", ["sg1"]), "perc_check");
  assert.equal(scoreNext("geneva_simple_score", ["sg1", "sg2"]), "ddimer_years");
  assert.equal(scoreNext("geneva_simple_score", ["sg1", "sg2", "sg3", "sg4", "sg5"]), "diagnostic_imaging_direct");
  assert.equal(scoreNext("geneva_simple_score", ["sg1", "sg2", "sg3", "sg4", "sg5", "sg6", "sg8", "sg9"]), "diagnostic_imaging_direct");
});

test("AHA · PERC: nessun criterio → nessun ulteriore test; almeno uno → D-Dimero+YEARS", () => {
  assert.equal(scoreNext("perc_check", []), "result_very_low_prob");
  for (const it of T.perc_check.items) assert.equal(scoreNext("perc_check", [it.id]), "ddimer_years");
  assert.equal(T.perc_check.items.length, 8);
});

test("AHA · YEARS: 0 criteri soglia 1000; ≥1 criterio soglia 500 o età-corretta", () => {
  const next = (y, d) => dd("ddimer_years", y, d).rule.next;
  assert.equal(next(0, { age: 40, value: 999, unit: "ng" }), "result_pe_excluded");
  assert.equal(next(0, { age: 40, value: 1000, unit: "ng" }), "diagnostic_imaging");
  assert.equal(next(1, { age: 40, value: 499, unit: "ng" }), "result_pe_excluded");
  assert.equal(next(1, { age: 40, value: 500, unit: "ng" }), "diagnostic_imaging");
  // 70 anni, 600 ng/mL, ≥1 criterio: esclusa con soglia età-corretta (700), imaging con soglia fissa
  assert.equal(next(1, { age: 70, value: 600, unit: "ng", mode: "age" }), "result_pe_excluded");
  assert.equal(next(1, { age: 70, value: 600, unit: "ng", mode: "fixed" }), "diagnostic_imaging");
  assert.equal(next(1, { age: 70, value: 700, unit: "ng", mode: "age" }), "diagnostic_imaging");
  assert.equal(next(2, { age: 70, value: 0.6, unit: "mg", mode: "age" }), "result_pe_excluded");
  assert.equal(dd("ddimer_years", 1, { age: 70, value: 600, unit: "ng", mode: "age" }).threshold, 700);
});

test("ESC · instabilità emodinamica: basta una manifestazione → ramo instabile", () => {
  assert.equal(scoreNext("esc_hemodynamic_check", []), "esc_choose_score");
  for (const it of T.esc_hemodynamic_check.items) assert.equal(scoreNext("esc_hemodynamic_check", [it.id]), "esc_bedside_tte");
});

test("ESC · Revised Geneva (Tabella 5): 3 livelli 0–3/4–10/≥11, 2 livelli 0–5/≥6", () => {
  assert.equal(scoreNext("esc_geneva_score", ["eg3", "eg1", "eg5"], 0), "esc_ddimer_test");      // 10
  assert.equal(scoreNext("esc_geneva_score", ["eg3", "eg1", "eg7"], 0), "esc_ctpa_no_dimer");    // 11
  assert.equal(scoreNext("esc_geneva_score", ["eg3"], 1), "esc_ddimer_test");                    // 5
  assert.equal(scoreNext("esc_geneva_score", ["eg3", "eg9"], 1), "esc_ctpa_no_dimer");           // 6
});

test("ESC · D-Dimero: soglia 500 o età-corretta; probabilità alta non passa dal D-Dimero", () => {
  const next = d => dd("esc_ddimer_test", 0, d).rule.next;
  assert.equal(next({ age: 45, value: 499, unit: "ng" }), "esc_pe_excluded");
  assert.equal(next({ age: 45, value: 500, unit: "ng" }), "esc_ctpa_low_intermediate");
  assert.equal(next({ age: 80, value: 750, unit: "ng", mode: "age" }), "esc_pe_excluded");
  assert.equal(next({ age: 80, value: 750, unit: "ng", mode: "fixed" }), "esc_ctpa_low_intermediate");
  for (const n of ["esc_wells_score", "esc_geneva_score"])
    for (const i of T[n].interpretation) assert.equal(i.rules[i.rules.length - 1].next, "esc_ctpa_no_dimer");
});

test("colori: PE esclusa = verde, alta probabilità = rosso, shock con RV normale non è verde", () => {
  const sev = (id, d) => E.severityFor(T, dd(id, 0, d).rule);
  assert.equal(sev("esc_ddimer_test", { age: 40, value: 100, unit: "ng" }), "safe");
  assert.equal(sev("ddimer_years", { age: 40, value: 100, unit: "ng" }), "safe");
  assert.equal(sev("ddimer_years", { age: 40, value: 2000, unit: "ng" }), "warning");
  assert.equal(E.severityFor(T, E.getScoreResult(T.esc_geneva_score, { items: pick("", ["eg3", "eg1", "eg7"]), interpIdx: 0 })), "danger");
  assert.equal(E.severityFor(T, E.getScoreResult(T.wells_score, { items: pick("", ["w1", "w2", "w6"]), interpIdx: 0 })), "danger");
  assert.notEqual(T.esc_search_other_causes_1.severity, "safe");
});

test("tabella eco RV: 5 parametri, come AHA 2026 Tabella 4", () => {
  assert.equal(ECHO_RV_TABLE.length, 5);
  assert.ok(ECHO_RV_TABLE.some(r => /RV\/LV > 0\.9/.test(r.definition)));
  assert.ok(ECHO_RV_TABLE.some(r => /TAPSE < 1\.6 cm/.test(r.definition)));
});

/* ── 4. Regole di sicurezza informatica (regressioni) ────────────────── */
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

test("index.html: nessuno script/stile inline, nessun handler inline, nessuna risorsa esterna", () => {
  const html = read("index.html");
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), "script inline");
  assert.ok(!/<style/i.test(html), "style inline");
  assert.ok(!/\son[a-z]+\s*=/i.test(html), "handler inline");
  assert.ok(!/\sstyle\s*=/i.test(html), "attributo style");
  assert.ok(!/(src|href)\s*=\s*["'](https?:)?\/\//i.test(html), "risorsa esterna");
  assert.ok(/Content-Security-Policy/.test(html) && /default-src 'none'/.test(html) && /connect-src 'none'/.test(html));
  assert.ok(!/unsafe-inline|unsafe-eval/.test(html));
});

test("app.js: nessun handler/stile inline generato, nessuna rete, nessun salvataggio di dati clinici", () => {
  const js = read("js/app.js");
  assert.ok(!/\son(click|input|change|keydown)\s*=/.test(js), "handler inline");
  assert.ok(!/style\s*=\s*["'`]/.test(js), "stile inline");
  for (const banned of ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource", "document.cookie", "sessionStorage", "indexedDB", "eval(", "new Function", "alert(", "prompt(", "confirm("]) {
    assert.ok(!js.includes(banned), banned);
  }
  // localStorage è ammesso SOLO per la preferenza del tema
  const ls = js.match(/localStorage\.(get|set)Item\([^)]*\)/g) || [];
  assert.ok(ls.length > 0 && ls.every(c => c.includes('"pe-tool-theme"')), ls.join(" "));
});

test("css: nessuna risorsa esterna", () => {
  assert.ok(!/url\(\s*["']?(https?:)?\/\//i.test(read("css/app.css")));
  assert.ok(!/@import/i.test(read("css/app.css")));
});

test("il report contiene l'avviso su riservatezza e responsabilità di chi lo scarica", () => {
  assert.ok(/responsabile/.test(TREE_METADATA.privacy_notice) && /2016\/679/.test(TREE_METADATA.privacy_notice));
  assert.ok(read("js/app.js").includes("TREE_METADATA.privacy_notice"));
});

test("la versione è dichiarata e coerente con il README", () => {
  assert.match(TREE_METADATA.version, /^\d+\.\d+\.\d+$/);
  assert.ok(read("README.md").includes(TREE_METADATA.version));
});

/**
 * PE DECISION TOOL — INTERFACCIA
 * ─────────────────────────────────────────────────────────────────────────────
 * Rendering, navigazione e report PDF. I contenuti clinici stanno in
 * decision_tree.js, i calcoli in engine.js (verificati dai test automatici).
 *
 * Regole di sicurezza rispettate da questo file (verificate da tests/):
 *   - nessun handler inline (onclick=…) e nessuno stile inline: compatibile con una
 *     Content-Security-Policy rigida (script-src 'self'; style-src 'self');
 *   - ogni testo inserito nella pagina passa da esc() (nessun HTML interpretato);
 *   - nessuna chiamata di rete, nessun cookie, nessun dato clinico salvato:
 *     ID paziente, scelte e tempi vivono solo in memoria e spariscono chiudendo
 *     la pagina, avviando una nuova valutazione o dopo inattività prolungata.
 */
(function () {
  "use strict";

  const TREE = PE_DECISION_TREE;
  const E = PEEngine;
  const START_NODE = "start";

  // Dopo questo periodo senza interazioni, con una valutazione in corso, compare un
  // avviso; senza risposta entro il conto alla rovescia la valutazione viene cancellata
  // dalla memoria (postazioni condivise / dispositivo lasciato incustodito).
  const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;
  const INACTIVITY_WARNING_S = 60;

  /* ═══════════════════════════════════════════════════════════════
     STATE (solo in memoria)
     ═══════════════════════════════════════════════════════════════ */
  let history  = [];
  let scores   = {};   // { nodeId: { items:{id:true}, interpIdx:num } }
  let ddimers  = {};   // { nodeId: { ageRaw, valueRaw, unit, mode, confirmUnusual } }
  let ctpaState= {};   // { ci_id: bool }
  let ctpaComments = {}; // { nodeId: "commento libero del medico" }
  let ctpaChoice   = {}; // { nodeId: altId } — modalità di imaging scelta esplicitamente dall'utente

  // L'ID paziente vive SOLO in questa variabile: non viene mai salvato o inviato.
  let patientId   = "";
  // Nome dell'operatore: facoltativo, stesso trattamento dell'ID paziente (solo in memoria).
  // Resta precompilato tra una valutazione e la successiva (stesso operatore, più pazienti)
  // ma viene cancellato alla chiusura della pagina e dopo inattività.
  let operatorName = "";
  let decisionLog = [];  // [{ fromIndex, fromNodeId, fromTitle, toNodeId, choice, detail, ts }]

  // evalStartTs: ingresso nel primo step dell'albero (dopo la schermata ID paziente).
  // evalEndTs:   raggiungimento dell'ULTIMO STEP del percorso — NON il download del report.
  let evalStartTs = null;
  let evalEndTs   = null;

  /* ═══════════════════════════════════════════════════════════════
     HELPERS DOM
     ═══════════════════════════════════════════════════════════════ */
  function $(id) { return document.getElementById(id); }

  /** Escape di QUALSIASI testo prima dell'inserimento nella pagina. */
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }

  /** Riesegue un rendering parziale mantenendo il focus sull'elemento attivo (data-key). */
  function keepFocus(fn) {
    const a = document.activeElement;
    const key = a && a.dataset ? a.dataset.key : null;
    fn();
    if (key) {
      const el = Array.prototype.find.call(document.querySelectorAll("[data-key]"), x => x.dataset.key === key);
      if (el) el.focus({ preventScroll: true });
    }
  }

  /** Colori dei badge COR: applicati via CSSOM (nessuno stile inline nell'HTML). */
  function applyDynamicStyles(rootEl) {
    rootEl.querySelectorAll("[data-cor-color]").forEach(el => {
      const c = el.dataset.corColor;
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) return;
      el.style.color = c; el.style.borderColor = c + "55"; el.style.backgroundColor = c + "1f";
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     FINESTRE DI DIALOGO (sostituiscono alert/prompt/confirm)
     ═══════════════════════════════════════════════════════════════ */
  let dialogResolve = null;

  function showDialog(opts) {
    if (dialogResolve) closeDialog({ ok: false });
    return new Promise(resolve => {
      const dlg = $("app-dialog"), box = $("dlg-inputs"), cancel = $("dlg-cancel");
      $("dlg-title").textContent = opts.title || "";
      $("dlg-text").textContent = opts.text || "";
      box.textContent = "";
      (opts.inputs || []).forEach((f, i) => {
        const lab = document.createElement("label");
        lab.className = "ddimer-label"; lab.htmlFor = "dlg-input-" + i; lab.textContent = f.label || "";
        const inp = document.createElement("input");
        inp.className = "dlg-input"; inp.id = "dlg-input-" + i; inp.type = "text";
        inp.autocomplete = "off"; inp.spellcheck = false;
        inp.value = f.value || ""; inp.maxLength = f.maxLength || 64; inp.placeholder = f.placeholder || "";
        box.appendChild(lab); box.appendChild(inp);
      });
      $("dlg-ok").textContent = opts.okLabel || "OK";
      cancel.hidden = !opts.cancelLabel;
      cancel.textContent = opts.cancelLabel || "";
      dialogResolve = resolve;
      if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
      (box.querySelector("input") || $("dlg-ok")).focus();
    });
  }

  function closeDialog(result) {
    const dlg = $("app-dialog"), r = dialogResolve;
    dialogResolve = null;
    const values = Array.prototype.map.call($("dlg-inputs").querySelectorAll("input"), i => i.value);
    if (dlg.open) { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); }
    if (r) r(Object.assign({ values }, result));
  }

  function showMessage(text, title) {
    return showDialog({ title: title || "Attenzione", text, okLabel: "OK" });
  }

  /* ═══════════════════════════════════════════════════════════════
     NAVIGATION
     ═══════════════════════════════════════════════════════════════ */
  function goTo(nodeId) {
    if (!TREE[nodeId]) { showMessage("Errore interno: step inesistente (" + nodeId + ")."); return; }
    // Registra nel log la scelta che ha portato dal nodo corrente a quello nuovo,
    // derivandola dal contenuto del nodo di partenza: il report riflette esattamente
    // il percorso e le selezioni fatte in app.
    const fromId = history[history.length - 1];
    if (fromId) {
      const { choice, detail, summary } = describeTransition(fromId, nodeId);
      decisionLog.push({
        fromIndex: history.length,
        fromNodeId: fromId,
        fromTitle: TREE[fromId].title || fromId,
        toNodeId: nodeId,
        choice, detail, summary: summary || "",
        ts: new Date().toISOString()
      });
    }
    if (TREE[nodeId].type === "ctpa_check") { ctpaState = {}; ctpaComments[nodeId] = ""; ctpaChoice[nodeId] = null; }
    if (!evalStartTs) evalStartTs = new Date();
    history.push(nodeId);
    render(nodeId);
    syncEndTimestamp();
    updateReportButtonState();
  }

  function goBack() {
    if (history.length <= 1) return;
    history.pop();
    decisionLog = decisionLog.filter(e => e.fromIndex < history.length);
    render(history[history.length - 1]);
    syncEndTimestamp();
    updateReportButtonState();
  }

  function resetApp(clearOperator) {
    history = []; scores = {}; ddimers = {}; ctpaState = {}; ctpaComments = {}; ctpaChoice = {}; decisionLog = [];
    evalStartTs = null; evalEndTs = null;
    // Ogni nuova valutazione riparte "pulita": l'ID della valutazione precedente
    // non deve essere riportato per errore su un altro paziente.
    patientId = "";
    if (clearOperator) operatorName = "";
    updatePatientBadge();
    renderPatientGate();
    updateReportButtonState();
  }

  /** Riavvio richiesto dall'utente: chiede conferma se c'è una valutazione in corso. */
  function requestReset() {
    if (!sessionHasData()) { resetApp(); return; }
    showDialog({
      title: "Nuova valutazione",
      text: "I dati della valutazione in corso (ID paziente, scelte, tempi) verranno cancellati; il nome dell'operatore resta precompilato e modificabile. Se ti serve il report, scaricalo prima di continuare.",
      okLabel: "Cancella e ricomincia", cancelLabel: "Annulla"
    }).then(r => { if (r.ok) resetApp(); });
  }

  function jumpTo(idx) {
    if (!(idx >= 0 && idx < history.length - 1)) return;
    history = history.slice(0, idx + 1);
    decisionLog = decisionLog.filter(e => e.fromIndex < history.length);
    const lastId = history[history.length - 1];
    if (TREE[lastId].type === "ctpa_check") { ctpaState = {}; ctpaComments[lastId] = ""; ctpaChoice[lastId] = null; }
    render(lastId);
    syncEndTimestamp();
    updateReportButtonState();
  }

  function sessionHasData() {
    return decisionLog.length > 0 || !!patientId;
  }

  /* ═══════════════════════════════════════════════════════════════
     PATIENT ID – schermata iniziale + badge header
     ═══════════════════════════════════════════════════════════════ */
  function renderPatientGate() {
    $("breadcrumb").innerHTML = "";
    $("progress-bar").style.width = "0%";
    const el = $("content");
    el.innerHTML = "";
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <span class="card-icon" aria-hidden="true">🪪</span>
      <h1 class="card-title" tabindex="-1">Nuova valutazione</h1>
      <p class="card-subtitle">Identificativi facoltativi — usati solo per etichettare il report</p>
      <div class="hint-box">Quanto inserito resta esclusivamente in questo browser, per la durata della sessione, al solo scopo di etichettare il report scaricabile a fine valutazione. Non viene salvato, trasmesso o collegato a nessun dato clinico: lo strumento resta anonimo lato software.</div>
      <label class="ddimer-label" for="patient-id-input">Codice / ID paziente</label>
      <input class="patient-id-input" id="patient-id-input" type="text" maxlength="64" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="es. RX-0234 — oppure lascia vuoto" value="${esc(patientId)}" data-enter="confirmPatientId" />
      <label class="ddimer-label" for="operator-input">Codice / ID operatore</label>
      <input class="patient-id-input" id="operator-input" type="text" maxlength="64" autocomplete="off" spellcheck="false"
        placeholder="es. Dr. M. Rossi — oppure lascia vuoto" value="${esc(operatorName)}" data-enter="confirmPatientId" />
      <button type="button" class="btn-primary" data-action="confirmPatientId">Continua →</button>
      <button type="button" class="btn-secondary mt-10" data-action="skipPatientId">Continua in forma anonima (paziente e operatore)</button>
    `;
    el.appendChild(card);
    window.scrollTo({ top: 0 });
  }

  function confirmPatientId() {
    const inp = $("patient-id-input"), op = $("operator-input");
    patientId = inp ? inp.value.trim().slice(0, 64) : "";
    operatorName = op ? op.value.trim().slice(0, 64) : "";
    updatePatientBadge();
    history = []; // la schermata iniziale non fa parte dell'albero decisionale
    goTo(START_NODE);
  }

  function skipPatientId() {
    patientId = ""; operatorName = "";
    updatePatientBadge();
    history = [];
    goTo(START_NODE);
  }

  function editPatientId() {
    showDialog({
      title: "Paziente e operatore",
      text: "Entrambi i campi sono facoltativi: lasciali vuoti per restare anonimi. Restano solo in questo browser, non vengono salvati né trasmessi.",
      inputs: [
        { label: "Codice / ID paziente", value: patientId, maxLength: 64, placeholder: "es. RX-0234" },
        { label: "Operatore", value: operatorName, maxLength: 64, placeholder: "es. Dr. M. Rossi" }
      ],
      okLabel: "Salva", cancelLabel: "Annulla"
    }).then(r => {
      if (!r.ok) return;
      patientId = (r.values[0] || "").trim().slice(0, 64);
      operatorName = (r.values[1] || "").trim().slice(0, 64);
      updatePatientBadge();
    });
  }

  function updatePatientBadge() {
    const b = $("patient-badge");
    if (!b) return;
    b.textContent = "🪪 " + (patientId || "Anonimo") + "  ·  👤 " + (operatorName || "Anonimo");
  }

  function updateReportButtonState() {
    const ready = decisionLog.length > 0;
    ["report-btn", "report-btn-schematic"].forEach(id => { const b = $(id); if (b) b.classList.toggle("report-ready", ready); });
  }

  /* ── Tempi della compilazione ─────────────────────────────────── */
  function formatDateTime(d) {
    return d.toLocaleDateString("it-IT") + " " + d.toLocaleTimeString("it-IT");
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
    const parts = [];
    if (h) parts.push(h + " h");
    if (h || m) parts.push(m + " min");
    parts.push(sec + " s");
    return parts.join(" ");
  }

  /* Fine compilazione = momento in cui si raggiunge l'ultimo step del percorso.
     Usa la stessa definizione di "esito finale" del report (getCurrentOutcomeSummary). */
  function syncEndTimestamp() {
    const out = getCurrentOutcomeSummary();
    const isFinal = !!(out && out.status === "finale");
    if (isFinal && !evalEndTs) evalEndTs = new Date();
    else if (!isFinal) evalEndTs = null;
  }

  /* ═══════════════════════════════════════════════════════════════
     D-DIMERO – lettura degli input
     ═══════════════════════════════════════════════════════════════ */
  /** Input grezzi → valori numerici validati (NaN se il testo non è un numero pulito). */
  function parseDd(nid) {
    const d = ddimers[nid] || {};
    const a = (d.ageRaw || "").trim();
    const v = (d.valueRaw || "").trim().replace(",", ".");
    return {
      age: /^\d{1,3}$/.test(a) ? parseInt(a, 10) : NaN,
      value: /^\d+(\.\d+)?$/.test(v) ? parseFloat(v) : NaN,
      unit: d.unit, mode: d.mode
    };
  }

  function evalDdimerNode(nid) {
    const node = TREE[nid];
    const state = scores[nid] || { items: {}, interpIdx: 0 };
    return E.evaluateDdimer(node, state.interpIdx, E.computeTotal(node, state.items), parseDd(nid));
  }

  /** Il nodo D-Dimero è completo? (regola determinata + eventuale valore insolito confermato) */
  function ddimerReady(nid) {
    const ev = evalDdimerNode(nid);
    return !!ev.rule && (!ev.warnings.length || !!(ddimers[nid] || {}).confirmUnusual);
  }

  /* ═══════════════════════════════════════════════════════════════
     DECISION LOG – ricostruzione automatica delle scelte
     ═══════════════════════════════════════════════════════════════ */
  function describeTransition(fromId, toId) {
    const node = TREE[fromId];
    if (!node) return { choice: "Continua", detail: [] };

    if (node.type === "question") {
      const opt = (node.options || []).find(o => o.next === toId);
      return {
        choice: opt ? ("Selezione: " + opt.label) : "Continua",
        detail: []
      };
    }

    if (node.type === "score") {
      const nid = fromId;
      const state = scores[nid] || { items: {}, interpIdx: 0 };
      const blocks = [];
      if (node.interpretation && node.interpretation.length > 1) {
        blocks.push({ kind: "kv", label: "Schema interpretativo utilizzato", value: node.interpretation[state.interpIdx].label });
      }
      const checked = (node.items || []).filter(it => state.items[it.id]).map(it => it.label);
      let result, summary = "";
      if (node.scoreType === "years") {
        const raw = ddimers[nid] || {}, ev = evalDdimerNode(nid);
        result = ev.rule;
        if (node.items && node.items.length) blocks.push(criteriaBlock("Criteri soddisfatti", checked));
        blocks.push({ kind: "kv", label: "Età paziente", value: E.isValidAge(parseDd(nid).age) ? parseDd(nid).age + " anni" : "n.d." });
        const unitLabel = E.DDIMER_UNITS[raw.unit] ? E.DDIMER_UNITS[raw.unit].short : "";
        let measured = ev.valueNg !== null ? (raw.valueRaw || "").trim() + " " + unitLabel : "n.d.";
        if (ev.valueNg !== null && raw.unit !== "ng") measured += " (pari a " + ev.valueNg + " ng/mL)";
        summary = ev.valueNg !== null && ev.threshold !== null ? "D-Dimero " + ev.valueNg + " ng/mL - soglia applicata " + ev.threshold + " ng/mL" : "";
        blocks.push({ kind: "kv", label: "D-Dimero misurato", value: measured });
        blocks.push({ kind: "kv", label: "Soglia applicata", value: ev.thresholdLabel || "n.d." });
        if (ev.warnings.length && raw.confirmUnusual) {
          blocks.push({ kind: "kv", label: "Nota", value: "valore fuori dall'intervallo abituale, confermato dall'operatore" });
        }
      } else {
        result = E.getScoreResult(node, state);
        blocks.push(criteriaBlock("Criteri selezionati", checked));
        blocks.push({ kind: "kv", label: node.total_label || "Punteggio totale", value: String(E.computeTotal(node, state.items)) });
        summary = (node.total_label || "Punteggio totale") + ": " + E.computeTotal(node, state.items);
      }
      // summary = dato numerico chiave, mostrato nella "Sintesi delle decisioni" del report
      return { choice: "Risultato: " + (result ? result.category : "punteggio calcolato"), detail: blocks, summary };
    }

    // info / result: transizione semplice, nessuna scelta da registrare
    return { choice: "Continua", detail: [] };
  }

  function ctpaSelectionSummary(node) {
    const noneId = node.no_contraindications_option.id;
    if (ctpaState[noneId]) return "Nessuna controindicazione presente.";
    const abs = (node.contraindications.absolute || []).filter(ci => ctpaState[ci.id]).map(ci => "[Assoluta] " + ci.label);
    const rel = (node.contraindications.relative || []).filter(ci => ctpaState[ci.id]).map(ci => "[Relativa] " + ci.label);
    const all = [...abs, ...rel];
    return all.length ? ("Controindicazioni selezionate: " + all.join("; ")) : "";
  }

  /* Come ctpaSelectionSummary, ma come blocchi strutturati: controindicazioni
     assolute e relative in due elenchi puntati separati, una voce per riga. */
  function ctpaSelectionBlocks(node) {
    const noneId = node.no_contraindications_option.id;
    if (ctpaState[noneId]) return [{ kind: "kv", label: "Controindicazioni", value: "nessuna presente" }];
    const abs = (node.contraindications.absolute || []).filter(ci => ctpaState[ci.id]).map(ci => ci.label);
    const rel = (node.contraindications.relative || []).filter(ci => ctpaState[ci.id]).map(ci => ci.label);
    const blocks = [];
    if (abs.length) blocks.push({ kind: "list", label: "Controindicazioni assolute (" + abs.length + ")", items: abs });
    if (rel.length) blocks.push({ kind: "list", label: "Controindicazioni relative (" + rel.length + ")", items: rel });
    return blocks;
  }

  /* Determina la modalità di imaging scelta dall'utente sul nodo ctpa_check
     corrente — condivisa tra interfaccia, log delle decisioni e generazione
     del report. Richiede una selezione ESPLICITA (click dell'utente su una
     delle card proposte): il solo aver spuntato le controindicazioni non
     basta a considerare la scelta "fatta". */
  function getCtpaRecommendation(node) {
    const noneId = node.no_contraindications_option.id;
    const checkedIds = Object.keys(ctpaState).filter(k => ctpaState[k] && k !== noneId);
    const noneChecked = !!ctpaState[noneId];
    const hasAny = checkedIds.length > 0;
    if (!noneChecked && !hasAny) return { made: false, pending: false };

    const chosenId = ctpaChoice[node.id];
    if (!chosenId) return { made: false, pending: true };

    const recommended = node.alternatives.find(a => a.id === chosenId) || null;
    return {
      made: true,
      recommended,
      selectionSummary: ctpaSelectionSummary(node),
      selectionBlocks: ctpaSelectionBlocks(node),
      comment: (ctpaComments[node.id] || "").trim()
    };
  }

  /* Stato/esito del nodo attualmente visualizzato, per la sezione "Esito" del report */
  function getCurrentOutcomeSummary() {
    const curId = history[history.length - 1];
    const node = TREE[curId];
    if (!node) return null;

    if (node.type === "result" && !node.next) {
      return {
        status: "finale", title: node.title, subtitle: node.subtitle || "",
        body: node.body || "", blocks: textToBlocks(node.body), note: node.note || "", severity: node.severity || "warning"
      };
    }

    if (node.type === "ctpa_check") {
      const rec = getCtpaRecommendation(node);
      if (rec.made) {
        return {
          status: "finale", title: node.title,
          subtitle: "",
          body: rec.recommended
            ? ("Modalità di imaging scelta: " + rec.recommended.label + " — " + rec.recommended.desc)
            : "Nessuna modalità determinata dalle controindicazioni selezionate.",
          // Blocchi: modalità scelta, poi controindicazioni (assolute/relative) una per riga
          blocks: [
            ...(rec.recommended
              ? [{ kind: "kv", label: "Modalità di imaging scelta", value: rec.recommended.label },
                 { kind: "text", text: rec.recommended.desc }]
              : [{ kind: "text", text: "Nessuna modalità determinata dalle controindicazioni selezionate." }]),
            ...rec.selectionBlocks
          ],
          note: "", comment: rec.comment, severity: "warning",
          bannerOverride: "Modalità di imaging selezionata: " + (rec.recommended ? rec.recommended.label : "Non determinata")
        };
      }
      return {
        status: "in corso", title: node.title, subtitle: node.subtitle || "",
        body: "Percorso non ancora concluso a questo step.", blocks: textToBlocks("Percorso non ancora concluso a questo step."), note: "", severity: "warning"
      };
    }

    return {
      status: "in corso", title: node.title, subtitle: node.subtitle || "",
      body: "Percorso non ancora concluso a questo step.", blocks: textToBlocks("Percorso non ancora concluso a questo step."), note: "", severity: "warning"
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     REPORT PDF
     Genera un PDF con: identificativo paziente (se inserito), data/ora,
     l'elenco cronologico di tutte le scelte fatte nel percorso, e
     l'esito corrente — senza aggiungere interpretazioni cliniche
     ulteriori rispetto a quanto già determinato dallo strumento.
     ═══════════════════════════════════════════════════════════════ */
  function sanitizeForPdf(s) {
    if (!s) return "";
    return String(s)
      .replace(/≥/g, ">=").replace(/≤/g, "<=")
      .replace(/→/g, "->").replace(/±/g, "+/-").replace(/₂/g, "2")
      .replace(/[–—]/g, "-").replace(/•/g, "-")
      .replace(/[\u{1F300}-\u{1FAFF}]|[\u2600-\u27BF]|[\u2190-\u21FF]|[\u2B00-\u2BFF]/gu, "")
      .replace(/\s+$/gm, "");
  }

  /* ═══ BLOCCHI DI DETTAGLIO (condivisi dai due report) ═══════════════
     Ogni dettaglio è un elenco di blocchi, così ogni informazione sta su
     una riga propria e si legge "a colpo d'occhio":
       { kind:"kv",   label, value }           "Etichetta: valore" (etichetta in grassetto)
       { kind:"list", label|null, items:[..] } etichetta + elenco puntato, una voce per riga
       { kind:"text", text, para? }            paragrafo semplice (para:true = stacco dal precedente) */
  function criteriaBlock(label, labels) {
    return labels.length
      ? { kind: "list", label: label + " (" + labels.length + ")", items: labels }
      : { kind: "kv", label, value: "nessuno" };
  }

  /* Testo libero -> blocchi: paragrafi separati da riga vuota, righe che
     iniziano con "•", "-" o "–" diventano un elenco puntato. */
  function textToBlocks(text) {
    const blocks = [];
    String(text || "").split(/\n\s*\n/).forEach((par, pi) => {
      let bullets = null, first = true;
      par.split("\n").map(l => l.trim()).filter(Boolean).forEach(l => {
        const m = l.match(/^[•\-–]\s+([\s\S]*)$/);
        if (m) {
          if (!bullets) { bullets = { kind: "list", label: null, items: [], para: pi > 0 && first }; blocks.push(bullets); }
          bullets.items.push(m[1]);
        } else {
          bullets = null;
          blocks.push({ kind: "text", text: l, para: pi > 0 && first });
        }
        first = false;
      });
    });
    return blocks;
  }

  /* "Etichetta: valore" -> blocco kv (etichetta in grassetto); altrimenti testo */
  function splitLabelValue(text) {
    const m = String(text).match(/^([^:]{1,60}):\s+([\s\S]*)$/);
    return m ? { kind: "kv", label: m[1], value: m[2] } : { kind: "text", text: String(text) };
  }

  /* Compatibilità: un dettaglio può ancora arrivare come stringa semplice */
  function normalizeDetail(d) {
    return Array.isArray(d) ? d : textToBlocks(d);
  }

  /* Impagina i blocchi in "righe" già spezzate sulla larghezza disponibile */
  function layoutBlocks(doc, blocks, o) {
    const rows = [];
    const wrap = (t, w) => doc.splitTextToSize(sanitizeForPdf(t), w);
    doc.setFontSize(o.size);
    (blocks || []).forEach(b => {
      const para = !!b.para;
      if (b.kind === "kv") {
        doc.setFont("helvetica", "bold");
        const label = sanitizeForPdf(b.label) + ":";
        const lw = doc.getTextWidth(label) + 4;
        doc.setFont("helvetica", "normal");
        rows.push({ t: "kv", label, lw, para, lines: wrap(b.value, o.width - lw) });
      } else if (b.kind === "list") {
        if (b.label) rows.push({ t: "head", label: sanitizeForPdf(b.label) + ":", para, lines: [""] });
        doc.setFont("helvetica", "normal");
        b.items.forEach((it, i) => rows.push({ t: "bullet", bi: o.bulletIndent, para: !b.label && i === 0 && para, lines: wrap(it, o.width - o.bulletIndent) }));
      } else {
        doc.setFont("helvetica", "normal");
        rows.push({ t: "text", para, lines: wrap(b.text, o.width) });
      }
    });
    return rows;
  }

  function rowsHeight(rows, lineH, gap) {
    return rows.reduce((h, r) => h + r.lines.length * lineH + gap + (r.para ? 4 : 0), 0);
  }

  /* Disegna le righe; restituisce la nuova y. o.beforeLine(ty,h) permette al
     chiamante di gestire il salto pagina (usato dal report schematico). */
  function drawRows(doc, rows, x, ty, o) {
    const pre = (t) => (o.beforeLine ? o.beforeLine(t, o.lineH) : t);
    rows.forEach(r => {
      if (r.para) ty += 4;
      if (r.t === "head") {
        ty = pre(ty);
        doc.setFont("helvetica", "bold"); doc.setFontSize(o.size); doc.setTextColor(...o.labelColor);
        doc.text(r.label, x, ty);
        ty += o.lineH;
      } else if (r.t === "kv") {
        r.lines.forEach((l, i) => {
          ty = pre(ty);
          doc.setFontSize(o.size);
          if (i === 0) { doc.setFont("helvetica", "bold"); doc.setTextColor(...o.labelColor); doc.text(r.label, x, ty); }
          doc.setFont("helvetica", "normal"); doc.setTextColor(...o.color);
          doc.text(l, x + r.lw, ty);
          ty += o.lineH;
        });
      } else if (r.t === "bullet") {
        r.lines.forEach((l, i) => {
          ty = pre(ty);
          if (i === 0) { doc.setFillColor(...o.bulletColor); doc.circle(x + 3.2, ty - o.size * 0.3, 1.3, "F"); }
          doc.setFont("helvetica", "normal"); doc.setFontSize(o.size); doc.setTextColor(...o.color);
          doc.text(l, x + r.bi, ty);
          ty += o.lineH;
        });
      } else {
        r.lines.forEach(l => {
          ty = pre(ty);
          doc.setFont("helvetica", "normal"); doc.setFontSize(o.size); doc.setTextColor(...o.color);
          doc.text(l, x, ty);
          ty += o.lineH;
        });
      }
      ty += o.gap;
    });
    return ty;
  }

  /* Raccoglie i dati del report — condivisi dalle due varianti (visiva e schematica),
     che differiscono solo nello stile: contenuto e ordine delle sezioni sono identici. */
  function collectReportData() {
    const now = new Date();
    const concluded = !!(evalStartTs && evalEndTs);
    let durationStr;
    if (concluded) durationStr = formatDuration(evalEndTs - evalStartTs);
    else if (evalStartTs) durationStr = "non conclusa (trascorso finora: " + formatDuration(now - evalStartTs) + ")";
    else durationStr = "n.d.";
    const rawGuideline = (decisionLog.find(e => e.fromNodeId === "choose_guideline") || {}).choice || "";
    const outcome = getCurrentOutcomeSummary();
    const curNode = TREE[history[history.length - 1]];

    // Esito: etichetta, titolo in evidenza, dettagli e tono (colore) del riquadro
    const out = { label: "Esito", tone: "warn", headline: "", blocks: [] };
    if (outcome && outcome.status === "finale" && curNode.type === "ctpa_check") {
      const rec = getCtpaRecommendation(curNode);
      out.tone = "info";
      out.headline = "Modalità di imaging scelta: " + (rec.recommended ? rec.recommended.label : "non determinata");
      if (rec.recommended) out.blocks.push({ kind: "text", text: rec.recommended.desc });
      out.blocks = out.blocks.concat(rec.selectionBlocks);
      if (rec.comment) out.blocks.push({ kind: "kv", label: "Commento dell'operatore", value: rec.comment });
    } else if (outcome && outcome.status === "finale") {
      out.tone = outcome.severity === "safe" ? "safe" : outcome.severity === "danger" ? "danger" : "warn";
      out.headline = outcome.title + (outcome.subtitle ? " - " + outcome.subtitle : "");
      out.blocks = (outcome.blocks || []).slice();
      if (outcome.note) out.blocks.push({ kind: "kv", label: "Nota", value: outcome.note, para: true });
    } else {
      out.label = "Valutazione non conclusa";
      out.headline = "Step corrente: " + (outcome ? outcome.title : "n.d.");
      out.blocks = [{ kind: "text", text: "Il report è stato scaricato prima della conclusione del percorso: non riporta un esito. Le sezioni seguenti descrivono solo i passaggi completati fino a questo momento." }];
    }

    // Passaggi: quelli registrati + l'eventuale scelta finale della modalità di imaging
    const steps = decisionLog.map((e, i) => ({ n: i + 1, title: e.fromTitle, choice: e.choice, detail: normalizeDetail(e.detail), summary: e.summary || "" }));
    if (curNode && curNode.type === "ctpa_check" && getCtpaRecommendation(curNode).made) {
      const rec = getCtpaRecommendation(curNode);
      steps.push({ n: steps.length + 1, title: curNode.title, detail: [], inOutcome: true,
        choice: "Modalità di imaging scelta: " + (rec.recommended ? rec.recommended.label : "non determinata") });
    }
    const strip = c => String(c).replace(/^(Selezione|Risultato|Modalità di imaging scelta):\s*/, "");
    const decisions = steps.filter(s => s.choice && s.choice !== "Continua").map(s => ({ n: s.n, title: s.title, result: strip(s.choice), summary: s.summary || "" }));
    const details = steps.filter(s => s.detail.length && !s.inOutcome).map(s => ({ n: s.n, title: s.title, result: strip(s.choice), blocks: s.detail }));

    return {
      now, out, steps, decisions, details,
      patient: patientId || "Non specificato (anonimo)",
      operator: operatorName || "Non specificato (anonimo)",
      guideline: rawGuideline.replace(/^Selezione:\s*/, "") || "Non ancora selezionate",
      startStr: evalStartTs ? formatDateTime(evalStartTs) : "n.d.",
      endStr: concluded ? formatDateTime(evalEndTs) : "Non ancora conclusa",
      durationStr, downloadStr: formatDateTime(now),
      version: "v" + TREE_METADATA.version + " (" + TREE_METADATA.lastUpdated + ")"
    };
  }

  /* Punto di ingresso unico per il download del report: "visual" oppure "schematic". */
  function downloadReport(style) {
    if (!decisionLog.length) {
      showMessage("Nessuno step registrato: completa almeno un passaggio della valutazione prima di scaricare il report.");
      return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showMessage("Libreria di generazione PDF non caricata: ricarica la pagina e riprova. Se il problema persiste segnalalo al responsabile dello strumento.");
      return;
    }
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    doc.setProperties({ title: "Report di valutazione - sospetta embolia polmonare", creator: "PE Decision Tool v" + TREE_METADATA.version });
    const data = collectReportData();
    renderReportPdf(doc, data, style === "schematic" ? "schematic" : "visual");

    const idPart = patientId ? patientId.replace(/[^a-zA-Z0-9_-]/g, "_") : "anonimo";
    const stamp  = data.now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    doc.save(`PE-Report_${idPart}_${style === "schematic" ? "schema" : "visivo"}_${stamp}.pdf`);
  }

  /* ═══════════════════════════════════════════════════════════════
     REPORT PDF — un solo impaginatore, due stili
       visual     colori, riquadri, righe alternate
       schematic  solo nero su bianco, filetti: per stampa e archiviazione
     Ordine delle sezioni (uguale nei due stili):
       intestazione · dati della valutazione · esito · sintesi delle decisioni ·
       dettaglio dei criteri · operatore/firma · avvertenze
     ═══════════════════════════════════════════════════════════════ */
  function renderReportPdf(doc, data, variant) {
    const V = variant !== "schematic";
    const M = 48, PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight();
    const W = PW - M * 2, BOTTOM = PH - 58;
    const K = [0, 0, 0], WHITE = [255, 255, 255];
    const COL = V
      ? { dark: [22, 27, 34], text: [45, 51, 59], muted: [100, 108, 118], faint: [245, 247, 249], border: [212, 217, 223], accent: [23, 92, 211],
          tone: { safe: { fg: [22, 108, 58], bg: [227, 245, 232] }, warn: { fg: [138, 90, 0], bg: [253, 240, 208] },
                  danger: { fg: [178, 34, 30], bg: [253, 228, 226] }, info: { fg: [23, 92, 211], bg: [230, 239, 253] } } }
      : { dark: K, text: K, muted: [75, 75, 75], faint: WHITE, border: [140, 140, 140], accent: K,
          tone: { safe: { fg: K, bg: WHITE }, warn: { fg: K, bg: WHITE }, danger: { fg: K, bg: WHITE }, info: { fg: K, bg: WHITE } } };
    const S = sanitizeForPdf;
    let y = 0;

    const font = (style, size, color) => { doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color); };
    const wrap = (t, w) => doc.splitTextToSize(S(t), w);          // usa il font impostato in quel momento
    const hline = (yy, color, lw) => { doc.setDrawColor(...color); doc.setLineWidth(lw); doc.line(M, yy, PW - M, yy); };

    function runningHeader() {
      font("normal", 8, COL.muted);
      doc.text(S("Report di valutazione - sospetta embolia polmonare acuta"), M, 30);
      doc.text(S("Paziente: " + data.patient), PW - M, 30, { align: "right" });
      hline(36, COL.border, 0.5);
    }
    function ensure(h) {
      if (y + h <= BOTTOM) return;
      doc.addPage(); y = 58; runningHeader();
    }
    // Titolo di sezione; "keep" = altezza minima che deve restare sulla pagina dopo il titolo
    function section(title, keep) {
      ensure(30 + (keep || 0));
      y += 8;
      font("bold", V ? 9.5 : 10.5, COL.accent);
      doc.text(S(title).toUpperCase(), M, y, { charSpace: V ? 0.7 : 0.3 });
      y += 6;
      hline(y, V ? COL.border : K, V ? 0.6 : 0.9);
      y += 15;
    }
    function blockRows(blocks, size, width) { return layoutBlocks(doc, blocks, { size, width, bulletIndent: 11 }); }
    function drawBlockRows(rows, x, ty, size, bullet) {
      return drawRows(doc, rows, x, ty, { size, lineH: size + 2.8, gap: 2.5, color: COL.text, labelColor: COL.dark, bulletColor: bullet || COL.accent });
    }

    /* ── Intestazione ── */
    if (V) { doc.setFillColor(...COL.accent); doc.rect(0, 0, PW, 7, "F"); }
    y = 54;
    font("bold", 19, COL.dark);
    doc.text("Report di valutazione", M, y);
    font("normal", 9, COL.muted);
    doc.text(S("PE Decision Tool " + data.version), PW - M, y - 8, { align: "right" });
    doc.text(S("Scaricato il " + data.downloadStr), PW - M, y + 4, { align: "right" });
    y += 17;
    font("normal", 10.5, COL.muted);
    doc.text(S("Sospetta embolia polmonare acuta - strumento di supporto decisionale"), M, y);
    y += 11;
    hline(y, V ? COL.accent : K, V ? 1.4 : 0.9);
    y += 16;

    /* ── Dati della valutazione: griglia a due colonne ── */
    (function infoGrid() {
      const LX = M + (V ? 14 : 0), LVX = LX + 82, RX = M + W * 0.56, RVX = RX + 46;
      const LW = RX - LVX - 12, RW = PW - M - RVX - (V ? 12 : 0);
      const rows = [
        [["Paziente (ID)", data.patient], ["Inizio", data.startStr]],
        [["Operatore", data.operator],    ["Fine", data.endStr]],
        [["Linee guida", data.guideline], ["Durata", data.durationStr]]
      ];
      font("normal", 10, COL.text);
      const laid = rows.map(r => ({ r, l: wrap(r[0][1], LW), rr: wrap(r[1][1], RW) }));
      const hs = laid.map(o => Math.max(o.l.length, o.rr.length) * 12.5 + 4);
      const h = hs.reduce((a, b) => a + b, 0) + (V ? 20 : 6);
      ensure(h + 10);
      if (V) { doc.setFillColor(...COL.faint); doc.setDrawColor(...COL.border); doc.setLineWidth(0.6); doc.roundedRect(M, y, W, h, 5, 5, "FD"); }
      let ty = y + (V ? 21 : 10);
      laid.forEach((o, i) => {
        font("bold", 8.5, COL.muted);
        doc.text(S(o.r[0][0]), LX, ty); doc.text(S(o.r[1][0]), RX, ty);
        font(i === 0 ? "bold" : "normal", 10, COL.dark);
        o.l.forEach((l, k) => doc.text(l, LVX, ty + k * 12.5));
        font("normal", 10, COL.dark);
        o.rr.forEach((l, k) => doc.text(l, RVX, ty + k * 12.5));
        ty += hs[i];
      });
      y += h + (V ? 14 : 6);
      if (!V) { hline(y, COL.border, 0.4); y += 12; }
    })();

    /* ── Esito ── */
    (function outcomeBox() {
      const tone = COL.tone[data.out.tone] || COL.tone.warn;
      const PADX = 16, IW = W - PADX * 2;
      font("bold", 13, tone.fg);
      const head = wrap(data.out.headline, IW);
      const rows = blockRows(data.out.blocks, 9.8, IW);
      const h = 20 + 12 + head.length * 16 + (rows.length ? 5 + rowsHeight(rows, 12.6, 2.5) : 0) + 2;
      ensure(Math.min(h, BOTTOM - 70) + 10);
      if (V) {
        doc.setFillColor(...tone.bg); doc.roundedRect(M, y, W, h, 5, 5, "F");
        doc.setFillColor(...tone.fg); doc.rect(M, y, 4, h, "F");
      } else {
        doc.setDrawColor(...K); doc.setLineWidth(1.1); doc.rect(M, y, W, h);
      }
      let ty = y + 18;
      font("bold", 8.5, V ? tone.fg : K);
      doc.text(S(data.out.label).toUpperCase(), M + PADX, ty, { charSpace: 0.8 });
      ty += 18;
      font("bold", 13, V ? tone.fg : K);
      head.forEach(l => { doc.text(l, M + PADX, ty); ty += 16; });
      if (rows.length) { ty += 1; drawBlockRows(rows, M + PADX, ty, 9.8, tone.fg); }
      y += h + 12;
    })();

    /* ── Sintesi delle decisioni: una riga per ogni scelta o risultato ── */
    if (data.decisions.length) {
      section("Sintesi delle decisioni", 60);
      const C1 = 26, C2 = 178, X1 = M + 8, X2 = X1 + C1, X3 = X2 + C2, W3 = PW - M - X3 - 8;
      font("bold", 8, COL.muted);
      doc.text("N.", X1, y); doc.text("PASSAGGIO", X2, y); doc.text("SCELTA / RISULTATO", X3, y);
      y += 6; hline(y, COL.border, 0.5); y += 3;
      data.decisions.forEach((d, i) => {
        font("normal", 9.5, COL.text);
        const t = wrap(d.title, C2 - 10);
        font("bold", 9.5, COL.dark);
        const r = wrap(d.result, W3);
        font("normal", 8.6, COL.muted);
        const sm = d.summary ? wrap(d.summary, W3) : [];
        const h = Math.max(t.length * 12, r.length * 12 + sm.length * 10.5) + 9;
        ensure(h);
        if (V && i % 2 === 0) { doc.setFillColor(...COL.faint); doc.rect(M, y, W, h, "F"); }
        font("normal", 9.5, COL.muted); doc.text(String(d.n), X1, y + 13);
        font("normal", 9.5, COL.text); t.forEach((l, k) => doc.text(l, X2, y + 13 + k * 12));
        font("bold", 9.5, COL.dark);   r.forEach((l, k) => doc.text(l, X3, y + 13 + k * 12));
        font("normal", 8.6, COL.muted); sm.forEach((l, k) => doc.text(l, X3, y + 13 + r.length * 12 + k * 10.5 - 1));
        y += h;
        if (!V) hline(y, [200, 200, 200], 0.3);
      });
      y += 9;
      font("normal", 8.3, COL.muted);
      const pathLines = wrap("Percorso completo (" + data.steps.length + " passaggi): " + data.steps.map(s => s.n + ". " + s.title).join("  >  "), W);
      pathLines.forEach(l => { ensure(10.5); doc.text(l, M, y); y += 10.5; });
      y += 6;
    }

    /* ── Dettaglio dei criteri: solo i passaggi con dati inseriti ── */
    if (data.details.length) {
      section("Dettaglio dei criteri", 70);
      data.details.forEach((d, i) => {
        const PADX = V ? 14 : 0, IW = W - PADX * 2;
        font("bold", 10.5, COL.dark);
        const t = wrap(d.n + ". " + d.title, IW);
        font("normal", 9.5, COL.accent);
        const r = wrap(d.result, IW);
        const rows = blockRows(d.blocks, 9.2, IW);
        const h = (V ? 16 : 2) + t.length * 13 + r.length * 12 + 6 + rowsHeight(rows, 12, 2.5) + (V ? 0 : 2);
        ensure(Math.min(h, BOTTOM - 70) + 8);
        if (V) { doc.setDrawColor(...COL.border); doc.setFillColor(...WHITE); doc.setLineWidth(0.6); doc.roundedRect(M, y, W, h, 4, 4, "FD"); }
        let ty = y + (V ? 18 : 10);
        font("bold", 10.5, COL.dark);
        t.forEach(l => { doc.text(l, M + PADX, ty); ty += 13; });
        font(V ? "normal" : "italic", 9.5, COL.accent);
        r.forEach(l => { doc.text(l, M + PADX, ty); ty += 12; });
        ty += 5;
        drawBlockRows(rows, M + PADX, ty, 9.2);
        y += h + (V ? 8 : 4);
        if (!V && i < data.details.length - 1) { hline(y, [200, 200, 200], 0.3); y += 6; }
      });
      y += 4;
    }

    /* ── Operatore e firma ── */
    section("Operatore", 46);
    font("bold", 8.5, COL.muted); doc.text("Operatore", M, y);
    font("normal", 10, COL.dark); doc.text(wrap(data.operator, W * 0.5 - 70)[0], M + 62, y);
    font("bold", 8.5, COL.muted); doc.text("Firma", M + W * 0.5, y);
    doc.setDrawColor(...COL.muted); doc.setLineWidth(0.5); doc.line(M + W * 0.5 + 36, y + 2, PW - M, y + 2);
    y += 26;

    /* ── Avvertenze ── */
    section("Avvertenze", 60);
    [["Uso clinico", TREE_METADATA.disclaimer],
     ["Riservatezza e sicurezza dei dati", TREE_METADATA.privacy_notice],
     ["Fonte", TREE_METADATA.source]].forEach(p => {
      font("normal", 8.2, COL.text);
      const lines = wrap(p[1], W);
      ensure(11 + Math.min(lines.length, 3) * 10);
      font("bold", 8.2, COL.dark); doc.text(S(p[0]), M, y); y += 10.5;
      font("normal", 8.2, COL.text);
      lines.forEach(l => { ensure(10); doc.text(l, M, y); y += 10; });
      y += 6;
    });

    /* ── Piè di pagina su ogni pagina ── */
    const total = doc.internal.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      hline(PH - 40, COL.border, 0.4);
      font("normal", 7.8, COL.muted);
      doc.text(S("PE Decision Tool " + data.version), M, PH - 27);
      doc.text("Documento riservato - contiene dati sanitari", PW / 2, PH - 27, { align: "center" });
      doc.text("Pag. " + p + " di " + total, PW - M, PH - 27, { align: "right" });
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     PROGRESS & BREADCRUMB
     ═══════════════════════════════════════════════════════════════ */
  /* Avanzamento reale: passi fatti / (passi fatti + passi massimi ancora possibili). */
  function updateProgress() {
    const done = Math.max(0, history.length - 1);
    const cur = history[history.length - 1];
    const left = cur ? E.maxDepthFrom(TREE, cur) : 1;
    const pct = (done + left) ? Math.round((done / (done + left)) * 100) : 0;
    $("progress-bar").style.width = pct + "%";
    $("progress-wrap").setAttribute("aria-valuenow", String(pct));
  }

  const NODE_LABELS = {
    start:"Inizio", choose_guideline:"Linee Guida", symptoms_check:"H&P", choose_score:"Scegli Score",
    wells_score:"Wells", geneva_score:"Geneva", geneva_simple_score:"Geneva Sempl.",
    perc_check:"PERC", ddimer_years:"D-Dimero+YEARS",
    diagnostic_imaging_direct:"Imaging (Alta prob.)", diagnostic_imaging:"Imaging",
    ctpa_check:"Scelta Imaging", result_very_low_prob:"PE improbabile", result_pe_excluded:"PE esclusa",
    esc_hemodynamic_check:"Instabilità Emod.", esc_bedside_tte:"TTE Bedside",
    esc_rv_dysfunction:"Disfunzione RV", esc_search_other_causes_1:"Altre Cause",
    esc_ctpa_feasible:"Scelta Imaging",
    esc_choose_score:"Scegli Score (ESC)", esc_wells_score:"Wells (ESC)", esc_geneva_score:"Geneva (ESC)",
    esc_ddimer_test:"D-Dimero (ESC)",
    esc_ctpa_low_intermediate:"Scelta Imaging",
    esc_ctpa_no_dimer:"Scelta Imaging",
    esc_pe_excluded:"PE Esclusa"
  };

  function renderBreadcrumb() {
    const el = $("breadcrumb");
    if (history.length <= 1) { el.innerHTML = ""; return; }
    el.innerHTML = history.map((id, i) => {
      const label = esc(NODE_LABELS[id] || id);
      return i === history.length - 1
        ? `<span class="crumb-current" aria-current="step">${label}</span>`
        : `<button type="button" class="crumb" data-action="jumpTo" data-idx="${i}">${label}</button>`;
    }).join('<span class="crumb-sep" aria-hidden="true">›</span>');
  }

  /* ═══════════════════════════════════════════════════════════════
     BLOCCHI COMUNI
     ═══════════════════════════════════════════════════════════════ */
  function corBadge(cor, color) {
    if (!cor) return "";
    return `<div class="cor-badge" data-cor-color="${esc(color || "")}"><span aria-hidden="true">●</span><span>${esc(cor)}</span></div>`;
  }

  function backButton(cls) {
    return history.length > 1 ? `<button type="button" class="btn-secondary ${cls || "mt-10"}" data-action="goBack">← Indietro</button>` : "";
  }

  function reportButtons() {
    return `<div class="btn-row mt-18">
      <button type="button" class="btn-primary" data-action="downloadReport" data-variant="visual">📄 Report Visivo</button>
      <button type="button" class="btn-primary" data-action="downloadReport" data-variant="schematic">📋 Report Schematico</button>
    </div>
    <p class="privacy-note">🔒 ${esc(TREE_METADATA.privacy_notice)}</p>`;
  }

  function disclaimerBox() {
    return `<div class="disclaimer">${esc(TREE_METADATA.disclaimer)}<br>
      <strong>Fonte:</strong> ${esc(TREE_METADATA.source)} · ${esc(TREE_METADATA.author)}</div>`;
  }

  function sevIcon(sev) {
    return { safe:"✅", warning:"🔶", danger:"🔴" }[sev] || "🔶";
  }

  function resultBanner(sev, text, cls) {
    return `<div class="result-banner banner-${esc(sev)} ${cls || ""}"><span aria-hidden="true">${sevIcon(sev)}</span><span>${esc(text)}</span></div>`;
  }

  /* ═══════════════════════════════════════════════════════════════
     RENDER DISPATCHER
     ═══════════════════════════════════════════════════════════════ */
  /* opts.keep = aggiornamento sul posto (spunta di una voce): niente animazione,
     niente scroll in cima, focus mantenuto. */
  function render(nodeId, opts) {
    opts = opts || {};
    updateProgress();
    renderBreadcrumb();
    const node = TREE[nodeId];
    const el = $("content");
    const build = () => {
      el.innerHTML = "";
      const fn = { info: renderInfo, question: renderQuestion, score: renderScore, result: renderResult, ctpa_check: renderCtpaCheck }[node.type];
      const card = fn(node);
      if (opts.keep) card.classList.add("no-anim");
      el.appendChild(card);
      applyDynamicStyles(el);
      if (node.ddimer_input) refreshDdimer(node.id);
    };
    if (opts.keep) { keepFocus(build); return; }
    build();
    window.scrollTo({ top: 0 });
    const h = el.querySelector(".card-title");
    if (h) h.focus({ preventScroll: true });
  }

  function newCard(cls) {
    const card = document.createElement("div");
    card.className = "card" + (cls ? " " + cls : "");
    return card;
  }

  /* ── INFO ─────────────────────────────────────────────────────── */
  function renderInfo(node) {
    const card = newCard();
    card.innerHTML = `
      ${corBadge(node.cor, node.cor_color)}
      <span class="card-icon" aria-hidden="true">${esc(node.icon)}</span>
      <h1 class="card-title" tabindex="-1">${esc(node.title)}</h1>
      ${node.subtitle ? `<p class="card-subtitle">${esc(node.subtitle)}</p>` : ""}
      <p class="card-body">${esc(node.body)}</p>
      ${node.hint ? `<div class="hint-box">${esc(node.hint)}</div>` : ""}
      <button type="button" class="btn-primary" data-action="goTo" data-node="${esc(node.next)}">Continua →</button>
      ${backButton()}
    `;
    return card;
  }

  /* ── QUESTION ─────────────────────────────────────────────────── */
  function renderQuestion(node) {
    const card = newCard();
    card.innerHTML = `
      <span class="card-icon" aria-hidden="true">${esc(node.icon || "🔀")}</span>
      <h1 class="card-title" tabindex="-1">${esc(node.title)}</h1>
      ${node.subtitle ? `<p class="card-subtitle">${esc(node.subtitle)}</p>` : ""}
      <p class="card-body">${esc(node.body)}</p>
      <div class="options-grid">
        ${node.options.map(o => `
          <button type="button" class="option-btn" data-action="goTo" data-node="${esc(o.next)}">
            <span class="option-label">${esc(o.label)}</span>
            ${o.desc ? `<span class="option-desc">${esc(o.desc)}</span>` : ""}
          </button>`).join("")}
      </div>
      ${backButton("mt-14")}
    `;
    return card;
  }

  /* ── SCORE ────────────────────────────────────────────────────── */
  function renderScore(node) {
    const nid = node.id;
    if (!scores[nid]) scores[nid] = { items: {}, interpIdx: 0 };
    const state = scores[nid];
    const isYEARS = node.scoreType === "years";
    const total = E.computeTotal(node, state.items);

    let tabsHtml = "";
    if (node.interpretation && node.interpretation.length > 1) {
      tabsHtml = `<div class="interp-tabs" role="group" aria-label="Schema interpretativo">` +
        node.interpretation.map((t, i) =>
          `<button type="button" class="interp-tab${i === state.interpIdx ? " active" : ""}" aria-pressed="${i === state.interpIdx}"
             data-action="setInterp" data-nid="${esc(nid)}" data-idx="${i}" data-key="tab-${i}">${esc(t.label)}</button>`
        ).join("") + `</div>`;
    }

    const checkHtml = (node.items || []).map(item => {
      const checked = !!state.items[item.id];
      return `
        <button type="button" class="check-item${checked ? " checked" : ""}" role="checkbox" aria-checked="${checked}"
            data-action="toggleItem" data-nid="${esc(nid)}" data-item="${esc(item.id)}" data-key="item-${esc(item.id)}">
          <span class="check-box" aria-hidden="true">${checked ? "✓" : ""}</span>
          <span class="check-label">${esc(item.label)}</span>
          ${node.hide_points ? "" : `<span class="check-pts">+${esc(item.points)}</span>`}
        </button>`;
    }).join("");

    let ddimerHtml = "";
    if (node.ddimer_input) {
      const dd = ddimers[nid] || {};
      const unitOpts = Object.keys(E.DDIMER_UNITS).map(u => `
        <label class="radio-opt"><input type="radio" name="unit-${esc(nid)}" value="${esc(u)}" ${dd.unit === u ? "checked" : ""}
          data-input="ddimer" data-nid="${esc(nid)}" data-key="unit-${esc(u)}"><span>${esc(E.DDIMER_UNITS[u].label)}</span></label>`).join("");
      ddimerHtml = `
        <div class="ddimer-group">
          <label class="ddimer-label" for="age-input-${esc(nid)}">Età paziente (anni compiuti)</label>
          <div class="age-row">
            <input class="age-input" id="age-input-${esc(nid)}" type="text" inputmode="numeric" autocomplete="off" maxlength="3"
              placeholder="anni" value="${esc(dd.ageRaw || "")}" data-input="ddimer" data-nid="${esc(nid)}" data-key="age"/>
          </div>
          <fieldset class="radio-group">
            <legend class="ddimer-label">Unità di misura riportata sul referto del D-Dimero</legend>
            ${unitOpts}
          </fieldset>
          <label class="ddimer-label" for="ddimer-val-${esc(nid)}">Valore D-Dimero (come da referto)</label>
          <div class="ddimer-row">
            <input class="ddimer-input" id="ddimer-val-${esc(nid)}" type="text" inputmode="decimal" autocomplete="off" maxlength="9"
              placeholder="es. 450 oppure 0,45" value="${esc(dd.valueRaw || "")}" data-input="ddimer" data-nid="${esc(nid)}" data-key="val"/>
          </div>
          <div class="ddimer-hint">ℹ Le soglie sono espresse in ng/mL (µg/L): un valore in mg/L viene convertito automaticamente (× 1000). Non usare separatori delle migliaia.</div>
          ${node.hint_age_adjusted ? `<div class="ddimer-hint">ℹ ${esc(node.hint_age_adjusted)}</div>` : ""}
          <div id="ddimer-dynamic-${esc(nid)}" aria-live="polite"></div>
        </div>`;
    }

    // Esito in anteprima (per i nodi D-Dimero è gestito da refreshDdimer)
    let interpHtml = "";
    if (!isYEARS) {
      const result = E.getScoreResult(node, state);
      if (result) interpHtml = resultBanner(E.severityFor(TREE, result), result.category, "mt-4");
    }

    const showTotal = (node.items || []).length > 0;
    const canGo = node.ddimer_input ? ddimerReady(nid) : !!E.getScoreResult(node, state);
    const card = newCard();
    card.innerHTML = `
      ${corBadge(node.cor, node.cor_color)}
      <span class="card-icon" aria-hidden="true">${esc(node.icon || "📋")}</span>
      <h1 class="card-title" tabindex="-1">${esc(node.title)}</h1>
      ${node.subtitle ? `<p class="card-subtitle">${esc(node.subtitle)}</p>` : ""}
      ${node.description ? `<div class="score-description">${esc(node.description)}</div>` : ""}
      ${tabsHtml}
      ${showTotal ? `<div class="checklist">${checkHtml}</div>
      <div class="score-total">
        <span class="score-total-label">${esc(node.total_label || "Punteggio totale")}</span>
        <span class="score-total-value" aria-live="polite">${esc(total)}</span>
      </div>` : ""}
      ${ddimerHtml}
      <div aria-live="polite">${interpHtml}</div>
      <button type="button" class="btn-primary" id="continue-btn-${esc(nid)}"
        data-action="submitScore" data-nid="${esc(nid)}" ${canGo ? "" : "disabled"}>
        Conferma e Continua →
      </button>
      ${backButton()}
    `;
    return card;
  }

  function toggleItem(nid, itemId) {
    const s = scores[nid];
    s.items = E.toggleItem(TREE[nid], s.items, itemId);
    render(history[history.length - 1], { keep: true });
  }

  function setInterpIdx(nid, idx) {
    if (!TREE[nid].interpretation[idx]) return;
    scores[nid].interpIdx = idx;
    render(history[history.length - 1], { keep: true });
  }

  /* Legge gli input del D-Dimero e aggiorna solo la parte dinamica (nessun re-render dei campi) */
  function onDdimerInput(nid) {
    const ageEl = $("age-input-" + nid), valEl = $("ddimer-val-" + nid);
    if (!ageEl || !valEl) return;
    const unitEl = document.querySelector('input[name="unit-' + nid + '"]:checked');
    const prev = ddimers[nid] || {};
    const next = { ageRaw: ageEl.value, valueRaw: valEl.value, unit: unitEl ? unitEl.value : undefined, mode: prev.mode, confirmUnusual: prev.confirmUnusual };
    // Se cambia valore o unità, un'eventuale conferma di "valore insolito" non è più valida
    if (next.valueRaw !== prev.valueRaw || next.unit !== prev.unit) next.confirmUnusual = false;
    ddimers[nid] = next;
    refreshDdimer(nid);
  }

  function refreshDdimer(nid) {
    const box = $("ddimer-dynamic-" + nid);
    if (!box) return;
    const dd = ddimers[nid] || {};
    const ev = evalDdimerNode(nid);
    const age = parseDd(nid).age;
    let html = "";
    if (ev.needsMode) {
      const base = ev.baseThreshold;
      html += `<fieldset class="radio-group">
        <legend class="ddimer-label">Soglia da applicare (scelta obbligatoria oltre i 50 anni)</legend>
        <label class="radio-opt"><input type="radio" name="mode-${esc(nid)}" value="fixed" ${dd.mode === "fixed" ? "checked" : ""}
          data-input="ddimer-mode" data-nid="${esc(nid)}" data-key="mode-fixed"><span>Soglia fissa: ${esc(base)} ng/mL</span></label>
        <label class="radio-opt"><input type="radio" name="mode-${esc(nid)}" value="age" ${dd.mode === "age" ? "checked" : ""}
          data-input="ddimer-mode" data-nid="${esc(nid)}" data-key="mode-age"><span>Soglia età-corretta: ${esc(E.ageAdjustedThreshold(age))} ng/mL (età × 10)</span></label>
      </fieldset>`;
    }
    if (ev.threshold !== null) html += `<div class="age-threshold">Soglia applicata: ${esc(ev.thresholdLabel)}</div>`;
    const started = !!((dd.ageRaw || "").trim() || (dd.valueRaw || "").trim() || dd.unit);
    if (started && ev.errors.length) {
      html += `<ul class="ddimer-todo">${ev.errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`;
    }
    if (ev.warnings.length) {
      html += `<div class="note-box">${ev.warnings.map(esc).join(" ")}</div>
        <label class="radio-opt confirm-opt"><input type="checkbox" ${dd.confirmUnusual ? "checked" : ""}
          data-input="ddimer-confirm" data-nid="${esc(nid)}" data-key="confirm-unusual"><span>Confermo che valore e unità di misura sono corretti</span></label>`;
    }
    if (ev.rule) html += resultBanner(E.severityFor(TREE, ev.rule), ev.rule.category, "mt-8");
    keepFocus(() => { box.innerHTML = html; });
    const btn = $("continue-btn-" + nid);
    if (btn) btn.disabled = !ddimerReady(nid);
  }

  function submitScore(nid) {
    const node = TREE[nid];
    let result;
    if (node.ddimer_input) {
      onDdimerInput(nid);
      const ev = evalDdimerNode(nid);
      if (!ev.rule) { showMessage(ev.errors.join("\n") || "Completa i dati del D-Dimero per procedere."); return; }
      if (ev.warnings.length && !(ddimers[nid] || {}).confirmUnusual) { showMessage(ev.warnings.join("\n") + "\nConferma il valore oppure correggilo per procedere."); return; }
      result = ev.rule;
    } else {
      result = E.getScoreResult(node, scores[nid]);
    }
    if (!result) { showMessage("Completa la valutazione per procedere."); return; }
    goTo(result.next);
  }

  /* ── RESULT ───────────────────────────────────────────────────── */
  function renderResult(node) {
    const card = newCard("result-" + node.severity);
    const banner = { safe:"Probabilità molto bassa / PE esclusa", warning:"Test necessari – procedere con imaging", danger:"Alta probabilità – eseguire imaging urgente" };
    card.innerHTML = `
      ${corBadge(node.cor, node.cor_color)}
      <span class="card-icon" aria-hidden="true">${esc(node.icon)}</span>
      <h1 class="card-title" tabindex="-1">${esc(node.title)}</h1>
      ${node.subtitle ? `<p class="card-subtitle">${esc(node.subtitle)}</p>` : ""}
      ${resultBanner(node.severity, node.banner || banner[node.severity] || "")}
      <p class="card-body">${esc(node.body)}</p>
      ${node.note ? `<div class="note-box">${esc(node.note)}</div>` : ""}
      ${disclaimerBox()}
      ${node.next
        ? `<button type="button" class="btn-primary mt-18" data-action="goTo" data-node="${esc(node.next)}">Verifica Controindicazioni CTPA →</button>`
        : reportButtons()}
      <button type="button" class="btn-secondary mt-10" data-action="requestReset">↺ Nuova Valutazione</button>
      ${backButton("mt-8")}
    `;
    return card;
  }

  /* ── CTPA CHECK ───────────────────────────────────────────────── */
  function renderCtpaCheck(node) {
    const card = newCard();
    card.id = "ctpa-card";
    card.dataset.nodeId = node.id;
    card.innerHTML = buildCtpaHtml(node);
    return card;
  }

  function buildCtpaHtml(node) {
    const { absolute, relative } = node.contraindications;
    const noneOpt = node.no_contraindications_option;
    const noneChecked = !!ctpaState[noneOpt.id];
    const checkedIds = Object.keys(ctpaState).filter(k => ctpaState[k] && k !== noneOpt.id);
    const hasAny = checkedIds.length > 0;

    const ciItem = (ci, cls) => {
      const on = !!ctpaState[ci.id];
      return `<button type="button" class="ci-item${on ? " " + cls : ""}" role="checkbox" aria-checked="${on}"
          data-action="toggleCi" data-nid="${esc(node.id)}" data-ci="${esc(ci.id)}" data-key="ci-${esc(ci.id)}">
        <span class="ci-box" aria-hidden="true">${on ? "✓" : ""}</span>
        <span class="ci-label">${esc(ci.label)}</span></button>`;
    };
    const absItems = absolute.map(ci => ciItem(ci, "ci-abs")).join("");
    const relItems = relative.map(ci => ciItem(ci, "ci-rel")).join("");

    // "Nessuna controindicazione" – opzione separata, mutuamente esclusiva
    const noneItem = `
      <button type="button" class="ci-item ci-none${noneChecked ? " ci-none-checked" : ""}" role="checkbox" aria-checked="${noneChecked}"
          data-action="toggleNoneCi" data-nid="${esc(node.id)}" data-key="ci-none">
        <span class="ci-box" aria-hidden="true">${noneChecked ? "✓" : ""}</span>
        <span class="ci-label strong">${esc(noneOpt.label)}</span>
      </button>`;

    let statusHtml = "";
    if (noneChecked) {
      statusHtml = `<div class="ctpa-ok"><span aria-hidden="true">✅</span> Confermato: nessuna controindicazione — puoi procedere con CTPA</div>`;
    } else if (hasAny) {
      statusHtml = `<div class="result-banner banner-warning mt-12"><span aria-hidden="true">🟡</span>
        <span>CTPA controindicata o non disponibile – seleziona un'alternativa tra quelle proposte</span></div>`;
    }

    const selectedAltId = ctpaChoice[node.id] || null;

    // Card di un'alternativa: sempre selezionabile dall'utente. "isBest" è solo un
    // suggerimento; è la SELEZIONE ESPLICITA a determinare la scelta nel report.
    const renderAltCard = (a, isBest, isSelected) => {
      const subHtml = a.subitems
        ? `<div class="alt-subitems">${a.subitems.map(s => `<div class="alt-subitem">${esc(s)}</div>`).join("")}</div>`
        : "";
      const echoHtml = a.id.indexOf("alt_echo") === 0 ? `
        <button type="button" class="echo-toggle" aria-expanded="false" data-action="toggleEcho" data-key="echo-${esc(a.id)}">▸ Parametri ecocardiografici disfunzione RV</button>
        <div class="echo-table-wrap" hidden>
          <table><thead><tr><th>Parametro</th><th>Tecnica</th><th>Soglia</th></tr></thead>
          <tbody>${ECHO_RV_TABLE.map(r => `<tr>
            <td><strong>${esc(r.parameter)}</strong></td>
            <td>${esc(r.technique)}</td>
            <td>${esc(r.definition)}</td></tr>`).join("")}
          </tbody></table>
          <p class="echo-source">${esc(ECHO_RV_TABLE_SOURCE)}${node.id.indexOf("esc_") === 0 ? "<br>" + esc(ECHO_RV_TABLE_ESC_NOTE) : ""}</p>
        </div>` : "";
      const cta = isSelected
        ? `<div class="alt-cta alt-cta-selected">✓ Modalità selezionata</div>`
        : `<div class="alt-cta">Seleziona questa modalità →</div>`;
      return `<div class="alt-card${isBest ? " best" : ""}${isSelected ? " selected" : ""}" role="button" tabindex="0" aria-pressed="${isSelected}"
          data-action="selectCtpaAlt" data-nid="${esc(node.id)}" data-alt="${esc(a.id)}" data-key="alt-${esc(a.id)}">
        <div class="alt-header">
          <span aria-hidden="true">${esc(a.icon)}</span><span>${esc(a.label)}</span>
          ${isBest ? `<span class="alt-best-badge">✦ Consigliata</span>` : ""}
        </div>
        <div class="alt-desc">${esc(a.desc)}</div>
        ${subHtml}${echoHtml}${cta}
      </div>`;
    };

    let altHtml = "";
    const ctpaAlt = node.alternatives.find(a => a.best_for.indexOf(noneOpt.id) >= 0);
    if (noneChecked) {
      if (ctpaAlt) {
        altHtml = `<div class="alt-section-label">Modalità disponibile — seleziona per confermare</div>${renderAltCard(ctpaAlt, true, selectedAltId === ctpaAlt.id)}`;
      }
    } else if (hasAny) {
      const ranked = node.alternatives
        .filter(a => !ctpaAlt || a.id !== ctpaAlt.id)
        .map(a => ({ a, score: a.best_for.filter(id => checkedIds.indexOf(id) >= 0).length }))
        .filter(x => x.score > 0)
        .sort((x, y) => y.score - x.score);
      if (ranked.length) {
        const topScore = ranked[0].score;
        const cards = ranked.map(x => renderAltCard(x.a, x.score === topScore, selectedAltId === x.a.id)).join("");
        altHtml = `<div class="alt-section-label">Seleziona la modalità di imaging tra le opzioni compatibili con le controindicazioni rilevate</div>${cards}`;
      }
    }

    const selectionPendingHint = (noneChecked || hasAny) && !selectedAltId
      ? `<div class="hint-box hint-warn mt-12">👆 Seleziona, tra le card sopra, la modalità di imaging che utilizzerai: comparirà poi nel report.</div>`
      : "";

    return `
      <span class="card-icon" aria-hidden="true">${esc(node.icon)}</span>
      <h1 class="card-title" tabindex="-1">${esc(node.title)}</h1>
      <p class="card-subtitle">${esc(node.subtitle)}</p>
      <div class="hint-box">Seleziona le controindicazioni presenti, oppure conferma che non ce ne sono, per individuare le modalità di imaging compatibili. La valutazione si conclude a questo step: interpretazione del referto e diagnosi finale restano di competenza clinica.</div>
      <div class="ci-section-label abs"><span aria-hidden="true">⬤</span> Controindicazioni Assolute</div>
      ${absItems}
      <div class="ci-section-label rel"><span aria-hidden="true">⬤</span> Controindicazioni Relative</div>
      ${relItems}
      <div class="ci-section-label none"><span aria-hidden="true">⬤</span> Nessuna controindicazione</div>
      ${noneItem}
      <div aria-live="polite">${statusHtml}</div>
      ${altHtml}
      ${selectionPendingHint}
      ${selectedAltId ? `
      <div class="ctpa-comment-box mt-16">
        <label class="ddimer-label" for="ctpa-comment-${esc(node.id)}">Commento clinico (facoltativo) — motiva la scelta della modalità di imaging</label>
        <textarea id="ctpa-comment-${esc(node.id)}" class="ctpa-comment-input" rows="3" maxlength="1000"
          placeholder="Es. paziente non trasferibile, priorità a ecografia point-of-care, disponibilità limitata di CTPA…"
          data-input="ctpa-comment" data-nid="${esc(node.id)}" data-key="ctpa-comment">${esc(ctpaComments[node.id] || "")}</textarea>
      </div>
      ${reportButtons()}` : ""}
      ${disclaimerBox()}
      <button type="button" class="btn-secondary mt-16" data-action="requestReset">↺ Nuova Valutazione</button>
      ${backButton("mt-8")}
    `;
  }

  function redrawCtpa(nodeId) {
    const card = $("ctpa-card");
    if (card) keepFocus(() => { card.innerHTML = buildCtpaHtml(TREE[nodeId]); });
  }

  function toggleCi(nodeId, id) {
    const node = TREE[nodeId];
    const valid = [].concat(node.contraindications.absolute, node.contraindications.relative).some(c => c.id === id);
    if (!valid) return;
    ctpaState[node.no_contraindications_option.id] = false;   // mutua esclusività
    ctpaState[id] = !ctpaState[id];
    // Il set di alternative cambia: selezione e commento precedenti non sono più validi
    ctpaChoice[nodeId] = null;
    ctpaComments[nodeId] = "";
    syncEndTimestamp();
    redrawCtpa(nodeId);
  }

  function toggleNoneCi(nodeId) {
    const node = TREE[nodeId];
    const noneId = node.no_contraindications_option.id;
    const turningOn = !ctpaState[noneId];
    if (turningOn) Object.keys(ctpaState).forEach(k => { if (k !== noneId) ctpaState[k] = false; });
    ctpaState[noneId] = turningOn;
    ctpaChoice[nodeId] = null;
    ctpaComments[nodeId] = "";
    syncEndTimestamp();
    redrawCtpa(nodeId);
  }

  function selectCtpaAlt(nodeId, altId) {
    const node = TREE[nodeId];
    if (!node.alternatives.some(a => a.id === altId)) return;
    const prevChoice = ctpaChoice[nodeId];
    ctpaChoice[nodeId] = altId;
    if (prevChoice !== altId) evalEndTs = null;   // l'ultimo step viene "rivissuto"
    syncEndTimestamp();
    redrawCtpa(nodeId);
  }

  function toggleEcho(btn) {
    const wrap = btn.nextElementSibling;
    const open = !wrap.hidden;
    wrap.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
    btn.textContent = (open ? "▸" : "▾") + " Parametri ecocardiografici disfunzione RV";
  }

  /* ═══════════════════════════════════════════════════════════════
     TEMA CHIARO / SCURO (unica preferenza salvata: nessun dato clinico)
     ═══════════════════════════════════════════════════════════════ */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const b = $("theme-btn");
    if (b) b.textContent = theme === "light" ? "☾ Tema scuro" : "☀ Tema chiaro";
  }

  function initTheme() {
    let t = null;
    try { t = window.localStorage.getItem("pe-tool-theme"); } catch (e) { /* storage non disponibile */ }
    if (t !== "light" && t !== "dark") {
      t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
    }
    applyTheme(t);
  }

  function toggleTheme() {
    const t = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(t);
    try { window.localStorage.setItem("pe-tool-theme", t); } catch (e) { /* storage non disponibile */ }
  }

  /* ═══════════════════════════════════════════════════════════════
     INATTIVITÀ – cancellazione automatica della valutazione
     ═══════════════════════════════════════════════════════════════ */
  let lastActivity = Date.now();
  let inactivityTimer = null;

  function checkInactivity() {
    if (inactivityTimer || !(sessionHasData() || operatorName)) return;
    if (Date.now() - lastActivity < INACTIVITY_LIMIT_MS) return;
    let left = INACTIVITY_WARNING_S;
    const text = () => "Nessuna attività da " + Math.round(INACTIVITY_LIMIT_MS / 60000) + " minuti. Per proteggere i dati del paziente, la valutazione in corso verrà cancellata tra " + left + " secondi.";
    inactivityTimer = setInterval(() => {
      left -= 1;
      if (left > 0) { $("dlg-text").textContent = text(); return; }
      clearInterval(inactivityTimer); inactivityTimer = null;
      closeDialog({ ok: false, timedOut: true });
    }, 1000);
    showDialog({ title: "Sessione inattiva", text: text(), okLabel: "Continua la valutazione" }).then(r => {
      if (inactivityTimer) { clearInterval(inactivityTimer); inactivityTimer = null; }
      lastActivity = Date.now();
      if (r.timedOut) {
        resetApp(true);
        showMessage("La valutazione è stata cancellata dalla memoria per inattività.", "Sessione chiusa");
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     EVENTI (delegati: nessun handler inline nell'HTML)
     ═══════════════════════════════════════════════════════════════ */
  const ACTIONS = {
    goTo:            d => goTo(d.node),
    goBack:          () => goBack(),
    jumpTo:          d => jumpTo(parseInt(d.idx, 10)),
    requestReset:    () => requestReset(),
    confirmPatientId:() => confirmPatientId(),
    skipPatientId:   () => skipPatientId(),
    editPatientId:   () => editPatientId(),
    downloadReport:  d => downloadReport(d.variant === "schematic" ? "schematic" : "visual"),
    toggleItem:      d => toggleItem(d.nid, d.item),
    setInterp:       d => setInterpIdx(d.nid, parseInt(d.idx, 10)),
    submitScore:     d => submitScore(d.nid),
    toggleCi:        d => toggleCi(d.nid, d.ci),
    toggleNoneCi:    d => toggleNoneCi(d.nid),
    selectCtpaAlt:   d => selectCtpaAlt(d.nid, d.alt),
    toggleEcho:      (d, el) => toggleEcho(el),
    toggleTheme:     () => toggleTheme(),
    dlgOk:           () => closeDialog({ ok: true }),
    dlgCancel:       () => closeDialog({ ok: false })
  };

  function bindEvents() {
    document.addEventListener("click", e => {
      const el = e.target.closest("[data-action]");
      if (!el || el.disabled) return;
      const fn = ACTIONS[el.dataset.action];
      if (fn) fn(el.dataset, el);
    });

    document.addEventListener("keydown", e => {
      const t = e.target;
      if (e.key === "Enter" && t.dataset && t.dataset.enter && ACTIONS[t.dataset.enter]) { e.preventDefault(); ACTIONS[t.dataset.enter](t.dataset, t); return; }
      if (e.key === "Enter" && t.classList && t.classList.contains("dlg-input")) { e.preventDefault(); closeDialog({ ok: true }); return; }
      // Elementi non-<button> resi attivabili da tastiera (card delle modalità di imaging)
      if ((e.key === "Enter" || e.key === " ") && t.getAttribute && t.getAttribute("role") === "button" && t.tagName !== "BUTTON" && t.dataset.action) {
        e.preventDefault(); t.click();
      }
    });

    const onInput = e => {
      const t = e.target, d = t.dataset || {};
      if (d.input === "ddimer") onDdimerInput(d.nid);
      else if (d.input === "ddimer-mode") { if (t.checked) { ddimers[d.nid] = Object.assign({}, ddimers[d.nid], { mode: t.value }); refreshDdimer(d.nid); } }
      else if (d.input === "ddimer-confirm") { ddimers[d.nid] = Object.assign({}, ddimers[d.nid], { confirmUnusual: !!t.checked }); refreshDdimer(d.nid); }
      else if (d.input === "ctpa-comment") ctpaComments[d.nid] = t.value;   // nessun re-render: il focus resta nel campo
    };
    document.addEventListener("input", onInput);
    document.addEventListener("change", onInput);

    $("app-dialog").addEventListener("cancel", e => { e.preventDefault(); closeDialog({ ok: false }); });

    ["pointerdown", "keydown", "input"].forEach(ev =>
      document.addEventListener(ev, () => { lastActivity = Date.now(); }, { capture: true, passive: true }));
    setInterval(checkInactivity, 5000);

    // Avviso prima di chiudere/ricaricare la pagina con una valutazione in corso
    window.addEventListener("beforeunload", e => { if (decisionLog.length > 0) { e.preventDefault(); e.returnValue = ""; } });
  }

  /* ═══════════════════════════════════════════════════════════════
     BOOT
     ═══════════════════════════════════════════════════════════════ */
  function boot() {
    initTheme();
    bindEvents();
    const v = $("app-version");
    if (v) v.textContent = "v" + TREE_METADATA.version + " · aggiornato " + TREE_METADATA.lastUpdated;

    // Fail-safe: se l'albero decisionale non è coerente l'app NON parte.
    const errors = E.validateTree(TREE, START_NODE);
    if (errors.length) {
      const card = newCard("result-danger");
      card.innerHTML = `
        <h1 class="card-title">Strumento non utilizzabile</h1>
        ${resultBanner("danger", "Controllo di coerenza dell'albero decisionale non superato")}
        <p class="card-body">Per sicurezza lo strumento è stato bloccato. Non utilizzarlo e segnala il problema al responsabile, indicando la versione ${esc(TREE_METADATA.version)}.</p>
        <ul class="ddimer-todo">${errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`;
      $("content").appendChild(card);
      document.querySelectorAll("header button").forEach(b => { b.disabled = true; });
      return;
    }
    updatePatientBadge();
    updateReportButtonState();
    renderPatientGate();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();

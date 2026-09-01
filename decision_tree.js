/**
 * PE CLINICAL DECISION TREE
 * ─────────────────────────────────────────────────────────────────────────────
 * AHA 2026 Guidelines – Clinical Evaluation of Patients With Suspected Acute PE
 * ESC 2019 Guidelines 
 *
 * ISTRUZIONI PER IL REFINEMENT
 * ─────────────────────────────────────────────────────────────────────────────
 * Ogni nodo ha un ID univoco e può essere di tipo:
 *   "info"       → schermata informativa / step narrativo
 *   "score"      → calcolo di un punteggio (Wells, Geneva, PERC, YEARS+DDimero)
 *   "question"   → scelta multipla senza calcolo punteggio
 *   "result"     → esito intermedio (con bottone "Continua" verso ctpa_check)
 *   "ctpa_check" → selezione controindicazioni CTPA + alternative raccomandate
 *
 * NAVIGAZIONE
 *   "next"     → nodo successivo (per info, result)
 *   "branches" → non usato al momento
 *   Per i nodi "score" la navigazione è definita dentro "interpretation[].rules[].next"
 *
 * AGGIUNGERE UN NODO
 *   1. Aggiungere la chiave in PE_DECISION_TREE con il tipo corretto
 *   2. Aggiornare il campo "next" del nodo precedente che deve puntarvi
 *   3. Se è uno score, aggiungere le rules con i "next" verso i nodi successivi
 *
 * CONTROINDICAZIONI CTPA (nodo ctpa_check)
 *   - contraindications.absolute[]  → controindicazioni assolute (id, label)
 *   - contraindications.relative[]  → controindicazioni relative (id, label)
 *   - alternatives[]                → alternative raccomandate, ciascuna con:
 *       best_for: [...id]           → IDs delle controindicazioni per cui è indicata
 *       subitems: [...]             → voci dettaglio opzionali (es. eco multiorgano)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PE_DECISION_TREE = {

  // ══════════════════════════════════════════════════════
  // STEP 0 – ENTRY POINT
  // ══════════════════════════════════════════════════════
  start: {
    id: "start",
    type: "info",
    title: "Valutazione PE Acuta",
    subtitle: "AHA Guidelines 2026",
    body: "Paziente con sintomi sospetti per Embolia Polmonare Acuta.\n\nProcedi con la valutazione clinica seguendo il percorso guidato.",
    icon: "🫁",
    cor: null,
    next: "choose_guideline",
    hint: "Sintomi tipici: dolore toracico pleuritico, dispnea, emottisi, sincope, shock. EO: tachicardia, ipotensione, tachipnea, ipossiemia, gonfiore/dolore gambe (DVT)."
  },

  // ══════════════════════════════════════════════════════
  // STEP 0bis – SCELTA DELLE LINEE GUIDA DI RIFERIMENTO
  // ══════════════════════════════════════════════════════
  choose_guideline: {
    id: "choose_guideline",
    type: "question",
    title: "Seleziona le Linee Guida",
    body: "Quale percorso diagnostico vuoi seguire?",
    icon: "📚",
    options: [
      { label: "AHA 2026", next: "symptoms_check", desc: "Wells / Geneva / Geneva Semplificato + PERC + YEARS" },
      { label: "ESC 2019", next: "esc_hemodynamic_check", desc: "Valutazione instabilità emodinamica + Wells/Geneva Score (ESC) + D-Dimero" }
    ]
  },

  // ══════════════════════════════════════════════════════
  // STEP 1 – ANAMNESI & ESAME OBIETTIVO
  // ══════════════════════════════════════════════════════
  symptoms_check: {
    id: "symptoms_check",
    type: "info",
    title: "Esegui H&P",
    subtitle: "Anamnesi ed Esame Obiettivo",
    body: "Valuta la probabilità clinica di PE acuta tramite:\n• Anamnesi mirata (fattori di rischio, comorbidità)\n• Esame obiettivo completo\n• Esclusione di diagnosi alternative",
    icon: "🩺",
    cor: "COR 1",
    cor_color: "#22c55e",
    next: "choose_score",
    hint: "COR 1 – Raccomandazione di Classe I: eseguire sempre H&P per valutare la probabilità clinica pre-test."
  },

  // ══════════════════════════════════════════════════════
  // STEP 2 – SCELTA DELLO SCORE
  // ══════════════════════════════════════════════════════
  choose_score: {
    id: "choose_score",
    type: "question",
    title: "Quantifica la Probabilità Clinica",
    body: "Seleziona il tool validato che vuoi utilizzare:",
    icon: "📊",
    options: [
      { label: "Wells Score",              next: "wells_score",         desc: "Score più utilizzato in PS/emergenza" },
      { label: "Revised Geneva Score",     next: "geneva_score",        desc: "Alternativa validata, senza valutazione soggettiva" },
      { label: "Simplified Geneva Score",  next: "geneva_simple_score", desc: "Versione semplificata del Geneva" }
    ]
  },

  // ══════════════════════════════════════════════════════
  // WELLS SCORE
  // ══════════════════════════════════════════════════════
  wells_score: {
    id: "wells_score",
    type: "score",
    title: "Wells Score per PE",
    icon: "📋",
    items: [
      { id: "w1", label: "Sintomi clinici di TVP (gonfiore gamba, dolore alla palpazione)", points: 3   },
      { id: "w2", label: "PE più probabile di diagnosi alternativa",                        points: 3   },
      { id: "w3", label: "Frequenza cardiaca > 100 bpm",                                   points: 1.5 },
      { id: "w4", label: "Immobilizzazione ≥ 3 gg o chirurgia nelle ultime 4 settimane",   points: 1.5 },
      { id: "w5", label: "TVP o PE precedente",                                             points: 1.5 },
      { id: "w6", label: "Emottisi",                                                        points: 1   },
      { id: "w7", label: "Tumore maligno attivo",                                           points: 1   }
    ],
    interpretation: [
      { label: "Standard Wells", rules: [
        { range: [0,   1.9], category: "Bassa (<15%)",           next: "perc_check"              },
        { range: [2,   6  ], category: "Intermedia (15–50%)",    next: "ddimer_years"             },
        { range: [6.1, 99 ], category: "Alta (>50%)",            next: "diagnostic_imaging_direct"}
      ]},
      { label: "Modified Wells (dicotomica)", rules: [
        { range: [0,   4  ], category: "PE improbabile (≤4)",    next: "perc_check"              },
        { range: [4.1, 99 ], category: "PE probabile (>4)",      next: "diagnostic_imaging_direct"}
      ]}
    ],
    scoreType: "wells"
  },

  // ══════════════════════════════════════════════════════
  // REVISED GENEVA SCORE
  // ══════════════════════════════════════════════════════
  geneva_score: {
    id: "geneva_score",
    type: "score",
    title: "Revised Geneva Score",
    icon: "📋",
    items: [
      { id: "g1", label: "Età > 65 anni",                                                                    points: 1 },
      { id: "g2", label: "TVP o PE precedente",                                                              points: 3 },
      { id: "g3", label: "Chirurgia in anestesia generale o frattura arti inferiori nell'ultimo mese",       points: 2 },
      { id: "g4", label: "Tumore maligno attivo",                                                            points: 2 },
      { id: "g5", label: "Dolore unilaterale all'arto inferiore",                                            points: 3 },
      { id: "g6", label: "Emottisi",                                                                         points: 2 },
      { id: "g7", label: "FC 75–94 bpm",                                                                     points: 3 },
      { id: "g8", label: "FC ≥ 95 bpm",                                                                      points: 5 },
      { id: "g9", label: "Dolore alla palpazione del circolo venoso profondo e edema unilaterale",           points: 4 }
    ],
    interpretation: [
      { label: "Revised Geneva", rules: [
        { range: [0,  3 ], category: "Bassa (<15%)",         next: "perc_check"              },
        { range: [4,  10], category: "Intermedia (15–50%)",  next: "ddimer_years"             },
        { range: [11, 99], category: "Alta (>50%)",          next: "diagnostic_imaging_direct"}
      ]}
    ],
    scoreType: "geneva"
  },

  // ══════════════════════════════════════════════════════
  // SIMPLIFIED REVISED GENEVA SCORE
  // ══════════════════════════════════════════════════════
  geneva_simple_score: {
    id: "geneva_simple_score",
    type: "score",
    title: "Simplified Revised Geneva Score",
    icon: "📋",
    items: [
      { id: "sg1", label: "Età > 65 anni",                                                                    points: 1 },
      { id: "sg2", label: "TVP o PE precedente",                                                              points: 1 },
      { id: "sg3", label: "Chirurgia in anestesia generale o frattura arti inferiori nell'ultimo mese",       points: 1 },
      { id: "sg4", label: "Tumore maligno attivo",                                                            points: 1 },
      { id: "sg5", label: "Dolore unilaterale all'arto inferiore",                                            points: 1 },
      { id: "sg6", label: "Emottisi",                                                                         points: 1 },
      { id: "sg7", label: "FC 75–94 bpm",                                                                     points: 1 },
      { id: "sg8", label: "FC ≥ 95 bpm",                                                                      points: 1 },
      { id: "sg9", label: "Dolore alla palpazione del circolo venoso profondo e edema unilaterale",           points: 1 }
    ],
    interpretation: [
      { label: "Simplified Revised Geneva", rules: [
        { range: [0, 1], category: "Bassa/PE improbabile (<15%)",  next: "perc_check"              },
        { range: [2, 4], category: "Intermedia (15–50%)",          next: "ddimer_years"             },
        { range: [5, 7], category: "Alta/PE probabile (>50%)",     next: "diagnostic_imaging_direct"}
      ]}
    ],
    scoreType: "geneva_simple"
  },

  // ══════════════════════════════════════════════════════
  // PERC – solo per probabilità BASSA (<15%)
  // ══════════════════════════════════════════════════════
  perc_check: {
    id: "perc_check",
    type: "score",
    title: "Criteri PERC",
    subtitle: "PE Rule Out Criteria",
    icon: "🔍",
    description: "Applicabile SOLO se probabilità clinica pre-test < 15% (es. Wells < 2).\nSeleziona i criteri PRESENTI nel paziente. Se punteggio = 0 (nessun criterio presente) → PE esclusa senza ulteriori esami.",
    items: [
      { id: "p1", label: "Età ≥ 50 anni",                                                   points: 1 },
      { id: "p2", label: "FC ≥ 100 bpm",                                                    points: 1 },
      { id: "p3", label: "SatO₂ < 95% in aria ambiente",                                   points: 1 },
      { id: "p4", label: "Emottisi",                                                         points: 1 },
      { id: "p5", label: "Uso di estrogeni",                                                 points: 1 },
      { id: "p6", label: "TVP o PE precedente",                                              points: 1 },
      { id: "p7", label: "Gonfiore unilaterale alla gamba",                                  points: 1 },
      { id: "p8", label: "Chirurgia/trauma con ospedalizzazione nelle ultime 4 settimane",   points: 1 }
    ],
    interpretation: [
      { label: "PERC", rules: [
        { range: [0, 0],  category: "PERC NEGATIVO – Tutti i criteri soddisfatti", next: "result_very_low_prob" },
        { range: [1, 99], category: "PERC POSITIVO – Almeno un criterio presente", next: "ddimer_years"         }
      ]}
    ],
    scoreType: "perc"
  },

  // ══════════════════════════════════════════════════════
  // D-DIMERO + CRITERI YEARS
  // Applicabile in probabilità intermedia o PERC positivo
  // ══════════════════════════════════════════════════════
  ddimer_years: {
    id: "ddimer_years",
    type: "score",
    title: "D-Dimero + Criteri YEARS",
    icon: "🧪",
    description: "Esegui dosaggio D-Dimero e valuta i 3 criteri YEARS.\nIl numero di criteri YEARS presenti determina la soglia di cut-off del D-Dimero da applicare.",
    cor: "COR 2a",
    cor_color: "#eab308",
    items: [
      { id: "y1", label: "Segni/sintomi clinici di TVP (deep vein thrombosis)", points: 1 },
      { id: "y2", label: "Emottisi",                                            points: 1 },
      { id: "y3", label: "PE è la diagnosi più probabile",                      points: 1 }
    ],
    ddimer_input: true,
    interpretation: [
      { label: "YEARS + D-Dimero", rules: [
        { years: 0,    ddimer_op: "<",  ddimer_val: 1000, category: "0 criteri YEARS e D-Dimero < 1000 ng/mL → PE esclusa",               next: "result_pe_excluded"          },
        { years: ">=1",ddimer_op: "<",  ddimer_val: 500,  category: "≥1 criteri YEARS e D-Dimero < 500 ng/mL (o soglia age-adj.) → PE esclusa", next: "result_pe_excluded"     },
        { years: 0,    ddimer_op: ">=", ddimer_val: 1000, category: "0 criteri YEARS e D-Dimero ≥ 1000 ng/mL → imaging necessario",        next: "diagnostic_imaging"          },
        { years: ">=1",ddimer_op: ">=", ddimer_val: 500,  category: "≥1 criteri YEARS e D-Dimero ≥ 500 ng/mL (o soglia age-adj.) → imaging necessario", next: "diagnostic_imaging"}
      ]}
    ],
    scoreType: "years",
    hint_age_adjusted: "D-Dimero age-adjusted: età < 50 anni → soglia 500 µg/L; età ≥ 50 anni → soglia = età × 10 µg/L"
  },

  // ══════════════════════════════════════════════════════
  // DIAGNOSTICA PER IMMAGINI – Alta probabilità (>50%)
  // Navigazione diretta senza D-Dimero
  // ══════════════════════════════════════════════════════
  diagnostic_imaging_direct: {
    id: "diagnostic_imaging_direct",
    type: "result",
    severity: "danger",
    title: "Esegui Diagnostica per Immagini",
    subtitle: "Probabilità Clinica Alta (>50%) – non attendere il D-Dimero",
    icon: "🔬",
    cor: "COR 1",
    cor_color: "#22c55e",
    body: "La probabilità clinica pre-test è ALTA (>50%).\n\nProcedi DIRETTAMENTE con la diagnostica per immagini. Il D-Dimero non è indicato in questa fascia perché anche valori negativi non escludono la PE con sufficiente affidabilità.\n\nModalità raccomandata: CTPA (Angio-TC polmonare), salvo controindicazioni da verificare nel passo successivo.",
    next: "ctpa_check"
  },

  // ══════════════════════════════════════════════════════
  // DIAGNOSTICA PER IMMAGINI – D-Dimero/YEARS positivo
  // ══════════════════════════════════════════════════════
  diagnostic_imaging: {
    id: "diagnostic_imaging",
    type: "result",
    severity: "warning",
    title: "Esegui Diagnostica per Immagini",
    subtitle: "D-Dimero elevato / YEARS positivo",
    icon: "🔬",
    cor: "COR 1",
    cor_color: "#22c55e",
    body: "I risultati del D-Dimero e/o dei criteri YEARS indicano la necessità di diagnostica per immagini per escludere o confermare la PE.\n\nModalità raccomandata: CTPA (Angio-TC polmonare), salvo controindicazioni da verificare nel passo successivo.",
    next: "ctpa_check"
  },

  // ══════════════════════════════════════════════════════
  // CTPA – SELEZIONE MODALITÀ IMAGING
  // ══════════════════════════════════════════════════════
  ctpa_check: {
    id: "ctpa_check",
    type: "ctpa_check",
    title: "Scelta della Modalità di Imaging",
    subtitle: "CTPA è la prima scelta – verifica le controindicazioni",
    icon: "🖥️",

    // ── Opzione esplicita "nessuna controindicazione" ───
    // Mutuamente esclusiva con le checkbox delle controindicazioni.
    // Se selezionata, conferma CTPA come esito raccomandato.
    no_contraindications_option: {
      id: "ci_none",
      label: "Nessuna delle controindicazioni sopra è presente",
      result_label: "CTPA (Angio-TC polmonare) – nessuna controindicazione rilevata"
    },

    // ── Controindicazioni ──────────────────────────────
    contraindications: {
      absolute: [
        { id: "ci_abs1", label: "Indisponibilità della TC (strumento non disponibile in sede)" },
        { id: "ci_abs2", label: "Shock emodinamico grave (instabilità che impedisce trasferimento in TC)" },
        { id: "ci_abs3", label: "Allergia grave/documentata al mezzo di contrasto iodato" }
      ],
      relative: [
        { id: "ci_rel1", label: "Gravidanza" },
        { id: "ci_rel2", label: "Insufficienza renale (GFR ridotto – rischio nefropatia da contrasto)" }
      ]
    },

    // ── Alternative raccomandate ───────────────────────
    // best_for: array di ID controindicazioni per cui questa alternativa è indicata
    // subitems: voci dettaglio mostrate come sotto-elenco (opzionale)
    alternatives: [
      {
        id: "alt_ctpa",
        label: "CTPA (Angio-TC polmonare)",
        icon: "🖥️",
        desc: "Prima scelta in assenza di controindicazioni: ampia disponibilità, costo relativo contenuto, basso rischio radiante con i protocolli attuali, eccellente performance diagnostica.",
        best_for: ["ci_none"]
      },
      {
        id: "alt_scinti",
        label: "Scintigrafia di Perfusione V/Q planare",
        icon: "☢️",
        desc: "Indicata in gravidanza (bassa dose fetale), allergia al mdc, insufficienza renale. Eseguita idealmente con la componente ventilatoria per accuratezza ottimale.",
        best_for: ["ci_rel1", "ci_rel2", "ci_abs3"]
      },
      {
        id: "alt_spect",
        label: "Scintigrafia V/Q SPECT (± CT low-dose)",
        icon: "🔬",
        desc: "Prima scelta rispetto alla scintigrafia planare quando disponibile: maggiore sensibilità, specificità e minore tasso di risultati indeterminati. Possibile combinazione con CT low-dose per accuratezza ulteriore.",
        best_for: ["ci_rel1", "ci_rel2", "ci_abs3"]
      },
      {
        id: "alt_echo",
        label: "Ecografia Multiorgano (point-of-care)",
        icon: "🩻",
        desc: "Prima scelta in caso di shock o paziente non trasferibile. Approccio integrato con tre componenti complementari:",
        best_for: ["ci_abs1", "ci_abs2"],
        subitems: [
          "Ecocardiografia – dilatazione/disfunzione RV, segno D del setto, stima TAPSE, ipertensione polmonare",
          "Ecografia polmonare – consolidamenti subpleurici a base pleurica (infarto polmonare), versamento pleurico",
          "Eco-Doppler venoso – ricerca TVP prossimale agli arti inferiori (compressibilità venosa)"
        ]
      }
    ]
  },

  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  //  RAMO ESC 2019 — ESC Guidelines for diagnosis and management
  //  of acute pulmonary embolism (Eur Heart J 2020;41:543-603)
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════

  // ────────────────────────────────────────────────────────────
  // STEP ESC-1 — Instabilità emodinamica (Tabella 4 ESC)
  // ────────────────────────────────────────────────────────────
  esc_hemodynamic_check: {
    id: "esc_hemodynamic_check",
    type: "score",
    title: "Instabilità Emodinamica",
    subtitle: "Tabella 4 — ESC 2019: definizione di PE ad alto rischio",
    icon: "🚨",
    description: "Seleziona le manifestazioni cliniche presenti. È sufficiente UNA delle tre condizioni per definire instabilità emodinamica (PE ad alto rischio).",
    items: [
      { id: "h1", label: "Arresto cardiaco (necessità di rianimazione cardiopolmonare)", points: 1 },
      { id: "h2", label: "Shock ostruttivo: PA sistolica < 90 mmHg o vasopressori necessari per PA ≥ 90 mmHg, con ipoperfusione d'organo (stato mentale alterato; cute fredda e marezzata; oligo/anuria; lattati aumentati)", points: 1 },
      { id: "h3", label: "Ipotensione persistente: PA sistolica < 90 mmHg o calo ≥ 40 mmHg per > 15 min, non da aritmia di nuova insorgenza, ipovolemia o sepsi", points: 1 }
    ],
    interpretation: [
      { label: "Instabilità emodinamica", rules: [
        { range: [0, 0], category: "Nessun criterio presente — emodinamicamente stabile", next: "esc_choose_score" },
        { range: [1, 99], category: "Almeno un criterio presente — PE ad ALTO RISCHIO (instabile)", next: "esc_bedside_tte" }
      ]}
    ],
    scoreType: "perc"
  },

  // ────────────────────────────────────────────────────────────
  // RAMO A — PAZIENTE INSTABILE (Figura 4 ESC)
  // ────────────────────────────────────────────────────────────
  esc_bedside_tte: {
    id: "esc_bedside_tte",
    type: "info",
    title: "Ecocardiografia Bedside (TTE)",
    subtitle: "Figura 4 ESC — Sospetta PE ad alto rischio",
    icon: "🫀",
    cor: "Classe I",
    cor_color: "#22c55e",
    body: "Nel paziente emodinamicamente instabile, esegui ecocardiografia transtoracica (TTE) al letto del paziente come primo step rapido.\n\nObiettivo: identificare segni di disfunzione del ventricolo destro (RV) per differenziare la PE da altre cause di shock o instabilità (tamponamento cardiaco, sindrome coronarica acuta, dissezione aortica, disfunzione valvolare acuta, ipovolemia).",
    hint: "Indicazione di Classe I, Livello C: eseguire TTE bedside o CTPA in emergenza (in base a disponibilità e circostanze cliniche) per la diagnosi. Iniziare anticoagulazione con UFH (bolo aggiustato per peso) senza ritardo.",
    next: "esc_rv_dysfunction"
  },

  esc_rv_dysfunction: {
    id: "esc_rv_dysfunction",
    type: "question",
    title: "Disfunzione del Ventricolo Destro?",
    body: "La TTE mostra segni di disfunzione/sovraccarico del RV? (in particolare rapporto RV/LV > 1.0; vedi parametri ecocardiografici dettagliati più avanti)",
    icon: "❓",
    options: [
      { label: "NO — RV normale", next: "esc_search_other_causes_1", desc: "L'assenza di disfunzione RV esclude praticamente la PE come causa dell'instabilità" },
      { label: "SÌ — segni di disfunzione RV", next: "esc_ctpa_feasible", desc: "Procedi alla verifica di disponibilità CTPA" }
    ]
  },

  esc_search_other_causes_1: {
    id: "esc_search_other_causes_1",
    type: "result",
    severity: "safe",
    title: "Ricerca Altre Cause di Shock o Instabilità",
    subtitle: "RV normale alla TTE",
    icon: "🔍",
    body: "In un paziente con instabilità emodinamica, l'assenza di segni ecocardiografici di disfunzione/sovraccarico del RV esclude praticamente la PE come causa dello shock o dell'instabilità.\n\nL'ecocardiografia può aiutare nella diagnosi differenziale: tamponamento pericardico, disfunzione valvolare acuta, disfunzione severa del VS globale o regionale, dissezione aortica, ipovolemia.",
    note: "Considerare ecografia venosa bilaterale (CUS) e/o TOE come test ancillari se il quadro resta dubbio.",
    next: null
  },

  esc_ctpa_feasible: {
    id: "esc_ctpa_feasible",
    type: "ctpa_check",
    title: "CTPA Immediatamente Disponibile e Fattibile?",
    subtitle: "Paziente instabile con segni di disfunzione RV — verifica le controindicazioni",
    icon: "🏥",

    // Stesso pattern del nodo AHA `ctpa_check`, riadattato al contesto di instabilità emodinamica:
    // qui "nessuna controindicazione" significa che la CTPA È fattibile e va eseguita per confermare la PE;
    // qualunque controindicazione assoluta/relativa selezionata indica che la CTPA NON è fattibile/disponibile
    // in tempi compatibili con l'instabilità del paziente, quindi si procede al trattamento bedside.
    no_contraindications_option: {
      id: "ci_none_esc",
      label: "Nessuna controindicazione — CTPA disponibile e fattibile",
      result_label: "CTPA (Angio-TC polmonare) — procedi con la conferma diagnostica"
    },

    contraindications: {
      absolute: [
        { id: "ci_abs1_esc", label: "Indisponibilità della TC (strumento non disponibile in sede o non accessibile in tempi utili)" },
        { id: "ci_abs2_esc", label: "Shock emodinamico grave (paziente troppo instabile per il trasferimento in TC)" },
        { id: "ci_abs3_esc", label: "Allergia grave/documentata al mezzo di contrasto iodato" }
      ],
      relative: [
        { id: "ci_rel1_esc", label: "Gravidanza" },
        { id: "ci_rel2_esc", label: "Insufficienza renale (GFR ridotto — rischio nefropatia da contrasto)" }
      ]
    },

    alternatives: [
      {
        id: "alt_ctpa_esc",
        label: "CTPA (Angio-TC polmonare)",
        icon: "🖥️",
        desc: "In assenza di controindicazioni, eseguire CTPA per confermare la PE ad alto rischio.",
        best_for: ["ci_none_esc"]
      },
      {
        id: "alt_scinti_esc",
        label: "Scintigrafia di Perfusione V/Q planare",
        icon: "☢️",
        desc: "Considerare se compatibile con i tempi di gestione dell'instabilità: indicata in gravidanza, allergia al mdc, insufficienza renale. In un paziente emodinamicamente instabile, raramente fattibile in urgenza.",
        best_for: ["ci_rel1_esc", "ci_rel2_esc", "ci_abs3_esc"]
      },
      {
        id: "alt_spect_esc",
        label: "Scintigrafia V/Q SPECT (± CT low-dose)",
        icon: "🔬",
        desc: "Maggiore accuratezza della planare, ma tempi di esecuzione generalmente incompatibili con l'instabilità emodinamica acuta.",
        best_for: ["ci_rel1_esc", "ci_rel2_esc", "ci_abs3_esc"]
      },
      {
        id: "alt_echo_esc",
        label: "Ecografia Multiorgano (point-of-care) — confermare con TTE/CUS già eseguite",
        icon: "🩻",
        desc: "Scelta appropriata quando la TC non è disponibile o il paziente non è trasferibile: i reperti ecocardiografici di disfunzione RV (già rilevati alla TTE bedside) sono sufficienti per confermare la PE ad alto rischio e procedere al trattamento, senza attendere la CTPA.",
        best_for: ["ci_abs1_esc", "ci_abs2_esc"],
        subitems: [
          "Ecocardiografia — già eseguita: disfunzione RV confermata",
          "Ecografia polmonare — eventuale supporto per infarto polmonare/versamento pleurico",
          "Eco-Doppler venoso — ricerca TVP prossimale come ulteriore conferma indiretta di PE"
        ]
      }
    ]
  },

  // ────────────────────────────────────────────────────────────
  // RAMO B — PAZIENTE STABILE: scelta dello score di probabilità clinica
  // ESC 2019, Sez. 4.2: "the most frequently used prediction rules are
  // the revised Geneva rule (Table 5) and the Wells rule" — entrambe
  // esplicitamente validate ed equivalenti in performance diagnostica
  // (confronto prospettico citato in Sez. 4.2).
  // ────────────────────────────────────────────────────────────
  esc_choose_score: {
    id: "esc_choose_score",
    type: "question",
    title: "Quantifica la Probabilità Clinica",
    subtitle: "ESC 2019, Sez. 4.2",
    body: "Le linee guida ESC 2019 indicano il Revised Geneva Score e il Wells Score come le due regole predittive più utilizzate e con performance diagnostica comparabile. Seleziona quale utilizzare:",
    icon: "📊",
    options: [
      { label: "Revised Geneva Score (ESC)", next: "esc_geneva_score", desc: "Tabella 5 ESC — non richiede giudizio soggettivo" },
      { label: "Wells Score",                next: "esc_wells_score",  desc: "Regola predittiva alternativa, ugualmente validata (ESC Sez. 4.2)" }
    ]
  },

  // ────────────────────────────────────────────────────────────
  // RAMO B — PAZIENTE STABILE: Wells Score (alternativa ESC al Geneva)
  // ────────────────────────────────────────────────────────────
  esc_wells_score: {
    id: "esc_wells_score",
    type: "score",
    title: "Wells Score per PE",
    subtitle: "Alternativa ESC 2019 al Revised Geneva Score",
    icon: "📋",
    description: "Stessa regola predittiva usata nel ramo AHA; le linee guida ESC 2019 la considerano equivalente al Geneva Score per la stima della probabilità clinica pre-test.",
    items: [
      { id: "ew1", label: "Sintomi clinici di TVP (gonfiore gamba, dolore alla palpazione)", points: 3   },
      { id: "ew2", label: "PE più probabile di diagnosi alternativa",                        points: 3   },
      { id: "ew3", label: "Frequenza cardiaca > 100 bpm",                                   points: 1.5 },
      { id: "ew4", label: "Immobilizzazione ≥ 3 gg o chirurgia nelle ultime 4 settimane",   points: 1.5 },
      { id: "ew5", label: "TVP o PE precedente",                                             points: 1.5 },
      { id: "ew6", label: "Emottisi",                                                        points: 1   },
      { id: "ew7", label: "Tumore maligno attivo",                                           points: 1   }
    ],
    interpretation: [
      { label: "Standard Wells", rules: [
        { range: [0,   1.9], category: "Bassa probabilità clinica (<15%)",        next: "esc_ddimer_test"   },
        { range: [2,   6  ], category: "Probabilità clinica intermedia (15–50%)", next: "esc_ddimer_test"   },
        { range: [6.1, 99 ], category: "Alta probabilità clinica (>50%)",         next: "esc_ctpa_no_dimer" }
      ]},
      { label: "Modified Wells (dicotomica)", rules: [
        { range: [0,   4  ], category: "PE improbabile (≤4)",  next: "esc_ddimer_test"   },
        { range: [4.1, 99 ], category: "PE probabile (>4)",    next: "esc_ctpa_no_dimer" }
      ]}
    ],
    scoreType: "wells"
  },

  esc_geneva_score: {
    id: "esc_geneva_score",
    type: "score",
    title: "Revised Geneva Score (ESC 2019)",
    subtitle: "Tabella 5 — versione originale e semplificata",
    icon: "📋",
    description: "Versione ESC del Revised Geneva Score. Seleziona i criteri presenti; il punteggio totale userà la colonna 'versione originale'. È disponibile anche l'interpretazione con lo schema a 2 livelli (PE-unlikely / PE-likely).",
    items: [
      { id: "eg1", label: "TVP o PE precedente",                                                            points: 3 },
      { id: "eg2", label: "FC 75–94 bpm",                                                                    points: 3 },
      { id: "eg3", label: "FC ≥ 95 bpm",                                                                     points: 5 },
      { id: "eg4", label: "Chirurgia o frattura nel mese precedente",                                       points: 2 },
      { id: "eg5", label: "Emottisi",                                                                        points: 2 },
      { id: "eg6", label: "Tumore maligno attivo",                                                           points: 2 },
      { id: "eg7", label: "Dolore unilaterale ad un arto inferiore",                                         points: 3 },
      { id: "eg8", label: "Dolore alla palpazione venosa profonda + edema unilaterale",                     points: 4 },
      { id: "eg9", label: "Età > 65 anni",                                                                   points: 1 }
    ],
    interpretation: [
      { label: "Schema a 3 livelli (originale)", rules: [
        { range: [0,  3 ], category: "Bassa probabilità clinica (0–3)",        next: "esc_ddimer_test" },
        { range: [4,  10], category: "Probabilità clinica intermedia (4–10)",  next: "esc_ddimer_test" },
        { range: [11, 99], category: "Alta probabilità clinica (≥11)",        next: "esc_ctpa_no_dimer" }
      ]},
      { label: "Schema a 2 livelli (PE-likely/unlikely)", rules: [
        { range: [0, 5],  category: "PE improbabile (0–5)",  next: "esc_ddimer_test" },
        { range: [6, 99], category: "PE probabile (≥6)",     next: "esc_ctpa_no_dimer" }
      ]}
    ],
    scoreType: "geneva"
  },

  // ────────────────────────────────────────────────────────────
  // D-Dimero (Figura 5 ESC) — solo per probabilità bassa/intermedia o PE-unlikely
  // ────────────────────────────────────────────────────────────
  esc_ddimer_test: {
    id: "esc_ddimer_test",
    type: "score",
    title: "D-Dimero",
    subtitle: "Figura 5 ESC — probabilità bassa/intermedia o PE-unlikely",
    icon: "🧪",
    description: "In pazienti con probabilità clinica bassa/intermedia (o PE-unlikely), il dosaggio del D-Dimero è il primo step. Una soglia fissa standard è 500 ng/mL; in alternativa possono essere usate soglie età-corrette o adattate alla probabilità clinica (criteri YEARS, vedi ramo AHA).\n\nInserisci il valore misurato e l'età del paziente.",
    cor: "Classe I-IIa",
    cor_color: "#eab308",
    items: [],
    ddimer_input: true,
    interpretation: [
      { label: "D-Dimero (soglia 500 ng/mL standard, o age-adjusted)", rules: [
        { years: 0,    ddimer_op: "<",  ddimer_val: 500, category: "D-Dimero negativo (< soglia) → PE esclusa, nessun trattamento", next: "esc_pe_excluded" },
        { years: 0,    ddimer_op: ">=", ddimer_val: 500, category: "D-Dimero positivo (≥ soglia) → eseguire CTPA",                  next: "esc_ctpa_low_intermediate" }
      ]}
    ],
    scoreType: "years",
    hint_age_adjusted: "Soglia età-corretta (alternativa): età < 50 anni → 500 µg/L; età ≥ 50 anni → soglia = età × 10 µg/L. L'inserimento di '0 criteri YEARS' è preimpostato qui poiché in questo ramo ESC il D-dimero non utilizza i criteri YEARS — viene usata solo la soglia indicata."
  },

  // ────────────────────────────────────────────────────────────
  // SCELTA MODALITÀ IMAGING — bassa/intermedia probabilità, D-dimero positivo
  // (stesso pattern del nodo AHA `ctpa_check` / ESC `esc_ctpa_feasible`)
  // ────────────────────────────────────────────────────────────
  esc_ctpa_low_intermediate: {
    id: "esc_ctpa_low_intermediate",
    type: "ctpa_check",
    title: "Scelta della Modalità di Imaging",
    subtitle: "Probabilità bassa/intermedia, D-Dimero positivo — verifica le controindicazioni",
    icon: "🔬",

    no_contraindications_option: {
      id: "ci_none_esc_li",
      label: "Nessuna controindicazione — CTPA disponibile e fattibile",
      result_label: "CTPA (Angio-TC polmonare) — procedi con la conferma diagnostica"
    },

    contraindications: {
      absolute: [
        { id: "ci_abs1_esc_li", label: "Indisponibilità della TC (strumento non disponibile in sede)" },
        { id: "ci_abs2_esc_li", label: "Shock emodinamico grave (instabilità che impedisce il trasferimento in TC)" },
        { id: "ci_abs3_esc_li", label: "Allergia grave/documentata al mezzo di contrasto iodato" }
      ],
      relative: [
        { id: "ci_rel1_esc_li", label: "Gravidanza" },
        { id: "ci_rel2_esc_li", label: "Insufficienza renale (GFR ridotto — rischio nefropatia da contrasto)" }
      ]
    },

    alternatives: [
      {
        id: "alt_ctpa_esc_li",
        label: "CTPA (Angio-TC polmonare)",
        icon: "🖥️",
        desc: "Prima scelta in assenza di controindicazioni: ampia disponibilità, eccellente performance diagnostica.",
        best_for: ["ci_none_esc_li"]
      },
      {
        id: "alt_scinti_esc_li",
        label: "Scintigrafia di Perfusione V/Q planare",
        icon: "☢️",
        desc: "Indicata in gravidanza (bassa dose fetale), allergia al mdc, insufficienza renale. Eseguita idealmente con la componente ventilatoria per accuratezza ottimale.",
        best_for: ["ci_rel1_esc_li", "ci_rel2_esc_li", "ci_abs3_esc_li"]
      },
      {
        id: "alt_spect_esc_li",
        label: "Scintigrafia V/Q SPECT (± CT low-dose)",
        icon: "🔬",
        desc: "Maggiore sensibilità e specificità rispetto alla planare, minore tasso di risultati indeterminati. Prima scelta quando disponibile.",
        best_for: ["ci_rel1_esc_li", "ci_rel2_esc_li", "ci_abs3_esc_li"]
      },
      {
        id: "alt_echo_esc_li",
        label: "Ecografia Multiorgano (point-of-care)",
        icon: "🩻",
        desc: "Opzione in caso di indisponibilità della TC o paziente non trasferibile. Approccio integrato:",
        best_for: ["ci_abs1_esc_li", "ci_abs2_esc_li"],
        subitems: [
          "Ecocardiografia — disfunzione RV",
          "Ecografia polmonare — infarto polmonare, versamento pleurico",
          "Eco-Doppler venoso — ricerca TVP prossimale"
        ]
      }
    ]
  },

  // ────────────────────────────────────────────────────────────
  // SCELTA MODALITÀ IMAGING — alta probabilità / PE-likely, nessun D-dimero necessario
  // (stesso pattern del nodo AHA `ctpa_check` / ESC `esc_ctpa_feasible`)
  // ────────────────────────────────────────────────────────────
  esc_ctpa_no_dimer: {
    id: "esc_ctpa_no_dimer",
    type: "ctpa_check",
    title: "Scelta della Modalità di Imaging",
    subtitle: "Alta probabilità clinica / PE-likely — D-Dimero non indicato — verifica le controindicazioni",
    icon: "🔬",

    no_contraindications_option: {
      id: "ci_none_esc_nd",
      label: "Nessuna controindicazione — CTPA disponibile e fattibile",
      result_label: "CTPA (Angio-TC polmonare) — procedi con la conferma diagnostica"
    },

    contraindications: {
      absolute: [
        { id: "ci_abs1_esc_nd", label: "Indisponibilità della TC (strumento non disponibile in sede)" },
        { id: "ci_abs2_esc_nd", label: "Shock emodinamico grave (instabilità che impedisce il trasferimento in TC)" },
        { id: "ci_abs3_esc_nd", label: "Allergia grave/documentata al mezzo di contrasto iodato" }
      ],
      relative: [
        { id: "ci_rel1_esc_nd", label: "Gravidanza" },
        { id: "ci_rel2_esc_nd", label: "Insufficienza renale (GFR ridotto — rischio nefropatia da contrasto)" }
      ]
    },

    alternatives: [
      {
        id: "alt_ctpa_esc_nd",
        label: "CTPA (Angio-TC polmonare)",
        icon: "🖥️",
        desc: "Prima scelta in assenza di controindicazioni: ampia disponibilità, eccellente performance diagnostica.",
        best_for: ["ci_none_esc_nd"]
      },
      {
        id: "alt_scinti_esc_nd",
        label: "Scintigrafia di Perfusione V/Q planare",
        icon: "☢️",
        desc: "Indicata in gravidanza (bassa dose fetale), allergia al mdc, insufficienza renale. Eseguita idealmente con la componente ventilatoria per accuratezza ottimale.",
        best_for: ["ci_rel1_esc_nd", "ci_rel2_esc_nd", "ci_abs3_esc_nd"]
      },
      {
        id: "alt_spect_esc_nd",
        label: "Scintigrafia V/Q SPECT (± CT low-dose)",
        icon: "🔬",
        desc: "Maggiore sensibilità e specificità rispetto alla planare, minore tasso di risultati indeterminati. Prima scelta quando disponibile.",
        best_for: ["ci_rel1_esc_nd", "ci_rel2_esc_nd", "ci_abs3_esc_nd"]
      },
      {
        id: "alt_echo_esc_nd",
        label: "Ecografia Multiorgano (point-of-care)",
        icon: "🩻",
        desc: "Opzione in caso di indisponibilità della TC o paziente non trasferibile. Approccio integrato:",
        best_for: ["ci_abs1_esc_nd", "ci_abs2_esc_nd"],
        subitems: [
          "Ecocardiografia — disfunzione RV",
          "Ecografia polmonare — infarto polmonare, versamento pleurico",
          "Eco-Doppler venoso — ricerca TVP prossimale"
        ]
      }
    ]
  },

  esc_pe_excluded: {
    id: "esc_pe_excluded",
    type: "result",
    severity: "safe",
    title: "PE Esclusa",
    subtitle: "D-Dimero negativo",
    icon: "✅",
    body: "Il D-Dimero è risultato negativo (sotto la soglia utilizzata) in un paziente con probabilità clinica bassa/intermedia o PE-unlikely.\n\nLa PE è considerata esclusa: nessun trattamento anticoagulante necessario.",
    next: null
  },

  // ══════════════════════════════════════════════════════
  // RISULTATI FINALI – sicuri (PE esclusa / probabilità bassissima)
  // ══════════════════════════════════════════════════════
  result_very_low_prob: {
    id: "result_very_low_prob",
    type: "result",
    severity: "safe",
    title: "Probabilità Molto Bassa di PE",
    subtitle: "Nessun ulteriore test necessario",
    icon: "✅",
    body: "Tutti i criteri PERC sono soddisfatti e la probabilità clinica pre-test è < 15%.\n\nLa probabilità di PE è molto bassa. Non sono necessari ulteriori esami diagnostici.",
    note: "Continuare sorveglianza clinica e rivalutare se i sintomi si modificano o peggiorano.",
    next: null
  },

  result_pe_excluded: {
    id: "result_pe_excluded",
    type: "result",
    severity: "safe",
    title: "PE Esclusa",
    subtitle: "D-Dimero e criteri YEARS negativi",
    icon: "✅",
    body: "La combinazione D-Dimero + criteri YEARS esclude la PE con elevata affidabilità.\n\nNon è necessaria ulteriore diagnostica per immagini.",
    note: "Considerare diagnosi alternative. Rivalutare se i sintomi peggiorano o cambiano.",
    next: null
  }

};

// ─────────────────────────────────────────────────────────────────────────────
// ECHO RV TABLE – Tabella 4 (Disfunzione RV all'ecocardiografia)
// Mostrata nella schermata ecografia multiorgano del nodo ctpa_check
// ─────────────────────────────────────────────────────────────────────────────
const ECHO_RV_TABLE = [
  { parameter: "Dimensione RV",             technique: "Apical 4-chamber view (EDD end-diastolico)", definition: "EDD > 30 mm  oppure  RV basal EDD > 42 mm"              },
  { parameter: "Rapporto RV/LV",            technique: "End-diastolic ratio (apicale o subcostale)", definition: "RV/LV > 0.9"                                             },
  { parameter: "TAPSE",                     technique: "M-mode, piano longitudinale, apical 4-chamber", definition: "TAPSE < 1.6 cm = anormale"                           },
  { parameter: "Doppler – IP. Acceleration",technique: "Tissue Doppler Imaging",                    definition: "Tempo acc. polmonare < 90 ms  o  gradiente RV/atr. > 30 mmHg" },
  { parameter: "Velocità sistolica tricusp.",technique: "Apical o subcostal 4-chamber",             definition: "Velocità sistolica > 2.6 m/sec"                           }
];

// ─────────────────────────────────────────────────────────────────────────────
// METADATA – aggiornare version e lastUpdated ad ogni modifica
// ─────────────────────────────────────────────────────────────────────────────
const TREE_METADATA = {
  version:      "3.3.0",
  source:       "AHA 2026 – Adults With Acute Pulmonary Embolism / ESC 2019 Guidelines for diagnosis and management of acute pulmonary embolism",
  author:       "AD – UMG",
  lastUpdated:  "2026-09-01",
  disclaimer:   "Questo strumento è a supporto decisionale clinico. Non sostituisce il giudizio del medico. Utilizzare sempre in combinazione con la valutazione clinica completa del paziente."
};

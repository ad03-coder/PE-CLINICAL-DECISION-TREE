# PE Decision Tool – AHA 2026 + ESC 2019

Strumento di supporto decisionale clinico per la valutazione di pazienti con **sospetta Embolia Polmonare Acuta**, basato su due set di linee guida selezionabili dall'utente:
- **AHA 2026** (*Adults With Acute Pulmonary Embolism*) — Wells/Geneva/Geneva Semplificato, PERC, D-Dimero+YEARS, scelta CTPA con controindicazioni
- **ESC 2019** (*European Society of Cardiology Guidelines for the diagnosis and management of acute pulmonary embolism*) — triage instabilità emodinamica (Tabella 4), Geneva Score originale ESC (Tabella 5), D-Dimero, algoritmi Figura 4/5

> **⚠ Disclaimer** — Questo tool è esclusivamente a supporto del ragionamento clinico. Non sostituisce la valutazione del medico né costituisce indicazione terapeutica.

---

## Struttura dei file

```
pe-decision-tool/
├── index.html              # Solo struttura della pagina + Content-Security-Policy
├── css/app.css             # Stili (tema scuro e chiaro)
├── js/decision_tree.js     # Albero decisionale (dati, punteggi, rami) ← modificare qui
├── js/engine.js            # Motore di calcolo (punteggi, soglie, controlli di coerenza)
├── js/app.js               # Interfaccia, navigazione, report PDF
├── vendor/                 # jsPDF 4.2.1 e font, ospitati in locale (nessuna CDN)
├── tests/tree.test.js      # Test automatici: node --test tests/tree.test.js
├── .github/workflows/      # I test girano a ogni push / pull request
├── _headers                # Header di sicurezza (Netlify / Cloudflare Pages)
├── SECURITY.md             # Sicurezza, dati, crittografia, rilascio
└── README.md               # Questa documentazione
```

---

## Novità della versione 4.1.0 (2026-11-16)

- **Operatore**: nella schermata iniziale si può indicare, oltre all'ID paziente, il nome o la sigla dell'operatore (facoltativo, solo in memoria come l'ID). Entrambi si modificano dal badge in header. Alla nuova valutazione l'ID paziente viene azzerato, l'operatore resta precompilato; chiusura della pagina o inattività cancellano entrambi.
- **Report PDF ridisegnato** (`renderReportPdf` in `js/app.js`, un solo impaginatore per i due stili). Ordine delle sezioni: intestazione · dati della valutazione (paziente, operatore, linee guida, inizio/fine/durata) · **Esito** in evidenza · **Sintesi delle decisioni** (una riga per scelta, con punteggio o D-Dimero/soglia) · **Dettaglio dei criteri** · operatore e spazio firma · avvertenze. Ogni informazione compare una sola volta: le controindicazioni e il commento stanno nell'Esito, i passaggi senza decisione solo nella riga "Percorso completo".
- **Avviso su riservatezza e responsabilità** (`TREE_METADATA.privacy_notice`): stampato in ogni report e mostrato accanto ai pulsanti di download; ogni pagina riporta "Documento riservato - contiene dati sanitari". Il testo va validato dal DPO.

> Le sezioni "Report PDF" più sotto descrivono ancora in dettaglio i blocchi (`kv`, `list`, `text`) e i tempi, che restano validi; l'impaginazione è quella descritta qui.

## Novità della versione 4.0.0 (2026-11-16)

**Logica clinica** (verificata su AHA 2026 Fig. 1 e tabelle, ESC 2019 Tab. 4-5 e Fig. 3-5):

| Prima | Ora |
|---|---|
| Soglia D-Dimero età-corretta mostrata ma mai applicata | Oltre i 50 anni l'utente sceglie esplicitamente soglia fissa o età-corretta; la soglia applicata compare a schermo e nel report |
| D-Dimero: un solo campo numerico, unità implicita | Unità obbligatoria (ng/mL o mg/L, conversione automatica); valori fuori dall'intervallo 50-100000 ng/mL richiedono conferma |
| Età accettata senza controlli | Solo interi 18-120 |
| Geneva: FC 75-94 e FC ≥ 95 spuntabili insieme | Mutuamente esclusive (`exclusive_group`) |
| Geneva semplificato: con 8 voci nessun esito (blocco) | Alta = ≥ 5, sempre un esito |
| Wells dicotomico ≤ 4 → PERC | PERC solo con Wells < 2 (AHA: "eg, Wells <2"); 2-4 → D-Dimero + YEARS |
| Banner ESC con colori incoerenti; shock con RV normale in verde | Colore dalla regola/nodo di destinazione; RV normale in paziente instabile = arancione con testo dedicato |
| ESC Tab. 4, shock ostruttivo incompleto | Aggiunto "nonostante adeguato riempimento volemico" |
| Tabella eco senza fonte | Fonte AHA Tab. 4 sempre indicata; nei nodi ESC nota su RV/LV > 1.0 |

**Sicurezza e robustezza**: nessuna risorsa esterna (font e jsPDF in locale), Content-Security-Policy rigida, nessun handler/stile inline, escape di ogni testo, controllo di coerenza dell'albero all'avvio (l'app non parte se fallisce), cancellazione automatica dopo 10 minuti di inattività, conferma prima del riavvio e avviso alla chiusura della pagina, versione dello strumento stampata nel report. Dettagli in `SECURITY.md`.

**Interfaccia**: tema chiaro/scuro, spunta delle voci senza ritorno in cima alla pagina, controlli accessibili da tastiera e lettori di schermo, zoom non più bloccato, barra di avanzamento reale, finestre di dialogo interne al posto di `alert`/`prompt`.

**Test**: `node --test tests/tree.test.js` (25 test: ogni combinazione di ogni score, casi clinici di riferimento, regole di sicurezza).

---

## ID Paziente e Report PDF (novità)

### Identificativo paziente
All'avvio (e ogni volta che si preme "↺ Riavvia") viene mostrata una schermata facoltativa per inserire un **codice/ID paziente** (es. numero cartella, iniziali).

- L'ID **non viene mai salvato, trasmesso o persistito**: vive solo nella variabile di sessione del browser (`patientId`) per la durata dell'utilizzo della pagina. Chiudendo/ricaricando la pagina viene perso.
- Lo strumento **resta anonimo lato software**: l'ID serve unicamente per etichettare il report scaricato, così che il medico possa ricondurlo al paziente corretto fuori dall'app.
- Si può saltare l'inserimento ("Salta — resta anonimo") o modificarlo in qualunque momento cliccando il badge 🪪 in header (finestra di dialogo interna).
- **Reset automatico ad ogni nuova valutazione**: premendo "↺ Riavvia"/"↺ Nuova Valutazione", l'ID della valutazione precedente viene azzerato (`resetApp()` svuota `patientId` prima di mostrare di nuovo la schermata) — non resta mai associato per errore a un paziente diverso. Il campo si presenta sempre vuoto, pronto per un nuovo inserimento (o per essere saltato di nuovo).

### Report PDF — due varianti, a scelta
Per ogni step con almeno una decisione registrata, sono disponibili **due varianti di report**, scaricabili indipendentemente l'una dall'altra:

| | 📄 Report Visivo | 📋 Report Schematico |
|---|---|---|
| Bottoni | header **"📄 Report"**, ed esiti finali | header **"📋 Schema"**, ed esiti finali |
| Stile | banner colorato, card, box con bordo colorato | solo testo bianco/nero, elenco puntato, nessun colore/box |
| Uso tipico | lettura rapida "a colpo d'occhio", presentazione | stampa, archiviazione, dossier clinico essenziale |

Entrambe condividono la stessa logica di raccolta dati (`collectReportData()`), quindi contengono **sempre le stesse informazioni**, solo impaginate in modo diverso — nessuna interpretazione ulteriore rispetto a quanto già determinato dallo strumento:

1. **Esito / banner** — nella versione visiva, riga colorata in evidenza (verde = esito favorevole/PE esclusa, rosso = PE confermata/alto rischio, arancio = attenzione/percorso in corso o scelta di imaging); nella versione schematica, stesso contenuto testuale in cima al documento, in grassetto, senza colore.
2. **Riquadro informazioni** — ID paziente (o "Non specificato (anonimo)"), **data/ora di inizio**, **data/ora di fine**, **tempo totale** della valutazione, **data/ora di download del file**, linee guida utilizzate (rilevate automaticamente dal percorso), versione dello strumento. Vedi "Tracciamento dei tempi" qui sotto.
3. **Percorso decisionale** — ogni step numerato, con titolo del nodo ed eventuali dettagli (criteri di score spuntati, punteggio totale, valori D-Dimero/età inseriti, controindicazioni selezionate, interpretazione/esito calcolato a quello step). Se il percorso termina alla scelta della modalità di imaging, questa compare come **ultimo step** dell'elenco, con la modalità **scelta dall'utente** (non un suggerimento automatico) e l'eventuale commento clinico.
   > **Step puramente di passaggio** (es. "Esegui H&P", tipo `info`/`result` senza una vera decisione) mostrano **solo il titolo dello step**, senza alcuna riga "Scelta: Continua" — quella dicitura non viene mai stampata nel report.

   **Etichette omogenee per tipo di step** — ogni riga sotto il titolo inizia con un prefisso chiaro e coerente, così che il tipo di informazione riportata sia immediatamente riconoscibile scorrendo il documento:

   | Prefisso | Tipo di nodo | Esempio |
   |---|---|---|
   | `Selezione:` | domanda a opzioni (`question`) — scelta linee guida, risposte sì/no, scelta score | `Selezione: ESC 2019`, `Selezione: Wells Score` |
   | `Risultato:` | punteggio/score (`score`) — riprende **direttamente la categoria clinica calcolata** dalla regola, non il nome dello step (mai una riga ridondante tipo "Wells Score per PE → Wells Score per PE") | `Risultato: Probabilità clinica intermedia (15-50%)`, `Risultato: D-Dimero negativo (< soglia) -> PE esclusa, nessun trattamento` |
   | `Modalità di imaging scelta:` | scelta finale della modalità di imaging (`ctpa_check`) | `Modalità di imaging scelta: CTPA (Angio-TC polmonare)` |
   | *(nessuna riga)* | passaggio informativo senza decisione (`info`/`result`) | — |

   Sotto l'headline, i dettagli di supporto (criteri spuntati, punteggio, età/D-Dimero, controindicazioni, commento) seguono le regole di impaginazione descritte in "Struttura dei dettagli" qui sotto, senza mai ripetere l'informazione già espressa nell'headline.
4. **Esito dettagliato** — riquadro con titolo, sottotitolo, testo completo, l'eventuale commento clinico e note del nodo finale raggiunto; se il percorso non è ancora concluso al momento del download, viene segnalato esplicitamente.
5. **Disclaimer e fonte**, identici a quelli mostrati in app, più numerazione pagine e intestazione ripetuta su ogni pagina per i report multi-pagina.

Il log delle scelte (`decisionLog`) viene ricostruito automaticamente ad ogni navigazione (`goTo`) leggendo il contenuto del nodo di partenza — nessun campo aggiuntivo da compilare. Tornando indietro (`goBack`/breadcrumb) il log viene troncato di conseguenza, così il report riflette sempre e solo il percorso effettivamente valido nella sessione corrente.

Il file scaricato è nominato `PE-Report_<ID-o-anonimo>_visivo_<data-ora>.pdf` oppure `..._schema_<data-ora>.pdf`.

### Struttura dei dettagli (una informazione per riga)
Ogni informazione del report sta su una **riga propria** e le voci di un elenco non vengono mai unite in un'unica riga con `;`. Entrambe le varianti usano le stesse regole:

| Elemento | Come appare |
|---|---|
| **Etichetta / valore** | etichetta in **grassetto** seguita dal valore (`Punteggio totale: 3`, `Età paziente: 58 anni`, `D-Dimero misurato: 640 ng/mL`). Se il valore è lungo va a capo allineato sotto il valore, non sotto l'etichetta. |
| **Elenco puntato** | intestazione in grassetto **con conteggio** (`Criteri selezionati (3):`) e sotto **una voce per riga** con puntino; le voci lunghe vanno a capo con rientro. Usato per i criteri di score spuntati e per le controindicazioni CTPA, queste ultime divise in due elenchi distinti: `Controindicazioni assolute (n)` e `Controindicazioni relative (n)`. |
| **Nessun elemento** | `Criteri selezionati: nessuno` / `Controindicazioni: nessuna presente` su una riga sola. |
| **Testo libero** | paragrafi semplici; le righe che iniziano con `•` o `-` nel testo dei nodi `result` diventano automaticamente un elenco puntato, i paragrafi separati da riga vuota restano staccati. |
| **Separazione degli step** | nel report visivo ogni step è una card con una linea sottile tra *risultato* e *dettagli*; in quello schematico ogni step è separato dal successivo da una linea sottile. |

L'**Esito** finale usa gli stessi blocchi (es. `Modalità di imaging scelta:` + descrizione + elenchi delle controindicazioni). Il titolo "Esito" non resta mai isolato a fondo pagina: si sposta insieme al suo riquadro.

**Per chi modifica il codice** (`js/app.js`): i dettagli non sono più stringhe ma un array di *blocchi* — `{kind:"kv", label, value}`, `{kind:"list", label, items:[...]}`, `{kind:"text", text}` — prodotti da `describeTransition()` e `getCurrentOutcomeSummary()` e impaginati da `layoutBlocks()` / `drawRows()` (condivise dai due renderer). Per aggiungere un nuovo dettaglio a uno step basta aggiungere un blocco all'array; `criteriaBlock(label, labels)` genera il caso "elenco con conteggio / nessuno". Le stringhe semplici sono ancora accettate (`normalizeDetail()`), quindi eventuali nuovi tipi di nodo continuano a funzionare. `decision_tree.js` non richiede modifiche.

### Tracciamento dei tempi (inizio / fine / durata / download)
Entrambe le varianti di report riportano, nel riquadro informazioni, quattro voci temporali:

| Voce nel report | Quando viene registrata |
|---|---|
| **Inizio valutazione** | Al primo ingresso nell'albero decisionale, cioè quando si lascia la schermata dell'ID paziente (conferma ID oppure "Procedi senza ID"). Il tempo trascorso sulla schermata ID non viene conteggiato. |
| **Fine valutazione** | Nel momento in cui si raggiunge l'**ultimo step del percorso** — **non** quando si genera il report. Ultimo step = un nodo `result` senza `next` (es. "PE esclusa", "PE confermata") oppure, nei nodi `ctpa_check`, la **selezione esplicita della modalità di imaging** (cliccare la card). Spuntare solo le controindicazioni non conclude il percorso. |
| **Tempo totale** | Fine − Inizio, nel formato `3 min 45 s` (oltre l'ora: `1 h 2 min 5 s`). Non include l'attesa tra la fine del percorso e il download. |
| **Scaricato il** | Data e ora del singolo download del file. Se si scarica più volte (o entrambe le varianti) ogni file riporta il proprio istante di download, mentre inizio, fine e durata restano quelli della valutazione. |

Comportamenti da conoscere:
- **Tornando indietro** (`goBack`/breadcrumb) dall'ultimo step la *fine* viene azzerata, e si registra di nuovo quando l'ultimo step viene raggiunto di nuovo. Allo stesso modo, in un nodo `ctpa_check`, cambiare le controindicazioni (che azzera la scelta) o scegliere un'altra modalità aggiorna la fine all'istante della nuova scelta; ri-cliccare la stessa modalità non la sposta.
- **Report scaricato prima della fine del percorso**: *Fine valutazione* riporta "Non ancora conclusa" e *Tempo totale* riporta "n.d. - percorso non concluso (trascorso finora: …)", calcolato fino all'istante del download. Inizio e data di download sono comunque presenti.
- **Nuova valutazione** (`resetApp`): inizio e fine vengono azzerati.
- I tempi restano **solo in memoria** nella pagina, come l'ID paziente: nessun salvataggio e nessun invio a server; compaiono esclusivamente nel PDF scaricato.
- Implementazione in `js/app.js`: variabili `evalStartTs`/`evalEndTs`, funzione `syncEndTimestamp()` (usa la stessa definizione di "esito finale" di `getCurrentOutcomeSummary()`, così i tempi sono sempre coerenti con il contenuto del referto), helper `formatDateTime()`/`formatDuration()`. Nessuna modifica a `decision_tree.js` è necessaria per i tempi.
- Nel report schematico il blocco intestazione è impaginato su due colonne allineate (etichetta / valore) invece che con spazi multipli, perché i valori restano leggibili anche con le nuove righe.

> **Regola principale**: per modificare la logica clinica o i criteri diagnostici, intervenire **solo su `decision_tree.js`**. L'interfaccia si adatta automaticamente.
>
> Il file `decision_tree.js` contiene **entrambi i rami** (AHA 2026 e ESC 2019) in un unico albero — la scelta tra i due avviene a runtime nel nodo `choose_guideline`. Sono moduli indipendenti: modificare un ramo non impatta l'altro.

---

## Come eseguire

Pubblicare la cartella così com'è su un server web statico (HTTPS) e aprire `index.html` — nessuna dipendenza esterna, nessuna chiamata di rete: funziona anche senza internet una volta caricata. Per l'uso clinico vedi `SECURITY.md` (hosting, header, rilascio).

Compatibile con:
- **Desktop**: Chrome, Firefox, Safari, Edge
- **Tablet / Mobile**: iOS Safari, Android Chrome
- Qualsiasi dispositivo con schermo ≥ 320px

---

## Flusso decisionale implementato

L'app permette di scegliere tra due percorsi linee-guida fin dalla seconda schermata (`choose_guideline`).

### Ramo AHA 2026

```
Sintomi sospetti PE
        │
        ▼
    Esegui H&P  [COR 1]
        │
        ▼
  Scegli score clinico
   ┌────┼────┐
Wells  Geneva  Geneva Sempl.
        │
        ▼
  ┌─────────────────────┐
  │   Probabilità?      │
  └─────────────────────┘
   <15% (Bassa)  15-50% (Interm.)  >50% (Alta)
      │                │                │
      ▼                │                ▼
   PERC           D-Dimero +    → Imaging diretto
  Tutti OK?       YEARS [COR 2a]
   │    │               │
  Sì   No         ┌─────┴─────┐
   │    │      Esclusa     Imaging
   ▼    │
PE       └──→ D-Dimero+YEARS
esclusa
        │
        ▼
  ┌─────────────────────────────┐
  │ Scelta Modalità di Imaging  │  ◄── FINE PERCORSO
  │ (check controindicazioni)   │      (nessun follow-up)
  └─────────────────────────────┘
  ✔ "Nessuna controindicazione presente" → CTPA (raccomandata)
  ✔ CI assoluta selezionata               → Eco multiorgano
  ✔ CI relativa selezionata               → Scintigrafia V/Q / SPECT
  (le due tipologie di selezione sono mutuamente esclusive)
  + commento libero facoltativo → riportato nel report PDF
```

### Ramo ESC 2019

```
Sintomi sospetti PE
        │
        ▼
  Instabilità emodinamica?  [Tabella 4]
  (arresto cardiaco / shock ostruttivo / ipotensione persistente)
        │
   ┌────┴────┐
  Sì         No
   │          │
   ▼          ▼
 ┌─────────────────────┐    Scegli lo score [Sez. 4.2 ESC]
 │ FIGURA 4 — Instabile│      ┌──────┴──────┐
 └─────────────────────┘   Geneva (ESC)   Wells Score
   TTE bedside              [Tabella 5]    (stessa regola AHA)
        │                       └──────┬──────┘
   Disfunzione RV?                     ▼
   ┌────┴────┐                Bassa/Interm. o Alta/PE-likely
  No         Sì                  │                │
   │          │                  ▼                ▼
   ▼          ▼              D-Dimero      ┌──────────────────┐
 Altre    ┌──────────────────┐< soglia?    │ Scelta Modalità   │ ◄── FINE PERCORSO
 cause    │ Scelta Modalità   │ ┌───┴───┐   │ Imaging            │
          │ Imaging           │Sì       No  │ (check contro-     │
          │ (check contro-    │PE       │   │ indicazioni)       │
          │ indicazioni)      │esclusa  ▼   └──────────────────┘
          └──────────────────┘      ┌──────────────────┐
          ◄── FINE PERCORSO         │ Scelta Modalità   │ ◄── FINE PERCORSO
                                    │ Imaging            │
                                    └──────────────────┘
```

> **Scelta dello score in ESC 2019** — Le linee guida (Sez. 4.2) indicano esplicitamente sia il **Revised Geneva Score** (Tabella 5) sia il **Wells Score** come regole predittive validate e con performance diagnostica comparabile ("*a direct prospective comparison of these rules confirmed a similar diagnostic performance*"). L'app permette quindi di scegliere quale utilizzare nel nodo `esc_choose_score`, prima del calcolo della probabilità clinica. Il Wells Score usato qui (`esc_wells_score`) applica gli stessi criteri/punteggi del ramo AHA, ma con navigazione propria verso `esc_ddimer_test` (bassa/intermedia) o `esc_ctpa_no_dimer` (alta) — i due rami restano indipendenti, come da convenzione del progetto.

> **Il percorso termina sempre alla scelta della modalità di imaging.** In tutti i rami (AHA e le tre varianti ESC: instabile `esc_ctpa_feasible`, stabile con D-Dimero positivo `esc_ctpa_low_intermediate`, stabile alta probabilità `esc_ctpa_no_dimer`) l'app non prosegue oltre l'individuazione della modalità di imaging più appropriata in base alle controindicazioni alla CTPA: nessuna schermata chiede l'esito dell'esame né formula una diagnosi finale di PE. L'interpretazione del referto resta interamente al giudizio clinico. Su ciascuna di queste schermate è disponibile un campo di commento facoltativo per motivare la scelta, riportato nel report PDF — vedi sezione dedicata più avanti.

---

## Tipi di nodi (`decision_tree.js`)

| Tipo         | Descrizione                                                  |
|--------------|--------------------------------------------------------------|
| `"info"`     | Schermata informativa con testo e bottone Continua           |
| `"question"` | Scelta multipla senza calcolo (es. selezione dello score, scelta linee guida) |
| `"score"`    | Checklist con punteggio + interpretazione a range            |
| `"result"`   | Esito intermedio — mostra testo e naviga al nodo `next`      |
| `"ctpa_check"` | Selezione controindicazioni CTPA + alternative raccomandate |

---

## Scores implementati

### Wells Score
| Criterio | Punti |
|---|---|
| Sintomi clinici di TVP | 3 |
| PE più probabile di diagnosi alternativa | 3 |
| FC > 100 bpm | 1.5 |
| Immobilizzazione ≥3gg o chirurgia nelle ultime 4 settimane | 1.5 |
| TVP o PE precedente | 1.5 |
| Emottisi | 1 |
| Tumore maligno attivo | 1 |

Interpretazione **Standard**: Bassa <2 · Intermedia 2–6 · Alta >6  
Interpretazione **Modified** (dicotomica): PE improbabile ≤4 · PE probabile >4. Nel ramo AHA "improbabile" porta a PERC solo se il punteggio è < 2; con 2–4 si va a D-Dimero + YEARS.

### Revised Geneva Score
| Criterio | Punti |
|---|---|
| Età > 65 anni | 1 |
| TVP o PE precedente | 3 |
| Chirurgia in AG o frattura arto inf. nell'ultimo mese | 2 |
| Tumore maligno attivo | 2 |
| Dolore unilaterale arto inferiore | 3 |
| Emottisi | 2 |
| FC 75–94 bpm | 3 |
| FC ≥ 95 bpm | 5 |
| Dolore palpazione circolo venoso profondo + edema unilaterale | 4 |

Interpretazione: Bassa 0–3 · Intermedia 4–10 · Alta ≥11

### Simplified Revised Geneva Score
Stessi criteri del Geneva, 1 punto ciascuno (tabella AHA 2026); le due fasce di FC sono mutuamente esclusive.  
Interpretazione: Bassa/Improbabile 0–1 · Intermedia 2–4 · Alta/Probabile ≥5

> Nota: ESC 2019 (Tabella 5) assegna 2 punti a FC ≥ 95 nella versione semplificata; il ramo AHA segue la tabella AHA (1 punto). Decisione da confermare dal responsabile clinico.

### PERC – PE Rule Out Criteria
Applicabile **solo** se probabilità pre-test < 15%.  
8 criteri; se punteggio = 0 (nessun criterio presente) → PE esclusa senza ulteriori test.

| Criterio |
|---|
| Età ≥ 50 anni |
| FC ≥ 100 bpm |
| SatO₂ < 95% in aria ambiente |
| Emottisi |
| Uso di estrogeni |
| TVP o PE precedente |
| Gonfiore unilaterale alla gamba |
| Chirurgia/trauma con ospedalizzazione nelle ultime 4 settimane |

### D-Dimero + Criteri YEARS [COR 2a]
3 criteri YEARS (TVP, emottisi, PE diagnosi più probabile).  
Soglia D-Dimero determinata dal numero di criteri:

| YEARS | D-Dimero | Esito |
|---|---|---|
| 0 | < 1000 ng/mL | PE esclusa |
| ≥1 | < 500 ng/mL (o soglia age-adj.) | PE esclusa |
| 0 | ≥ 1000 ng/mL | → Imaging |
| ≥1 | ≥ 500 ng/mL (o soglia age-adj.) | → Imaging |

**D-Dimero age-adjusted**: età < 50 anni → 500 µg/L; età ≥ 50 anni → età × 10 µg/L. Oltre i 50 anni l'utente deve scegliere quale soglia applicare (fissa o età-corretta). Con 0 criteri YEARS la soglia resta 1000 ng/mL.

---

## Score e criteri ESC 2019 

### Instabilità Emodinamica —  ESC (ref. Tabella 4)
Definisce la PE ad alto rischio. **Basta UNA** delle tre condizioni:

| Condizione | Criterio |
|---|---|
| Arresto cardiaco | Necessità di rianimazione cardiopolmonare |
| Shock ostruttivo | PA sistolica < 90 mmHg (o vasopressori per PA ≥ 90 mmHg) **+** ipoperfusione d'organo |
| Ipotensione persistente | PA sistolica < 90 mmHg o calo ≥ 40 mmHg per > 15 min, non da aritmia/ipovolemia/sepsi |

Se presente almeno una condizione → ramo "instabile" (Figura 4 ESC, vedi sopra).  
Se nessuna condizione → ramo "stabile", si procede con il Geneva Score ESC.

### Revised Geneva Score — ESC (versione originale, ref. Tabella 5)
Diversa dalla versione AHA: punteggi e soglie differenti.

| Criterio | Punti |
|---|---|
| TVP o PE precedente | 3 |
| FC 75–94 bpm | 3 |
| FC ≥ 95 bpm | 5 |
| Chirurgia o frattura nel mese precedente | 2 |
| Emottisi | 2 |
| Tumore maligno attivo | 2 |
| Dolore unilaterale arto inferiore | 3 |
| Dolore palpazione venosa profonda + edema unilaterale | 4 |
| Età > 65 anni | 1 |

Due possibili interpretazioni, selezionabili nell'interfaccia tramite tab:
- **Schema a 3 livelli**: Bassa 0–3 · Intermedia 4–10 · Alta ≥11
- **Schema a 2 livelli**: PE improbabile 0–5 · PE probabile ≥6

### Wells Score — alternativa ESC al Geneva (ref. Sez. 4.2)
Le linee guida ESC 2019 citano il Wells Score come regola predittiva alternativa al Geneva, con performance diagnostica comparabile. Nel nodo `esc_choose_score` l'utente sceglie quale usare. Il nodo `esc_wells_score` applica gli **stessi criteri e punteggi** del Wells AHA (vedi tabella sopra), con soglie di interpretazione identiche (Standard: Bassa <2 · Intermedia 2–6 · Alta >6; Modified: PE improbabile ≤4 · PE probabile >4), ma naviga verso i nodi ESC (`esc_ddimer_test` per bassa/intermedia, `esc_ctpa_no_dimer` per alta).

### D-Dimero — ESC (ref. Figura 5)
Per probabilità bassa/intermedia (o PE-unlikely): soglia fissa standard 500 ng/mL (con possibilità di applicare soglia age-adjusted). Se negativo → PE esclusa; se positivo → si procede alla **scelta della modalità di imaging** (fine percorso).  
Per probabilità alta (o PE-likely): il D-Dimero **non è indicato** (basso valore predittivo negativo in questa fascia) → si procede direttamente alla **scelta della modalità di imaging** (fine percorso).

### Scelta della Modalità di Imaging — dopo D-Dimero positivo o probabilità alta
In entrambi i casi (D-Dimero positivo con probabilità bassa/intermedia, oppure probabilità alta/PE-likely che salta il D-Dimero), viene mostrata la stessa schermata di **controindicazioni CTPA** usata nel ramo AHA e nel ramo ESC instabile (`esc_ctpa_low_intermediate` e `esc_ctpa_no_dimer`, entrambi di tipo `ctpa_check`):

| Controindicazione selezionata | Modalità alternativa proposta |
|---|---|
| Nessuna | CTPA |
| Relativa (gravidanza, insufficienza renale) o allergia al mdc | Scintigrafia V/Q planare o SPECT |
| Assoluta (TC non disponibile, shock grave) | Ecografia Multiorgano |

**Il percorso termina qui**: la schermata individua solo la modalità di imaging più appropriata (con campo di commento facoltativo, riportato nel report) — non chiede né interpreta l'esito dell'esame. L'eventuale diagnosi di PE, e le decisioni terapeutiche conseguenti, restano interamente al giudizio clinico del medico dopo la refertazione dell'esame scelto.

### Algoritmo Instabilità Emodinamica — ESC (ref. Figura 4)
Percorso parallelo per il paziente instabile (`esc_bedside_tte` → `esc_ctpa_feasible`):

1. **TTE bedside** — primo step rapido per cercare disfunzione del ventricolo destro (RV)
2. **RV normale** → PE praticamente esclusa come causa dell'instabilità → ricerca altre cause di shock (fine percorso)
3. **RV disfunzionante** → schermata di **controindicazioni assolute/relative** alla CTPA (nodo `esc_ctpa_feasible`, stesso pattern del ramo AHA, vedi sezione successiva) per individuare la modalità di imaging/conferma più appropriata — fine percorso, senza ulteriore interpretazione dell'esito

---

## Scelta della modalità di imaging 

L'app usa **quattro istanze** dello stesso tipo di nodo `ctpa_check`, con interfaccia identica (checkbox controindicazioni assolute/relative + opzione "nessuna controindicazione" + card delle modalità compatibili). **In tutti e quattro i casi il percorso si conclude a questa schermata**: nessuna prosecuzione verso schermate di "esito imaging" o diagnosi.

| Nodo | Contesto |
|---|---|
| `ctpa_check` (ramo AHA) | Probabilità clinica intermedia/alta, D-Dimero positivo |
| `esc_ctpa_feasible` (ramo ESC, paziente instabile) | RV disfunzionante alla TTE bedside |
| `esc_ctpa_low_intermediate` (ramo ESC, paziente stabile) | Probabilità bassa/intermedia con D-Dimero positivo |
| `esc_ctpa_no_dimer` (ramo ESC, paziente stabile) | Probabilità clinica alta / PE-likely |

Gli ID delle checkbox sono namespaced per ciascun nodo (`ci_abs1`, `ci_abs1_esc`, `ci_abs1_esc_li`, `ci_abs1_esc_nd`, ecc.) per evitare conflitti di stato, pur condividendo lo stesso codice di rendering (`buildCtpaHtml`, `toggleCi`, `toggleNoneCi` in `js/app.js`).

Lo schermo presenta tre gruppi di checkbox, **mutuamente esclusivi tra loro**:
1. Controindicazioni assolute
2. Controindicazioni relative
3. **"Nessuna delle controindicazioni sopra è presente"** — checkbox dedicata che, se selezionata, deseleziona automaticamente tutte le altre e mostra la CTPA come unica card disponibile. Selezionare una qualsiasi controindicazione, viceversa, deseleziona questa opzione.

### Selezione esplicita dell'utente tra le opzioni risultanti
Dopo aver spuntato le controindicazioni (o "nessuna"), l'app mostra le **card delle modalità di imaging compatibili** (ranked per pertinenza; la/le migliori per punteggio sono marcate "✦ Consigliata"). Queste card sono **cliccabili**: è l'utente a dover selezionare esplicitamente quale utilizzerà (`selectCtpaAlt(nodeId, altId)`), anche quando è disponibile una sola opzione (es. CTPA in assenza di controindicazioni). Finché non viene fatta una selezione, compare un promemoria ("👆 Seleziona… la modalità che utilizzerai") e **campo commento e bottoni di download del report restano nascosti**.

La card selezionata viene evidenziata (bordo verde, "✓ Modalità selezionata") ed è **questa** — non un suggerimento automatico — a comparire come scelta finale nel report. Cambiare le controindicazioni selezionate azzera la scelta precedente (e l'eventuale commento), perché il set di opzioni compatibili può cambiare.

### Commento clinico facoltativo
Una volta selezionata la modalità, compare un campo di testo libero — **"Commento clinico (facoltativo) — motiva la scelta della modalità di imaging"** — per annotare il razionale clinico (es. "paziente non trasferibile", "priorità a ecografia point-of-care", disponibilità limitata di CTPA, ecc.). Il testo viene salvato in memoria (`ctpaComments`, per nodo) e digitare non causa un nuovo render della card (nessuna perdita del focus). Il commento, se presente, viene riportato nel report PDF sia nell'ultimo step del percorso decisionale sia nel box "Esito".


### CTPA – Prima scelta [COR 1]
Ampia disponibilità, eccellente performance diagnostica, bassa dose radiante rispetto alle tecniche storiche. Mostrata come card "Consigliata" quando viene confermata l'assenza di controindicazioni.

### Controindicazioni Assolute → **Ecografia Multiorgano**
| ID | Controindicazione |
|---|---|
| `ci_abs1` | Indisponibilità della TC |
| `ci_abs2` | Shock emodinamico grave (paziente non trasferibile) |
| `ci_abs3` | Allergia grave/documentata al mezzo di contrasto iodato |

**Ecografia Multiorgano** (point-of-care integrata):
- **Ecocardiografia**: dilatazione/disfunzione RV, segno D setto, TAPSE, ipertensione polmonare
- **Ecografia polmonare**: consolidamenti subpleurici, versamento pleurico
- **Eco-Doppler venoso**: TVP prossimale agli arti inferiori

#### Parametri ecocardiografici disfunzione RV (Tabella 4 AHA)
Il pulsante "▸ Parametri ecocardiografici disfunzione RV" (con relativa tabella a comparsa) è disponibile per **tutte** le card "Ecografia Multiorgano", in ciascuno dei quattro nodi `ctpa_check` (AHA e le tre varianti ESC: `alt_echo`, `alt_echo_esc`, `alt_echo_esc_li`, `alt_echo_esc_nd`) — comportamento uniforme in tutto il percorso.

| Parametro | Tecnica | Soglia |
|---|---|---|
| Dimensione RV | Apical 4-chamber (EDD) | EDD > 30 mm o RV basal EDD > 42 mm |
| Rapporto RV/LV | End-diastolic ratio apicale/subcostale | > 0.9 |
| TAPSE | M-mode, piano longitudinale | < 1.6 cm = anormale |
| Doppler IP. Acceleration | Tissue Doppler Imaging | Tempo acc. < 90 ms o gradiente RV/atr. > 30 mmHg |
| Velocità sistolica tricuspide | Apical/subcostal 4-chamber | > 2.6 m/sec |

### Controindicazioni Relative → **Scintigrafia V/Q planare o SPECT**
| ID | Controindicazione |
|---|---|
| `ci_rel1` | Gravidanza |
| `ci_rel2` | Insufficienza renale (rischio nefropatia da contrasto) |

- **V/Q planare**: bassa dose fetale (gravidanza), no contrasto iodato
- **V/Q SPECT (± CT low-dose)**: prima scelta quando disponibile — maggiore sensibilità/specificità, minore tasso di indeterminato

---

### Metadati
```js
const TREE_METADATA = {
  version:     "4.1.0",      // 4.1.0: nuovo report, operatore, avviso privacy; 4.0.0: correzioni logica clinica, hardening, test automatici (vedi "Novità")
  lastUpdated: "2026-11-16",
  ...
};
```

---

*Fonte: AHA 2026 – Adults With Acute Pulmonary Embolism · © 2026 American Heart Association, Inc. and American College of Cardiology Foundation*  


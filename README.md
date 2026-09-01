# PE Decision Tool – AHA 2026 + ESC 2019

Strumento di supporto decisionale clinico per la valutazione di pazienti con **sospetta Embolia Polmonare Acuta**, basato su due set di linee guida selezionabili dall'utente:
- **AHA 2026** (*Adults With Acute Pulmonary Embolism*) — Wells/Geneva/Geneva Semplificato, PERC, D-Dimero+YEARS, scelta CTPA con controindicazioni
- **ESC 2019** (*European Society of Cardiology Guidelines for the diagnosis and management of acute pulmonary embolism*) — triage instabilità emodinamica (Tabella 4), Geneva Score originale ESC (Tabella 5), D-Dimero, algoritmi Figura 4/5

> **⚠ Disclaimer** — Questo tool è esclusivamente a supporto del ragionamento clinico. Non sostituisce la valutazione del medico né costituisce indicazione terapeutica.

---

## Struttura dei file

```
pe-decision-tool/
├── index.html          # Interfaccia utente (HTML + CSS + JS logica di rendering)
├── decision_tree.js    # Albero decisionale (dati, punteggi, rami) ← modificare qui
└── README.md           # Questa documentazione
```

---

## ID Paziente e Report PDF (novità)

### Identificativo paziente
All'avvio (e ogni volta che si preme "↺ Riavvia") viene mostrata una schermata facoltativa per inserire un **codice/ID paziente** (es. numero cartella, iniziali).

- L'ID **non viene mai salvato, trasmesso o persistito**: vive solo nella variabile di sessione del browser (`patientId`) per la durata dell'utilizzo della pagina. Chiudendo/ricaricando la pagina viene perso.
- Lo strumento **resta anonimo lato software**: l'ID serve unicamente per etichettare il report scaricato, così che il medico possa ricondurlo al paziente corretto fuori dall'app.
- Si può saltare l'inserimento ("Salta — resta anonimo") o modificarlo in qualunque momento cliccando il badge 🪪 in header (usa `prompt()`).
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
2. **Riquadro informazioni** — ID paziente (o "Non specificato (anonimo)"), data/ora di generazione, linee guida utilizzate (rilevate automaticamente dal percorso), versione dello strumento.
3. **Percorso decisionale** — ogni step numerato, con titolo del nodo ed eventuali dettagli (criteri di score spuntati, punteggio totale, valori D-Dimero/età inseriti, controindicazioni selezionate, interpretazione/esito calcolato a quello step). Se il percorso termina alla scelta della modalità di imaging, questa compare come **ultimo step** dell'elenco, con la modalità **scelta dall'utente** (non un suggerimento automatico) e l'eventuale commento clinico.
   > **Step puramente di passaggio** (es. "Esegui H&P", tipo `info`/`result` senza una vera decisione) mostrano **solo il titolo dello step**, senza alcuna riga "Scelta: Continua" — quella dicitura non viene mai stampata nel report.

   **Etichette omogenee per tipo di step** — ogni riga sotto il titolo inizia con un prefisso chiaro e coerente, così che il tipo di informazione riportata sia immediatamente riconoscibile scorrendo il documento:

   | Prefisso | Tipo di nodo | Esempio |
   |---|---|---|
   | `Selezione:` | domanda a opzioni (`question`) — scelta linee guida, risposte sì/no, scelta score | `Selezione: ESC 2019`, `Selezione: Wells Score` |
   | `Risultato:` | punteggio/score (`score`) — riprende **direttamente la categoria clinica calcolata** dalla regola, non il nome dello step (mai una riga ridondante tipo "Wells Score per PE → Wells Score per PE") | `Risultato: Probabilità clinica intermedia (15-50%)`, `Risultato: D-Dimero negativo (< soglia) -> PE esclusa, nessun trattamento` |
   | `Modalità di imaging scelta:` | scelta finale della modalità di imaging (`ctpa_check`) | `Modalità di imaging scelta: CTPA (Angio-TC polmonare)` |
   | *(nessuna riga)* | passaggio informativo senza decisione (`info`/`result`) | — |

   Sotto l'headline, i dettagli di supporto (criteri spuntati, punteggio, età/D-Dimero, controindicazioni, commento) sono elencati puntati, senza mai ripetere l'informazione già espressa nell'headline.
4. **Esito dettagliato** — riquadro con titolo, sottotitolo, testo completo, l'eventuale commento clinico e note del nodo finale raggiunto; se il percorso non è ancora concluso al momento del download, viene segnalato esplicitamente.
5. **Disclaimer e fonte**, identici a quelli mostrati in app, più numerazione pagine e intestazione ripetuta su ogni pagina per i report multi-pagina.

Il log delle scelte (`decisionLog`) viene ricostruito automaticamente ad ogni navigazione (`goTo`) leggendo il contenuto del nodo di partenza — nessun campo aggiuntivo da compilare. Tornando indietro (`goBack`/breadcrumb) il log viene troncato di conseguenza, così il report riflette sempre e solo il percorso effettivamente valido nella sessione corrente.

Il file scaricato è nominato `PE-Report_<ID-o-anonimo>_visivo_<data-ora>.pdf` oppure `..._schema_<data-ora>.pdf`.

> **Regola principale**: per modificare la logica clinica o i criteri diagnostici, intervenire **solo su `decision_tree.js`**. L'interfaccia si adatta automaticamente.
>
> Il file `decision_tree.js` contiene **entrambi i rami** (AHA 2026 e ESC 2019) in un unico albero — la scelta tra i due avviene a runtime nel nodo `choose_guideline`. Sono moduli indipendenti: modificare un ramo non impatta l'altro.

---

## Come eseguire

Aprire `index.html` in qualsiasi browser moderno — nessun server, nessuna dipendenza esterna da installare.

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
Interpretazione **Modified** (dicotomica): PE improbabile ≤4 · PE probabile >4

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
Stessi criteri del Geneva, 1 punto ciascuno.  
Interpretazione: Bassa/Improbabile 0–1 · Intermedia 2–4 · Alta/Probabile 5–7

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

**D-Dimero age-adjusted**: età < 50 anni → 500 µg/L; età ≥ 50 anni → età × 10 µg/L

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

Gli ID delle checkbox sono namespaced per ciascun nodo (`ci_abs1`, `ci_abs1_esc`, `ci_abs1_esc_li`, `ci_abs1_esc_nd`, ecc.) per evitare conflitti di stato, pur condividendo lo stesso codice di rendering (`buildCtpaHtml`, `toggleCi`, `toggleNoneCi` in `index.html`).

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
  version:     "3.3",      
  lastUpdated: "2026-09-01",  
  ...
};
```

---

*Fonte: AHA 2026 – Adults With Acute Pulmonary Embolism · © 2026 American Heart Association, Inc. and American College of Cardiology Foundation*  


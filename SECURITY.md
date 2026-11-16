# Sicurezza, dati e rilascio — PE Decision Tool

## 1. Cosa fa (e non fa) lo strumento con i dati

- Tutto il calcolo avviene nel browser. Non esiste un server applicativo, un database o un account.
- Nessuna chiamata di rete dopo il caricamento della pagina: la Content-Security-Policy impone `connect-src 'none'`.
- ID paziente, nome dell'operatore, scelte, valori e tempi vivono solo nella memoria della pagina. Vengono cancellati chiudendo o ricaricando la pagina, con "Riavvia" e dopo 10 minuti di inattività (avviso di 60 s; costanti `INACTIVITY_*` in `js/app.js`).
- Nessun cookie; `localStorage` contiene solo la preferenza del tema.
- L'unico dato che esce dallo strumento è il **PDF scaricato**: da quel momento è un documento con dati sanitari pseudonimizzati e va gestito secondo il protocollo di studio.

## 2. Crittografia

| Dove | Cosa serve | Chi lo garantisce |
|---|---|---|
| In transito | HTTPS, TLS 1.2 o superiore, HSTS | Il server che ospita i file |
| Dati nell'app | Niente da cifrare: nulla viene salvato | — |
| PDF sul dispositivo | Cifratura del disco (BitLocker, FileVault, cifratura nativa iOS/Android) e blocco schermo | Gestione dei dispositivi dell'ospedale |
| PDF archiviati per lo studio | Archivio dell'ente (cartella clinica, eCRF, share cifrato con accessi nominali) | Protocollo di studio / DPO |
| Integrità del codice | Commit e tag firmati, hash SHA-256 dei file di ogni release | Processo di rilascio (§4) |

Non aggiungere cifratura "fatta in casa" in JavaScript (es. PDF con password generata nel browser): la chiave starebbe nello stesso posto del dato e la protezione sarebbe solo apparente. Se un giorno servisse salvare o trasmettere dati, va introdotto un backend dell'ente con autenticazione, non una soluzione lato browser.

## 3. Hosting

GitHub Pages non permette header HTTP personalizzati: la CSP funziona via `<meta>`, ma mancano `frame-ancestors`, HSTS configurabile e gli altri header. Per l'uso clinico, in ordine di preferenza:

1. Server web dell'ospedale (intranet), con gli header del file `_headers`.
2. Hosting statico che legge `_headers` (Cloudflare Pages, Netlify), previo accordo con il DPO.

Header minimi: quelli elencati in `_headers`. Esempio nginx:

```
add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'" always;
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
```

## 4. Rilascio di una nuova versione

1. Modifica su un branch; `main` protetto, 2FA obbligatoria per chi ha accesso al repository.
2. Test verdi (`node --test tests/tree.test.js`, eseguiti anche da GitHub Actions).
3. Revisione di una seconda persona; per `js/decision_tree.js` e `js/engine.js` il revisore è un clinico.
4. Aggiornare `version` e `lastUpdated` in `TREE_METADATA` e la sezione "Novità" del README.
5. Tag firmato (`git tag -s vX.Y.Z`) e registro degli hash: `sha256sum index.html css/* js/* vendor/*.js`.
6. In produzione va solo una versione con tag. La versione compare nel piè di pagina e in ogni report.

## 5. Dipendenze

- jsPDF 4.2.1 (`vendor/jspdf.umd.min.js`), copiato dal pacchetto npm ufficiale. Controllare gli avvisi di sicurezza a ogni release e almeno ogni tre mesi; aggiornare sostituendo il file e rieseguendo i test e una prova di download dei due report.
- Font DM Sans e DM Serif Display (licenza OFL) in `vendor/fonts`.

## 6. Limiti noti

- Le soglie del D-Dimero sono in ng/mL come riportato dalle linee guida. Verificare con il laboratorio che il referto sia in unità FEU; se il laboratorio referta in DDU lo strumento non va usato senza una conversione validata.
- Lo strumento non autentica l'utente e non tiene un registro d'uso: se lo studio richiede tracciabilità dell'operatore, va prevista nel protocollo (es. firma sul report).
- Segnalazione di problemi di sicurezza o di errori clinici: contattare il responsabile dello strumento indicato in `TREE_METADATA.author`, sospendendo l'uso fino a verifica.

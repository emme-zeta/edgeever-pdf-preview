# PDF Preview — EdgeEver plugin

Anteprima inline dei **PDF allegati** alle note di EdgeEver, renderizzati su **canvas con pdf.js** (incorporato nel plugin). Funziona sia su Web sia su Desktop, incluso quando il viewer PDF del browser non è disponibile (es. app desktop Electron), perché non dipende dal viewer nativo né da richieste di rete.

## Cosa fa
- **Comando "PDF: anteprima rapida"**: apre un pannello a tutto schermo e mostra i PDF della nota corrente, pagina per pagina.
- **Comando "PDF: inserisci anteprima nel testo"**: inserisce nella nota un blocco embed `pdf-preview` che mostra il PDF (se la nota ha più PDF, apre il selettore).
- **Blocco embed `pdf-preview`**: renderizza un PDF (per `resourceId`) dentro la nota.

## Come individua i PDF
Legge il markdown della nota attiva, estrae i riferimenti `…/api/v1/resources/<id>/blob` e usa i metadati di `resources.list()` (mime/nome file) per riconoscere i PDF; fallback sui magic bytes `%PDF-`. I byte del PDF si leggono via `context.resources.read()`.

## Rendering
Usa **pdf.js** (`pdfjs-dist`, stesso motore che EdgeEver usa internamente) incorporato nel bundle: la libreria e il worker sono inclusi in `main.js` in base64, quindi **nessuna richiesta di rete a runtime** e nessun permesso `network`. I `blob:` URL per il worker sono consentiti dallo stesso meccanismo con cui EdgeEver carica i plugin.

## Requisiti / limiti
- Gira su **Web e Desktop** (non sulle app mobile iOS/Android — i plugin non girano lì).
- Permessi: `resources:read`, `notes:read`, `editor:read/write`, `ui:embeds/commands/panels/notices`.

## Build
`main.js` è **generato** da `build.sh` (scarica pdf.js da cdnjs alla versione pinnata e lo incorpora in `main.src.js`). Non modificare `main.js` a mano: edita `main.src.js` e rilancia:

```bash
./build.sh        # usa PDFJS_VERSION (default pinnata) e riassembla main.js
```

Il limite di EdgeEver per `main.js` è 5 MB; il bundle con pdf.js è ~2,3 MB.

## Struttura
- `manifest.json` — manifest del plugin (apiVersion 2).
- `main.src.js` — logica del plugin (sorgente).
- `build.sh` — assembla `main.js` incorporando pdf.js.
- `main.js` — bundle generato (pdf.js inline + logica).
- `styles.css` — nessuno stile aggiuntivo (richiesto dall'installer).

## Installazione
EdgeEver → Plugin → installa da questo repository GitHub. Ogni release è taggata con la versione del manifest e include `manifest.json`, `main.js`, `styles.css`.

Autore: Oxigeno (marco@oxigeno.it).

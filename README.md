# PDF Preview — EdgeEver plugin

Anteprima inline dei **PDF allegati** alle note di EdgeEver, usando il viewer PDF nativo del browser. Nessuna dipendenza esterna.

## Cosa fa
- **Blocco embed `pdf-preview`**: mostra un PDF (via `<iframe>` su object URL) dentro la nota.
- **Comando "PDF: anteprima rapida"**: apre un pannello a tutto schermo con i PDF della nota corrente e li visualizza.
- **Comando "PDF: inserisci anteprima nel testo"**: inserisce un blocco di anteprima del PDF (se la nota ha più PDF, apre il selettore).

## Requisiti / limiti
- Gira su **Web e Desktop** (non sulle app mobile iOS/Android — i plugin non girano lì).
- Permessi: `resources:read`, `editor:read/write`, `ui:embeds/commands/panels/notices`.
- Usa il viewer PDF del browser: l'anteprima funziona dove il browser sa renderizzare i PDF.

## Installazione
EdgeEver → Plugin Marketplace → installa da questo repository GitHub (o da URL del manifest). Abilita il plugin e usa i comandi dal menu/scorciatoie.

## Struttura
- `manifest.json` — manifest del plugin (apiVersion 2).
- `main.js` — entry/bundle del plugin.

Autore: Oxigeno (marco@oxigeno.it).

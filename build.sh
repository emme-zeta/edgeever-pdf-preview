#!/usr/bin/env bash
# Assembla main.js = consts base64 di pdf.js (inline) + logica del plugin (main.src.js).
# pdf.js viene scaricato da cdnjs (versione pinnata) e incorporato: il plugin non
# effettua richieste di rete a runtime. Limite EdgeEver per main.js: 5 MB.
set -euo pipefail
cd "$(dirname "$0")"

PDFJS_VERSION="${PDFJS_VERSION:-6.4.299}"
BASE="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Scarico pdf.js ${PDFJS_VERSION}…"
curl -sSL -o "$TMP/pdf.min.mjs"        "${BASE}/pdf.min.mjs"
curl -sSL -o "$TMP/pdf.worker.min.mjs" "${BASE}/pdf.worker.min.mjs"

# sanity check: devono essere moduli JS, non pagine di errore
head -c 2 "$TMP/pdf.min.mjs"        | grep -q '/\*' || { echo "pdf.min.mjs non valido"; exit 1; }
head -c 2 "$TMP/pdf.worker.min.mjs" | grep -q '/\*' || { echo "pdf.worker.min.mjs non valido"; exit 1; }

echo "Assemblo main.js…"
{
  printf '// EdgeEver plugin: PDF Preview — main.js GENERATO da build.sh (non modificare a mano).\n'
  printf '// pdf.js %s inline (lib + worker, base64) + main.src.js. Rigenera con ./build.sh.\n' "$PDFJS_VERSION"
  printf 'const __PDFJS_LIB_B64__="';    base64 -i "$TMP/pdf.min.mjs"        | tr -d '\n'; printf '";\n'
  printf 'const __PDFJS_WORKER_B64__="'; base64 -i "$TMP/pdf.worker.min.mjs" | tr -d '\n'; printf '";\n'
  cat main.src.js
} > main.js

SIZE=$(wc -c < main.js | tr -d ' ')
echo "main.js = ${SIZE} byte ($((SIZE/1024)) KB)"
if [ "$SIZE" -gt 5242880 ]; then echo "ERRORE: main.js supera il limite di 5 MB di EdgeEver"; exit 1; fi
echo "OK"

#!/usr/bin/env bash
# Syntaxcontrole van alle inline <script> blokken in index.html.
# Voorkomt dat een kapot scriptblok (zoals unbalanced parentheses) gemerged wordt.
set -uo pipefail

FILES=$(ls index.html 2>/dev/null || true)
if [ -z "$FILES" ]; then
  echo "Geen HTML-bestanden gevonden om te controleren."
  exit 0
fi

NODE_BIN=$(command -v node || true)
if [ -z "$NODE_BIN" ]; then
  echo "node is niet geïnstalleerd — sla JS-syntaxcontrole over."
  exit 0
fi

FAIL=0
for f in $FILES; do
  if ! node scripts/extract-and-check.js "$f"; then
    FAIL=1
  fi
done

if [ $FAIL -eq 1 ]; then
  echo "JS-syntaxcontrole MISLUKT."
  exit 1
fi
echo "Alle inline scripts zijn syntactisch geldig."

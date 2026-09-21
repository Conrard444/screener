#!/usr/bin/env bash
# Volledige kwaliteitscontrole: JS-syntax + HTML-structuur.
# Dit is de combinatie die alle eerdere storingen had gevangen.
set -uo pipefail
FAIL=0

if [ -f scripts/check-js.sh ]; then
  ./scripts/check-js.sh || FAIL=1
fi

if [ -f scripts/check-structure.js ] && command -v node >/dev/null 2>&1; then
  for f in index.html; do
    [ -f "$f" ] && node scripts/check-structure.js "$f" || FAIL=1
  done
fi

if [ $FAIL -eq 1 ]; then
  echo ""
  echo "KWALITEITSCONTROLE MISLUKT — Los de fouten op voordat je commit."
  exit 1
fi
echo ""
echo "Alle controles geslaagd."

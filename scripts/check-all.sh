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

# Sectiecontrole: per-sectie syntax en verplichte ankers (zie scripts/check-sections.js)
if [ -f scripts/check-sections.js ] && command -v node >/dev/null 2>&1; then
  for f in index.html; do
    [ -f "$f" ] && node scripts/check-sections.js "$f" || FAIL=1
  done
fi

# Gedrags- en logische tests: laden de echte paginacode met stubs en toetsen de
# ketens die statisch niet te controleren zijn (screening-trechter, cloud-merge van
# portefeuilles, score-invarianten, archiefopslag, weergave-robuustheid).
if command -v node >/dev/null 2>&1; then
  for t in scripts/test-gedrag.js scripts/test-logica.js; do
    if [ -f "$t" ]; then
      node "$t" || FAIL=1
    fi
  done
fi

# Zelftest van de offline herrekening (parser, analyse en oordeel op een klein
# voorbeeld). De tool zelf leest een gekopieerd accuratesserapport.
if [ -f scripts/acc-replay.js ] && command -v node >/dev/null 2>&1; then
  node scripts/acc-replay.js --zelftest || FAIL=1
fi

if [ $FAIL -eq 1 ]; then
  echo ""
  echo "KWALITEITSCONTROLE MISLUKT — Los de fouten op voordat je commit."
  exit 1
fi
echo ""
echo "Alle controles geslaagd."

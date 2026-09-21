# AGENTS.md — projectregels voor agents (Vibe / Claude / Copilot / mensen)

Dit is een single-file webapplicatie: alle HTML, CSS en JavaScript staat in `index.html`
(~8.000 regels). Er is geen build-step, geen bundler, geen package.json. De app draait
direct als statische pagina (GitHub Pages).

## Harde regels (schendingen hebben al vier storingen veroorzaakt)

1. **Voer vóór elke commit uit:** `./scripts/check-all.sh`
   - JS-syntaxcontrole van alle inline `<script>` blokken
   - HTML-structuurcontrole (tag-nesting, IIFE-balans, ID-referenties)
   - Bij falen: commit weigeren en eerst oplossen.

2. **Module-volgorde in `index.html` is bewust en moet behouden blijven:**
   1. Bronopties en patronen (`EULER_*`, `ISIN_RE`)
   2. Gegevenstabellen en toestand (`SECTOR`, `NAAM_BIJ_ISIN`, `PORTFOLIO`, ...)
   3. Centrale modules (`NAAM`, `VELD`, `BRON`)
   4. Scorefuncties (momentum/waardering/groei/kwaliteit)
   5. Databronnen (`enrichFinnhub`, `enrichEulerpool`, ...)
   6. Weergave (`render`, `renderPortfolio`, `renderEtf`)
   7. Koppelingen aan knoppen (`onclick`/`onchange`) — **altijd binnen DOMContentLoaded of na de DOM**
   Elk blok gebruikt alleen wat erboven staat; verplaatsen leidt tot "is not defined".

3. **Event listeners (tabs, knoppen, login) horen BINNEN een
   `document.addEventListener('DOMContentLoaded', ...)` handler**, nooit los in de
   globale scope. De tab-bug en de login-bug zijn hierdoor ontstaan.

4. **IIFE's `(function(){ ... })();` moeten volledig gesloten zijn.** De login-bug
   ontstond doordat de sluiting ontbrak en code van een ander blok binnen de IIFE
   terechtkwam. De structuurcheck (check-structure.js) vangt dit nu af.

5. **Firebase initialisatie staat in `(function initFirebase(){ ... })();`** bij de
   cloud-sync sectie en voert zichzelf uit. Niet los aanroepen en niet verplaatsen:
   een dubbele of vroege aanroep reset de auth-state.

6. **Scoremethodiek**: dit is een winstmaximalisatie-tool. De eigenaar hertest de
   scoremethodiek regelmatig tegen opgehaalde historische data. Bij wijzigingen aan
   scorefuncties (`totalScore`, `etfTotalScore`, etc.):
   - schaal 0-100 houden, met neutraal midden rond 50
   - `Math.max(0, Math.min(100, ...))` clamping behouden
   - ontbrekende data => neutrale 50-score, nooit 0

7. **UI-wijzigingen**: lichter en cleaner is welkom, maar **nooit informatieverlies**.
   Kolommen, tooltips en uitleg bevatten bewust veel context; verwijder niets zonder
   expliciete opdracht.

8. **Geen comments toevoegen in JS** behalve sectie-headers zoals de bestaande
   `// ---- naam ----` conventie. Het bestaande commentaar is documentatie voor de
   eigenaar; behoud het.

9. **Commits**: direct naar `main` is de convention van de eigenaar. Push altijd
   na de commit. Commit-berichten in het Nederlands, beschrijf wat + waarom.

## Werkwijze bij een bugmelding van de eigenaar

1. Reproduceer de oorzaak in de code (lees eerst, gok niet).
2. Fix de aangetoonden oorzaak, niet een gegiste randverschijnsel.
3. Voer `./scripts/check-all.sh` uit vóór commit.
4. Commit + push naar main.

## Controlescripts

| Script | Wat het doet |
|---|---|
| `scripts/check-js.sh` | wrapper: syntax van inline scripts via node |
| `scripts/extract-and-check.js` | extraheert `<script>` blokken en valideert met `new Function()` |
| `scripts/check-structure.js` | tag-nesting, IIFE-balans, ID-referenties in HTML |
| `scripts/check-all.sh` | combinatie — dit draait ook in CI en de pre-commit hook |
| `scripts/pre-commit` | hook-template; kopieer naar `.git/hooks/pre-commit` |
| `.github/workflows/check-js.yml` | GitHub Action: "Quality Check" op push/PR naar main |

## Verifiëren van de volledige app

Er zijn geen geautomatiseerde UI-tests. Na grote wijzigingen: open de pagina, controleer
(1) toegangscode "screeno", (2) alle tabbladen, (3) Google-login/cloud-status,
(4) een demo-screening, (5) mobiele weergave.

#!/usr/bin/env node
// Sectiecontrole van het grote scriptblok in index.html.
//
// Elke // ---- sectie wordt apart geparsed met de Function-constructor.
// Een haakjes- of quote-fout wordt daardoor toegeschreven aan de sectie
// waar hij zit (met regelnummer en sectienaam), in plaats van "blok #2 faalt".
// Aanvullend: secties die per IIFE/structural noodzakelijk zijn (tab-navigatie,
// Firebase-init, centrale clamps) worden gecontroleerd op aanwezigheid, zodat
// een verloren blok direct opvalt in plaats van maanden onopgemerkt te blijven.
//
// Beperking: een sectie is pas zelfstandig parseerbaar als het een volledige
// functie/opsomming is. Byte-voor-byte splitsing op headers werkt hier omdat
// secties in dit project bewust op functiegrenzen liggen (AGENTS.md regel 2).

const fs = require("fs");
const file = process.argv[2];
if (!file) {
  console.error("Gebruik: node check-sections.js <html-bestand>");
  process.exit(1);
}

const html = fs.readFileSync(file, "utf8");
const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
const blocks = [];
let m;
while ((m = re.exec(html)) !== null) blocks.push(m[1]);

let failures = 0;
function fail(msg) {
  failures++;
  console.error("SECTIEFOUT: " + msg);
}

// ---------- verplichte ankers ----------
// Kritieke blokken die ooit verloren zijn gegaan bij een herstructurering.
// Elk anker: [naam, regex die het blok moet matchen]
const ANCHORS = [
  ["Tab-navigatie (centrale wissel-luisteraar)", /querySelectorAll\(['"]\.tab['"]\)/],
  ["Firebase-init (FB-object)", /var FB=\{app:null,auth:null,db:null,user:null,ready:false\}/],
  ["Firebase auth-listener", /onAuthStateChanged/],
  ["clampScore (centrale clamp)", /function clampScore\(/],
  ["setStatus (centrale statusbalk)", /function setStatus\(/],
  ["foutVolledig (centrale foutafhandeling)", /function foutVolledig\(/],
  ["OPHAALPOOL (centrale ophaalpool)", /OPHAALPOOL/],
  ["loadCloud (centrale cloud-lezer)", /function loadCloud\(/],
  ["accuratesse-rapporten", /ACC_RAPPORTEN_KEY/],
];
const allJs = blocks.join("\n");
ANCHORS.forEach(([naam, rx]) => {
  if (!rx.test(allJs)) fail("verplicht anker ontbreekt: " + naam);
});

// ---------- per-sectie syntaxcontrole ----------
// Alleen secties met een // ---- header in het grootste blok.
const big = blocks.reduce((a, b) => (b.length > a.length ? b : a), "");
const lines = big.split("\n");
const headers = [];
lines.forEach((l, i) => {
  // alleen top-level headers (kolom 0) zijn sectiegrenzen; ingesprongen
  // "// ---- sorteren ----" e.d. zijn sub-secties binnen \u00e9\u00e9n functie
  if (!l.startsWith("// ----")) return;
  const name = l.replace(/^\/\/\s*----\s*/, "").replace(/\s*----\s*$/, "");
  headers.push({ line: i, name });
});
if (!headers.length) {
  fail("geen // ---- sectie-headers gevonden in het grootste scriptblok — index is weg?");
} else {
  for (let h = 0; h < headers.length; h++) {
    const start = headers[h].line;
    const end = h + 1 < headers.length ? headers[h + 1].line : lines.length;
    const seg = lines.slice(start + 1, end).join("\n"); // header zelf overslaan
    if (!seg.trim()) continue;
    try {
      new Function(seg);
    } catch (e) {
      // Sub-secties binnen \u00e9\u00e9n functie (bv. "// ---- filteren ----" midden in
      // renderPortfolio) zijn geen zelfstandige eenheden: ze mogen pas fout zijn
      // als de combinatie met alle voorgaande code \u00f3\u00f3k faalt. Zo blijft de
      // attributie nauwkeurig zonder valse meldingen op functionele sub-secties.
      const upto = lines.slice(0, end).join("\n");
      try {
        new Function(upto);
        continue; // alleen standalone ongeldig maar in context geldig: geen fout
      } catch (e2) {
        fail(
          '"' + headers[h].name + '" (vanaf regel ' + (start + 1) + ' in het blok): ' + e2.message
        );
      }
    }
  }
}

console.log(
  "Sectiecontrole " + file + ": " + headers.length + " secties" +
  (failures ? " — " + failures + " FOUT" : " — OK") +
  ", " + ANCHORS.length + " verplichte ankers gecontroleerd."
);
process.exit(failures ? 1 : 0);

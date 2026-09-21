#!/usr/bin/env node
// Structuurcontrole van index.html: vangt de klassieke fouten af die dit project
// al meerdere keren gebroken hebben.
//
// Controles:
//   1. Tag-balans in de HTML (buiten inline <script> blokken)
//   2. IIFE-balans binnen inline <script> blokken (elk "(function" heeft een "})();" sluiting)
//   3. ID-referenties: $('id') en getElementById('id') die statisch lijken maar
//      niet in de HTML voorkomen krijgen een waarschuwing
const fs = require("fs");

const file = process.argv[2];
if (!file) {
  console.error("Gebruik: node check-structure.js <html-bestand>");
  process.exit(1);
}

const raw = fs.readFileSync(file, "utf8");
let failures = 0;
function fail(msg) {
  failures++;
  console.error("STRUCTUURFOUT: " + msg);
}
function warn(msg) {
  console.warn("WAARSCHUWING: " + msg);
}

// ---------- 0. Splits HTML en inline scripts ----------
const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const htmlParts = [];
let m, lastEnd = 0;
const jsBlocks = [];
while ((m = scriptRe.exec(raw)) !== null) {
  htmlParts.push(raw.slice(lastEnd, m.index));
  jsBlocks.push(m[1]);
  lastEnd = m.index + m[0].length;
}
htmlParts.push(raw.slice(lastEnd));
const htmlOnly = htmlParts.join("\n");

// ---------- 1. Tag-balans in de HTML zelf ----------
const voidTags = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\/?>/g;
const stack = [];
while ((m = tagRe.exec(htmlOnly)) !== null) {
  const full = m[0];
  const name = m[1].toLowerCase();
  if (voidTags.has(name)) continue;
  if (full.startsWith("<!--")) continue;
  if (full.endsWith("/>")) continue;
  if (full.startsWith("</")) {
    const top = stack.pop();
    if (top === undefined) {
      fail("Sluit-tag </" + name + "> zonder openings-tag.");
    } else if (top !== name) {
      fail("Verkeerde nesting: </" + name + "> sluit <" + top + "> (verwacht </" + top + ">).");
    }
  } else {
    stack.push(name);
  }
}
if (stack.length) fail("Niet-gesloten tags: " + stack.join(", "));

// ---------- 2. IIFE-balans binnen scripts ----------
// Callbacks zoals .forEach(function(){...}) zijn geen IIFEs. We tellen alleen
// echte IIFE-openingen "(function" die NIET als callback worden doorgegeven,
// door ze te matchen als zelfstandig statement. Sluitingen zijn "})();" varianten.
jsBlocks.forEach((js, i) => {
  if (!js.trim()) return;
  const stripped = js
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
  const opens = (stripped.match(/(?<![.\w])\(\s*function\b/g) || []).length;
  const closes = (stripped.match(/\}\s*\)\s*\(\s*\)/g) || []).length;
  if (opens !== closes) {
    fail("Scriptblok #" + (i + 1) + ": IIFE onevenwichtig (" + opens + "x opening vs " + closes + "x sluiting '})();" + "').");
  }
});

// ---------- 3. ID-referenties ----------
const idRefs = new Set();
jsBlocks.forEach(js => {
  const refRe = /\$\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)|getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/g;
  let r;
  while ((r = refRe.exec(js)) !== null) idRefs.add(r[1] || r[2]);
});
const idDefRe = /\bid="([A-Za-z0-9_-]+)"/g;
const definedIds = new Set();
while ((m = idDefRe.exec(raw)) !== null) definedIds.add(m[1]);

const dynamicPrefixes = ["tab-", "key_"];
let missing = 0;
for (const id of idRefs) {
  if (definedIds.has(id)) continue;
  if (dynamicPrefixes.some(p => id.startsWith(p))) continue;
  missing++;
  warn("$('" + id + "') aangeroepen maar id niet gedefinieerd in HTML (kan dynamisch zijn).");
}
if (missing > 0) {
  console.log(missing + " onbekende ID-referenties (waarschuwing, geen fout).");
}

console.log("Structuurcontrole " + file + ": " + (failures ? failures + " FOUT" : "OK") + " (" + definedIds.size + " id's, " + idRefs.size + " referenties, " + jsBlocks.length + " scriptblokken)");
process.exit(failures ? 1 : 0);

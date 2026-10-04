#!/usr/bin/env node
// Genereert de sectie-index van index.html: een lijst van alle top-level
// // ---- secties met hun regelnummers, als naslagwerk en om te controleren
// dat de documentatie (AGENTS.md / de inhoudsopgave in het script) synchroon
// loopt met de werkelijke code-indeling.
//
// Gebruik: node scripts/gen-section-index.js [html-bestand]
// Zonder argument wordt index.html in de repo-root gelezen.

const fs = require("fs");
const path = require("path");
const file = process.argv[2] || path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(file, "utf8");

const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
const blocks = [];
let m;
while ((m = re.exec(html)) !== null) blocks.push(m[1]);
const big = blocks.reduce((a, b) => (b.length > a.length ? b : a), "");
const lines = big.split("\n");

console.log("Sectie-index van " + path.basename(file) + " (" + lines.length + " regels in het grote scriptblok):");
console.log("");
let n = 0;
lines.forEach((l, i) => {
  if (!l.startsWith("// ----")) return;
  n++;
  const name = l.replace(/^\/\/\s*----\s*/, "").replace(/\s*----\s*$/, "");
  console.log(String(n).padStart(3) + ". regel " + String(i + 1).padStart(5) + "  " + name);
});
console.log("");
console.log(n + " secties. Houd deze indeling synchroon met de inhoudsopgave bovenaan het scriptblok.");

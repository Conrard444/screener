#!/usr/bin/env node
// Extraheert alle inline <script> blokken uit een HTML-bestand en controleert
// de JavaScript-syntax met de Function-constructor (equivalent aan node --check).
const fs = require("fs");

const file = process.argv[2];
if (!file) {
  console.error("Gebruik: node extract-and-check.js <html-bestand>");
  process.exit(1);
}

const html = fs.readFileSync(file, "utf8");
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, bad = 0;
while ((m = re.exec(html)) !== null) {
  const body = m[1].trim();
  if (!body) continue;
  i++;
  try {
    new Function(body);
  } catch (e) {
    bad++;
    console.error("SYNTAXFOUT in scriptblok #" + i + " van " + file + ": " + e.message);
  }
}
console.log(i + " inline scriptblok(ken) gecontroleerd in " + file + (bad ? " — " + bad + " FOUT" : " — OK"));
process.exit(bad ? 1 : 0);

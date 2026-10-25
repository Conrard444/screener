#!/usr/bin/env node
// Logische audit op de echte paginacode (via test-harnas.js): invarianten en
// randgevallen die statisch niet te zien zijn. Elke controle hieronder is een
// eigenschap die de app moet houden; faalt er één, dan is er een echte regressie.
//
// Aanleiding: de eigenaar vroeg een grondige logische test. Deze audit vond
// (en borgt) vier gaten die met de hand niet opvallen:
//  - weights() deelde door nul als alle vier de schuiven op 0 stonden -> NaN-score;
//  - etfWeights() gaf dan alle gewichten 0 -> elk fonds op de bodem;
//  - passesFilters(undefined) wierp een TypeError;
//  - een archief in een oudere opslagvorm (zonder 'etfs'-tak) stopte stil met bewaren.
// Draait mee in check-all.sh (en dus in CI en de pre-commit hook).
"use strict";
var harnas = require("./test-harnas");
var maakSandbox = harnas.maakSandbox;
var teller = harnas.maakChecker();
var check = teller.check;

var h = maakSandbox({});
var C = h.ctx;
// echte standaardweging uit de HTML (10/0/30/60); de stub zet sliderwaarden niet
h.el("wm").value = "10"; h.el("wv").value = "0"; h.el("wg").value = "30"; h.el("wq").value = "60";

var inBereik = function (v) { return v != null && !isNaN(v) && v >= 0 && v <= 100; };
var T = function (d) { return C.totalScore(d); };

// ---------------- A. Scoremethodiek
console.log("\nA. Scoremethodiek");
check("clampScore(null) = null", C.clampScore(null) === null);
check("clampScore(NaN) = null", C.clampScore(NaN) === null);
check("clampScore(-5) = 0", C.clampScore(-5) === 0);
check("clampScore(150) = 100", C.clampScore(150) === 100);
check("clampScore(50.6) = 51", C.clampScore(50.6) === 51);

var leeg = {};
// ontbrekende factordata valt terug op 40 (norm/pctRank-conventie in deze app), niet 50;
// belangrijkste invariant is dat de score bestaat en binnen de schaal blijft
check("totalScore({}) bestaat en is in 0..100", inBereik(T(leeg)), "werd " + T(leeg));
check("totalScore({}) valt terug op de factor-default (40)", T(leeg) === 40, "werd " + T(leeg));

var extreem = { pe: -999, roe: -500, margin: -900, revG: 5000, epsG: -5000, de: 999, chg: -99, dd: -99, pb: -1, peg: -1 };
check("totalScore(extreme waarden) in 0..100", inBereik(T(extreem)), "werd " + T(extreem));

var gezond = { chg: 3, mom1m: 8, pe: 18, pb: 3, revG: 12, epsG: 15, roe: 22, margin: 18, de: 0.4, piotroski: 8, roicSpread: 6, altmanZ: 4 };
check("totalScore(gezond aandeel) in 0..100", inBereik(T(gezond)), "werd " + T(gezond));
check("totalScore(gezond) > totalScore(extreem)", T(gezond) > T(extreem), T(gezond) + " vs " + T(extreem));

check("compounderScore({}) = 50", C.compounderScore({}) === 50, "werd " + C.compounderScore({}));
check("gecombineerdeScore({}) in 0..100", inBereik(C.gecombineerdeScore({})), "werd " + C.gecombineerdeScore({}));

check("retentieGraad zonder P/E = null", C.retentieGraad({ divYield: 2 }) === null);
check("retentieGraad 0% dividend = 100", C.retentieGraad({ pe: 20, divYield: 0 }) === 100);
check("retentieGraad 50% uitkering = 50", Math.round(C.retentieGraad({ pe: 20, divYield: 2.5 })) === 50, "werd " + C.retentieGraad({ pe: 20, divYield: 2.5 }));
check("retentieGraad zware uitkering klemt op 0", C.retentieGraad({ pe: 20, divYield: 10 }) === 0, "werd " + C.retentieGraad({ pe: 20, divYield: 10 }));

var w1 = C.weights();
check("weights() telt op tot 1", Math.abs(w1.wm + w1.wv + w1.wg + w1.wq - 1) < 1e-9, JSON.stringify(w1));
check("weights() met wv=0 geeft wv=0", w1.wv === 0, JSON.stringify(w1));

h.el("wm").value = "0"; h.el("wv").value = "0"; h.el("wg").value = "0"; h.el("wq").value = "0";
var w2 = C.weights();
check("weights() met alles 0 bevat geen NaN", !isNaN(w2.wm) && !isNaN(w2.wv) && !isNaN(w2.wg) && !isNaN(w2.wq), JSON.stringify(w2));
check("weights() met alles 0 valt terug op de standaardweging", Math.abs(w2.wm - 0.10) < 1e-9 && Math.abs(w2.wg - 0.30) < 1e-9 && Math.abs(w2.wq - 0.60) < 1e-9, JSON.stringify(w2));
check("totalScore bij wegingen alle 0 is geen NaN", inBereik(T(leeg)), "werd " + T(leeg));

h.el("wm").value = ""; h.el("wv").value = ""; h.el("wg").value = ""; h.el("wq").value = "";
var wLeeg = C.weights();
check("weights() met lege velden valt terug op de standaardweging", Math.abs(wLeeg.wq - 0.60) < 1e-9, JSON.stringify(wLeeg));

h.el("wm").value = "25"; h.el("wv").value = "25"; h.el("wg").value = "25"; h.el("wq").value = "25";

var dekLeeg = C.dekkingAandeel({});
check("dekkingAandeel({}) pct = 0", dekLeeg && dekLeeg.pct === 0, JSON.stringify(dekLeeg));
var dekVol = C.dekkingAandeel({ chg: 1, pe: 20, revG: 5, roe: 10 });
check("dekkingAandeel(alles aanwezig) pct = 100", dekVol && dekVol.pct === 100, JSON.stringify(dekVol));
check("dekkingAandeel(null) = null", C.dekkingAandeel(null) === null);
var dekEtf = C.dekkingEtf({});
check("dekkingEtf({}) pct = 0", dekEtf && dekEtf.pct === 0, JSON.stringify(dekEtf));
check("dekkingEtf(alleen ter) = 35%", C.dekkingEtf({ ter: 0.2 }).pct === 35, JSON.stringify(C.dekkingEtf({ ter: 0.2 })));

check("passesFilters({}) werpt niet", (function () { try { C.passesFilters({}); return true; } catch (e) { return false; } })());
check("passesFilters(undefined) werpt niet", (function () { try { C.passesFilters(undefined); return true; } catch (e) { return false; } })());

// ---------------- B. Opslag & datacache
console.log("\nB. Opslag, cache en historiek");
C.DATA_CACHE = {};
C.dataCachePut("AAPL", { symbol: "AAPL", pe: 20 });
var vers = C.dataCacheGet("aapl");
check("dataCacheGet is hoofdletterongevoelig", !!(vers && vers.pe === 20), JSON.stringify(vers));
check("cache-markering aanwezig", !!(vers && vers._uitCache === true));
C.DATA_CACHE.AAPL.ts = Date.now() - 13 * 60 * 60 * 1000;
check("cache ouder dan 12u is verlopen", C.dataCacheGet("AAPL") === null);
C.DATA_CACHE.MSFT = { ts: Date.now(), d: null };
check("cache zonder data geeft null", C.dataCacheGet("MSFT") === null);

var schoon = C.sanitizeHistory([
  { ts: 1, date: "2026-01-01", items: [{ symbol: "AAPL", pe: 20, score: 88, totaalscore: 88 }] },
  { ts: 2, date: "2026-01-02", items: [{ symbol: "MSFT", score: 70 }] },
  null,
  "rommel",
  { ts: 3, items: [{ symbol: "NVDA", roe: 30 }] }
]);
check("sanitizeHistory gooit rommel weg", schoon.length === 2, "werd " + schoon.length);
check("sanitizeHistory stript scores", !("score" in (schoon[0].items[0] || {})), JSON.stringify(schoon[0] && schoon[0].items && schoon[0].items[0]));
check("sanitizeHistory bewaart kerndata", (schoon[0].items[0] || {}).pe === 20);
check("sanitizeHistory verwijdert item zonder kernvelden", (schoon[0].items || []).length === 1, JSON.stringify(schoon[0] && schoon[0].items));
check("sanitizeHistory(niet-array) = []", C.sanitizeHistory(null).length === 0);

C.archiefBewaar("aandelen", [{ symbol: "AAPL", price: 100 }]);
C.archiefBewaar("aandelen", [{ symbol: "AAPL", price: 101 }, { symbol: "MSFT", price: 300 }]);
var archief = C.archiefLijst("aandelen");
check("archiefBewaar onbekende soort werpt niet", (function () { try { C.archiefBewaar("onbekend", [{ symbol: "X", price: 1 }]); return true; } catch (e) { return false; } })());
// oude opgeslagen vorm zonder 'etfs'-tak mag het opslaan niet stil blokkeren
C.ARCHIEF = { aandelen: { AAPL: { symbol: "AAPL", price: 1 } } };
C.archiefOpslaan();
check("archiefOpslaan werkt zonder 'etfs'-tak", !!h.opslag["kompas_archief"], "niets weggeschreven");
C.ARCHIEF = { aandelen: {}, etfs: {} };
check("archief dedupliceert op symbool", archief.length === 2, "werd " + archief.length);
check("archief bewaart de nieuwste meting", (archief.find(function (x) { return x.symbol === "AAPL"; }) || {}).price === 101, JSON.stringify(archief));

check("savePortfoliosCloud werkt zonder Firebase-SDK", (function () { try { C.savePortfoliosCloud(); return true; } catch (e) { return false; } })());
check("lokale portefeuille blijft bewaard zonder Firebase", !!h.opslag["kompas_portfolios"], "niets weggeschreven");

var e1 = C.estimateCalls(15, C.UNIVERSE_US.slice(0, 15));
var e2 = C.estimateCalls(75, C.UNIVERSE_US);
check("estimateCalls bevat geen NaN", !isNaN(e1.total) && !isNaN(e2.total), JSON.stringify([e1, e2]));
check("estimateCalls groeit met het universum", e2.total > e1.total, e1.total + " vs " + e2.total);

// ---------------- C. Weergave & formattering
console.log("\nC. Weergave-helpers");
check("fmt(null) = streepje", C.fmt(null) === "\u2014");
check("fmt(NaN) = streepje", C.fmt(NaN) === "\u2014");
check("signed(null) = streepje", C.signed(null) === "\u2014");
check("signed(1.234) = +1.2%", C.signed(1.234) === "+1.2%", C.signed(1.234));
check("num(null) = streepje", C.num(null, String) === "\u2014");

// ---------------- D. Ketens
console.log("\nD. Ketens");
check("sorteerOpScore sorteert aflopend", (function () {
  var r = C.sorteerOpScore([leeg, gezond]);
  return r[0] === gezond;
})());
check("sorteerOpScore([]) = []", C.sorteerOpScore([]).length === 0);
check("buildPeers([]) werpt niet", (function () { try { C.buildPeers([]); return true; } catch (e) { return false; } })());
check("kerngegevens bevat geen score-velden", (function () {
  var k = C.kerngegevens({ symbol: "AAPL", pe: 20, score: 80, totaalscore: 80, m: 70, v: 60, g: 50, q: 40, _src: "x" });
  return !("score" in k) && !("totaalscore" in k) && k.pe === 20;
})(), JSON.stringify(C.kerngegevens({ symbol: "AAPL", pe: 20, score: 80 })));

// ---------------- E. ETF's
console.log("\nE. ETF's");
h.el("ewc").value = "40"; h.el("ewd").value = "25"; h.el("ewl").value = "20"; h.el("ewt").value = "15";
var ew1 = C.etfWeights();
check("etfWeights() telt op tot 1", Math.abs(ew1.wc + ew1.wd + ew1.wl + ew1.wt - 1) < 1e-9, JSON.stringify(ew1));
h.el("ewc").value = "0"; h.el("ewd").value = "0"; h.el("ewl").value = "0"; h.el("ewt").value = "0";
var ew2 = C.etfWeights();
check("etfWeights() met alles 0 valt terug op de standaardweging", Math.abs(ew2.wc - 0.40) < 1e-9 && Math.abs(ew2.wt - 0.15) < 1e-9, JSON.stringify(ew2));
check("etfTotalScore({}) in 0..100", inBereik(C.etfTotalScore({})), "werd " + C.etfTotalScore({}));
check("etfCompounderScore({}) in 0..100", inBereik(C.etfCompounderScore({})), "werd " + C.etfCompounderScore({}));
check("etfGecombineerdeScore({}) in 0..100", inBereik(C.etfGecombineerdeScore({})), "werd " + C.etfGecombineerdeScore({}));
check("hefboomfonds krijgt compounderstraf", C.etfCompounderScore({ isLeveraged: true }) === 25, "werd " + C.etfCompounderScore({ isLeveraged: true }));
check("etfTotalScore(goedkoop fonds) > etfTotalScore(duur fonds)",
  C.etfTotalScore({ ter: 0.05, aum: 50, holdings: 500, return5Y: 12, sharpe: 1.2 }) >
  C.etfTotalScore({ ter: 1.5, aum: 50, holdings: 500, return5Y: 12, sharpe: 1.2 }));
h.el("ewc").value = "40"; h.el("ewd").value = "25"; h.el("ewl").value = "20"; h.el("ewt").value = "15";

// ---------------- F. Weergave met lege en onvolledige data
console.log("\nF. Weergave-robuustheid");
function werptNiet(fn) { try { fn(); return true; } catch (e) { return false; } }
C.CURRENT = []; C.SCORESET = null;
check("render() met lege lijst werpt niet", werptNiet(function () { C.render(); }), "render faalt op lege data");
C.SCORESET = [{}]; C.CURRENT = C.SCORESET;
check("render() met een leeg record werpt niet", werptNiet(function () { C.render(); }), "render faalt op onvolledig record");
C.SCORESET = [gezond]; C.CURRENT = C.SCORESET;
check("render() met volledig record werpt niet", werptNiet(function () { C.render(); }));
C.CURRENT = []; C.SCORESET = null;
C.ETF_CURRENT = [];
check("renderEtf() met lege lijst werpt niet", werptNiet(function () { C.renderEtf(); }));
C.ETF_CURRENT = [{}];
check("renderEtf() met een leeg fonds werpt niet", werptNiet(function () { C.renderEtf(); }));
C.ETF_CURRENT = [];
C.PORTFOLIO = [];
check("renderPortfolio() met lege lijst werpt niet", werptNiet(function () { C.renderPortfolio(); }));
C.PORTFOLIO = [{ symbol: "AAPL" }];
check("renderPortfolio() met een positie zonder cijfers werpt niet", werptNiet(function () { C.renderPortfolio(); }));
C.PORTFOLIO = [];
check("renderPfKiezer() werpt niet", werptNiet(function () { C.renderPfKiezer(); }));
check("archiefLeeftijd(null) = null", C.archiefLeeftijd(null) === null);

// ---------------- G. Broker-import (Saxo)
console.log("\nG. Broker-import (Saxo)");
C.PORTFOLIO = [];
var saxoRegels = [
  ["Symb.", "Aantal", "AK-krs", "Valutadatum", "ISIN", "Koers", "+/- koers %"],
  ["AAPL:xnas", "10", "150,5", "01-okt-2026", "US0378331005", "170", "5,2"],
  ["ASML:xams", "3", "600", "02-okt-2026", "NL0010273215", "650", "8,3"]
];
C.importSaxoRijen(saxoRegels);
var aapl = C.PORTFOLIO.filter(function (p) { return p.symbol === "AAPL"; })[0];
check("Saxo-import voegt twee posities toe", C.PORTFOLIO.length === 2, JSON.stringify(C.PORTFOLIO.map(function (p) { return p.symbol; })));
check("VS-ticker krijgt geen suffix", !!aapl);
check("aantal en aankoopkoers met decimale komma", !!(aapl && aapl.qty === 10 && aapl.buyPrice === 150.5), JSON.stringify(aapl));
check("ISIN wordt overgenomen", !!(aapl && aapl.isin === "US0378331005"), JSON.stringify(aapl && aapl.isin));
check("koers en rendement van de broker", !!(aapl && aapl.brokerPrice === 170 && aapl.brokerReturn === 5.2), JSON.stringify(aapl));
check("Europese beurs krijgt de juiste suffix", C.PORTFOLIO.some(function (p) { return p.symbol === "ASML.AS"; }), JSON.stringify(C.PORTFOLIO.map(function (p) { return p.symbol; })));
check("datum wordt ISO", !!(aapl && aapl.buyDate === "2026-10-01"), aapl && aapl.buyDate);
check("aandelenklasse BRKb -> BRK-B", C.saxoSymbolToTicker("BRKb:xnas") === "BRK-B", C.saxoSymbolToTicker("BRKb:xnas"));
check("CSV-parser houdt komma binnen quotes", C.parseCsvLine('"A, B",2').join("|") === "A, B|2", C.parseCsvLine('"A, B",2').join("|"));
C.importSaxoRijen([saxoRegels[0], saxoRegels[1]]);
check("tweede import dupliceert geen posities", C.PORTFOLIO.length === 2, "werd " + C.PORTFOLIO.length);
check("onbekend formaat geeft een duidelijke fout", (function () {
  try { C.importSaxoRijen([["Foo", "Bar"], ["1", "2"]]); return false; }
  catch (e) { return /onbekend Saxo-formaat/.test(e.message); }
})());
C.PORTFOLIO = [];

// ---------------- H. Archief laden uit een oudere opslagvorm
console.log("\nH. Archief laden");
C.ARCHIEF = { aandelen: {}, etfs: {} };
h.opslag["kompas_archief"] = JSON.stringify({ aandelen: { AAPL: { symbol: "AAPL", price: 1 } } });
C.archiefLaden().then(function () {
  check("archiefLaden vult een ontbrekende 'etfs'-tak aan", !!C.ARCHIEF.etfs, JSON.stringify(Object.keys(C.ARCHIEF)));
  check("archiefLaden bewaart de bestaande aandelen", C.archiefLijst("aandelen").length === 1);
  delete h.opslag["kompas_archief"];
  C.ARCHIEF = { aandelen: { AAPL: { symbol: "AAPL", price: 1 } } };
  C.archiefOpslaan();
  check("archiefOpslaan bewaart ook na het laden van een oude vorm", !!h.opslag["kompas_archief"], "niets weggeschreven");

  process.exit(teller.rapport("Logische audit") ? 1 : 0);
});

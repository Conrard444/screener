#!/usr/bin/env node
// Onafhankelijke herrekening van een accuratesserapport.
//
// Waarom dit bestaat: het rapport in de app telt datapunten, maar niet hoeveel
// onafhankelijke informatie er echt in zit. Eén aandeel dat tien keer gemeten is,
// levert tien punten en toch maar één stem. Deze tool leest de RUWE DATAPUNTEN uit
// een gekopieerd rapport en herrekent:
//   - de effectieve breedte (unieke effecten) en het aantal momentopnamen;
//   - correlaties gepoold EN per aandeel (één stem per aandeel);
//   - een cluster-bootstrap, zodat de onzekerheid klopt bij herhaalde metingen;
//   - de verdeling tussen aandelen versus binnen hetzelfde aandeel;
//   - of de scores reproduceerbaar zijn uit de factoren plus valstrik-korting;
//   - alternatieve formules op dezelfde data, inclusief de verleiding van een
//     omgekeerde factor (overfitting-signaal);
//   - of de steekproef groot genoeg is om een echt effect te kunnen zien.
//
// Gebruik:  node scripts/acc-replay.js rapport.txt [--gewichten 10,0,30,60]
//           node scripts/acc-replay.js --zelftest
"use strict";
var fs = require("fs");

var VELD = {
  sym: "sym", score: "score", mom: "mom", momentum: "mom",
  waard: "waard", waardering: "waard", groei: "groei",
  kwal: "kwal", kwaliteit: "kwal",
  rend: "rend", rendement: "rend", overrend: "over", overrendement: "over",
  dagen: "dagen", sector: "sector",
  "p/e": "pe", pe: "pe", "k/b": "pb", pb: "pb", peg: "peg", roe: "roe",
  omzetgr: "revg", winstgr: "epsg", piotroski: "piotroski", altmanz: "altmanz",
  divyld: "div", dividend: "div", valstrik: "trap"
};

function veldnaam(k) {
  var t = String(k).trim().toLowerCase().replace(/%/g, "").replace(/\s+/g, "");
  return VELD[t] || t;
}

function num(s) {
  var t = String(s == null ? "" : s).trim();
  if (!t) return null;
  var v = Number(t.replace(",", "."));
  return isFinite(v) ? v : null;
}

function isTicker(s) { return /^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(String(s || "").trim()); }

function parseRapport(tekst) {
  var regels = String(tekst || "").split(/\r?\n/);
  var kop = -1, kolommen = [];
  for (var i = 0; i < regels.length; i++) {
    var eerste = regels[i].split(";")[0].trim().toLowerCase();
    if (eerste === "sym" && /score/i.test(regels[i])) {
      kop = i;
      kolommen = regels[i].split(";").map(veldnaam);
      break;
    }
  }
  if (kop < 0) return { kolommen: [], rijen: [] };
  var rijen = [];
  for (var j = kop + 1; j < regels.length; j++) {
    var regel = regels[j];
    if (!regel.trim()) break;
    var delen = regel.split(";");
    if (delen.length < kolommen.length - 1) break;
    if (!isTicker(delen[0])) break;
    var r = {};
    kolommen.forEach(function (naam, k) {
      var rauw = delen[k] == null ? "" : delen[k];
      r[naam] = (naam === "sym" || naam === "sector") ? String(rauw).trim() : num(rauw);
    });
    if (r.sym && r.score != null) rijen.push(r);
  }
  return { kolommen: kolommen, rijen: rijen };
}

function mediaan(a) {
  var s = a.slice().sort(function (x, y) { return x - y; });
  if (!s.length) return null;
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function gem(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
function sd(a) {
  if (a.length < 2) return null;
  var m = gem(a);
  return Math.sqrt(a.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0) / (a.length - 1));
}
function pearson(x, y) {
  var mx = gem(x), my = gem(y), a = 0, b = 0, c = 0;
  for (var i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; }
  return (b && c) ? a / Math.sqrt(b * c) : null;
}
function rangen(a) {
  var idx = a.map(function (v, i) { return i; }).sort(function (i, j) { return a[i] - a[j]; });
  var r = new Array(a.length), i = 0;
  while (i < a.length) {
    var j = i;
    while (j + 1 < a.length && a[idx[j + 1]] === a[idx[i]]) j++;
    var g = (i + j) / 2 + 1;
    for (var k = i; k <= j; k++) r[idx[k]] = g;
    i = j + 1;
  }
  return r;
}
function spearman(x, y) { return pearson(rangen(x), rangen(y)); }
function tWaarde(r, n) { return (r == null || n < 3) ? null : r * Math.sqrt((n - 2) / (1 - r * r)); }

function perSymbool(rijen, velden) {
  var m = {};
  rijen.forEach(function (r) { (m[r.sym] = m[r.sym] || []).push(r); });
  return Object.keys(m).sort().map(function (s) {
    var g = m[s], o = { sym: s, n: g.length };
    velden.forEach(function (v) { o[v] = gem(g.map(function (r) { return r[v]; }).filter(function (x) { return x != null; })); });
    o.trap = gem(g.map(function (r) { return r.trap == null ? 0 : r.trap; }));
    return o;
  });
}

// deterministische bootstrap: hetzelfde rapport geeft altijd hetzelfde interval
function maakRandom(zaad) {
  var s = zaad || 12345;
  return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

function bootstrap(rond, rijen, symboolLijst, veld, reps) {
  var rnd = maakRandom(987654321), uit = [];
  for (var b = 0; b < reps; b++) {
    var sub = [];
    for (var k = 0; k < symboolLijst.length; k++) {
      var s = symboolLijst[Math.floor(rnd() * symboolLijst.length)];
      rijen.forEach(function (r) { if (r.sym === s) sub.push(r); });
    }
    var rr = rond(sub, veld);
    if (rr != null) uit.push(rr);
  }
  uit.sort(function (a, b) { return a - b; });
  if (!uit.length) return [null, null];
  return [uit[Math.floor(0.025 * uit.length)], uit[Math.floor(0.975 * uit.length)]];
}

function analyse(rijen, opties) {
  opties = opties || {};
  var uit = { waarschuwingen: [] };
  var syms = Object.keys(rijen.reduce(function (m, r) { m[r.sym] = 1; return m; }, {}));
  var factorVelden = ["score", "mom", "waard", "groei", "kwal"];
  uit.n = rijen.length;
  uit.uniek = syms.length;
  uit.puntenPerAandeel = rijen.length / syms.length;

  var dagen = {};
  rijen.forEach(function (r) { if (r.dagen != null) dagen[r.dagen] = (dagen[r.dagen] || 0) + 1; });
  uit.dagen = Object.keys(dagen).map(Number).sort(function (a, b) { return a - b; });
  uit.snapshots = uit.dagen.length;

  uit.gepoold = {};
  factorVelden.forEach(function (v) {
    var x = rijen.map(function (r) { return r[v]; });
    var rr = pearson(x, rijen.map(function (r) { return r.over; }));
    var rho = spearman(x, rijen.map(function (r) { return r.over; }));
    uit.gepoold[v] = { r: rr, rho: rho, t: tWaarde(rr, rijen.length) };
  });

  var per = perSymbool(rijen, factorVelden.concat(["over", "rend"]));
  uit.perAandeel = {};
  factorVelden.forEach(function (v) {
    var rr = pearson(per.map(function (p) { return p[v]; }), per.map(function (p) { return p.over; }));
    var rho = spearman(per.map(function (p) { return p[v]; }), per.map(function (p) { return p.over; }));
    uit.perAandeel[v] = { r: rr, rho: rho, t: tWaarde(rr, per.length) };
  });
  uit.per = per;

  uit.ci = {
    score: bootstrap(function (s) { return pearson(s.map(function (r) { return r.score; }), s.map(function (r) { return r.over; })); }, rijen, syms, "score", 2000),
    mom: bootstrap(function (s) { return pearson(s.map(function (r) { return r.mom; }), s.map(function (r) { return r.over; })); }, rijen, syms, "mom", 2000)
  };

  var tussen = 0, gemiddelde = gem(rijen.map(function (r) { return r.over; }));
  syms.forEach(function (s) {
    var g = rijen.filter(function (r) { return r.sym === s; });
    tussen += g.length * (gem(g.map(function (r) { return r.over; })) - gemiddelde) ** 2;
  });
  var totaal = rijen.reduce(function (a, r) { return a + (r.over - gemiddelde) ** 2; }, 0);
  uit.tussenAandeel = totaal ? 100 * tussen / totaal : null;

  uit.binnen = {};
  ["score", "mom"].forEach(function (v) {
    var x = [], y = [];
    syms.forEach(function (s) {
      var g = rijen.filter(function (r) { return r.sym === s; });
      if (g.length < 2) return;
      var mx = gem(g.map(function (r) { return r[v]; })), my = gem(g.map(function (r) { return r.over; }));
      g.forEach(function (r) { x.push(r[v] - mx); y.push(r.over - my); });
    });
    uit.binnen[v] = { r: pearson(x, y), n: x.length };
  });

  var gesorteerd = per.slice().sort(function (a, b) { return a.score - b.score; });
  var perKwartiel = per.length / 4;
  uit.kwartielen = [];
  for (var q = 0; q < 4; q++) {
    var g = gesorteerd.slice(Math.floor(q * perKwartiel), Math.floor((q + 1) * perKwartiel));
    if (!g.length) continue;
    uit.kwartielen.push({
      q: q + 1, n: g.length, scoreVan: g[0].score, scoreTot: g[g.length - 1].score,
      over: gem(g.map(function (p) { return p.over; })), rend: gem(g.map(function (p) { return p.rend; }))
    });
  }

  uit.traps = [0, 1, 2].map(function (t) {
    var g = per.filter(function (p) { return Math.round(p.trap) === t; });
    return g.length ? { trap: t, n: g.length, over: gem(g.map(function (p) { return p.over; })) } : null;
  }).filter(Boolean);

  var metDiv = rijen.filter(function (r) { return r.div != null && r.div > 0; });
  var correcties = rijen.map(function (r) { return (r.div || 0) * (r.dagen || 0) / 365; });
  var gemCorrectie = gem(correcties);
  // één regel per aandeel: hetzelfde aandeel komt meerdere keren in het rapport voor
  var verdachtMap = {};
  metDiv.forEach(function (r) {
    if (r.div > 8 && (!verdachtMap[r.sym] || r.div > verdachtMap[r.sym])) verdachtMap[r.sym] = r.div;
  });
  uit.dividend = {
    met: metDiv.length, zonder: rijen.length - metDiv.length,
    gemCorrectie: gemCorrectie,
    verdacht: Object.keys(verdachtMap).sort().map(function (s) { return s + " (" + verdachtMap[s] + "%)"; }),
    scoreGecorrigeerd: pearson(rijen.map(function (r) { return r.score; }),
      rijen.map(function (r, i) { return r.over + correcties[i] - gemCorrectie; }))
  };

  var w = opties.gewichten || [10, 0, 30, 60];
  var som = w[0] + w[1] + w[2] + w[3] || 1;
  uit.gewichten = w;
  uit.formule = [];
  rijen.forEach(function (r) {
    var basis = (w[0] * r.mom + w[1] * r.waard + w[2] * r.groei + w[3] * r.kwal) / som;
    r._basis = basis;
    r._rest = r.score - basis;
  });
  uit.formuleRest = [0, 1, 2].map(function (t) {
    var g = rijen.filter(function (r) { return Math.round(r.trap || 0) === t; });
    if (!g.length) return null;
    return { trap: t, n: g.length, rest: gem(g.map(function (r) { return r._rest; })),
      korting: gem(g.map(function (r) { return r._basis ? r.score / r._basis : null; })) };
  }).filter(Boolean);
  uit.scoreZonderKorting = pearson(rijen.map(function (r) { return r._basis; }), rijen.map(function (r) { return r.over; }));

  var rang = {};
  factorVelden.forEach(function (v) { rang[v] = rangen(rijen.map(function (r) { return r[v]; })).map(function (x) { return x / rijen.length; }); });
  var formules = {
    "score zoals gemeten": rang.score,
    "gelijk gewicht vier factoren": rang.mom.map(function (v, i) { return (v + rang.waard[i] + rang.groei[i] + rang.kwal[i]) / 4; }),
    "alleen momentum": rang.mom,
    "alleen kwaliteit": rang.kwal,
    "alleen groei": rang.groei,
    "alleen waardering": rang.waard,
    "momentum + waardering": rang.mom.map(function (v, i) { return (v + rang.waard[i]) / 2; }),
    "momentum + kwaliteit": rang.mom.map(function (v, i) { return (v + rang.kwal[i]) / 2; }),
    "kwaliteit + groei": rang.kwal.map(function (v, i) { return (v * 0.6 + rang.groei[i] * 0.3) / 0.9; }),
    "omgekeerd momentum": rang.mom.map(function (v) { return 1 - v; }),
    "omgekeerd groei": rang.groei.map(function (v) { return 1 - v; })
  };
  uit.alternatieven = Object.keys(formules).map(function (naam) {
    var c = formules[naam];
    var y = rijen.map(function (r) { return r.over; });
    var laag = [], hoog = [];
    var grensLaag = c.slice().sort(function (a, b) { return a - b; })[Math.floor(0.25 * (c.length - 1))];
    var grensHoog = c.slice().sort(function (a, b) { return a - b; })[Math.floor(0.75 * (c.length - 1))];
    c.forEach(function (v, i) { if (v >= grensHoog) hoog.push(y[i]); if (v <= grensLaag) laag.push(y[i]); });
    return { naam: naam, r: pearson(c, y), rho: spearman(c, y), spread: gem(hoog) - gem(laag), nHoog: hoog.length };
  }).sort(function (a, b) { return b.spread - a.spread; });

  uit.perDag = uit.dagen.map(function (d) {
    var g = rijen.filter(function (r) { return r.dagen === d; });
    // Splitsen op de mediaan en de namen die er precies op vallen buiten de
    // vergelijking laten. Een "hoogste helft" is bij een gelijke score op de grens
    // willekeurig: de ene sortering zette 38d op -0,8pp, de andere op +2,0pp.
    // Boven/onder de mediaan is dezelfde vraag zonder die willekeur.
    var med = mediaan(g.map(function (r) { return r.score; }));
    var hoog = g.filter(function (r) { return r.score > med; });
    var laag = g.filter(function (r) { return r.score < med; });
    if (hoog.length < 2 || laag.length < 2) {
      return { dagen: d, n: g.length, spread: null, winrate: null, teKlein: true,
        nHoog: hoog.length, nLaag: laag.length, gelijk: g.length - hoog.length - laag.length };
    }
    return {
      dagen: d, n: g.length, teKlein: false,
      nHoog: hoog.length, nLaag: laag.length,
      gelijk: g.length - hoog.length - laag.length,
      spread: gem(hoog.map(function (r) { return r.over; })) - gem(laag.map(function (r) { return r.over; })),
      winrate: Math.round(100 * hoog.filter(function (r) { return r.over >= 0; }).length / hoog.length)
    };
  }).sort(function (a, b) { return b.dagen - a.dagen; });

  uit.vereist = [0.05, 0.10, 0.15].map(function (r) {
    return { r: r, n: Math.ceil(((1.96 + 0.84) / r) ** 2 + 2) };
  });

  if (uit.uniek < 30) uit.waarschuwingen.push("minder dan 30 aandelen: elke conclusie per factor is te zwak.");
  if (uit.dividend.verdacht.length) uit.waarschuwingen.push("onwaarschijnlijke dividendrendementen: " + uit.dividend.verdacht.join(", ") + " (datafout, niet gebruiken).");
  if (uit.puntenPerAandeel > 2) uit.waarschuwingen.push("elk aandeel komt gemiddeld " + uit.puntenPerAandeel.toFixed(1) + " keer voor: de gepoolde n is geen onafhankelijke n.");
  return uit;
}

function tekstRapport(uit, meta) {
  var L = [];
  var f = function (v, d) { return v == null ? "-" : v.toFixed(d == null ? 3 : d); };
  L.push("HERREKENING ACCURATESSEMETING");
  L.push("");
  L.push("MEETKRACHT");
  L.push("  datapunten: " + uit.n + "   unieke effecten: " + uit.uniek + "   punten per aandeel: " + uit.puntenPerAandeel.toFixed(1));
  L.push("  momentopnamen (op houdperiode): " + uit.snapshots + "   houdperiodes: " + uit.dagen.join(", ") + " dagen");
  if (meta && meta.meetperiode && uit.dagen.length && Math.max.apply(null, uit.dagen) < meta.meetperiode) {
    L.push("  LET OP: de langste houdperiode (" + Math.max.apply(null, uit.dagen) + "d) is korter dan de meetperiode (" +
      meta.meetperiode + "d). Alle vensters eindigen dus op dezelfde dag: dit is een enkele koersbeweging,");
    L.push("  tien keer vanaf een ander startpunt bekeken, geen reeks onafhankelijke metingen.");
  }
  L.push("  variantie in overrendement: " + f(uit.tussenAandeel, 0) + "% zit tussen aandelen, " + f(100 - uit.tussenAandeel, 0) + "% binnen hetzelfde aandeel");
  L.push("");
  L.push("CORRELATIE MET OVERRENDEMENT    gepoold              per aandeel (1 stem)");
  ["score", "mom", "waard", "groei", "kwal"].forEach(function (v) {
    var g = uit.gepoold[v], p = uit.perAandeel[v];
    L.push("  " + v.padEnd(8) +
      ("r=" + f(g.r) + "  t=" + f(g.t, 2)).padEnd(20) +
      "r=" + f(p.r) + "  t=" + f(p.t, 2));
  });
  L.push("  95%-interval (bootstrap per aandeel): score [" + f(uit.ci.score[0]) + " ; " + f(uit.ci.score[1]) +
    "], momentum [" + f(uit.ci.mom[0]) + " ; " + f(uit.ci.mom[1]) + "]");
  L.push("  binnen hetzelfde aandeel: score r=" + f(uit.binnen.score.r) + ", momentum r=" + f(uit.binnen.mom.r));
  L.push("");
  L.push("KWARTIELEN OP AANDELENGEMIDDELDE");
  uit.kwartielen.forEach(function (k) {
    L.push("  Q" + k.q + " score " + f(k.scoreVan, 0) + "-" + f(k.scoreTot, 0) + "  n=" + k.n +
      "  overrendement " + f(k.over, 1) + "pp  rendement " + f(k.rend, 1) + "%");
  });
  L.push("");
  L.push("VALSTRIK (gemiddeld overrendement per aandeel)");
  uit.traps.forEach(function (t) { L.push("  niveau " + t.trap + ": n=" + t.n + "  " + f(t.over, 1) + "pp"); });
  L.push("");
  L.push("SCOREFORMULE (gewichten " + uit.gewichten.join("/") + ")");
  uit.formuleRest.forEach(function (r) {
    L.push("  trap " + r.trap + ": n=" + r.n + "  restscore " + f(r.rest, 1) +
      "  score/basis " + f(r.korting, 2) + (r.trap ? "  (dus " + f(100 - 100 * r.korting, 0) + "% korting)" : ""));
  });
  L.push("  factordeel zonder korting vs overrendement: r=" + f(uit.scoreZonderKorting) + " (totaalscore: " + f(uit.gepoold.score.r) + ")");
  L.push("");
  L.push("ALTERNATIEVE FORMULES (rangschikking, Q4-Q1 in overrendement)");
  uit.alternatieven.forEach(function (a) {
    L.push("  " + a.naam.padEnd(30) + " r=" + f(a.r) + "  rho=" + f(a.rho) + "  " + f(a.spread, 1) + "pp");
  });
  var beste = uit.alternatieven[0];
  if (beste && /omgekeerd/.test(beste.naam)) {
    L.push("  WAARSCHUWING: de best scorende formule is een omgekeerde factor. Dat past deze periode");
    L.push("  en is precies het overfitting-signaal: zo'n omkering is niet op deze data te rechtvaardigen.");
  }
  L.push("");
  L.push("CONSISTENTIE PER HOUDPERIODE (boven de mediaan minus onder de mediaan)");
  uit.perDag.forEach(function (d) {
    if (d.teKlein) {
      L.push("  " + String(d.dagen).padStart(3) + "d  n=" + String(d.n).padStart(3) +
        "  te weinig namen voor een hoog/laag-vergelijking");
      return;
    }
    L.push("  " + String(d.dagen).padStart(3) + "d  n=" + String(d.n).padStart(3) + "  spread " +
      (d.spread >= 0 ? "+" : "") + f(d.spread, 1) + "pp  winrate hoog " + d.winrate + "%" +
      (d.gelijk ? "   (" + d.gelijk + " op de mediaan buiten beschouwing)" : ""));
  });
  var spreads = uit.perDag.filter(function (d) { return d.spread != null; }).map(function (d) { return d.spread; });
  if (spreads.length > 1) {
    var sdS = sd(spreads);
    L.push("  gemiddeld " + f(gem(spreads), 2) + "pp, sd " + f(sdS, 2) +
      (sdS ? ", t=" + f(gem(spreads) / (sdS / Math.sqrt(spreads.length)), 2) : "") +
      "  (" + spreads.filter(function (s) { return s > 0; }).length + "/" + spreads.length + " positief)");
    L.push("  Let op: de houdperiodes delen dezelfde einddatum en overlappen, dus deze t is te optimistisch.");
  }
  L.push("");
  L.push("DIVIDEND");
  L.push("  " + uit.dividend.met + " punten met dividend, " + uit.dividend.zonder + " zonder; gemiddelde correctie " +
    f(uit.dividend.gemCorrectie, 2) + "pp");
  L.push("  score vs gecorrigeerd overrendement: r=" + f(uit.dividend.scoreGecorrigeerd));
  L.push("");
  L.push("STATISTISCHE KRACHT");
  uit.vereist.forEach(function (v) {
    L.push("  IC " + v.r.toFixed(2) + " met 80% kans vinden: ~" + v.n + " onafhankelijke waarnemingen (nu " + uit.uniek + ")");
  });
  var genoeg = uit.uniek >= 786 && uit.snapshots >= 12;
  L.push("");
  L.push("OORDEEL: " + (genoeg
    ? "de steekproef is groot genoeg om een effect van 0,10 te kunnen zien; toets een nieuwe weging op een holdout."
    : "NOG NIET TE ZEGGEN. " + uit.uniek + " aandelen in " + uit.snapshots +
      " overlappende vensters is te weinig om een weging te verantwoorden."));
  if (uit.waarschuwingen.length) {
    L.push("");
    uit.waarschuwingen.forEach(function (w) { L.push("  ! " + w); });
  }
  return L.join("\n");
}

function leesMeta(tekst) {
  var m = /meetperiode:\s*(\d+)\s*dagen/i.exec(tekst || "");
  var w = /weging bij meting:\s*momentum\s*(\d+)[^\d]+waardering\s*(\d+)[^\d]+groei\s*(\d+)[^\d]+kwaliteit\s*(\d+)/i.exec(tekst || "");
  return {
    meetperiode: m ? +m[1] : null,
    gewichten: w ? [+w[1], +w[2], +w[3], +w[4]] : null
  };
}

function zelftest() {
  var voorbeeld = [
    "MEETOPZET",
    "  meetperiode: 120 dagen (oudste momentopname)",
    "  weging bij meting: momentum 10, waardering 0, groei 30, kwaliteit 60",
    "  sym; score; mom; waard; groei; kwal; rend%; overrend%; dagen; sector; P/E; K/B; PEG; ROE; omzetgr; winstgr; Piotroski; AltmanZ; divYld%; valstrik",
    "  AAA; 80; 50; 60; 70; 90; 5.0; 1.0; 40; Technologie; 20; 3; 1; 20; 10; 12; 7; 3; ; 0",
    "  AAA; 79; 45; 60; 70; 90; -2.0; -3.0; 20; Technologie; 20; 3; 1; 20; 10; 12; 7; 3; ; 0",
    "  BBB; 30; 40; 55; 10; 40; -8.0; -5.0; 40; Nuts; 15; 2; 1; 8; 4; 3; 5; 2; 1.2; 2",
    "  BBB; 31; 48; 55; 10; 40; 1.0; 2.0; 20; Nuts; 15; 2; 1; 8; 4; 3; 5; 2; 1.2; 2",
    "  CCC; 55; 30; 70; 50; 60; 3.0; 0.5; 40; Financieel; 12; 1.5; 0.8; 15; 6; 8; 6; 2; ; 1",
    "  VOORBEHOUD",
    "  - tekst die geen datapunt is"
  ].join("\n");
  var g = parseRapport(voorbeeld);
  var meta = leesMeta(voorbeeld);
  var fouten = [];
  if (g.rijen.length !== 5) fouten.push("parser vond " + g.rijen.length + " rijen, verwacht 5");
  if (g.kolommen.length !== 20) fouten.push("parser vond " + g.kolommen.length + " kolommen, verwacht 20");
  var a = analyse(g.rijen, { gewichten: meta.gewichten });
  if (a.uniek !== 3) fouten.push("uniek=" + a.uniek + ", verwacht 3");
  if (a.snapshots !== 2) fouten.push("snapshots=" + a.snapshots + ", verwacht 2");
  var tekst = tekstRapport(a, meta);
  ["MEETKRACHT", "unieke effecten: 3", "OORDEEL", "NOG NIET TE ZEGGEN"].forEach(function (must) {
    if (tekst.indexOf(must) < 0) fouten.push("rapport mist: " + must);
  });
  if (fouten.length) {
    console.log("ZELFTEST MISLUKT:\n  - " + fouten.join("\n  - "));
    return 1;
  }
  console.log("Zelftest acc-replay: OK (parser, analyse en oordeel)");
  return 0;
}

function main() {
  var args = process.argv.slice(2);
  if (args.indexOf("--zelftest") > -1) return process.exit(zelftest());
  var bestand = args.filter(function (a) { return a.indexOf("--") !== 0; })[0];
  if (!bestand) {
    console.log("Gebruik: node scripts/acc-replay.js rapport.txt [--gewichten 10,0,30,60]");
    console.log("         node scripts/acc-replay.js --zelftest");
    return process.exit(1);
  }
  var tekst;
  try { tekst = fs.readFileSync(bestand, "utf8"); }
  catch (e) { console.error("Kan " + bestand + " niet lezen: " + e.message); return process.exit(2); }

  var g = parseRapport(tekst);
  if (!g.rijen.length) {
    console.error("Geen RUWE DATAPUNTEN gevonden. Kopieer het rapport inclusief de regel met 'sym; score; ...'.");
    return process.exit(2);
  }
  var meta = leesMeta(tekst);
  var i = args.indexOf("--gewichten");
  var gewichten = meta.gewichten;
  if (i > -1 && args[i + 1]) {
    gewichten = args[i + 1].split(",").map(function (x) { return num(x) || 0; });
    if (gewichten.length !== 4 || !gewichten.some(Boolean)) gewichten = meta.gewichten;
  }
  var uit = analyse(g.rijen, { gewichten: gewichten });
  console.log(tekstRapport(uit, meta));
  return process.exit(0);
}

if (require.main === module) main();

module.exports = {
  parseRapport: parseRapport, analyse: analyse, tekstRapport: tekstRapport,
  leesMeta: leesMeta, zelftest: zelftest
};

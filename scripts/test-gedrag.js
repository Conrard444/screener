#!/usr/bin/env node
// Gedragstest op de echte paginacode (via test-harnas.js): test ketens die
// statisch niet te controleren zijn.
//
// Aanleiding (twee storingen, beide hier gereproduceerd voordat ze gefixt werden):
//  1. S&P 500 leverde "Geen enkel aandeel kon opgehaald worden ... HTTP 401 (finnhub)".
//     De vooranalyse-trechter (universa > 60) haalde de koers met het verborgen losse
//     sleutelveld #apikey; sleutels uit Instellingen/cloud staan in MULTI_KEYS, dus elk
//     aandeel kreeg een leeg token. Kleine universa (zonder trechter) liepen wel.
//  2. Portefeuilles leken niet uit Firestore te laden. loadCloud() verving PORTFOLIOS
//     maar niet de werkkopie PORTFOLIO, waarna pfSync() de geladen posities overschreef
//     met de oude lokale lijst.
// Draait mee in check-all.sh (en dus in CI en de pre-commit hook).
"use strict";
var harnas = require("./test-harnas");
var maakSandbox = harnas.maakSandbox;
var maakFetch = harnas.maakFetch;
var wachtTot = harnas.wachtTot;
var statusTekst = harnas.statusTekst;
var teller = harnas.maakChecker();
var check = teller.check;

// ---------------------------------------------------------------- screening
function screening(velden, keys, losseSleutel) {
  var log = [];
  var h = maakSandbox({ velden: velden, fetch: maakFetch(log) });
  Object.assign(h.ctx.MULTI_KEYS, keys);
  h.el("multiSource").checked = true;
  h.el("apikey").value = losseSleutel;
  h.el("source").value = "finnhub";
  h.ctx.OPHAALPOOL.MAX_PER_MIN = 1e9;   // test: de echte 60s-limiet zou minuten wachten
  h.ctx.run();
  return wachtTot(function () {
    return /Klaar|Geen enkel aandeel|Limiet van je|voldoen aan deze filters/.test(statusTekst(h));
  }, 30000).then(function () {
    var quotes = log.filter(function (u) { return u.indexOf("/quote?") > -1; });
    return {
      tekst: statusTekst(h),
      quotes: quotes.length,
      leegToken: quotes.filter(function (u) { return /[?&]token=($|&)/.test(u); }).length
    };
  });
}

// -------------------------------------------------------------- portefeuille
function portfolio(naam, lokaal, lokaleTs, cloud) {
  var h = maakSandbox({});
  h.opslag["kompas_portfolios"] = JSON.stringify({ actief: "eigen", lijsten: lokaal, ts: lokaleTs });
  h.ctx.LS_PORTFOLIO_TS = lokaleTs;
  h.ctx.PORTFOLIOS = JSON.parse(JSON.stringify(lokaal));
  h.ctx.PORTFOLIO = h.ctx.PORTFOLIOS.eigen.posities;
  var geschreven = [];
  h.ctx.FB.user = { uid: "u1", displayName: "Test" };
  h.ctx.FB.ready = true;
  h.ctx.FB.db = {
    collection: function () {
      return { doc: function () { return {
        get: function () { return Promise.resolve({ exists: true, data: function () { return { portfoliosJson: cloud }; } }); },
        set: function (lading) { geschreven.push(lading); return Promise.resolve(); }
      }; } };
    }
  };
  h.ctx.loadCloud();
  return wachtTot(function () {
    return geschreven.length > 0 || (h.ctx.PORTFOLIOS.eigen.posities || []).length > 0;
  }, 3000).then(function () {
    return {
      naam: naam,
      posities: (h.ctx.PORTFOLIOS.eigen.posities || []).length,
      wisteCloud: geschreven.some(function (l) {
        return l && l.portfoliosJson && ((l.portfoliosJson.lijsten.eigen || {}).posities || []).length === 0;
      })
    };
  });
}

// ------------------------------------------------- herhaalde screening
// Dezelfde screening twee keer achter elkaar: de tweede run hoort de koersen uit
// KOERSCACHE te halen en de pool mag alleen boekhouden wat er echt gebeurt.
function herhaaldeScreening() {
  var log = [];
  var h = maakSandbox({ velden: { exchange: "SP500" }, fetch: maakFetch(log) });
  Object.assign(h.ctx.MULTI_KEYS, { finnhub: "FINNHUB-KEY", eodhd: "", fmp: "", eulerpool: "" });
  h.el("multiSource").checked = true;
  h.el("source").value = "finnhub";
  h.ctx.OPHAALPOOL.MAX_PER_MIN = 1e9;
  function eenRun() {
    h.el("status").textContent = "";
    h.el("status").innerHTML = "";
    h.ctx.run();
    return wachtTot(function () {
      return /Klaar|Geen enkel aandeel/.test(statusTekst(h));
    }, 30000);
  }
  return eenRun().then(function () {
    var eerste = log.length;
    h.ctx.OPHAALPOOL.reset();
    return eenRun().then(function () {
      return {
        eerste: eerste,
        tweede: log.length - eerste,
        stempels: h.ctx.OPHAALPOOL.stempels.length,
        tekst: statusTekst(h)
      };
    });
  });
}

function main() {
  var finnhub = { finnhub: "FINNHUB-KEY", eodhd: "", fmp: "", eulerpool: "" };
  var reeks = [];

  reeks.push(screening({ exchange: "SP500" }, finnhub, "").then(function (r) {
    console.log("\n[S&P 500, sleutel alleen in Instellingen/MULTI_KEYS]");
    console.log("  calls: " + r.quotes + " quote-calls, " + r.leegToken + " met leeg token");
    console.log("  status: " + r.tekst.replace(/\s+/g, " ").slice(0, 150));
    check("S&P 500 haalt aandelen binnen", /Klaar/.test(r.tekst), r.tekst.slice(0, 200));
    check("vooranalyse gebruikt de sleutel uit MULTI_KEYS", r.leegToken === 0, r.leegToken + " calls met leeg token");
  }));

  reeks.push(screening({ exchange: "US_SMALL" }, finnhub, "").then(function (r) {
    console.log("\n[VS compact, sleutel alleen in Instellingen/MULTI_KEYS]");
    console.log("  status: " + r.tekst.replace(/\s+/g, " ").slice(0, 150));
    check("VS compact haalt aandelen binnen", /Klaar/.test(r.tekst), r.tekst.slice(0, 200));
  }));

  reeks.push(screening({ exchange: "SP500" }, finnhub, "FINNHUB-KEY").then(function (r) {
    console.log("\n[S&P 500, sleutel ook in het losse veld]");
    console.log("  status: " + r.tekst.replace(/\s+/g, " ").slice(0, 150));
    check("losse-sleutelmodus blijft werken", /Klaar/.test(r.tekst), r.tekst.slice(0, 200));
  }));

  var leeg = { eigen: { naam: "Mijn portefeuille", posities: [] } };
  var gevuld = { eigen: { naam: "Mijn portefeuille", posities: [{ symbol: "MSFT", qty: 1 }] } };
  reeks.push(portfolio("cloud gevuld, lokaal leeg, lokale ts nieuwer", leeg, 2000,
    { actief: "eigen", lijsten: { eigen: { naam: "Mijn portefeuille", posities: [{ symbol: "AAPL", qty: 1 }] } }, bijgewerkt: 1000 })
    .then(function (r) {
      console.log("\n[" + r.naam + "] posities: " + r.posities);
      check("lege lokale lijst neemt de cloud-portefeuille over", r.posities === 1, "werd " + r.posities);
      check("lege lokale lijst overschrijft de cloud niet", !r.wisteCloud);
    }));

  reeks.push(portfolio("cloud nieuwer dan lokaal", gevuld, 1000,
    { actief: "eigen", lijsten: { eigen: { naam: "Mijn portefeuille", posities: [{ symbol: "AAPL", qty: 2 }, { symbol: "NVDA", qty: 3 }] } }, bijgewerkt: 2000 })
    .then(function (r) {
      console.log("\n[" + r.naam + "] posities: " + r.posities);
      check("nieuwere cloud-lijst wordt geladen", r.posities === 2, "werd " + r.posities);
      check("cloud wordt niet met de lokale lijst overschreven", !r.wisteCloud);
    }));

  reeks.push(portfolio("lokaal nieuwer dan cloud", gevuld, 3000,
    { actief: "eigen", lijsten: { eigen: { naam: "Mijn portefeuille", posities: [{ symbol: "AAPL", qty: 2 }] } }, bijgewerkt: 2000 })
    .then(function (r) {
      console.log("\n[" + r.naam + "] posities: " + r.posities);
      check("nieuwere lokale lijst blijft leidend", r.posities === 1, "werd " + r.posities);
    }));

  reeks.push(portfolio("lege cloud, gevulde lokale lijst", gevuld, 1000,
    { actief: "eigen", lijsten: { eigen: { naam: "Mijn portefeuille", posities: [] } }, bijgewerkt: 5000 })
    .then(function (r) {
      console.log("\n[" + r.naam + "] posities: " + r.posities);
      check("een lege cloud wist de lokale posities niet", r.posities === 1, "werd " + r.posities);
    }));

  reeks.push(herhaaldeScreening().then(function (r) {
    console.log("\n[twee keer dezelfde S&P 500-screening]");
    console.log("  calls: eerste run " + r.eerste + ", tweede run " + r.tweede +
      ", geboekt in de pool " + r.stempels);
    check("tweede run haalt de vooranalyse uit de koerscache", r.tweede < r.eerste / 2,
      r.tweede + " calls tegen " + r.eerste);
    check("de pool boekt alleen wat er echt gebeurt", r.stempels === 75, "geboekt: " + r.stempels);
    check("tweede run levert nog steeds aandelen", /Klaar/.test(r.tekst), r.tekst.slice(0, 200));
  }));

  return Promise.all(reeks).then(function () {
    process.exit(teller.rapport("Gedragstest") ? 1 : 0);
  });
}

try { main(); }
catch (e) { console.error("Gedragstest kon niet draaien: " + (e && e.stack || e)); process.exit(2); }

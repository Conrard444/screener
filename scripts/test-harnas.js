#!/usr/bin/env node
// Gedeeld testharnas voor de gedrags- en logica-tests.
//
// Waarom dit bestaat: de tests moeten de ECHTE paginacode uitvoeren, niet een
// nagemaakte kopie. Dit harnas leest de inline <script>-blokken uit index.html en
// laadt ze in een vm met stubs voor DOM, opslag, Firebase en fetch. Zo lopen de
// tests door dezelfde code als de browser, zonder netwerk of browser.
//
// Eén module voor beide tests: wijzigingen aan de stubs (nieuwe DOM-methode, ander
// opslaggedrag) hoeven zo maar op één plek te gebeuren. Draait mee in check-all.sh.
"use strict";
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var INDEX = path.join(__dirname, "..", "index.html");

// standaardwaarden voor de velden die de screener uitleest
var VELDEN = {
  exchange: "US_ALL", limit: "25", mode: "stijgers", horizon: "kort", mcap: "0", pemax: "40",
  divYieldMin: "0", altmanZMin: "1.81", piotroskiMin: "0", typeFilter: "alles",
  source: "finnhub", apikey: "", colPreset: "alles"
};

function scriptBlokken(html) {
  var blokken = [], re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, m;
  while ((m = re.exec(html))) blokken.push(m[1]);
  return blokken;
}

function maakElement(id) {
  var leeg = function () { return null; };
  return {
    id: id || "", value: "", checked: false, textContent: "", innerHTML: "",
    className: "", title: "", disabled: false, dataset: {}, options: [], selectedIndex: 0,
    style: { display: "", cssText: "", setProperty: function () {}, removeProperty: function () {} },
    children: [], firstChild: null,
    parentNode: {
      style: {},
      classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
      appendChild: function () {}, removeChild: function () {}, querySelector: leeg, querySelectorAll: function () { return []; }
    },
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    addEventListener: function () {}, removeEventListener: function () {},
    appendChild: function (c) { this.children.push(c); return c; },
    insertBefore: function (c) { this.children.push(c); return c; },
    removeChild: function () {}, remove: function () {}, focus: function () {}, blur: function () {}, click: function () {},
    scrollIntoView: function () {}, getAttribute: leeg, setAttribute: function () {},
    removeAttribute: function () {}, hasAttribute: function () { return false; }, contains: function () { return false; },
    querySelector: leeg, querySelectorAll: function () { return []; }, closest: leeg,
    offsetWidth: 0, offsetHeight: 0
  };
}

function maakSandbox(opties) {
  opties = opties || {};
  var velden = Object.assign({}, VELDEN, opties.velden || {});
  var elementen = {}, opslag = {};
  function el(id) {
    if (!elementen[id]) {
      var e = maakElement(id);
      if (Object.prototype.hasOwnProperty.call(velden, id)) e.value = velden[id];
      elementen[id] = e;
    }
    return elementen[id];
  }
  var document = {
    getElementById: el,
    createElement: function (tag) { return maakElement("nieuw_" + tag); },
    createTextNode: function (t) { return { textContent: t }; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {}, removeEventListener: function () {},
    body: maakElement("body"), documentElement: maakElement("html"), head: maakElement("head"),
    readyState: "complete", title: "test"
  };
  var opslagApi = {
    getItem: function (k) { return opslag[k] != null ? opslag[k] : null; },
    setItem: function (k, v) { opslag[k] = String(v); },
    removeItem: function (k) { delete opslag[k]; },
    clear: function () { opslag = {}; },
    key: function (i) { return Object.keys(opslag)[i] || null; },
    get length() { return Object.keys(opslag).length; }
  };
  var sandbox = {
    console: {
      log: function () {}, info: function () {}, debug: function () {},
      warn: function () {},
      error: function () { if (opties.debug) console.error.apply(console, arguments); }
    },
    document: document, localStorage: opslagApi, sessionStorage: opslagApi,
    navigator: { userAgent: "node-test", language: "nl-BE" },
    location: { href: "https://example.test/", hostname: "example.test", origin: "https://example.test", protocol: "https:" },
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
    Promise: Promise, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array, String: String,
    Number: Number, Boolean: Boolean, RegExp: RegExp, Error: Error, isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
    fetch: opties.fetch || function () { return Promise.reject(new Error("geen fetch-stub")); },
    alert: function () {}, confirm: function () { return true; }, prompt: function () { return null; },
    matchMedia: function () { return { matches: false, addEventListener: function () {}, addListener: function () {} }; },
    requestAnimationFrame: function (f) { return setTimeout(f, 0); },
    Notification: function () { this.close = function () {}; },
    gtag: function () {}, performance: { now: function () { return Date.now(); } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  var ctx = vm.createContext(sandbox);
  scriptBlokken(fs.readFileSync(INDEX, "utf8")).forEach(function (code, i) {
    vm.runInContext(code, ctx, { filename: "index.html#script" + (i + 1) });
  });
  return { ctx: ctx, el: el, opslag: opslag };
}

function resp(status, body) {
  return {
    ok: status >= 200 && status < 300, status: status,
    statusText: status === 401 ? "Unauthorized" : status === 429 ? "Too Many Requests" : "OK",
    text: function () { return Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)); }
  };
}

function wachtTot(fn, ms) {
  var tot = Date.now() + (ms || 20000);
  return new Promise(function (resolve) {
    (function lus() {
      var klaar = false;
      try { klaar = fn(); } catch (e) {}
      if (klaar || Date.now() > tot) return resolve(klaar);
      setTimeout(lus, 25);
    })();
  });
}

// realistische stub-responsen: 401 zonder token, geldige cijfers met token.
// Dezelfde respons voor elke ticker is genoeg: de tests toetsen de keten, niet de data.
function maakFetch(log) {
  return function (url) {
    log.push(url);
    var u = String(url);
    var token = (/[?&]token=([^&]*)/.exec(u) || [])[1];
    if (u.indexOf("finnhub.io") > -1) {
      if (!token) return Promise.resolve(resp(401, { error: "Invalid API key." }));
      if (u.indexOf("/quote?") > -1) return Promise.resolve(resp(200, { c: 100, dp: 1.2, h: 110, l: 90, pc: 98.8 }));
      return Promise.resolve(resp(200, { metric: {
        peTTM: 20, pbAnnual: 3, roeTTM: 18, netProfitMarginTTM: 20,
        revenueGrowthTTMYoy: 8, epsGrowthTTMYoy: 10, marketCapitalization: 50000,
        "52WeekHigh": 110, "52WeekLow": 80, "totalDebt/totalEquityQuarterly": 0.4
      } }));
    }
    if (u.indexOf("securitiesdb.com") > -1) {
      if (u.indexOf("/quant-health") > -1) return Promise.resolve(resp(200, { data: {
        ticker: "X",
        valuation: { pe_ratio: 20, price_to_book: 3, pe_vs_historical_pct: -5 },
        profitability: { net_margin: 0.2 },
        value_creation: { roic: 0.15, roic_wacc_spread: 0.05 },
        growth: { revenue_growth_yoy: 0.1, earnings_growth_yoy: 0.12 },
        leverage: { debt_to_equity: 0.4 }, risk: { volatility_annual: 0.2 },
        scores: { piotroski_f: 7, altman_z: 3.2, altman_z_zone: "safe" }
      } }));
      if (u.indexOf("/dcf") > -1) return Promise.resolve(resp(200, { data: { current_price: 100, dcf: { fair_value: 110, upside_pct: 10 } } }));
      return Promise.resolve(resp(200, { data: {} }));
    }
    return Promise.resolve(resp(200, { data: {} }));
  };
}

function statusTekst(h) {
  var e = h.el("status");
  return (e.textContent || "") + " " + (e.innerHTML || "");
}

// teller + rapport in één vorm, zodat beide tests identiek rapporteren
function maakChecker() {
  var geslaagd = 0, gefaald = 0;
  return {
    check: function (naam, voorwaarde, detail) {
      if (voorwaarde) { geslaagd++; console.log("  OK   " + naam); }
      else { gefaald++; console.log("  FAAL " + naam + (detail ? "\n       " + detail : "")); }
    },
    rapport: function (titel) {
      console.log("\n" + titel + ": " + geslaagd + " geslaagd, " + gefaald + " gefaald");
      return gefaald;
    }
  };
}

module.exports = {
  INDEX: INDEX, VELDEN: VELDEN,
  scriptBlokken: scriptBlokken, maakElement: maakElement, maakSandbox: maakSandbox,
  resp: resp, wachtTot: wachtTot, maakFetch: maakFetch, statusTekst: statusTekst,
  maakChecker: maakChecker
};

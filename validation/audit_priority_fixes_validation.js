"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..");

function testLaboIsolation() {
  var session = { labo_id: "LAB-A", is_admin: false, admin_labos: null };
  var storage = {};
  var sandbox = {
    window: null,
    document: {
      getElementById: function () { return null; },
      querySelector: function () { return null; }
    },
    localStorage: {
      getItem: function (k) { return storage[k] || null; },
      setItem: function (k, v) { storage[k] = String(v); },
      removeItem: function (k) { delete storage[k]; }
    },
    navigator: { onLine: true },
    setTimeout: function () {}, Promise: Promise,
    CAEKOperateurs: {
      session: function () { return session; },
      isAdmin: function () { return session.is_admin; },
      adminLabos: function () { return session.admin_labos; }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "labofilter.js"), "utf8"), sandbox);

  assert.strictEqual(sandbox.CAEKLaboFilter.match("LAB-A"), true, "opérateur: son labo");
  assert.strictEqual(sandbox.CAEKLaboFilter.match("LAB-B"), false, "opérateur: labo étranger masqué");
  assert.strictEqual(sandbox.CAEKLaboFilter.match(""), false, "opérateur: donnée non scopée masquée");

  session = { labo_id: "LAB-A", is_admin: true, admin_labos: ["LAB-A"] };
  assert.strictEqual(sandbox.CAEKLaboFilter.match("LAB-A"), true, "ingénieur scopé: labo autorisé");
  assert.strictEqual(sandbox.CAEKLaboFilter.match("LAB-B"), false, "ingénieur scopé: labo étranger masqué");

  session = { labo_id: null, is_admin: true, admin_labos: null };
  assert.strictEqual(sandbox.CAEKLaboFilter.match("LAB-B"), true, "admin principal: vue globale");
}

function sourceGuards() {
  var validation = fs.readFileSync(path.join(ROOT, "js", "validation.js"), "utf8");
  var compression = fs.readFileSync(path.join(ROOT, "js", "compression.js"), "utf8");
  var medias = fs.readFileSync(path.join(ROOT, "js", "medias.js"), "utf8");
  var coulages = fs.readFileSync(path.join(ROOT, "js", "coulages.js"), "utf8");
  assert(validation.includes("Résultat précédent du même coulage"), "contexte du jalon précédent absent");
  assert(validation.includes("Camion / toupie") && validation.includes("BL :"), "BL/camion absents de la validation");
  assert(compression.includes("Centrale") && compression.includes("N° BL") && compression.includes("provenanceDuLot"), "provenance absente de l'historique/export");
  assert(!medias.includes('headers: headers({ "Content-Type": (blob && blob.type) || "application/octet-stream", "x-upsert": "true" })'), "ancien upsert anonyme encore actif");
  assert(medias.includes('action: "upload"') && medias.includes("mediaRegister"), "upload authentifié non câblé");
  assert(coulages.includes("_pushChains") && coulages.includes("existing._version"), "sérialisation/version locale absente");
}

testLaboIsolation();
sourceGuards();
console.log("OK — correctifs prioritaires audit (isolation, jalons, provenance, médias, versions)");

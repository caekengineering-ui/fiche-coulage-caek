/* ============================================================================
   Script de VALIDATION FONCTIONNELLE — synchronisation du BASSIN (lots).

   Objet : exercer l'arbitrage du merge de js/lots_sync.js (pull) :
     S1  une clé bloquée dans la file d'attente n'empêche PLUS de recevoir
         l'état du serveur quand celui-ci est plus avancé (le bug : un lot
         sorti du bassin par un collègue restait affiché « en retard ») ;
     S2  une copie locale plus avancée que le serveur n'est jamais écrasée
         (les résultats d'essai saisis hors ligne sont préservés) ;
     S3  une action locale toute fraîche (sortie du bassin), dont le push
         n'est pas encore parti, survit à un pull immédiat ;
     S4  local et serveur identiques : aucune réécriture, aucun « changed »
         (l'horodatage de synchro est exclu de la comparaison) ;
     S5  un lot créé par un collègue est bien rapatrié ;
     S6  autoSync() ne renvoie JAMAIS un état local périmé au serveur : le
         pull précède le push, donc l'app ne dépend pas du garde-fou SQL
         « conflit_statut » de op_upsert_lot (absent de la 1re version du
         script) pour éviter de faire régresser le serveur ;
     S7  effet de bord documenté : CAEKDB.deleteLot étant intercepté, un
         archivage LOCAL (bassin.js, lots écrasés depuis plus de 24 h)
         supprime aussi le lot CÔTÉ SERVEUR, donc pour tous les appareils.

   Exécution :  node validation/bassin_sync_validation.js
   Aucune dépendance, aucun accès réseau : le module est chargé dans un
   bac à sable avec des doubles de CAEKDB / CAEKServer / CAEKOperateurs.
   Code de sortie 0 si toutes les assertions passent.
   ========================================================================= */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var MODULE = path.join(__dirname, "..", "js", "lots_sync.js");

/* ---------- Bac à sable : doubles de la base locale et du serveur ---------- */
function makeEnv(localLots, serverRows, queue) {
  var meta = { lotsQueue: JSON.parse(JSON.stringify(queue || {})) };
  var lots = JSON.parse(JSON.stringify(localLots));
  var nextId = 1000;
  var pushed = [];

  var CAEKDB = {
    getMeta: function (k) { return Promise.resolve(meta[k]); },
    setMeta: function (k, v) { meta[k] = v; return Promise.resolve(); },
    getAllLots: function () { return Promise.resolve(JSON.parse(JSON.stringify(lots))); },
    getLot: function (id) {
      return Promise.resolve(lots.filter(function (l) { return l.id === id; })[0] || null);
    },
    addLots: function (arr) {
      arr.forEach(function (l) { l.id = nextId++; lots.push(JSON.parse(JSON.stringify(l))); });
      return Promise.resolve();
    },
    updateLot: function (l) {
      for (var i = 0; i < lots.length; i++) {
        if (lots[i].id === l.id) { lots[i] = JSON.parse(JSON.stringify(l)); return Promise.resolve(); }
      }
      lots.push(JSON.parse(JSON.stringify(l)));
      return Promise.resolve();
    },
    deleteLot: function (id) {
      lots = lots.filter(function (l) { return l.id !== id; });
      return Promise.resolve();
    }
  };

  var sandbox = {
    console: console,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise: Promise, JSON: JSON, Date: Date, Object: Object, Math: Math, String: String,
    navigator: { onLine: true },
    addEventListener: function () {}
  };
  sandbox.window = sandbox;
  sandbox.CAEKDB = CAEKDB;
  sandbox.CAEKOperateurs = { isLogged: function () { return true; }, token: function () { return "T"; } };
  var supprimes = [];
  sandbox.CAEKServer = {
    configured: function () { return true; },
    listLots: function () { return Promise.resolve(JSON.parse(JSON.stringify(serverRows))); },
    upsertLot: function (t, k, l) {
      pushed.push({ cle: k, statut: l && l.statut });
      return Promise.resolve({ ok: true });
    },
    deleteLotByKey: function (t, k) { supprimes.push(k); return Promise.resolve({ ok: true }); }
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(MODULE, "utf8"), sandbox);
  return {
    sandbox: sandbox, lots: function () { return lots; },
    meta: meta, pushed: pushed, supprimes: supprimes
  };
}

var results = [];
function check(nom, cond, detail) {
  results.push({ nom: nom, ok: !!cond });
  console.log((cond ? "  OK   " : "  KO   ") + nom + (cond ? "" : "  -> " + JSON.stringify(detail)));
}

function cas(titre, localLots, serverRows, queue, assertions) {
  console.log("\n" + titre);
  var env = makeEnv(localLots, serverRows, queue);
  env.sandbox.CAEKLots.init();   // installHook() capture rawAdd/rawUpdate/rawDelete
  return env.sandbox.CAEKLots.pull().then(function (r) { assertions(env, r); });
}

var chain = Promise.resolve();

/* ---- S1 : LE BUG SIGNALÉ ----------------------------------------------- */
chain = chain.then(function () {
  return cas("S1 — clé bloquée en file, serveur plus avancé (sorti)",
    [{ id: 1, lotKey: "K1", ref: "ECPM169", statut: "en_bassin",
       datePrevue: "2026-08-01", _syncedAt: "2026-07-01T00:00:00Z" }],
    [{ lot_key: "K1", labo_id: "L1", statut: "sorti",
       payload: { lotKey: "K1", ref: "ECPM169", statut: "sorti",
                  dateSortie: "2026-08-05", datePrevue: "2026-08-01" } }],
    { K1: "upsert" },
    function (env, r) {
      var l = env.lots()[0];
      check("le lot local passe à « sorti »", l.statut === "sorti", l.statut);
      check("le push périmé est retiré de la file", !env.meta.lotsQueue.K1, env.meta.lotsQueue);
      check("pull signale un changement", r.changed === true, r);
      check("l'horodatage du dernier pull est enregistré", !!env.meta.lotsLastPull, env.meta.lotsLastPull);
    });
});

/* ---- S2 : la copie locale est plus avancée ----------------------------- */
chain = chain.then(function () {
  return cas("S2 — copie locale « teste » face à un serveur « sorti »",
    [{ id: 1, lotKey: "K1", ref: "ECPM169", statut: "teste", essais: [{ r: 32 }] }],
    [{ lot_key: "K1", labo_id: "L1", statut: "sorti",
       payload: { lotKey: "K1", ref: "ECPM169", statut: "sorti" } }],
    { K1: "upsert" },
    function (env) {
      var l = env.lots()[0];
      check("la copie locale « teste » est conservée", l.statut === "teste", l.statut);
      check("les résultats d'essai locaux ne sont pas perdus", !!(l.essais && l.essais.length), l.essais);
      check("le push reste en file d'attente", env.meta.lotsQueue.K1 === "upsert", env.meta.lotsQueue);
    });
});

/* ---- S3 : action locale récente, push pas encore parti ----------------- */
chain = chain.then(function () {
  return cas("S3 — sortie du bassin toute fraîche, aucune entrée en file",
    [{ id: 1, lotKey: "K1", ref: "ECPM169", statut: "sorti", dateSortie: "2026-08-07" }],
    [{ lot_key: "K1", labo_id: "L1", statut: "en_bassin",
       payload: { lotKey: "K1", ref: "ECPM169", statut: "en_bassin" } }],
    {},
    function (env) {
      var l = env.lots()[0];
      check("la sortie locale n'est pas annulée par le serveur", l.statut === "sorti", l.statut);
      check("la date de sortie est conservée", l.dateSortie === "2026-08-07", l.dateSortie);
    });
});

/* ---- S4 : idempotence -------------------------------------------------- */
chain = chain.then(function () {
  return cas("S4 — local et serveur identiques : aucune réécriture",
    [{ id: 1, lotKey: "K1", ref: "ECPM169", statut: "sorti", laboId: "L1",
       _syncedAt: "2026-07-01T00:00:00Z" }],
    [{ lot_key: "K1", labo_id: "L1", statut: "sorti",
       payload: { lotKey: "K1", ref: "ECPM169", statut: "sorti", laboId: "L1" } }],
    {},
    function (env, r) {
      check("pull ne signale aucun changement", r.changed === false, r);
    });
});

/* ---- S5 : lot créé par un collègue ------------------------------------- */
chain = chain.then(function () {
  return cas("S5 — lot créé par un collègue, absent en local",
    [],
    [{ lot_key: "K9", labo_id: "L1", statut: "en_bassin",
       payload: { lotKey: "K9", ref: "ECPM175", statut: "en_bassin" } }],
    {},
    function (env, r) {
      check("le lot est créé localement", env.lots().length === 1, env.lots());
      check("pull signale un changement", r.changed === true, r);
    });
});

/* ---- S6 : autoSync() ne pousse pas d'état périmé ------------------------
   Même situation que S1, mais par autoSync() complet (pull + push). Le
   serveur ne doit recevoir AUCUN upsert « en_bassin » : sinon, sur une base
   où op_upsert_lot n'a pas le garde-fou 'conflit_statut', l'appareil périmé
   ferait revenir le lot dans le bassin pour toute l'équipe. */
chain = chain.then(function () {
  console.log("\nS6 — autoSync() : le pull précède le push (pas de régression serveur)");
  var env = makeEnv(
    [{ id: 1, lotKey: "K1", ref: "ECPM169", statut: "en_bassin", _syncedAt: "2026-07-01T00:00:00Z" }],
    [{ lot_key: "K1", labo_id: "L1", statut: "sorti",
       payload: { lotKey: "K1", ref: "ECPM169", statut: "sorti", dateSortie: "2026-08-05" } }],
    { K1: "upsert" });
  env.sandbox.CAEKLots.init();
  return env.sandbox.CAEKLots.autoSync().then(function () {
    var regressions = env.pushed.filter(function (p) { return p.statut === "en_bassin"; });
    check("aucun « en_bassin » périmé n'est envoyé au serveur",
      regressions.length === 0, env.pushed);
    check("le lot local a bien adopté « sorti »", env.lots()[0].statut === "sorti", env.lots()[0].statut);
  });
});

/* ---- S7 : effet de bord de l'archivage local ---------------------------
   Constat, pas une régression : le hook sur CAEKDB.deleteLot fait qu'une
   suppression LOCALE se propage au serveur. bassin.js (autoArchive) appelle
   CAEKDB.deleteLot sur les lots écrasés depuis plus de 24 h : l'archivage
   d'un appareil supprime donc le lot pour tous les autres. */
chain = chain.then(function () {
  console.log("\nS7 — archivage local : la suppression se propage au serveur");
  var env = makeEnv([{ id: 1, lotKey: "K1", ref: "ECPM169", statut: "ecrase" }], [], {});
  env.sandbox.CAEKLots.init();
  // Appel identique à celui de bassin.js -> autoArchive().
  return env.sandbox.CAEKDB.deleteLot(1).then(function () {
    check("CAEKDB.deleteLot déclenche op_delete_lot côté serveur",
      env.supprimes.indexOf("K1") >= 0, env.supprimes);
  });
});

chain.then(function () {
  var ko = results.filter(function (r) { return !r.ok; });
  console.log("\n=== " + (results.length - ko.length) + "/" + results.length + " assertions OK ===");
  process.exit(ko.length ? 1 : 0);
}).catch(function (e) { console.error(e); process.exit(1); });

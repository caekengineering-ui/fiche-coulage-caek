/* ============================================================
   Module Béton - CAEK
   lots_sync.js - V3 (P5) : synchronisation des LOTS d'éprouvettes
   (bassin de conservation + écrasements) avec le serveur.

   Même principe que coulages.js : IndexedDB reste la copie de
   travail (bassin.js / compression.js inchangés) ; un hook sur
   CAEKDB.addLots / updateLot / deleteLot pousse chaque changement
   au serveur (op_upsert_lot par lot_key), avec file d'attente
   hors-ligne (meta "lotsQueue") rejouée au retour du réseau.

   pull() rapatrie les lots du serveur (scopés par labo côté
   serveur ; l'admin reçoit tous les labos) : lots des collègues,
   validations de résultats par l'admin (payload.resultatsValides).
   Cycle : en_bassin -> sorti -> teste (op) -> valide (ADMIN,
   verrouillé ensuite : op_upsert_lot refuse).
   ============================================================ */
var CAEKLots = (function () {
  "use strict";

  var QUEUE_KEY = "lotsQueue";   // meta : { lotKey: "upsert" | "delete" }
  var _pushTimer = null;
  var _pushKeys = {};

  function ready() {
    return !!(window.CAEKServer && CAEKServer.configured() &&
      window.CAEKOperateurs && CAEKOperateurs.isLogged() && window.CAEKDB);
  }
  function online() { return navigator.onLine !== false; }
  function token() { return CAEKOperateurs.token(); }
  function isDemo(ref) { return String(ref || "").indexOf("DEMO") === 0; }

  function genKey(l) {
    return (l.ref || "LOT") + "-L" + (l.id != null ? l.id : Math.floor(Math.random() * 1e6)) +
      "-" + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- File d'attente ---------- */
  function getQueue() { return CAEKDB.getMeta(QUEUE_KEY).then(function (q) { return q || {}; }); }
  function setQueue(q) { return CAEKDB.setMeta(QUEUE_KEY, q); }
  function enqueue(key, action) {
    return getQueue().then(function (q) {
      if (q[key] !== "delete") { q[key] = action; }   // delete prime
      if (action === "delete") { q[key] = "delete"; }
      return setQueue(q);
    });
  }
  function dequeue(key) {
    return getQueue().then(function (q) { delete q[key]; return setQueue(q); });
  }

  /* ---------- Push ---------- */
  function schedulePush(key) {
    if (!key) { return; }
    _pushKeys[key] = true;
    if (_pushTimer) { clearTimeout(_pushTimer); }
    _pushTimer = setTimeout(flushPush, 1500);
  }
  function flushPush() {
    _pushTimer = null;
    var keys = Object.keys(_pushKeys);
    _pushKeys = {};
    if (!keys.length) { return; }
    CAEKDB.getAllLots().then(function (all) {
      var byKey = {};
      (all || []).forEach(function (l) { if (l.lotKey) { byKey[l.lotKey] = l; } });
      keys.forEach(function (k) {
        if (byKey[k]) { pushLot(byKey[k]); }
      });
    });
  }

  function pushLot(l) {
    if (!l || !l.lotKey || isDemo(l.ref)) { return Promise.resolve(); }
    if (!ready() || !online()) { return enqueue(l.lotKey, "upsert"); }
    return CAEKServer.upsertLot(token(), l.lotKey, l).then(function (r) {
      if (r && r.ok === true) {
        l._syncedAt = new Date().toISOString();
        return rawUpdate(l).then(function () { return dequeue(l.lotKey); });
      }
      if (r && (r.error === "verrouille" || r.error === "conflit_statut" || r.error === "conflit_resultats")) {
        // Serveur plus avancé que la copie hors-ligne : se réaligner.
        return dequeue(l.lotKey).then(pull);
      }
      // coulage_introuvable (coulage pas encore synchronisé) ou autre :
      // on garde en file, rejoué après la synchro des coulages.
      return enqueue(l.lotKey, "upsert");
    }).catch(function () { return enqueue(l.lotKey, "upsert"); });
  }

  function pushDelete(key) {
    if (!key) { return Promise.resolve(); }
    if (!ready() || !online()) { return enqueue(key, "delete"); }
    return CAEKServer.deleteLotByKey(token(), key).then(function (r) {
      if (r && (r.ok === true)) { return dequeue(key); }
      if (r && r.error === "verrouille") { return dequeue(key).then(pull); }
      return enqueue(key, "delete");
    }).catch(function () { return enqueue(key, "delete"); });
  }

  function processQueue() {
    if (!ready() || !online()) { return Promise.resolve(); }
    return Promise.all([getQueue(), CAEKDB.getAllLots()]).then(function (out) {
      var q = out[0] || {};
      var byKey = {};
      (out[1] || []).forEach(function (l) { if (l.lotKey) { byKey[l.lotKey] = l; } });
      var keys = Object.keys(q);
      return keys.reduce(function (p, k) {
        return p.then(function () {
          if (q[k] === "delete") { return pushDelete(k); }
          if (byKey[k]) { return pushLot(byKey[k]); }
          return dequeue(k);   // upsert d'un lot local disparu
        });
      }, Promise.resolve());
    });
  }

  /* ---------- Pull : serveur -> local ---------- */
  function pull() {
    if (!ready() || !online()) { return Promise.resolve({ ok: false, changed: false }); }
    return CAEKServer.listLots(token(), null).then(function (rows) {
      rows = (rows || []).filter(function (r) { return r.lot_key && r.payload; });
      var onServer = {};
      rows.forEach(function (r) { onServer[r.lot_key] = true; });
      return Promise.all([CAEKDB.getAllLots(), getQueue()]).then(function (out) {
        var locals = out[0] || [], queue = out[1] || {};
        var byKey = {};
        locals.forEach(function (l) { if (l.lotKey) { byKey[l.lotKey] = l; } });
        var changed = false;
        var work = [];

        rows.forEach(function (row) {
          if (queue[row.lot_key]) { return; }          // push local en attente
          var merged = row.payload;
          merged.lotKey = row.lot_key;
          merged.laboId = row.labo_id || merged.laboId || "";
          if (row.statut === "valide") { merged.resultatsValides = true; }
          merged._syncedAt = new Date().toISOString();
          var local = byKey[row.lot_key];
          if (local) {
            merged.id = local.id;                       // id local conservé
            var a = JSON.stringify(local), b = JSON.stringify(merged);
            if (a !== b) { changed = true; work.push(rawUpdate(merged)); }
          } else {
            delete merged.id;                           // nouvel id local auto
            changed = true;
            work.push(rawAdd([merged]));
          }
        });

        // Lots locaux connus du serveur mais disparus (supprimés ailleurs).
        locals.forEach(function (l) {
          if (l.lotKey && l._syncedAt && !onServer[l.lotKey] && !queue[l.lotKey] && !isDemo(l.ref)) {
            changed = true;
            work.push(rawDelete(l.id));
          }
        });

        return Promise.all(work).then(function () {
          if (changed && window.CAEKBadges) { CAEKBadges.refresh(); }
          return { ok: true, changed: changed };
        });
      });
    }).catch(function () { return { ok: false, changed: false }; });
  }

  /* ---------- Hooks sur la base locale ---------- */
  var rawAdd = null, rawUpdate = null, rawDelete = null;

  function ensureKeysAndPush(refs) {
    // Après addLots : attribue une clé aux lots qui n'en ont pas, puis push.
    CAEKDB.getAllLots().then(function (all) {
      (all || []).forEach(function (l) {
        if (refs[l.ref] && !isDemo(l.ref)) {
          if (!l.lotKey) {
            l.lotKey = genKey(l);
            rawUpdate(l).then(function () { schedulePush(l.lotKey); });
          } else {
            schedulePush(l.lotKey);
          }
        }
      });
    });
  }

  function installHook() {
    if (!window.CAEKDB || rawUpdate) { return; }
    rawAdd = CAEKDB.addLots.bind(CAEKDB);
    rawUpdate = CAEKDB.updateLot.bind(CAEKDB);
    rawDelete = CAEKDB.deleteLot.bind(CAEKDB);

    CAEKDB.addLots = function (lots) {
      return rawAdd(lots).then(function (res) {
        var refs = {};
        (lots || []).forEach(function (l) { if (l && l.ref) { refs[l.ref] = true; } });
        ensureKeysAndPush(refs);
        return res;
      });
    };
    CAEKDB.updateLot = function (l) {
      if (l && !l.lotKey && l.ref && !isDemo(l.ref)) { l.lotKey = genKey(l); }
      return rawUpdate(l).then(function (res) {
        if (l && l.lotKey && !isDemo(l.ref)) { schedulePush(l.lotKey); }
        return res;
      });
    };
    CAEKDB.deleteLot = function (id) {
      return CAEKDB.getLot(id).then(function (l) {
        var key = l && l.lotKey;
        var demo = l && isDemo(l.ref);
        return rawDelete(id).then(function (res) {
          if (key && !demo) { pushDelete(key); }
          return res;
        });
      });
    };
  }

  function autoSync() {
    if (!ready() || !online()) { return Promise.resolve(); }
    return processQueue().then(pull);
  }

  function init() {
    installHook();
    window.addEventListener("online", function () { setTimeout(autoSync, 2500); });
    setTimeout(autoSync, 2000);
  }

  return {
    init: init,
    pull: pull,
    processQueue: processQueue,
    autoSync: autoSync
  };
})();

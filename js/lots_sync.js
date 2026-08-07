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

   ARBITRAGE DU MERGE (pull) : le RANG dans le cycle tranche, jamais
   la seule présence d'un push en attente. La copie la plus avancée
   gagne ; un push local périmé est abandonné. Sans cette règle, une
   clé bloquée en file (coulage pas encore synchronisé, refus de
   scope, erreur réseau) figeait le lot indéfiniment sur l'appareil,
   qui continuait d'afficher « en bassin / en retard » un lot déjà
   sorti par un collègue.
   ============================================================ */
var CAEKLots = (function () {
  "use strict";

  var QUEUE_KEY = "lotsQueue";        // meta : { lotKey: "upsert" | "delete" }
  var LAST_PULL_KEY = "lotsLastPull"; // meta : horodatage ISO du dernier pull réussi
  var _pushTimer = null;
  var _pushKeys = {};

  /* Rang du cycle de vie d'un lot : en_bassin -> sorti -> teste -> valide.
     Même échelle que op_upsert_lot côté serveur ; sert d'arbitre au merge
     quand la copie locale et le serveur divergent. « ecrase » est un statut
     hérité (ancienne version) : traité au niveau de « teste ». Un statut
     inconnu vaut « en_bassin » : jamais en dessous du départ du cycle. */
  var RANGS = { en_bassin: 1, sorti: 2, teste: 3, ecrase: 3, valide: 4 };
  function rang(statut) { return RANGS[String(statut || "en_bassin")] || 1; }

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
  function dequeueAll(keys) {
    if (!keys || !keys.length) { return Promise.resolve(); }
    return getQueue().then(function (q) {
      keys.forEach(function (k) { delete q[k]; });
      return setQueue(q);
    });
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

  /* ---------- Phase 3 : allocation serveur ATOMIQUE des numéros E ---------- */
  var _allocRpcAbsent = false;
  function isRpcMissing(e) {
    var m = String((e && e.message) || "");
    return m.indexOf("404") >= 0 || m.toLowerCase().indexOf("could not find the function") >= 0;
  }
  // Enregistre le prélèvement + les éprouvettes du lot côté serveur
  // (idempotent par uuid). Si le serveur alloue un numéro E différent
  // (création concurrente sur un autre appareil), le numéro et les codes
  // SERVEUR sont adoptés — jamais deux E identiques pour un même coulage.
  function allocIfNeeded(l) {
    if (_allocRpcAbsent || !CAEKServer.allocPrels) { return Promise.resolve(); }
    if (!l.prelUuid || l._prelAlloue) { return Promise.resolve(); }
    var eprUuids = (l.codes || []).map(function (x) { return x.eprUuid; }).filter(Boolean);
    return CAEKServer.allocPrels(token(), l.ref, [{
      uuid: l.prelUuid, type: l.type, nombre: l.nombre, eprUuids: eprUuids
    }]).then(function (r) {
      if (r && r.ok === true && r.prels && r.prels.length) {
        var srv = r.prels[0];
        l._prelAlloue = true;
        if (srv.e && srv.e !== l.prel) {
          l.prel = srv.e;
          (srv.codes || []).forEach(function (sc) {
            (l.codes || []).forEach(function (x) {
              if (x.eprUuid === sc.uuid) { x.code = sc.code; }
            });
          });
        }
        return rawUpdate(l);
      }
    }).catch(function (e) { if (isRpcMissing(e)) { _allocRpcAbsent = true; } });
  }

  function pushLot(l) {
    if (!l || !l.lotKey || isDemo(l.ref)) { return Promise.resolve(); }
    if (!ready() || !online()) { return enqueue(l.lotKey, "upsert"); }
    return allocIfNeeded(l).then(function () {
    return CAEKServer.upsertLot(token(), l.lotKey, l).then(function (r) {
      if (r && r.ok === true) {
        l._syncedAt = new Date().toISOString();
        return rawUpdate(l).then(function () { return dequeue(l.lotKey); });
      }
      if (r && (r.error === "verrouille" || r.error === "conflit_statut" ||
                r.error === "conflit_resultats" || r.error === "autre_labo")) {
        // Refus DÉFINITIF : serveur plus avancé que la copie hors-ligne, ou
        // lot hors du périmètre de cet opérateur. Réessayer indéfiniment
        // laisserait la clé en file, ce qui bloquerait le pull de ce lot
        // (cf. pull()) et figerait l'appareil sur son état périmé.
        return dequeue(l.lotKey).then(pull);
      }
      // coulage_introuvable (coulage pas encore synchronisé) ou autre :
      // on garde en file, rejoué après la synchro des coulages.
      return enqueue(l.lotKey, "upsert");
    }).catch(function () { return enqueue(l.lotKey, "upsert"); });
    });   // fin allocIfNeeded
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
  // Horodatage du dernier pull RÉUSSI : le bassin s'en sert pour signaler
  // à l'utilisateur qu'il regarde une copie locale qui peut dater.
  function lastPull() {
    if (!window.CAEKDB) { return Promise.resolve(""); }
    return CAEKDB.getMeta(LAST_PULL_KEY).then(function (v) { return v || ""; });
  }

  // Empreinte de comparaison : clés triées (l'ordre diffère entre la copie
  // IndexedDB et le payload jsonb) et horodatage de synchro ignoré (il change
  // à chaque pull). Sans cela, TOUS les lots étaient réécrits à chaque
  // passage et le pull se déclarait toujours « changed ».
  function empreinte(lot) {
    var cles = [], k;
    for (k in lot) {
      if (Object.prototype.hasOwnProperty.call(lot, k) && k !== "_syncedAt") { cles.push(k); }
    }
    cles.sort();
    return JSON.stringify(cles.map(function (c) { return [c, lot[c]]; }));
  }

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
        var obsoletes = [];   // pushs en attente devenus périmés

        rows.forEach(function (row) {
          var local = byKey[row.lot_key];
          var rLocal = rang(local && local.statut), rServeur = rang(row.statut);

          // (1) Copie locale STRICTEMENT plus avancée : elle vient d'être
          // modifiée sur cet appareil (sortie du bassin, essai saisi) et son
          // push n'est pas encore parti. On ne la réécrit jamais avec un
          // serveur en retard, et on (re)programme sa remontée — sans quoi un
          // pull déclenché juste après l'action annulerait celle-ci.
          if (local && rLocal > rServeur) { schedulePush(row.lot_key); return; }

          // (2) Push local en attente : il ne prime que s'il est au moins
          // aussi avancé que le serveur (même arbitrage que op_upsert_lot).
          // Sinon la copie locale est périmée : le serveur gagne et le push
          // obsolète est abandonné.
          //
          // Auparavant la seule présence de la clé en file faisait sauter la
          // ligne. Une clé qui ne part jamais (coulage pas encore synchronisé,
          // refus de scope, erreur réseau...) figeait alors le lot
          // DÉFINITIVEMENT sur cet appareil : un lot sorti du bassin par un
          // collègue continuait de s'afficher « en bassin / en retard ».
          if (queue[row.lot_key]) {
            if (rLocal >= rServeur) { return; }
            obsoletes.push(row.lot_key);
          }
          var merged = row.payload;
          merged.lotKey = row.lot_key;
          merged.laboId = row.labo_id || merged.laboId || "";
          if (row.statut === "valide") { merged.resultatsValides = true; }
          merged._syncedAt = new Date().toISOString();
          if (local) {
            merged.id = local.id;                       // id local conservé
            if (empreinte(local) !== empreinte(merged)) { changed = true; work.push(rawUpdate(merged)); }
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
          return dequeueAll(obsoletes);
        }).then(function () {
          return CAEKDB.setMeta(LAST_PULL_KEY, new Date().toISOString());
        }).then(function () {
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
    // Phase 3 : clés en attente de synchro (affichage des états).
    pendingKeys: function () { return getQueue(); },
    lastPull: lastPull,
    autoSync: autoSync
  };
})();

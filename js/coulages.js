/* ============================================================
   Module Béton - CAEK
   coulages.js - V3 : synchronisation des coulages avec le serveur.

   Cycle V3 : brouillon (op, modifiable) -> soumis (op, verrouillé,
   en attente admin) -> valide (admin). Le renvoi admin remet la
   fiche en brouillon avec un motif (retourAdmin).

   Fonctionnement hors-ligne :
   - IndexedDB reste la copie de travail (fiche.js/bassin.js inchangés) ;
   - toute sauvegarde LOCALE d'un brouillon est poussée au serveur
     (op_save_coulage) via un hook sur CAEKDB.updateCoulage/addCoulage ;
   - la soumission (op_soumettre_coulage) passe par soumettre(ref) ;
   - sans réseau, les actions sont mises en FILE D'ATTENTE (meta
     "coulagesQueue") et rejouées au retour du réseau ;
   - pull() rapatrie les coulages du serveur (scopés par labo côté
     serveur) : validations/renvois admin, fiches des collègues du
     même labo. Les champs opérationnels locaux (récupération,
     codification confirmée) sont conservés au merge.
   - Les fiches locales connues du serveur (_syncedAt) qui n'y sont
     plus ont été supprimées par l'admin -> suppression locale.
     Les données DEMO- restent locales.
   ============================================================ */
var CAEKCoulages = (function () {
  "use strict";

  var QUEUE_KEY = "coulagesQueue";   // meta : { ref: "save" | "soumettre" }
  var _pushTimer = null;
  var _pushRefs = {};                // refs en attente de push différé

  // Champs opérationnels gérés LOCALEMENT après soumission (bassin) :
  // conservés lors d'un merge serveur -> local.
  var LOCAL_FIELDS = ["eprRecuperees", "codificationConfirmee", "dateRecuperation",
    "operateurRecuperation", "qualificationRecuperation"];

  function ready() {
    return !!(window.CAEKServer && CAEKServer.configured() &&
      window.CAEKOperateurs && CAEKOperateurs.isLogged() && window.CAEKDB);
  }
  function online() { return navigator.onLine !== false; }
  function token() { return CAEKOperateurs.token(); }
  function isDemo(ref) { return String(ref || "").indexOf("DEMO") === 0; }

  /* ---------- File d'attente (meta) ---------- */
  function getQueue() {
    return CAEKDB.getMeta(QUEUE_KEY).then(function (q) { return q || {}; });
  }
  function setQueue(q) { return CAEKDB.setMeta(QUEUE_KEY, q); }
  function enqueue(ref, action) {
    return getQueue().then(function (q) {
      // "soumettre" prime sur "save" (la soumission emporte le payload complet).
      if (q[ref] !== "soumettre") { q[ref] = action; }
      return setQueue(q);
    });
  }
  function dequeue(ref) {
    return getQueue().then(function (q) { delete q[ref]; return setQueue(q); });
  }
  function pendingCount() {
    return getQueue().then(function (q) { return Object.keys(q).length; });
  }

  /* ---------- Push : brouillons ---------- */
  // Appelé (via le hook DB) après chaque sauvegarde locale.
  function schedulePush(c) {
    if (!c || !c.ref || isDemo(c.ref)) { return; }
    if ((c.statut || "brouillon") !== "brouillon") { return; }
    _pushRefs[c.ref] = true;
    if (_pushTimer) { clearTimeout(_pushTimer); }
    _pushTimer = setTimeout(flushPush, 1500);
  }

  function flushPush() {
    _pushTimer = null;
    var refs = Object.keys(_pushRefs);
    _pushRefs = {};
    refs.forEach(function (ref) { pushBrouillon(ref); });
  }

  function pushBrouillon(ref) {
    if (!window.CAEKDB) { return Promise.resolve(); }
    return CAEKDB.getCoulage(ref).then(function (c) {
      if (!c || (c.statut || "brouillon") !== "brouillon") { return; }
      if (!ready() || !online()) { return enqueue(ref, "save"); }
      return CAEKServer.saveCoulage(token(), ref, c).then(function (r) {
        if (r && r.ok === true) {
          c._syncedAt = new Date().toISOString();
          return rawUpdate(c).then(function () { return dequeue(ref); });
        }
        if (r && (r.error === "verrouille")) {
          // Le serveur est en avance (soumis/validé ailleurs) -> se réaligner.
          return dequeue(ref).then(pull);
        }
        // labo_requis / autre : on garde en file pour re-tentative.
        return enqueue(ref, "save");
      }).catch(function () { return enqueue(ref, "save"); });
    });
  }

  /* ---------- Soumission ---------- */
  // Verrouille localement puis envoie au serveur (ou met en file).
  function soumettre(ref, signature) {
    return CAEKDB.getCoulage(ref).then(function (c) {
      if (!c) { return { ok: false, error: "Fiche introuvable." }; }
      if ((c.statut || "brouillon") === "valide") { return { ok: false, error: "Fiche déjà validée." }; }
      c.statut = "soumis";
      c.dateSoumission = new Date().toISOString();
      c.retourAdmin = "";
      if (signature) {
        if (!c.signatureOperateur) { c.signatureOperateur = signature.nom || ""; }
        c.operateurSoumission = signature.nom || "";
        c.qualificationSoumission = signature.qualification || "";
      }
      c.dateModification = new Date().toISOString();
      return rawUpdate(c).then(function () {
        if (isDemo(ref)) { return { ok: true, offline: false }; }
        if (!ready() || !online()) {
          return enqueue(ref, "soumettre").then(function () { return { ok: true, offline: true }; });
        }
        // Téléversement des médias (photos + audios) AVANT la soumission :
        // l'admin les examinera à la validation. Échec (bucket absent,
        // réseau instable) => on soumet quand même, médias marqués incomplets.
        var up = window.CAEKMedias
          ? CAEKMedias.uploadForRef(ref)
          : Promise.resolve({ medias: [], incomplet: false });
        return up.then(function (m) {
          c.medias = m.medias;
          c.mediasIncomplets = (m.incomplet === true);
          return rawUpdate(c);
        }).then(function () {
        return CAEKServer.soumettreCoulage(token(), ref, c).then(function (r) {
          if (r && r.ok === true) {
            c._syncedAt = new Date().toISOString();
            return rawUpdate(c).then(function () {
              return dequeue(ref).then(function () { return { ok: true, offline: false }; });
            });
          }
          if (r && r.error === "deja_valide") {
            return pull().then(function () { return { ok: false, error: "Cette fiche a déjà été validée par l'administrateur." }; });
          }
          if (r && r.error === "labo_requis") {
            return { ok: false, error: "Aucun laboratoire affecté à votre compte : contactez l'administrateur." };
          }
          return enqueue(ref, "soumettre").then(function () { return { ok: true, offline: true }; });
        }).catch(function () {
          return enqueue(ref, "soumettre").then(function () { return { ok: true, offline: true }; });
        });
        });   // fin téléversement médias
      });
    });
  }

  /* ---------- Suppression (brouillon) ---------- */
  function deleteOnServer(ref) {
    if (isDemo(ref) || !ready() || !online()) { return Promise.resolve(); }
    return CAEKServer.deleteCoulage(token(), ref).catch(function () {});
  }

  /* ---------- File : rejouer ---------- */
  function processQueue() {
    if (!ready() || !online()) { return Promise.resolve(); }
    return getQueue().then(function (q) {
      var refs = Object.keys(q);
      return refs.reduce(function (p, ref) {
        return p.then(function () {
          return CAEKDB.getCoulage(ref).then(function (c) {
            if (!c) { return dequeue(ref); }
            // Rejouer une soumission : re-tenter d'abord les médias.
            var prep = (q[ref] === "soumettre" && window.CAEKMedias)
              ? CAEKMedias.uploadForRef(ref).then(function (m) {
                  c.medias = m.medias;
                  c.mediasIncomplets = (m.incomplet === true);
                  return rawUpdate(c);
                })
              : Promise.resolve();
            return prep.then(function () {
            var fn = (q[ref] === "soumettre")
              ? CAEKServer.soumettreCoulage(token(), ref, c)
              : CAEKServer.saveCoulage(token(), ref, c);
            return fn.then(function (r) {
              if (r && (r.ok === true || r.error === "verrouille" || r.error === "deja_valide")) {
                if (r.ok === true) { c._syncedAt = new Date().toISOString(); }
                return rawUpdate(c).then(function () { return dequeue(ref); });
              }
              // échec non réseau (ex. labo_requis) : on garde en file.
            }).catch(function () { /* réseau : re-tentative plus tard */ });
            });   // fin prep médias
          });
        });
      }, Promise.resolve());
    });
  }

  /* ---------- Pull : serveur -> local ---------- */
  function mergeRow(row, local, queue) {
    var ref = row.ref;
    if (queue[ref]) { return Promise.resolve(false); }   // push local en attente : ne pas écraser
    var srv = row.payload || {};
    var merged = srv;
    merged.ref = ref;
    merged.statut = row.statut || srv.statut || "brouillon";
    merged.retourAdmin = row.retour_admin || srv.retourAdmin || "";
    merged.laboId = row.labo_id || srv.laboId || "";
    merged._syncedAt = new Date().toISOString();
    if (local) {
      LOCAL_FIELDS.forEach(function (f) {
        if (local[f] !== undefined && merged[f] === undefined) { merged[f] = local[f]; }
        // La confirmation locale prime (travail bassin déjà fait).
        if ((f === "eprRecuperees" || f === "codificationConfirmee") && local[f] === true) { merged[f] = true; }
      });
      var changed = JSON.stringify(local) !== JSON.stringify(merged);
      if (!changed) { return Promise.resolve(false); }
    }
    return rawUpdate(merged).then(function () { return true; });
  }

  function pull() {
    if (!ready() || !online()) { return Promise.resolve({ ok: false, changed: false }); }
    return CAEKServer.listCoulages(token(), null).then(function (rows) {
      rows = rows || [];
      var onServer = {};
      rows.forEach(function (r) { onServer[r.ref] = true; });
      return Promise.all([CAEKDB.getAllCoulages(), getQueue()]).then(function (out) {
        var locals = out[0] || [], queue = out[1] || {};
        var byRef = {};
        locals.forEach(function (c) { byRef[c.ref] = c; });
        var work = rows.map(function (row) { return mergeRow(row, byRef[row.ref], queue); });
        // Fiches locales connues du serveur mais disparues (supprimées par l'admin).
        locals.forEach(function (c) {
          if (!onServer[c.ref] && c._syncedAt && !queue[c.ref] && !isDemo(c.ref)) {
            work.push(CAEKDB.deleteCoulage(c.ref).then(function () { return true; }));
          }
        });
        return Promise.all(work).then(function (flags) {
          var changed = flags.some(function (x) { return x === true; });
          if (changed && window.CAEKBadges) { CAEKBadges.refresh(); }
          return { ok: true, changed: changed };
        });
      });
    }).catch(function () { return { ok: false, changed: false }; });
  }

  /* ---------- Hook sur la base locale ---------- */
  var rawUpdate = null;   // updateCoulage ORIGINAL (sans push) pour usage interne

  function installHook() {
    if (!window.CAEKDB || rawUpdate) { return; }
    rawUpdate = CAEKDB.updateCoulage.bind(CAEKDB);
    CAEKDB.updateCoulage = function (c) {
      return rawUpdate(c).then(function (res) { schedulePush(c); return res; });
    };
    if (CAEKDB.addCoulage) {
      var rawAdd = CAEKDB.addCoulage.bind(CAEKDB);
      CAEKDB.addCoulage = function (c) {
        return rawAdd(c).then(function (res) { schedulePush(c); return res; });
      };
    }
  }

  function autoSync() {
    if (!ready() || !online()) { return; }
    processQueue().then(pull).then(function (r) {
      if (r && r.changed && window.CAEKRepertoire) {
        var s = document.getElementById("screen-repertoire");
        if (s && s.classList.contains("is-active")) { CAEKRepertoire.refresh(); }
      }
    });
  }

  function init() {
    installHook();
    window.addEventListener("online", autoSync);
    setTimeout(autoSync, 1200);
  }

  return {
    init: init,
    schedulePush: schedulePush,
    soumettre: soumettre,
    deleteOnServer: deleteOnServer,
    processQueue: processQueue,
    pull: pull,
    pendingCount: pendingCount,
    autoSync: autoSync
  };
})();

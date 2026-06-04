/* ============================================================
   Fiche de coulage terrain - CAEK
   db.js - Acces IndexedDB (stockage local hors-ligne)
   T2 : magasins "projets" et "meta".
   (Les magasins coulages / photos / compteurs viendront en T3-T6.)
   ============================================================ */

var CAEKDB = (function () {
  "use strict";

  var DB_NAME = "caek_coulage";
  var DB_VERSION = 3;
  var _dbPromise = null;

  function open() {
    if (_dbPromise) { return _dbPromise; }
    _dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains("projets")) {
          db.createObjectStore("projets", { keyPath: "codeProjet" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "cle" });
        }
        if (!db.objectStoreNames.contains("coulages")) {
          db.createObjectStore("coulages", { keyPath: "ref" });
        }
        if (!db.objectStoreNames.contains("compteurs")) {
          db.createObjectStore("compteurs", { keyPath: "codeProjet" });
        }
        if (!db.objectStoreNames.contains("photos")) {
          var sp = db.createObjectStore("photos", { keyPath: "id", autoIncrement: true });
          sp.createIndex("ref", "ref", { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  function tx(store, mode) {
    return open().then(function (db) {
      return db.transaction(store, mode).objectStore(store);
    });
  }

  /* ---------- Projets ---------- */

  // Fusion par CodeProjet : ajout ou mise a jour, sans suppression.
  // Retourne { ajoutes, misAJour }.
  function upsertProjets(liste) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction("projets", "readwrite");
        var store = t.objectStore("projets");
        var res = { ajoutes: 0, misAJour: 0 };
        var i = 0;

        function next() {
          if (i >= liste.length) { return; }
          var item = liste[i++];
          var getReq = store.get(item.codeProjet);
          getReq.onsuccess = function () {
            if (getReq.result) { res.misAJour++; } else { res.ajoutes++; }
            store.put(item);
            next();
          };
          getReq.onerror = function () { next(); };
        }

        next();
        t.oncomplete = function () { resolve(res); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function getAllProjets() {
    return tx("projets", "readonly").then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function countProjets() {
    return tx("projets", "readonly").then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.count();
        req.onsuccess = function () { resolve(req.result || 0); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /* ---------- Meta ---------- */

  function setMeta(cle, valeur) {
    return tx("meta", "readwrite").then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.put({ cle: cle, valeur: valeur });
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function getMeta(cle) {
    return tx("meta", "readonly").then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.get(cle);
        req.onsuccess = function () { resolve(req.result ? req.result.valeur : null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function getProjet(codeProjet) {
    return tx("projets", "readonly").then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.get(codeProjet);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /* ---------- Compteurs (dernier n° par code projet) ---------- */

  function getCompteur(codeProjet) {
    return tx("compteurs", "readonly").then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.get(codeProjet);
        req.onsuccess = function () { resolve(req.result ? req.result.dernier : 0); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function peekNextNumero(codeProjet) {
    return getCompteur(codeProjet).then(function (n) { return n + 1; });
  }

  /* ---------- Coulages ---------- */

  function getCoulage(ref) {
    return tx("coulages", "readonly").then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.get(ref);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function refExists(ref) {
    return getCoulage(ref).then(function (c) { return !!c; });
  }

  function getAllCoulages() {
    return tx("coulages", "readonly").then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // Enregistre un coulage et met a jour le compteur du code projet.
  // Transaction unique sur coulages + compteurs : controle d'unicite atomique.
  // Retourne { ok, error }.
  function saveCoulage(coulage) {
    return open().then(function (db) {
      return new Promise(function (resolve) {
        var t = db.transaction(["coulages", "compteurs"], "readwrite");
        var sCoul = t.objectStore("coulages");
        var sComp = t.objectStore("compteurs");
        var existe = sCoul.get(coulage.ref);
        existe.onsuccess = function () {
          if (existe.result) {
            t.abort();
            resolve({ ok: false, error: "La référence " + coulage.ref + " existe déjà." });
            return;
          }
          sCoul.put(coulage);
          var getC = sComp.get(coulage.codeProjet);
          getC.onsuccess = function () {
            var dernier = getC.result ? getC.result.dernier : 0;
            var maj = Math.max(dernier, coulage.numero);
            sComp.put({ codeProjet: coulage.codeProjet, dernier: maj });
          };
        };
        t.oncomplete = function () { resolve({ ok: true }); };
        t.onerror = function () { resolve({ ok: false, error: t.error && t.error.message }); };
        t.onabort = function () { /* resolu plus haut */ };
      });
    });
  }

  /* ---------- Photos ---------- */

  function addPhoto(ref, categorie, blob) {
    return tx("photos", "readwrite").then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.add({ ref: ref, categorie: categorie, blob: blob, dateAjout: new Date().toISOString() });
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function getPhotosByRef(ref) {
    return tx("photos", "readonly").then(function (store) {
      return new Promise(function (resolve, reject) {
        var out = [];
        var idx = store.index("ref");
        var req = idx.openCursor(IDBKeyRange.only(ref));
        req.onsuccess = function (ev) {
          var cur = ev.target.result;
          if (cur) { out.push(cur.value); cur.continue(); }
          else { resolve(out); }
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function deletePhoto(id) {
    return tx("photos", "readwrite").then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.delete(id);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // Met a jour un coulage existant (ecrase). Ne touche pas au compteur.
  function updateCoulage(coulage) {
    return tx("coulages", "readwrite").then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.put(coulage);
        req.onsuccess = function () { resolve({ ok: true }); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  return {
    upsertProjets: upsertProjets,
    getAllProjets: getAllProjets,
    countProjets: countProjets,
    getProjet: getProjet,
    setMeta: setMeta,
    getMeta: getMeta,
    getCompteur: getCompteur,
    peekNextNumero: peekNextNumero,
    getCoulage: getCoulage,
    refExists: refExists,
    getAllCoulages: getAllCoulages,
    saveCoulage: saveCoulage,
    updateCoulage: updateCoulage,
    addPhoto: addPhoto,
    getPhotosByRef: getPhotosByRef,
    deletePhoto: deletePhoto
  };
})();

/* ============================================================
   Module Béton - CAEK
   medias.js - V3 : médias (photos + notes audio) sur Supabase Storage.

   Cycle : les médias restent LOCAUX (IndexedDB, store "photos",
   catégories formulation/prelevement/eprouvettes/anomalie/audio)
   pendant la saisie ; à la SOUMISSION du coulage ils sont téléversés
   dans le bucket privé « medias » (chemin coulages/<ref>/...) et
   listés dans payload.medias ; l'admin les consulte à l'écran de
   validation puis ils sont SUPPRIMÉS du serveur après validation
   (quota gratuit = zone de transit uniquement).

   Prérequis serveur : exécuter supabase_storage.sql (bucket +
   policies). Sans bucket, la soumission continue sans médias
   (payload.mediasIncomplets = true).
   ============================================================ */
var CAEKMedias = (function () {
  "use strict";

  var BUCKET = "medias";

  function configured() {
    return !!(window.CAEKServer && CAEKServer.configured());
  }
  function objUrl(path) {
    return CAEK_CONFIG.SUPABASE_URL + "/storage/v1/object/" + BUCKET + "/" + path;
  }
  function headers(extra) {
    var h = {
      "apikey": CAEK_CONFIG.SUPABASE_ANON,
      "Authorization": "Bearer " + CAEK_CONFIG.SUPABASE_ANON
    };
    if (extra) { for (var k in extra) { h[k] = extra[k]; } }
    return h;
  }

  var EXT = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3",
    "audio/ogg": "ogg", "audio/wav": "wav", "audio/aac": "aac", "audio/3gpp": "3gp"
  };
  function extOf(blob, categorie) {
    var mime = String(blob && blob.type || "").split(";")[0];
    return EXT[mime] || (categorie === "audio" ? "webm" : "jpg");
  }

  function upload(path, blob) {
    return fetch(objUrl(path), {
      method: "POST",
      headers: headers({ "Content-Type": (blob && blob.type) || "application/octet-stream", "x-upsert": "true" }),
      body: blob
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error("Storage (" + res.status + ") " + String(t).slice(0, 120));
        });
      }
      return true;
    });
  }

  // Téléverse tous les médias locaux d'un coulage.
  // -> { medias: [{path, categorie, type}], incomplet: bool }
  function uploadForRef(ref) {
    if (!configured() || !window.CAEKDB) {
      return Promise.resolve({ medias: [], incomplet: true });
    }
    return CAEKDB.getPhotosByRef(ref).then(function (list) {
      list = list || [];
      var medias = [];
      var incomplet = false;
      return list.reduce(function (p, ph) {
        return p.then(function () {
          if (!ph || !ph.blob) { return; }
          var cat = ph.categorie || "photo";
          var type = (cat === "audio") ? "audio" : "photo";
          var path = "coulages/" + ref + "/" + cat + "_" + ph.id + "." + extOf(ph.blob, cat);
          return upload(path, ph.blob).then(function () {
            medias.push({ path: path, categorie: cat, type: type });
          }).catch(function () { incomplet = true; });
        });
      }, Promise.resolve()).then(function () {
        return { medias: medias, incomplet: incomplet };
      });
    }).catch(function () { return { medias: [], incomplet: true }; });
  }

  function fetchBlob(path) {
    return fetch(objUrl(path), { headers: headers() }).then(function (res) {
      if (!res.ok) { throw new Error("Storage " + res.status); }
      return res.blob();
    });
  }

  // Suppression groupée (purge après validation admin).
  function deletePaths(paths) {
    if (!paths || !paths.length || !configured()) { return Promise.resolve({ ok: true, n: 0 }); }
    return fetch(CAEK_CONFIG.SUPABASE_URL + "/storage/v1/object/" + BUCKET, {
      method: "DELETE",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: paths })
    }).then(function (res) {
      return { ok: res.ok, n: res.ok ? paths.length : 0 };
    }).catch(function () { return { ok: false, n: 0 }; });
  }

  return {
    configured: configured,
    uploadForRef: uploadForRef,
    fetchBlob: fetchBlob,
    deletePaths: deletePaths
  };
})();

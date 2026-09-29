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
  function edgeUrl() { return CAEK_CONFIG.SUPABASE_URL + "/functions/v1/media-access"; }
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

  function uuid() {
    if (window.crypto && crypto.randomUUID) { return crypto.randomUUID(); }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) {
      var r = Math.random() * 16 | 0;
      return (ch === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function blobBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || "");
        resolve(s.slice(s.indexOf(",") + 1));
      };
      reader.onerror = function () { reject(reader.error || new Error("lecture_media")); };
      reader.readAsDataURL(blob);
    });
  }

  function uploadEdge(ref, mediaUuid, path, blob, metadata) {
    if (!window.CAEKOperateurs || !CAEKOperateurs.token()) { return Promise.reject(new Error("auth")); }
    return blobBase64(blob).then(function (base64) {
      return fetch(edgeUrl(), {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "upload", token: CAEKOperateurs.token(), coulageRef: ref,
          mediaUuid: mediaUuid, storagePath: path,
          numeroEchantillon: (metadata && metadata.numeroEchantillon) || "",
          mime: (blob && blob.type) || "application/octet-stream",
          taille: (blob && blob.size) || 0, base64: base64
        })
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || body.ok !== true) { throw new Error("media-access " + res.status); }
        return true;
      });
    });
  }

  // Repli de transition : INSERT unique uniquement. L'ancien x-upsert=true
  // exigeait UPDATE, explicitement interdit par les règles Storage Phase 0.
  function uploadDirect(path, blob) {
    return fetch(objUrl(path), {
      method: "POST",
      headers: headers({ "Content-Type": (blob && blob.type) || "application/octet-stream" }),
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

  function register(ref, mediaUuid, path, blob, metadata) {
    if (!window.CAEKServer || !CAEKServer.mediaRegister || !window.CAEKOperateurs) {
      return Promise.resolve(true);
    }
    return CAEKServer.mediaRegister(CAEKOperateurs.token(), {
      uuid: mediaUuid, coulageRef: ref, storagePath: path,
      numeroEchantillon: (metadata && metadata.numeroEchantillon) || "",
      mime: (blob && blob.type) || "", taille: (blob && blob.size) || 0
    }).then(function (r) {
      if (!r || r.ok !== true) { throw new Error((r && r.error) || "media_register"); }
      return true;
    });
  }

  function upload(ref, mediaUuid, path, blob, metadata) {
    return uploadEdge(ref, mediaUuid, path, blob, metadata).catch(function () {
      return uploadDirect(path, blob).then(function () {
        return register(ref, mediaUuid, path, blob, metadata);
      });
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
          var metadata = (ph.metadata && typeof ph.metadata === "object") ? ph.metadata : {};
          if (!ph.mediaUuid) { ph.mediaUuid = uuid(); }
          var keepUuid = (CAEKDB.updatePhoto ? CAEKDB.updatePhoto(ph) : Promise.resolve());
          var path = "coulages/" + ref + "/" + cat + "_" + ph.mediaUuid + "." + extOf(ph.blob, cat);
          return keepUuid.then(function () {
            return upload(ref, ph.mediaUuid, path, ph.blob, metadata);
          }).then(function () {
            medias.push({
              uuid: ph.mediaUuid, path: path, categorie: cat, type: type,
              numeroEchantillon: metadata.numeroEchantillon || ""
            });
          }).catch(function () { incomplet = true; });
        });
      }, Promise.resolve()).then(function () {
        return { medias: medias, incomplet: incomplet };
      });
    }).catch(function () { return { medias: [], incomplet: true }; });
  }

  function fetchBlob(path, ref, mediaUuid) {
    var signed = (ref && mediaUuid && window.CAEKOperateurs && CAEKOperateurs.token())
      ? fetch(edgeUrl(), {
          method: "POST", headers: headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ action: "read", token: CAEKOperateurs.token(),
            coulageRef: ref, mediaUuid: mediaUuid })
        }).then(function (res) { return res.json(); }).then(function (r) {
          if (!r || r.ok !== true || !r.url) { throw new Error("signature_media"); }
          return fetch(r.url);
        })
      : Promise.reject(new Error("manifest_legacy"));
    return signed.catch(function () { return fetch(objUrl(path), { headers: headers() }); }).then(function (res) {
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

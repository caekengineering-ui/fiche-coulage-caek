/* ============================================================
   Fiche de coulage terrain - CAEK
   photos.js - T6 : photos liees a une fiche
   Categories : BL, formulation, prelevement, eprouvettes, anomalie.
   Capture appareil photo, compression canvas, stockage local (IndexedDB).
   ============================================================ */

var CAEKPhotos = (function () {
  "use strict";

  var currentRef = null;     // reference du coulage affiche
  var locked = false;        // fiche verrouillee : pas d'ajout/suppression
  var urls = [];             // object URLs a revoquer

  var MAX_DIM = 1280;        // cote max en pixels
  var QUALITE = 0.7;         // qualite JPEG

  var CAT_LABEL = {
    bl: "Bon de livraison",
    formulation: "Formulation",
    prelevement: "Prélèvement",
    eprouvettes: "Éprouvettes",
    anomalie: "Anomalie"
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function revokeUrls() {
    for (var i = 0; i < urls.length; i++) {
      try { URL.revokeObjectURL(urls[i]); } catch (e) { /* ignore */ }
    }
    urls = [];
  }

  // Charge un fichier image -> compresse -> renvoie un Blob JPEG.
  function compress(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var ratio = Math.min(1, MAX_DIM / Math.max(w, h));
          var cw = Math.round(w * ratio);
          var ch = Math.round(h * ratio);
          var canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, cw, ch);
          canvas.toBlob(function (blob) {
            if (blob) { resolve(blob); }
            else { reject(new Error("Compression impossible.")); }
          }, "image/jpeg", QUALITE);
        };
        img.onerror = function () { reject(new Error("Image illisible.")); };
        img.src = fr.result;
      };
      fr.onerror = function () { reject(new Error("Lecture du fichier impossible.")); };
      fr.readAsDataURL(file);
    });
  }

  function refresh(ref, isLocked) {
    currentRef = ref;
    locked = !!isLocked;
    var zone = $("fc-photos-zone");
    if (zone) { zone.style.display = locked ? "none" : ""; }
    render();
  }

  function render() {
    var grid = $("fc-photos-grid");
    if (!grid) { return; }
    revokeUrls();
    grid.innerHTML = "";
    if (!currentRef || !window.CAEKDB) { return; }
    CAEKDB.getPhotosByRef(currentRef).then(function (list) {
      grid.innerHTML = "";
      if (!list.length) {
        grid.innerHTML = "<p class=\"hint\">Aucune photo pour cette fiche.</p>";
        return;
      }
      list.forEach(function (p) {
        var url = URL.createObjectURL(p.blob);
        urls.push(url);
        var card = document.createElement("div");
        card.className = "photo-card";
        var del = locked ? "" :
          "<button type=\"button\" class=\"photo-del\" data-id=\"" + p.id + "\" title=\"Supprimer\">&#10006;</button>";
        card.innerHTML =
          "<img class=\"photo-thumb\" src=\"" + url + "\" alt=\"\">" +
          "<span class=\"photo-cat\">" + escapeHtml(CAT_LABEL[p.categorie] || p.categorie) + "</span>" +
          del;
        grid.appendChild(card);
      });
    });
  }

  function add(file) {
    if (!file || !currentRef || locked) { return; }
    var cat = $("fc-photo-cat") ? $("fc-photo-cat").value : "anomalie";
    compress(file).then(function (blob) {
      return CAEKDB.addPhoto(currentRef, cat, blob);
    }).then(function () {
      render();
    }).catch(function (err) {
      alert("Erreur photo : " + (err && err.message ? err.message : err));
    });
  }

  function init() {
    var input = $("fc-photo-input");
    if (input) {
      input.addEventListener("change", function () {
        add(input.files && input.files[0]);
        input.value = "";
      });
    }
    var grid = $("fc-photos-grid");
    if (grid) {
      grid.addEventListener("click", function (ev) {
        var btn = ev.target.closest ? ev.target.closest(".photo-del") : null;
        if (!btn || locked) { return; }
        var id = parseInt(btn.getAttribute("data-id"), 10);
        if (isNaN(id)) { return; }
        if (!confirm("Supprimer cette photo ?")) { return; }
        CAEKDB.deletePhoto(id).then(function () { render(); });
      });
    }
  }

  return { init: init, refresh: refresh };
})();

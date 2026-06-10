/* ============================================================
   Fiche de coulage terrain - CAEK
   profil.js - Profil operateur local (nom + qualification).
   Stockage : IndexedDB via le store "meta" (cle "profilOperateur"),
   avec repli localStorage pour affichage immediat hors-ligne.
   Expose CAEKProfil.require() pour les actions importantes.
   ============================================================ */
var CAEKProfil = (function () {
  "use strict";

  var LS_KEY = "caek_profil";
  var META_KEY = "profilOperateur";
  var _cache = null;

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); }
    catch (e) { return null; }
  }
  function writeLocal(p) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(p || null)); } catch (e) {}
  }

  // Profil courant (synchrone). Source : cache memoire, sinon localStorage.
  function get() {
    if (_cache) { return _cache; }
    _cache = readLocal();
    return _cache;
  }

  function isRenseigne() {
    var p = get();
    return !!(p && p.nom);
  }

  function label() {
    var p = get();
    if (!p || !p.nom) { return "Profil opérateur non renseigné"; }
    return p.qualification ? (p.nom + " — " + p.qualification) : p.nom;
  }

  function save(nom, qualification, username) {
    var p = { nom: (nom || "").trim(), qualification: (qualification || "").trim() };
    if (username !== undefined) { p.username = (username || "").trim(); }
    _cache = p.nom ? p : null;
    writeLocal(_cache);
    refreshBar();
    if (window.CAEKDB && CAEKDB.setMeta) {
      return CAEKDB.setMeta(META_KEY, _cache).then(function () { return _cache; });
    }
    return Promise.resolve(_cache);
  }

  function clear() {
    _cache = null;
    writeLocal(null);
    refreshBar();
    if (window.CAEKDB && CAEKDB.setMeta) { return CAEKDB.setMeta(META_KEY, null); }
    return Promise.resolve();
  }

  // Met a jour le bandeau "profil" en haut de l'application.
  function refreshBar() {
    var t = $("profil-bar-text");
    if (t) { t.textContent = label(); }
    var bar = $("profil-bar");
    if (bar) { bar.classList.toggle("is-empty", !isRenseigne()); }
  }

  // Garde-fou pour les actions importantes.
  // Retourne le profil si renseigne, sinon affiche un message, ouvre
  // l'ecran profil et retourne null.
  function require(message) {
    if (isRenseigne()) { return get(); }
    alert(message || "Profil opérateur requis. Veuillez renseigner votre nom et qualification.");
    if (window.CAEKApp) { CAEKApp.navigate("screen-profil"); }
    return null;
  }

  function fillForm() {
    var p = get();
    if ($("profil-nom")) { $("profil-nom").value = (p && p.nom) || ""; }
    if ($("profil-qualif")) { $("profil-qualif").value = (p && p.qualification) || ""; }
  }

  function showResult(html, isError) {
    var box = $("profil-result"); if (!box) { return; }
    box.hidden = false;
    box.className = "result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function init() {
    // Recharge depuis IndexedDB (source durable) puis rafraichit l'affichage.
    if (window.CAEKDB && CAEKDB.getMeta) {
      CAEKDB.getMeta(META_KEY).then(function (p) {
        if (p && p.nom) { _cache = p; writeLocal(p); }
        refreshBar();
      }).catch(function () { refreshBar(); });
    } else {
      refreshBar();
    }

    var save0 = $("profil-save");
    if (save0) {
      save0.addEventListener("click", function () {
        var nom = ($("profil-nom") && $("profil-nom").value || "").trim();
        if (!nom) { showResult("&#9888; Le nom de l'opérateur est obligatoire.", true); return; }
        var qualif = ($("profil-qualif") && $("profil-qualif").value || "").trim();
        save(nom, qualif).then(function () {
          showResult("&#10004; Profil enregistré : <strong>" + escapeHtml(label()) + "</strong>.", false);
        });
      });
    }
    var clr = $("profil-clear");
    if (clr) {
      clr.addEventListener("click", function () {
        if (!confirm("Effacer le profil opérateur ?")) { return; }
        clear().then(function () { fillForm(); showResult("Profil effacé.", false); });
      });
    }
  }

  return {
    init: init,
    get: get,
    isRenseigne: isRenseigne,
    label: label,
    save: save,
    clear: clear,
    require: require,
    refreshBar: refreshBar,
    fillForm: fillForm
  };
})();

/* ============================================================
   Module Béton - CAEK
   labofilter.js - V3 (P5) : sélecteur de laboratoire (ADMIN).

   Un opérateur ne voit que SON labo (scope serveur) : le filtre
   ne s'applique QU'À l'administrateur, qui reçoit les données de
   tous les labos. Il choisit « Tous » ou un labo précis pour
   observer ce qui s'y passe (répertoire, bassin, écrasements).

   match(laboId) : contrôle TOUJOURS le périmètre de la session avant
   d'appliquer l'éventuel filtre d'affichage administrateur.
   Utilisé par repertoire.js / bassin.js / compression.js / badges.js.
   ============================================================ */
var CAEKLaboFilter = (function () {
  "use strict";

  var LS = "caek_labo_filter";
  var _labos = [];

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function isAdmin() { return !!(window.CAEKOperateurs && CAEKOperateurs.isAdmin()); }

  function get() {
    if (!isAdmin()) { return ""; }
    try { return localStorage.getItem(LS) || ""; } catch (e) { return ""; }
  }
  function set(id) {
    try { if (id) { localStorage.setItem(LS, id); } else { localStorage.removeItem(LS); } } catch (e) {}
  }

  // Cœur du filtre : le serveur reste la source d'autorité, mais le cache
  // local ne doit jamais exposer les données d'une session précédente.
  function match(laboId) {
    var s = (window.CAEKOperateurs && CAEKOperateurs.session)
      ? CAEKOperateurs.session() : null;
    if (!s) { return false; }
    var id = String(laboId || "");
    if (!isAdmin()) {
      return !!s.labo_id && id === String(s.labo_id);
    }
    var allowed = (window.CAEKOperateurs && CAEKOperateurs.adminLabos)
      ? CAEKOperateurs.adminLabos() : null;
    if (allowed && allowed.length && allowed.indexOf(id) < 0) { return false; }
    var f = get();
    if (!f) { return true; }
    return id === String(f);
  }

  function laboNom(id) {
    for (var i = 0; i < _labos.length; i++) { if (_labos[i].id === id) { return _labos[i].nom; } }
    return "";
  }

  function fillSelect() {
    var sel = $("labo-filter");
    var bar = $("labo-filter-bar");
    if (!sel || !bar) { return; }
    bar.hidden = !isAdmin();
    if (!isAdmin()) { return; }
    var cur = get();
    var html = "<option value=\"\">Tous les laboratoires</option>";
    _labos.forEach(function (b) {
      html += "<option value=\"" + escapeHtml(b.id) + "\"" + (b.id === cur ? " selected" : "") + ">" +
        "🏢 " + escapeHtml(b.nom) + "</option>";
    });
    sel.innerHTML = html;
    if (cur) { sel.value = cur; }
  }

  function refresh() {
    if (!isAdmin() || !window.CAEKServer || !CAEKServer.configured() || navigator.onLine === false) {
      fillSelect();
      return Promise.resolve();
    }
    return CAEKServer.adminListLabos(CAEKOperateurs.token()).then(function (r) {
      _labos = (r && r.labos) || [];
      // Admin scopé : ne proposer QUE ses laboratoires autorisés.
      var allowed = CAEKOperateurs.adminLabos ? CAEKOperateurs.adminLabos() : null;
      if (allowed && allowed.length) {
        _labos = _labos.filter(function (b) { return allowed.indexOf(b.id) >= 0; });
        var cur = get();
        if (cur && allowed.indexOf(cur) < 0) { set(""); }   // filtre invalide -> réinit
      }
      fillSelect();
    }).catch(function () { fillSelect(); });
  }

  // Rafraîchit l'écran courant après changement de filtre.
  function refreshCurrent() {
    if (window.CAEKBadges) { CAEKBadges.refresh(); }
    var active = document.querySelector(".screen.is-active");
    var id = active ? active.id : "";
    if (id === "screen-repertoire" && window.CAEKRepertoire) { CAEKRepertoire.refresh(); }
    if ((id === "screen-bassin" || id === "screen-bassin-virtuel") && window.CAEKBassin) { CAEKBassin.refreshBassin(); }
    if (id === "screen-repartir" && window.CAEKBassin) { CAEKBassin.refreshRepartir(); }
    if ((id === "screen-compression" || id === "screen-comp-atester" ||
      id === "screen-comp-historique") && window.CAEKCompression) { CAEKCompression.refresh(); }
    if (id === "screen-validation" && window.CAEKValidation) { CAEKValidation.refresh(); }
  }

  function onChange() {
    var sel = $("labo-filter");
    if (!sel) { return; }
    set(sel.value);
    refreshCurrent();
  }

  function init() {
    var sel = $("labo-filter");
    if (sel) { sel.addEventListener("change", onChange); }
    setTimeout(refresh, 1600);
  }

  return {
    init: init, refresh: refresh, fillSelect: fillSelect,
    get: get, match: match, laboNom: laboNom
  };
})();

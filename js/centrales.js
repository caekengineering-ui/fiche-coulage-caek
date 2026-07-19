/* ============================================================
   Module Béton - CAEK
   centrales.js - Phase 2 : référentiel des CENTRALES (fournisseurs
   de béton), porté au niveau du COULAGE.

   - Liste serveur (op_list_centrales), cache hors-ligne (meta
     "centralesList"), mêmes principes que formulations.js.
   - Remplit le sélecteur fc-centrale de la fiche (avec « Autre… »
     pour une centrale inconnue : la valeur saisie reste stable).
   ============================================================ */
var CAEKCentrales = (function () {
  "use strict";

  var META_KEY = "centralesList";
  var _list = [];

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function ready() {
    return !!(window.CAEKServer && CAEKServer.configured() &&
      window.CAEKOperateurs && CAEKOperateurs.isLogged());
  }

  function fillSelect() {
    var sel = $("fc-centrale");
    if (!sel) { return; }
    var cur = sel.value;
    var html = "<option value=\"\">— Choisir —</option>";
    _list.forEach(function (c) {
      html += "<option value=\"" + escapeHtml(c.nom) + "\">" + escapeHtml(c.nom) + "</option>";
    });
    html += "<option value=\"autre\">Autre…</option>";
    sel.innerHTML = html;
    if (cur) { sel.value = cur; }
  }

  function refresh() {
    if (!ready() || navigator.onLine === false) { return Promise.resolve(false); }
    return CAEKServer.listCentrales(CAEKOperateurs.token()).then(function (rows) {
      _list = rows || [];
      if (window.CAEKDB && CAEKDB.setMeta) { CAEKDB.setMeta(META_KEY, _list); }
      fillSelect();
      return true;
    }).catch(function () { return false; });   // RPC absente (serveur non migré) : cache/fallback
  }

  function loadCache() {
    if (!window.CAEKDB || !CAEKDB.getMeta) { return Promise.resolve(); }
    return CAEKDB.getMeta(META_KEY).then(function (l) {
      if (Array.isArray(l)) { _list = l; fillSelect(); }
    }).catch(function () {});
  }

  function init() {
    loadCache().then(function () { setTimeout(refresh, 1000); });
  }

  return {
    init: init,
    refresh: refresh,
    fillSelect: fillSelect,
    getCached: function () { return _list.slice(); }
  };
})();

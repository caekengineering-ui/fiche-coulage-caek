/* ============================================================
   Fiche de coulage terrain - CAEK
   dechets.js - V2.03 : module "Gestion déchets" du bassin.

   Suit les eprouvettes cassees apres essai de compression :
   chaque essai valide alimente un compteur global de dechets beton.
   Stockage dans les meta (pas de changement de schema IndexedDB) :
     dechetsStock        : nombre d'eprouvettes cassees en stock ;
     dechetsSeuil        : seuil d'alerte (defaut 300) ;
     dechetsPoidsMoyen   : poids moyen kg/eprouvette (defaut 8) ;
     dechetsEvacuations  : historique [{date, quantite, observation, operateur, resteApres}].

   L'historique compression n'est JAMAIS modifie : on ne fait que
   gerer un stock de dechets et son historique d'evacuations.
   ============================================================ */

var CAEKDechets = (function () {
  "use strict";

  var DEFAULT_SEUIL = 300;
  var DEFAULT_POIDS = 8;

  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? 0 : n; }
  function intOr0(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function nowTime() { var d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function fmtDate(d) {
    if (!d) { return "—"; }
    var s = String(d); if (s.indexOf("T") >= 0) { s = s.slice(0, 10); }
    var p = s.split("-"); return p.length === 3 ? (p[2] + "/" + p[1] + "/" + p[0]) : s;
  }

  // Lit les parametres + le stock (avec valeurs par defaut).
  function getParams() {
    if (!window.CAEKDB) {
      return Promise.resolve({ stock: 0, seuil: DEFAULT_SEUIL, poidsMoyen: DEFAULT_POIDS, evacuations: [] });
    }
    return Promise.all([
      CAEKDB.getMeta("dechetsStock"), CAEKDB.getMeta("dechetsSeuil"),
      CAEKDB.getMeta("dechetsPoidsMoyen"), CAEKDB.getMeta("dechetsEvacuations")
    ]).then(function (o) {
      return {
        stock: intOr0(o[0]),
        seuil: (o[1] == null) ? DEFAULT_SEUIL : intOr0(o[1]),
        poidsMoyen: (o[2] == null) ? DEFAULT_POIDS : num(o[2]),
        evacuations: Array.isArray(o[3]) ? o[3] : []
      };
    });
  }

  // Ajoute n eprouvettes cassees au stock (appele apres validation d'un essai).
  function addCasse(n) {
    n = intOr0(n);
    if (n <= 0 || !window.CAEKDB) { return Promise.resolve(); }
    return CAEKDB.getMeta("dechetsStock").then(function (v) {
      return CAEKDB.setMeta("dechetsStock", intOr0(v) + n);
    });
  }

  function result(html, isError) {
    var b = $("dechets-result"); if (!b) { return; }
    b.hidden = false;
    b.className = "result-card " + (isError ? "is-error" : "is-ok");
    b.innerHTML = html;
  }

  function renderEvac(list) {
    var box = $("dechets-evac-liste"); if (!box) { return; }
    if (!list || !list.length) { box.innerHTML = "<p class=\"hint\">Aucune évacuation enregistrée.</p>"; return; }
    box.innerHTML = list.slice().reverse().map(function (e) {
      return "<div class=\"dechets-evac-item\">" +
        "<strong>" + intOr0(e.quantite) + " éprouvette(s)</strong> évacuée(s) · " + escapeHtml(fmtDate(e.date)) +
        (e.operateur ? " · " + escapeHtml(e.operateur) : "") +
        " · reste " + intOr0(e.resteApres) +
        (e.observation ? "<br>📝 " + escapeHtml(e.observation) : "") +
        "</div>";
    }).join("");
  }

  function refresh() {
    getParams().then(function (p) {
      var poids = Math.round(p.stock * p.poidsMoyen * 10) / 10;
      if ($("dechets-stock")) { $("dechets-stock").textContent = p.stock; }
      if ($("dechets-poids")) { $("dechets-poids").textContent = poids; }
      if ($("dechets-seuil-aff")) { $("dechets-seuil-aff").textContent = p.seuil; }
      if ($("dechets-seuil") && document.activeElement !== $("dechets-seuil")) { $("dechets-seuil").value = p.seuil; }
      if ($("dechets-poidsmoyen") && document.activeElement !== $("dechets-poidsmoyen")) { $("dechets-poidsmoyen").value = p.poidsMoyen; }
      var al = $("dechets-alerte");
      if (al) {
        if (p.seuil > 0 && p.stock >= p.seuil) {
          al.hidden = false; al.className = "bassin-alerte is-retard";
          al.innerHTML = "&#9888; Seuil atteint (" + p.stock + "/" + p.seuil +
            "). Prévoir évacuation des déchets béton / camion.";
        } else { al.hidden = true; }
      }
      renderEvac(p.evacuations);
    });
  }

  function saveParams() {
    if (window.CAEKOperateurs && !CAEKOperateurs.requireAdmin("modifier les paramètres déchets")) { return; }
    var seuil = intOr0($("dechets-seuil") ? $("dechets-seuil").value : 0);
    var pm = num($("dechets-poidsmoyen") ? $("dechets-poidsmoyen").value : 0);
    if (seuil <= 0) { result("&#9888; Le seuil doit être supérieur à 0.", true); return; }
    if (pm <= 0) { result("&#9888; Le poids moyen doit être supérieur à 0.", true); return; }
    Promise.all([CAEKDB.setMeta("dechetsSeuil", seuil), CAEKDB.setMeta("dechetsPoidsMoyen", pm)]).then(function () {
      result("&#10004; Paramètres enregistrés.", false);
      refresh();
      if (window.CAEKBadges) { CAEKBadges.refresh(); }
    });
  }

  function confirmEvac() {
    var prof = window.CAEKProfil
      ? CAEKProfil.require("Profil opérateur requis pour confirmer une évacuation.")
      : { nom: "", qualification: "" };
    if (!prof) { return; }
    var qte = intOr0($("dechets-evac-qte") ? $("dechets-evac-qte").value : 0);
    if (qte <= 0) { result("&#9888; Indiquez la quantité évacuée.", true); return; }
    getParams().then(function (p) {
      if (qte > p.stock) { result("&#9888; Quantité supérieure au stock (" + p.stock + ").", true); return; }
      var reste = p.stock - qte;
      var evac = {
        date: todayStr(), heure: nowTime(), quantite: qte,
        observation: ($("dechets-evac-obs") && $("dechets-evac-obs").value.trim()) || "",
        operateur: prof.nom || "", qualification: prof.qualification || "",
        resteApres: reste, at: new Date().toISOString()
      };
      var list = p.evacuations.concat([evac]);
      Promise.all([CAEKDB.setMeta("dechetsStock", reste), CAEKDB.setMeta("dechetsEvacuations", list)]).then(function () {
        if ($("dechets-evac-qte")) { $("dechets-evac-qte").value = ""; }
        if ($("dechets-evac-obs")) { $("dechets-evac-obs").value = ""; }
        result("&#10004; Évacuation enregistrée. Reste " + reste + " éprouvette(s) en stock.", false);
        refresh();
        if (window.CAEKBadges) { CAEKBadges.refresh(); }
      });
    });
  }

  function init() {
    var sp = $("dechets-params-save"); if (sp) { sp.addEventListener("click", saveParams); }
    var ev = $("dechets-evac-valider"); if (ev) { ev.addEventListener("click", confirmEvac); }
  }

  return { init: init, refresh: refresh, addCasse: addCasse, getParams: getParams };
})();

/* ============================================================
   Fiche de coulage terrain - CAEK
   repertoire.js - T5 : liste des fiches + recherche/filtre
   Ouvre une fiche (brouillon = modifiable ; validee/envoyee = lecture seule).
   ============================================================ */

var CAEKRepertoire = (function () {
  "use strict";

  var _all = [];
  var _statut = "";

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fmtDate(d) {
    if (!d) { return ""; }
    var s = String(d);
    if (s.indexOf("T") >= 0) { s = s.slice(0, 10); }
    var parts = s.split("-");
    return parts.length === 3 ? (parts[2] + "/" + parts[1] + "/" + parts[0]) : s;
  }

  var STATUT_LABEL = { brouillon: "Brouillon", envoyee: "Envoyé" };

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  // Totaux terrain : quantite (m3) et nombre d'eprouvettes sur tous les malaxeurs.
  function totaux(c) {
    var mals = c.malaxeurs || [];
    var qte = 0, epr = 0;
    for (var i = 0; i < mals.length; i++) {
      qte += num(mals[i].quantite);
      if (mals[i].preleve) { epr += num(mals[i].eprNombre); }
    }
    return { qte: qte, epr: epr };
  }

  function refresh() {
    if (!window.CAEKDB) { return; }
    CAEKDB.getAllCoulages().then(function (list) {
      list.sort(function (a, b) {
        var da = a.dateModification || a.dateCreation || "";
        var db = b.dateModification || b.dateCreation || "";
        return db.localeCompare(da);
      });
      _all = list;
      render();
    });
  }

  function render() {
    var search = ($("rep-search") ? $("rep-search").value : "").trim().toLowerCase();
    var box = $("rep-liste");
    if (!box) { return; }

    var filtered = _all.filter(function (c) {
      if (_statut && (c.statut || "brouillon") !== _statut) { return false; }
      if (!search) { return true; }
      var hay = [c.ref, c.codeProjet, c.entreprise, c.client, c.nomProjet,
        fmtDate(c.dateCoulage), c.dateCoulage].join(" ").toLowerCase();
      return hay.indexOf(search) >= 0;
    });

    if ($("rep-count")) {
      $("rep-count").textContent = filtered.length + " fiche(s)";
    }

    if (!filtered.length) {
      box.innerHTML = "<p class=\"screen-placeholder\">Aucune fiche enregistrée pour ce filtre.</p>";
      return;
    }

    box.innerHTML = filtered.map(function (c) {
      var st = c.statut || "brouillon";
      var t = totaux(c);
      return "<div class=\"rep-item\" data-ref=\"" + escapeHtml(c.ref) + "\">" +
        "<button type=\"button\" class=\"rep-open\" data-ref=\"" + escapeHtml(c.ref) + "\">" +
        "<div class=\"rep-top\"><span class=\"rep-ref\">" + escapeHtml(c.ref) + "</span>" +
        "<span class=\"badge badge-" + st + "\">" + (STATUT_LABEL[st] || st) + "</span></div>" +
        "<div class=\"rep-ent\">" + escapeHtml(c.client || c.entreprise || "—") + "</div>" +
        "<div class=\"rep-sub\">" + escapeHtml(c.nomProjet || "") +
        (c.dateCoulage ? " · " + escapeHtml(fmtDate(c.dateCoulage)) : "") + "</div>" +
        "<div class=\"rep-tot\">" + t.qte + " m³ · " + t.epr + " éprouvette(s)</div>" +
        "</button>" +
        "<button type=\"button\" class=\"rep-del\" data-del=\"" + escapeHtml(c.ref) + "\" " +
        "aria-label=\"Supprimer la fiche " + escapeHtml(c.ref) + "\" title=\"Supprimer\">&#128465;</button>" +
        "</div>";
    }).join("");
  }

  function init() {
    var s = $("rep-search");
    if (s) { s.addEventListener("input", render); }

    var chips = $("rep-filtres");
    if (chips) {
      chips.addEventListener("click", function (ev) {
        var c = ev.target.closest ? ev.target.closest(".chip") : null;
        if (!c) { return; }
        _statut = c.getAttribute("data-statut") || "";
        var all = chips.querySelectorAll(".chip");
        for (var i = 0; i < all.length; i++) { all[i].classList.remove("is-active"); }
        c.classList.add("is-active");
        render();
      });
    }

    var box = $("rep-liste");
    if (box) {
      box.addEventListener("click", function (ev) {
        var del = ev.target.closest ? ev.target.closest(".rep-del") : null;
        if (del) {
          ev.stopPropagation();
          var dref = del.getAttribute("data-del");
          if (!dref) { return; }
          if (window.confirm("Voulez-vous vraiment supprimer la fiche " + dref + " ? Cette action est irréversible.")) {
            CAEKDB.deleteCoulage(dref).then(function () { refresh(); });
          }
          return;
        }
        var open = ev.target.closest ? ev.target.closest(".rep-open") : null;
        if (!open) { return; }
        var ref = open.getAttribute("data-ref");
        if (ref && window.CAEKFiche) { CAEKFiche.open(ref); }
      });
    }
  }

  return { init: init, refresh: refresh };
})();

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

  var STATUT_LABEL = { brouillon: "brouillon", validee: "validée", envoyee: "envoyée" };

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
      return "<button type=\"button\" class=\"rep-item\" data-ref=\"" + escapeHtml(c.ref) + "\">" +
        "<div class=\"rep-top\"><span class=\"rep-ref\">" + escapeHtml(c.ref) + "</span>" +
        "<span class=\"badge badge-" + st + "\">" + (STATUT_LABEL[st] || st) + "</span></div>" +
        "<div class=\"rep-ent\">" + escapeHtml(c.client || c.entreprise || "—") + "</div>" +
        "<div class=\"rep-sub\">" + escapeHtml(c.nomProjet || "") +
        (c.dateCoulage ? " · " + escapeHtml(fmtDate(c.dateCoulage)) : "") + "</div>" +
        "</button>";
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
        var item = ev.target.closest ? ev.target.closest(".rep-item") : null;
        if (!item) { return; }
        var ref = item.getAttribute("data-ref");
        if (ref && window.CAEKFiche) { CAEKFiche.open(ref); }
      });
    }
  }

  return { init: init, refresh: refresh };
})();

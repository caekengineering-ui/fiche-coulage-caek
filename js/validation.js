/* ============================================================
   Module Béton - CAEK
   validation.js - V3 : écran ADMIN « Validation des coulages ».

   Rôle de la validation (jamais bloquante pour le terrain) :
   confirmer la désignation exacte de l'ouvrage coulé et la
   formulation. L'admin examine le récapitulatif soumis puis :
     - ✔ Valider  (admin_valider_coulage : statut 'valide', figé) ;
     - ↩ Renvoyer (admin_renvoyer_coulage : retour brouillon + motif,
       l'opérateur corrige et resoumet).
   En Phase 3-lot 2 : affichage photo formulation (BL) + audios,
   et purge des médias du Storage après validation.
   ============================================================ */
var CAEKValidation = (function () {
  "use strict";

  var _rows = [];        // coulages 'soumis' (lignes serveur)
  var _labos = {};       // id -> nom
  var _openRef = null;   // détail déplié

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function ready() {
    return !!(window.CAEKServer && CAEKServer.configured() &&
      window.CAEKOperateurs && CAEKOperateurs.isAdmin());
  }
  function fmtDate(d) {
    if (!d) { return "—"; }
    var s = String(d);
    if (s.indexOf("T") >= 0) { s = s.slice(0, 10); }
    var p = s.split("-");
    return p.length === 3 ? (p[2] + "/" + p[1] + "/" + p[0]) : s;
  }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  /* ---------- Récapitulatif d'un coulage soumis ---------- */
  function formulationHtml(f) {
    if (!f) { return "—"; }
    if (f.mode === "photo") { return "📷 Photo du BL (visible en lot 2)"; }
    var parts = [];
    if (f.fournisseur) { parts.push(escapeHtml(f.fournisseur)); }
    if (f.classe) { parts.push(escapeHtml(f.classe)); }
    if (f.ciment) { parts.push("Ciment " + escapeHtml(f.ciment)); }
    if (f.dosage) { parts.push(escapeHtml(f.dosage) + " kg/m³"); }
    if (f.dmax) { parts.push("Dmax " + escapeHtml(f.dmax)); }
    if (f.adjuvant) { parts.push(escapeHtml(f.adjuvant)); }
    return parts.length ? parts.join(" · ") : "—";
  }

  function detailHtml(c) {
    var mals = c.malaxeurs || [];
    var qte = 0;
    mals.forEach(function (m) { qte += num(m.quantite); });
    qte = Math.round(qte * 100) / 100;
    var epr = window.CAEKModel ? CAEKModel.totalEprouvettes(c) : 0;

    var ouvr = Array.isArray(c.ouvrages) ? c.ouvrages.join(" + ") : (c.ouvrages || "—");
    var blocEtage = [c.bloc, c.etage].filter(Boolean).join(" · ") || "—";

    var malRows = mals.map(function (m, i) {
      var prel = (m.preleve === true)
        ? ("✔ " + (m.prelNombre || 0) + " épr. " + (m.prelType || "cube")) : "—";
      return "<div class=\"valid-mal\">" +
        "<div class=\"valid-mal-head\"><strong>Malaxeur " + (i + 1) + "</strong>" +
        (m.heure ? " · " + escapeHtml(m.heure) : "") +
        (m.quantite ? " · " + escapeHtml(String(m.quantite)) + " m³" : "") +
        (m.affaissement ? " · Aff. " + escapeHtml(String(m.affaissement)) + " cm" : "") +
        (m.temperature ? " · " + escapeHtml(String(m.temperature)) + " °C" : "") + "</div>" +
        "<div class=\"valid-mal-form\">&#129514; Formulation : " + formulationHtml(m.formulation) + "</div>" +
        "<div class=\"valid-mal-prel\">Prélèvement : " + prel + "</div>" +
        "</div>";
    }).join("");

    var codif = "";
    if (window.CAEKModel && epr > 0) {
      codif = CAEKModel.codification(c).map(function (p) {
        return "<div class=\"valid-codif\"><strong>" + escapeHtml(p.numero) + "</strong> (" +
          escapeHtml(p.type) + ", " + p.nombre + " épr.) : " +
          escapeHtml(p.premier) + (p.nombre > 1 ? " → " + escapeHtml(p.dernier) : "") + "</div>";
      }).join("");
    }

    return "<div class=\"valid-detail\">" +
      "<div class=\"valid-line\"><strong>Client :</strong> " + escapeHtml(c.client || c.entreprise || "—") + "</div>" +
      "<div class=\"valid-line\"><strong>Projet :</strong> " + escapeHtml(c.nomProjet || "—") +
        (c.codeProjet ? " (" + escapeHtml(c.codeProjet) + ")" : "") + "</div>" +
      "<div class=\"valid-line\"><strong>Date du coulage :</strong> " + fmtDate(c.dateCoulage) + "</div>" +
      "<div class=\"valid-line\"><strong>Ouvrage(s) coulé(s) :</strong> " + escapeHtml(ouvr) + "</div>" +
      "<div class=\"valid-line\"><strong>Bloc / étage :</strong> " + escapeHtml(blocEtage) + "</div>" +
      "<div class=\"valid-line\"><strong>Totaux :</strong> " + qte + " m³ · " + epr + " éprouvette(s)</div>" +
      malRows + codif +
      "<div class=\"oper-actions\">" +
      "<button type=\"button\" class=\"btn-primary\" data-act=\"valider\" data-ref=\"" + escapeHtml(c.ref) + "\">&#9989; Valider ce coulage</button>" +
      "<button type=\"button\" class=\"btn-secondary\" data-act=\"renvoyer\" data-ref=\"" + escapeHtml(c.ref) + "\">&#8617; Renvoyer pour correction</button>" +
      "</div>" +
      "<div class=\"valid-result result-card\" hidden></div>" +
      "</div>";
  }

  function itemHtml(row) {
    var c = row.payload || {};
    var open = (row.ref === _openRef);
    var labo = _labos[row.labo_id] || "—";
    return "<div class=\"rep-item\" data-ref=\"" + escapeHtml(row.ref) + "\">" +
      "<div class=\"rep-row\">" +
      "<button type=\"button\" class=\"rep-open valid-toggle\" data-ref=\"" + escapeHtml(row.ref) + "\">" +
      "<div class=\"rep-top\"><span class=\"rep-ref\">" + escapeHtml(row.ref) + "</span>" +
      "<span class=\"badge badge-soumis\">Soumis</span></div>" +
      "<div class=\"rep-ent\">" + escapeHtml(c.client || c.entreprise || "—") + "</div>" +
      "<div class=\"rep-sub\">&#127970; " + escapeHtml(labo) + " · Opérateur : " +
        escapeHtml(row.operateur || "—") +
        (c.dateCoulage ? " · " + fmtDate(c.dateCoulage) : "") + "</div>" +
      "</button></div>" +
      (open ? detailHtml(c) : "") +
      "</div>";
  }

  function render() {
    var box = $("valid-liste");
    if (!box) { return; }
    if (!_rows.length) {
      box.innerHTML = "<p class=\"screen-placeholder\">&#10004; Aucun coulage en attente de validation.</p>";
    } else {
      box.innerHTML = _rows.map(itemHtml).join("");
    }
    var cnt = $("valid-count");
    if (cnt) { cnt.textContent = _rows.length + " coulage(s) soumis"; }
    updateBadgeDisplay(_rows.length);
  }

  function updateBadgeDisplay(n) {
    var b = $("badge-validation");
    if (!b) { return; }
    if (n > 0) { b.textContent = n; b.hidden = false; } else { b.hidden = true; }
  }

  function refresh() {
    var box = $("valid-liste");
    if (!ready()) {
      if (box) { box.innerHTML = "<p class=\"hint\">&#128274; Écran réservé à l'administrateur (réseau requis).</p>"; }
      return Promise.resolve();
    }
    return Promise.all([
      CAEKServer.listCoulages(CAEKOperateurs.token(), null),
      CAEKServer.adminListLabos(CAEKOperateurs.token())
    ]).then(function (out) {
      _labos = {};
      ((out[1] && out[1].labos) || []).forEach(function (b) { _labos[b.id] = b.nom; });
      _rows = (out[0] || []).filter(function (r) { return r.statut === "soumis"; });
      render();
    }).catch(function (e) {
      if (box) { box.innerHTML = "<p class=\"hint\">&#9888; Chargement impossible (réseau requis) : " + escapeHtml(e && e.message || "") + "</p>"; }
    });
  }

  // Badge accueil (appelé à l'affichage de l'accueil, admin en ligne).
  function updateBadge() {
    if (!ready() || navigator.onLine === false) { return; }
    CAEKServer.listCoulages(CAEKOperateurs.token(), null).then(function (rows) {
      var n = (rows || []).filter(function (r) { return r.statut === "soumis"; }).length;
      updateBadgeDisplay(n);
    }).catch(function () {});
  }

  /* ---------- Actions ---------- */
  function resultBox(itemEl, html, isError) {
    var box = itemEl ? itemEl.querySelector(".valid-result") : null;
    if (!box) { return; }
    box.hidden = false;
    box.className = "valid-result result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function findRow(ref) {
    for (var i = 0; i < _rows.length; i++) { if (_rows[i].ref === ref) { return _rows[i]; } }
    return null;
  }

  function valider(ref, itemEl) {
    var row = findRow(ref);
    if (!row) { return; }
    if (!window.confirm("Valider le coulage " + ref + " ?\nLa désignation de l'ouvrage et la formulation sont confirmées. La fiche sera figée.")) { return; }
    CAEKServer.adminValiderCoulage(CAEKOperateurs.token(), ref, row.payload).then(function (r) {
      if (!r || r.ok !== true) {
        resultBox(itemEl, "&#9888; " + (r && r.error === "deja_valide" ? "Déjà validé." : "Échec de la validation."), true);
        return;
      }
      resultBox(itemEl, "&#10004; Coulage validé.", false);
      if (window.CAEKCoulages) { CAEKCoulages.pull(); }
      setTimeout(refresh, 600);
    }).catch(function (e) { resultBox(itemEl, "&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
  }

  function renvoyer(ref, itemEl) {
    var motif = window.prompt("Motif du renvoi (visible par l'opérateur) :", "");
    if (motif == null) { return; }
    motif = String(motif).trim();
    if (!motif) { resultBox(itemEl, "&#9888; Indiquez un motif.", true); return; }
    CAEKServer.adminRenvoyerCoulage(CAEKOperateurs.token(), ref, motif).then(function (r) {
      if (!r || r.ok !== true) { resultBox(itemEl, "&#9888; Échec du renvoi.", true); return; }
      resultBox(itemEl, "&#8617; Renvoyé à l'opérateur : la fiche repasse en brouillon.", false);
      if (window.CAEKCoulages) { CAEKCoulages.pull(); }
      setTimeout(refresh, 600);
    }).catch(function (e) { resultBox(itemEl, "&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
  }

  function onClick(ev) {
    var tgt = ev.target;
    var item = tgt.closest ? tgt.closest(".rep-item") : null;
    var act = tgt.closest ? tgt.closest("[data-act]") : null;
    if (act) {
      var a = act.getAttribute("data-act");
      var ref = act.getAttribute("data-ref");
      if (a === "valider") { valider(ref, item); }
      else if (a === "renvoyer") { renvoyer(ref, item); }
      return;
    }
    var tog = tgt.closest ? tgt.closest(".valid-toggle") : null;
    if (tog) {
      var r = tog.getAttribute("data-ref");
      _openRef = (_openRef === r) ? null : r;
      render();
    }
  }

  function init() {
    var box = $("valid-liste");
    if (box) { box.addEventListener("click", onClick); }
  }

  return { init: init, refresh: refresh, updateBadge: updateBadge };
})();

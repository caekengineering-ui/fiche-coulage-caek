/* ============================================================
   Module Béton - CAEK
   formulations.js - V3 (P4) : catalogue de formulations.

   Catalogue GLOBAL (tous laboratoires), groupé par FOURNISSEUR
   (ex. « BTPH HASNAOUI » -> N°01, N°02...).

   - Opérateur : choisit un « modèle enregistré » dans l'étape
     formulation du malaxeur (les champs se remplissent seuls) ;
     peut PROPOSER la formulation saisie comme nouveau modèle.
   - Admin : valide les propositions, crée/supprime des modèles
     (section Formulations de l'écran Administration).
   - Hors-ligne : la liste des modèles validés est mise en cache
     (meta "formulationsList") et resynchronisée avec les
     référentiels (sync.js).
   ============================================================ */
var CAEKFormulations = (function () {
  "use strict";

  var META_KEY = "formulationsList";
  var _list = [];     // modèles validés+actifs (cache)
  var _admin = [];    // liste complète (écran admin)

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function ready() {
    return !!(window.CAEKServer && CAEKServer.configured() &&
      window.CAEKOperateurs && CAEKOperateurs.isLogged());
  }

  /* ---------- Cache + rafraîchissement ---------- */
  function refresh() {
    if (!ready() || navigator.onLine === false) { return Promise.resolve(false); }
    return CAEKServer.listFormulations(CAEKOperateurs.token()).then(function (rows) {
      _list = rows || [];
      if (window.CAEKDB && CAEKDB.setMeta) { CAEKDB.setMeta(META_KEY, _list); }
      fillSelect();
      return true;
    }).catch(function () { return false; });
  }

  function loadCache() {
    if (!window.CAEKDB || !CAEKDB.getMeta) { return Promise.resolve(); }
    return CAEKDB.getMeta(META_KEY).then(function (l) {
      if (Array.isArray(l)) { _list = l; fillSelect(); }
    }).catch(function () {});
  }

  /* ---------- Sélecteur de modèle (étape malaxeur) ---------- */
  function fillSelect() {
    var sel = $("fc-mal-modele");
    if (!sel) { return; }
    var cur = sel.value;
    var html = "<option value=\"\">— Choisir un modèle (facultatif) —</option>";
    var byFour = {};
    _list.forEach(function (f) {
      var k = f.fournisseur || "Autres";
      (byFour[k] = byFour[k] || []).push(f);
    });
    Object.keys(byFour).sort().forEach(function (four) {
      html += "<optgroup label=\"" + escapeHtml(four) + "\">";
      byFour[four].forEach(function (f) {
        html += "<option value=\"" + escapeHtml(f.id) + "\">" + escapeHtml(four) + " — " + escapeHtml(f.nom) + "</option>";
      });
      html += "</optgroup>";
    });
    sel.innerHTML = html;
    if (cur) { sel.value = cur; }
  }

  // Remplit un select "preset + Autre…" de la fiche avec une valeur libre.
  function setSelect(selId, value) {
    var s = $(selId), a = $(selId + "-autre");
    if (!s) { return; }
    value = value == null ? "" : String(value);
    if (!value) {
      s.value = "";
      if (a) { a.hidden = true; a.value = ""; }
      return;
    }
    var found = false;
    for (var i = 0; i < s.options.length; i++) {
      if (s.options[i].value !== "autre" && s.options[i].value === value) { found = true; break; }
    }
    if (found) {
      s.value = value;
      if (a) { a.hidden = true; a.value = ""; }
    } else {
      s.value = "autre";
      if (a) { a.hidden = false; a.value = value; }
    }
  }

  function setInput(id, value) {
    var e = $(id);
    if (e) { e.value = value == null ? "" : value; }
  }

  function findModele(id) {
    for (var i = 0; i < _list.length; i++) { if (_list[i].id === id) { return _list[i]; } }
    return null;
  }

  function applyById(id) {
    var f = findModele(id);
    if (!f) { return false; }
    var p = f.payload || {};
    var four = $("fc-mal-fournisseur");
    if (four) { four.value = f.fournisseur || ""; }
    setSelect("fc-mal-classe", p.classe || "");
    setSelect("fc-mal-ciment", p.ciment || "");
    setInput("fc-mal-ciment-prov", p.cimentProvenance || "");
    setSelect("fc-mal-dosage", p.dosage || "");
    setSelect("fc-mal-dmax", p.dmax || "");
    setSelect("fc-mal-adjuvant", p.adjuvant || "");
    setInput("fc-mal-adjuvant-dosage", p.adjuvantDosage || "");
    setInput("fc-mal-adjuvant-prov", p.adjuvantProvenance || "");
    setInput("fc-mal-sable1-fraction", p.sable1Fraction || "");
    setInput("fc-mal-sable1-qte", p.sable1Qte || "");
    setInput("fc-mal-sable1-prov", p.sable1Provenance || "");
    setInput("fc-mal-sable2-fraction", p.sable2Fraction || "");
    setInput("fc-mal-sable2-qte", p.sable2Qte || "");
    setInput("fc-mal-sable2-prov", p.sable2Provenance || "");
    setInput("fc-mal-grav-38", p.gravier38 || "");
    setInput("fc-mal-grav-38-prov", p.gravier38Provenance || "");
    setInput("fc-mal-grav-815", p.gravier815 || "");
    setInput("fc-mal-grav-815-prov", p.gravier815Provenance || "");
    setInput("fc-mal-grav-1525", p.gravier1525 || "");
    setInput("fc-mal-grav-1525-prov", p.gravier1525Provenance || "");
    setInput("fc-mal-eau", p.eau || "");
    setInput("fc-mal-eau-prov", p.eauProvenance || "");
    return true;
  }

  /* ---------- Proposition par l'opérateur ---------- */
  function readSel(selId) {
    var s = $(selId), a = $(selId + "-autre");
    if (!s) { return ""; }
    return s.value === "autre" ? (a ? a.value.trim() : "") : s.value;
  }
  function readInput(id) {
    var e = $(id);
    return e ? e.value.trim() : "";
  }

  function proposer() {
    var fournisseur = ($("fc-mal-fournisseur") ? $("fc-mal-fournisseur").value : "").trim();
    var payload = {
      classe: readSel("fc-mal-classe"), ciment: readSel("fc-mal-ciment"),
      cimentProvenance: readInput("fc-mal-ciment-prov"),
      dosage: readSel("fc-mal-dosage"), dmax: readSel("fc-mal-dmax"),
      adjuvant: readSel("fc-mal-adjuvant"),
      adjuvantDosage: readInput("fc-mal-adjuvant-dosage"),
      adjuvantProvenance: readInput("fc-mal-adjuvant-prov"),
      sable1Fraction: readInput("fc-mal-sable1-fraction"),
      sable1Qte: readInput("fc-mal-sable1-qte"),
      sable1Provenance: readInput("fc-mal-sable1-prov"),
      sable2Fraction: readInput("fc-mal-sable2-fraction"),
      sable2Qte: readInput("fc-mal-sable2-qte"),
      sable2Provenance: readInput("fc-mal-sable2-prov"),
      gravier38: readInput("fc-mal-grav-38"),
      gravier38Provenance: readInput("fc-mal-grav-38-prov"),
      gravier815: readInput("fc-mal-grav-815"),
      gravier815Provenance: readInput("fc-mal-grav-815-prov"),
      gravier1525: readInput("fc-mal-grav-1525"),
      gravier1525Provenance: readInput("fc-mal-grav-1525-prov"),
      eau: readInput("fc-mal-eau"),
      eauProvenance: readInput("fc-mal-eau-prov")
    };
    if (!fournisseur) { window.alert("Renseignez d'abord le fournisseur / la centrale."); return; }
    if (!payload.classe && !payload.dosage) { window.alert("Renseignez au moins la classe ou le dosage."); return; }
    var nom = window.prompt("Nom du modèle pour « " + fournisseur + " » (ex. N°01) :", "");
    if (nom == null) { return; }
    nom = String(nom).trim();
    if (!nom) { return; }
    if (!ready() || navigator.onLine === false) {
      window.alert("Réseau requis pour proposer un modèle (réessayez plus tard).");
      return;
    }
    CAEKServer.proposerFormulation(CAEKOperateurs.token(), fournisseur, nom, payload).then(function (r) {
      if (r && r.ok === true) {
        window.alert("Modèle proposé : « " + fournisseur + " — " + nom + " ».\nIl sera utilisable après validation par l'administrateur.");
      } else if (r && r.error === "existe") {
        window.alert("Un modèle « " + fournisseur + " — " + nom + " » existe déjà.");
      } else {
        window.alert("Échec de la proposition.");
      }
    }).catch(function (e) { window.alert("Réseau requis : " + (e && e.message || "")); });
  }

  /* ---------- Section admin (écran Administration) ---------- */
  function formResult(html, isError) {
    var box = $("form-result"); if (!box) { return; }
    box.hidden = false; box.className = "result-card " + (isError ? "is-error" : "is-ok"); box.innerHTML = html;
  }

  function payloadLine(p) {
    p = p || {};
    var parts = [];
    if (p.classe) { parts.push(p.classe); }
    if (p.ciment) { parts.push("Ciment " + p.ciment + (p.cimentProvenance ? " (" + p.cimentProvenance + ")" : "")); }
    if (p.dosage) { parts.push(p.dosage + " kg"); }
    if (p.dmax) { parts.push("Dmax " + p.dmax); }
    if (p.adjuvant) { parts.push(p.adjuvant + (p.adjuvantDosage ? " " + p.adjuvantDosage + " %" : "") + (p.adjuvantProvenance ? " (" + p.adjuvantProvenance + ")" : "")); }
    if (p.sable1Fraction || p.sable1Qte) {
      parts.push("Sable 01" + (p.sable1Fraction ? " " + p.sable1Fraction : "") +
        (p.sable1Qte ? " " + p.sable1Qte + " kg" : "") +
        (p.sable1Provenance ? " (" + p.sable1Provenance + ")" : ""));
    }
    if (p.sable2Fraction || p.sable2Qte) {
      parts.push("Sable 02" + (p.sable2Fraction ? " " + p.sable2Fraction : "") +
        (p.sable2Qte ? " " + p.sable2Qte + " kg" : "") +
        (p.sable2Provenance ? " (" + p.sable2Provenance + ")" : ""));
    }
    if (p.gravier38) { parts.push("Agrégat 3/8 " + p.gravier38 + " kg" + (p.gravier38Provenance ? " (" + p.gravier38Provenance + ")" : "")); }
    if (p.gravier815) { parts.push("Agrégat 8/15 " + p.gravier815 + " kg" + (p.gravier815Provenance ? " (" + p.gravier815Provenance + ")" : "")); }
    if (p.gravier1525) { parts.push("Agrégat 15/25 " + p.gravier1525 + " kg" + (p.gravier1525Provenance ? " (" + p.gravier1525Provenance + ")" : "")); }
    if (p.eau) { parts.push("Eau " + p.eau + " Litre" + (p.eauProvenance ? " (" + p.eauProvenance + ")" : "")); }
    return parts.join(" · ") || "—";
  }

  function adminItemHtml(f) {
    var proposee = (f.statut === "proposee");
    var badges = proposee
      ? "<span class=\"oper-badge is-nopin\">Proposée" + (f.cree_par ? " par " + escapeHtml(f.cree_par) : "") + "</span>"
      : "<span class=\"oper-badge is-active\">Validée</span>";
    if (f.actif === false) { badges += "<span class=\"oper-badge is-off\">Désactivée</span>"; }
    var actions = "";
    if (proposee) {
      actions += "<button type=\"button\" class=\"btn-text\" data-fact=\"valider\" data-id=\"" + escapeHtml(f.id) + "\">&#9989; Valider</button>";
    }
    actions += "<button type=\"button\" class=\"btn-text oper-off\" data-fact=\"supprimer\" data-id=\"" + escapeHtml(f.id) + "\">&#128465; Supprimer</button>";
    return "<div class=\"oper-item" + (f.actif === false ? " is-inactive" : "") + "\">" +
      "<div class=\"oper-info\"><span class=\"oper-nom\">&#129514; " + escapeHtml(f.fournisseur) + " — " + escapeHtml(f.nom) + "</span> " +
      badges +
      "<span class=\"oper-qualif\">" + escapeHtml(payloadLine(f.payload)) + "</span></div>" +
      "<div class=\"oper-actions\">" + actions + "</div></div>";
  }

  function renderAdmin() {
    var box = $("form-liste");
    if (!box) { return; }
    box.innerHTML = _admin.length
      ? _admin.map(adminItemHtml).join("")
      : "<p class=\"hint\">Aucune formulation enregistrée.</p>";
  }

  function refreshAdmin() {
    if (!window.CAEKOperateurs || !CAEKOperateurs.isAdmin() || !ready()) { return Promise.resolve(); }
    return CAEKServer.adminListFormulations(CAEKOperateurs.token()).then(function (rows) {
      _admin = rows || [];
      renderAdmin();
    }).catch(function (e) {
      formResult("&#9888; Chargement impossible (réseau requis) : " + escapeHtml(e && e.message || ""), true);
    });
  }

  function onAdminAdd() {
    var fournisseur = ($("form-add-fournisseur") ? $("form-add-fournisseur").value : "").trim();
    var nom = ($("form-add-nom") ? $("form-add-nom").value : "").trim();
    if (!fournisseur || !nom) { formResult("&#9888; Fournisseur et nom obligatoires.", true); return; }
    var payload = {
      classe: ($("form-add-classe") ? $("form-add-classe").value : "").trim(),
      ciment: ($("form-add-ciment") ? $("form-add-ciment").value : "").trim(),
      cimentProvenance: ($("form-add-ciment-prov") ? $("form-add-ciment-prov").value : "").trim(),
      dosage: ($("form-add-dosage") ? $("form-add-dosage").value : "").trim(),
      dmax: ($("form-add-dmax") ? $("form-add-dmax").value : "").trim(),
      adjuvant: ($("form-add-adjuvant") ? $("form-add-adjuvant").value : "").trim(),
      adjuvantDosage: ($("form-add-adjuvant-dosage") ? $("form-add-adjuvant-dosage").value : "").trim(),
      adjuvantProvenance: ($("form-add-adjuvant-prov") ? $("form-add-adjuvant-prov").value : "").trim(),
      sable1Fraction: ($("form-add-sable1-fraction") ? $("form-add-sable1-fraction").value : "").trim(),
      sable1Qte: ($("form-add-sable1-qte") ? $("form-add-sable1-qte").value : "").trim(),
      sable1Provenance: ($("form-add-sable1-prov") ? $("form-add-sable1-prov").value : "").trim(),
      sable2Fraction: ($("form-add-sable2-fraction") ? $("form-add-sable2-fraction").value : "").trim(),
      sable2Qte: ($("form-add-sable2-qte") ? $("form-add-sable2-qte").value : "").trim(),
      sable2Provenance: ($("form-add-sable2-prov") ? $("form-add-sable2-prov").value : "").trim(),
      gravier38: ($("form-add-grav-38") ? $("form-add-grav-38").value : "").trim(),
      gravier38Provenance: ($("form-add-grav-38-prov") ? $("form-add-grav-38-prov").value : "").trim(),
      gravier815: ($("form-add-grav-815") ? $("form-add-grav-815").value : "").trim(),
      gravier815Provenance: ($("form-add-grav-815-prov") ? $("form-add-grav-815-prov").value : "").trim(),
      gravier1525: ($("form-add-grav-1525") ? $("form-add-grav-1525").value : "").trim(),
      gravier1525Provenance: ($("form-add-grav-1525-prov") ? $("form-add-grav-1525-prov").value : "").trim(),
      eau: ($("form-add-eau") ? $("form-add-eau").value : "").trim(),
      eauProvenance: ($("form-add-eau-prov") ? $("form-add-eau-prov").value : "").trim()
    };
    CAEKServer.adminUpsertFormulation(CAEKOperateurs.token(), {
      fournisseur: fournisseur, nom: nom, payload: payload, actif: true
    }).then(function (r) {
      if (!r || r.ok !== true) { formResult("&#9888; Échec de l'enregistrement.", true); return; }
      ["form-add-nom", "form-add-classe", "form-add-ciment", "form-add-dosage",
        "form-add-ciment-prov", "form-add-dmax", "form-add-adjuvant", "form-add-adjuvant-dosage", "form-add-adjuvant-prov",
        "form-add-sable1-fraction", "form-add-sable1-qte", "form-add-sable1-prov",
        "form-add-sable2-fraction", "form-add-sable2-qte", "form-add-sable2-prov",
        "form-add-grav-38", "form-add-grav-38-prov", "form-add-grav-815", "form-add-grav-815-prov",
        "form-add-grav-1525", "form-add-grav-1525-prov", "form-add-eau", "form-add-eau-prov"].forEach(function (id) {
        var e = $(id); if (e) { e.value = ""; }
      });
      formResult("&#10004; Formulation « " + escapeHtml(fournisseur) + " — " + escapeHtml(nom) + " » enregistrée (validée).", false);
      refreshAdmin().then(refresh);
    }).catch(function (e) { formResult("&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
  }

  function onAdminClick(ev) {
    var btn = ev.target.closest ? ev.target.closest("[data-fact]") : null;
    if (!btn) { return; }
    var act = btn.getAttribute("data-fact");
    var id = btn.getAttribute("data-id");
    if (act === "valider") {
      CAEKServer.adminValiderFormulation(CAEKOperateurs.token(), id).then(function (r) {
        if (!r || r.ok !== true) { formResult("&#9888; Échec.", true); return; }
        formResult("&#10004; Formulation validée : elle est maintenant proposée aux opérateurs.", false);
        refreshAdmin().then(refresh);
      }).catch(function (e) { formResult("&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
    } else if (act === "supprimer") {
      if (!window.confirm("Supprimer cette formulation du catalogue ?")) { return; }
      CAEKServer.adminDeleteFormulation(CAEKOperateurs.token(), id).then(function (r) {
        if (!r || r.ok !== true) { formResult("&#9888; Échec.", true); return; }
        formResult("Formulation supprimée.", false);
        refreshAdmin().then(refresh);
      }).catch(function (e) { formResult("&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
    }
  }

  /* ---------- Initialisation ---------- */
  function init() {
    loadCache();
    var sel = $("fc-mal-modele");
    if (sel) {
      sel.addEventListener("change", function () {
        if (sel.value) { applyById(sel.value); }
      });
    }
    var prop = $("fc-mal-proposer");
    if (prop) { prop.addEventListener("click", proposer); }
    var addBtn = $("form-add-btn");
    if (addBtn) { addBtn.addEventListener("click", onAdminAdd); }
    var lst = $("form-liste");
    if (lst) { lst.addEventListener("click", onAdminClick); }
    setTimeout(refresh, 1500);
  }

  return {
    init: init,
    refresh: refresh,
    refreshAdmin: refreshAdmin,
    applyById: applyById,
    getCached: function () { return _list.slice(); }
  };
})();

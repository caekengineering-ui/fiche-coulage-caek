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
    setSelect("fc-mal-dosage", p.dosage || "");
    setSelect("fc-mal-dmax", p.dmax || "");
    setSelect("fc-mal-adjuvant", p.adjuvant || "");
    return true;
  }

  /* ---------- Proposition par l'opérateur ---------- */
  function readSel(selId) {
    var s = $(selId), a = $(selId + "-autre");
    if (!s) { return ""; }
    return s.value === "autre" ? (a ? a.value.trim() : "") : s.value;
  }

  function proposer() {
    var fournisseur = ($("fc-mal-fournisseur") ? $("fc-mal-fournisseur").value : "").trim();
    var payload = {
      classe: readSel("fc-mal-classe"), ciment: readSel("fc-mal-ciment"),
      dosage: readSel("fc-mal-dosage"), dmax: readSel("fc-mal-dmax"),
      adjuvant: readSel("fc-mal-adjuvant")
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
    if (p.ciment) { parts.push("Ciment " + p.ciment); }
    if (p.dosage) { parts.push(p.dosage + " kg/m³"); }
    if (p.dmax) { parts.push("Dmax " + p.dmax); }
    if (p.adjuvant) { parts.push(p.adjuvant); }
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
      dosage: ($("form-add-dosage") ? $("form-add-dosage").value : "").trim(),
      dmax: ($("form-add-dmax") ? $("form-add-dmax").value : "").trim(),
      adjuvant: ($("form-add-adjuvant") ? $("form-add-adjuvant").value : "").trim()
    };
    CAEKServer.adminUpsertFormulation(CAEKOperateurs.token(), {
      fournisseur: fournisseur, nom: nom, payload: payload, actif: true
    }).then(function (r) {
      if (!r || r.ok !== true) { formResult("&#9888; Échec de l'enregistrement.", true); return; }
      ["form-add-nom", "form-add-classe", "form-add-ciment", "form-add-dosage",
        "form-add-dmax", "form-add-adjuvant"].forEach(function (id) {
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

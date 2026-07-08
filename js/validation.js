/* ============================================================
   Module Béton - CAEK
   validation.js - V3 : écran ADMIN « Validation ».

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
  var _lotsT = [];       // lots 'teste' (résultats d'écrasement à valider)
  var _labos = {};       // id -> nom
  var _openRef = null;   // détail déplié
  var _editRef = null;   // coulage en cours de CORRECTION par le vérificateur

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
  function modeCoulageLabel(c) {
    var mode = (c && c.modeCoulage) || "";
    if (mode === "pompe") { return "Pompe"; }
    if (mode === "benne") { return "Benne"; }
    if (mode === "autre") { return c.modeCoulageAutre ? "Autre : " + c.modeCoulageAutre : "Autre"; }
    return "—";
  }

  /* ---------- Récapitulatif d'un coulage soumis ---------- */
  function formulationHtml(f) {
    if (!f) { return "—"; }
    if (f.mode === "photo") { return "📷 Photo du BL (visible en lot 2)"; }
    var parts = [];
    if (f.fournisseur) { parts.push(escapeHtml(f.fournisseur)); }
    if (f.classe) { parts.push(escapeHtml(f.classe)); }
    if (f.ciment) { parts.push("Ciment " + escapeHtml(f.ciment) + (f.cimentProvenance ? " (" + escapeHtml(f.cimentProvenance) + ")" : "")); }
    if (f.dosage) { parts.push(escapeHtml(f.dosage) + " kg ciment"); }
    if (f.dmax) { parts.push("Dmax " + escapeHtml(f.dmax)); }
    if (f.adjuvant) { parts.push(escapeHtml(f.adjuvant) + (f.adjuvantDosage ? " " + escapeHtml(f.adjuvantDosage) + " %" : "") + (f.adjuvantProvenance ? " (" + escapeHtml(f.adjuvantProvenance) + ")" : "")); }
    if (f.sable1Fraction || f.sable1Qte) {
      parts.push("Sable 01" + (f.sable1Fraction ? " " + escapeHtml(f.sable1Fraction) : "") +
        (f.sable1Qte ? " " + escapeHtml(f.sable1Qte) + " kg" : "") +
        (f.sable1Provenance ? " (" + escapeHtml(f.sable1Provenance) + ")" : ""));
    }
    if (f.sable2Fraction || f.sable2Qte) {
      parts.push("Sable 02" + (f.sable2Fraction ? " " + escapeHtml(f.sable2Fraction) : "") +
        (f.sable2Qte ? " " + escapeHtml(f.sable2Qte) + " kg" : "") +
        (f.sable2Provenance ? " (" + escapeHtml(f.sable2Provenance) + ")" : ""));
    }
    if (f.gravier38) { parts.push("Agrégat 3/8 " + escapeHtml(f.gravier38) + " kg" + (f.gravier38Provenance ? " (" + escapeHtml(f.gravier38Provenance) + ")" : "")); }
    if (f.gravier815) { parts.push("Agrégat 8/15 " + escapeHtml(f.gravier815) + " kg" + (f.gravier815Provenance ? " (" + escapeHtml(f.gravier815Provenance) + ")" : "")); }
    if (f.gravier1525) { parts.push("Agrégat 15/25 " + escapeHtml(f.gravier1525) + " kg" + (f.gravier1525Provenance ? " (" + escapeHtml(f.gravier1525Provenance) + ")" : "")); }
    if (f.eau) { parts.push("Eau " + escapeHtml(f.eau) + " Litre" + (f.eauProvenance ? " (" + escapeHtml(f.eauProvenance) + ")" : "")); }
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

    var medias = c.medias || [];
    var mediasHtml = "";
    if (medias.length) {
      mediasHtml = "<div class=\"valid-medias\" data-ref=\"" + escapeHtml(c.ref) + "\">" +
        "<div class=\"valid-line\"><strong>&#128247; Médias soumis (" + medias.length + ")</strong>" +
        (c.mediasIncomplets ? " <span class=\"oper-badge is-off\">liste incomplète</span>" : "") +
        " <span class=\"hint\">— supprimés du serveur après validation</span></div>" +
        "<div class=\"valid-medias-zone\"><p class=\"hint\">Chargement des médias…</p></div></div>";
    } else if (c.mediasIncomplets) {
      mediasHtml = "<div class=\"valid-line\">&#9888; Médias non téléversés (soumission hors-ligne ou stockage indisponible).</div>";
    }

    if (_editRef === c.ref) {
      return editFormHtml(c, mediasHtml);
    }

    return "<div class=\"valid-detail\">" +
      "<div class=\"valid-line\"><strong>Client :</strong> " + escapeHtml(c.client || c.entreprise || "—") + "</div>" +
      "<div class=\"valid-line\"><strong>Projet :</strong> " + escapeHtml(c.nomProjet || "—") +
        (c.codeProjet ? " (" + escapeHtml(c.codeProjet) + ")" : "") + "</div>" +
      "<div class=\"valid-line\"><strong>Date du coulage :</strong> " + fmtDate(c.dateCoulage) + "</div>" +
      "<div class=\"valid-line\"><strong>Mode de coulage :</strong> " + escapeHtml(modeCoulageLabel(c)) + "</div>" +
      "<div class=\"valid-line\"><strong>Ouvrage(s) coulé(s) :</strong> " + escapeHtml(ouvr) + "</div>" +
      "<div class=\"valid-line\"><strong>Bloc / étage :</strong> " + escapeHtml(blocEtage) + "</div>" +
      "<div class=\"valid-line\"><strong>Totaux :</strong> " + qte + " m³ · " + epr + " éprouvette(s)</div>" +
      (c.corrigePar ? "<div class=\"valid-line\">&#9999;&#65039; <strong>Corrigé par :</strong> " +
        escapeHtml(c.corrigePar) + (c.corrigeLe ? " le " + escapeHtml(c.corrigeLe) : "") + "</div>" : "") +
      malRows + codif + mediasHtml +
      "<div class=\"oper-actions\">" +
      "<button type=\"button\" class=\"btn-primary\" data-act=\"valider\" data-ref=\"" + escapeHtml(c.ref) + "\">&#9989; Valider ce coulage</button>" +
      "<button type=\"button\" class=\"btn-secondary\" data-act=\"corriger\" data-ref=\"" + escapeHtml(c.ref) + "\">&#9999;&#65039; Corriger</button>" +
      "<button type=\"button\" class=\"btn-text\" data-act=\"renvoyer\" data-ref=\"" + escapeHtml(c.ref) + "\">&#8617; Renvoyer à l'opérateur</button>" +
      "</div>" +
      "<div class=\"valid-result result-card\" hidden></div>" +
      "</div>";
  }

  /* ---------- Formulaire de CORRECTION (vérificateur) ---------- */
  // Champs de formulation éditables (mêmes clés que la fiche opérateur).
  var FORM_FIELDS = [
    ["fournisseur", "Fournisseur / centrale"],
    ["classe", "Classe béton"],
    ["ciment", "Type de ciment"],
    ["cimentProvenance", "Provenance ciment"],
    ["dosage", "Dosage ciment (kg)"],
    ["dmax", "Dmax (mm)"],
    ["adjuvant", "Adjuvant"],
    ["adjuvantDosage", "Dosage adjuvant (%)"],
    ["adjuvantProvenance", "Provenance adjuvant"],
    ["eau", "Eau (Litre)"],
    ["eauProvenance", "Provenance eau"],
    ["sable1Fraction", "Sable 01 — fraction"],
    ["sable1Qte", "Sable 01 (kg)"],
    ["sable1Provenance", "Provenance sable 01"],
    ["sable2Fraction", "Sable 02 — fraction"],
    ["sable2Qte", "Sable 02 (kg)"],
    ["sable2Provenance", "Provenance sable 02"],
    ["gravier38", "Agrégat 3/8 (kg)"],
    ["gravier38Provenance", "Provenance agrégat 3/8"],
    ["gravier815", "Agrégat 8/15 (kg)"],
    ["gravier815Provenance", "Provenance agrégat 8/15"],
    ["gravier1525", "Agrégat 15/25 (kg)"],
    ["gravier1525Provenance", "Provenance agrégat 15/25"]
  ];

  function inp(id, label, value, type) {
    return "<label class=\"field-label\" for=\"" + id + "\">" + label + "</label>" +
      "<input id=\"" + id + "\" class=\"field\" type=\"" + (type || "text") + "\" value=\"" +
      escapeHtml(value == null ? "" : value) + "\" autocomplete=\"off\">";
  }

  function editFormHtml(c, mediasHtml) {
    var ouvr = Array.isArray(c.ouvrages) ? c.ouvrages.join(" + ") : (c.ouvrages || "");
    var html = "<div class=\"valid-detail valid-edit\">" +
      "<p class=\"hint\">&#9999;&#65039; <strong>Correction par le vérificateur</strong> — modifiez les informations saisies par l'opérateur, puis enregistrez et validez. Les prélèvements et la codification ne sont pas modifiables ici.</p>" +
      inp("ved-client", "Client", c.client || c.entreprise || "") +
      inp("ved-ouvrages", "Ouvrage(s) coulé(s)", ouvr) +
      "<div class=\"ved-grid\">" +
      inp("ved-bloc", "Bloc", c.bloc || "") +
      inp("ved-etage", "Étage", c.etage || "") +
      "</div>" +
      inp("ved-date", "Date du coulage", String(c.dateCoulage || "").slice(0, 10), "date") +
      "<label class=\"field-label\" for=\"ved-mode-coulage\">Mode de coulage</label>" +
      "<select id=\"ved-mode-coulage\" class=\"field\">" +
      "<option value=\"\">—</option>" +
      "<option value=\"pompe\"" + (c.modeCoulage === "pompe" ? " selected" : "") + ">Pompe</option>" +
      "<option value=\"benne\"" + (c.modeCoulage === "benne" ? " selected" : "") + ">Benne</option>" +
      "<option value=\"autre\"" + (c.modeCoulage === "autre" ? " selected" : "") + ">Autre</option>" +
      "</select>" +
      inp("ved-mode-coulage-autre", "Mode de coulage — autre", c.modeCoulageAutre || "");

    // Modèles de formulation disponibles (catalogue validé, en cache local).
    var modeles = (window.CAEKFormulations && CAEKFormulations.getCached)
      ? CAEKFormulations.getCached() : [];
    function modeleSelectHtml(i) {
      var out = "<label class=\"field-label\" for=\"ved-m" + i + "-modele\">&#128218; Choisir une formulation enregistrée</label>" +
        "<select id=\"ved-m" + i + "-modele\" class=\"field ved-modele\" data-mal=\"" + i + "\">" +
        "<option value=\"\">— Choisir un modèle (facultatif) —</option>";
      var byFour = {};
      modeles.forEach(function (fm) {
        var k = fm.fournisseur || "Autres";
        (byFour[k] = byFour[k] || []).push(fm);
      });
      Object.keys(byFour).sort().forEach(function (four) {
        out += "<optgroup label=\"" + escapeHtml(four) + "\">";
        byFour[four].forEach(function (fm) {
          out += "<option value=\"" + escapeHtml(fm.id) + "\">" + escapeHtml(four) + " — " + escapeHtml(fm.nom) + "</option>";
        });
        out += "</optgroup>";
      });
      return out + "</select>";
    }

    (c.malaxeurs || []).forEach(function (m, i) {
      var f = m.formulation || {};
      html += "<div class=\"valid-mal\"><div class=\"valid-mal-head\"><strong>Malaxeur " + (i + 1) + "</strong>" +
        (m.preleve === true ? " · " + (m.prelNombre || 0) + " épr. " + escapeHtml(m.prelType || "cube") + " (non modifiable)" : "") +
        "</div>" +
        (modeles.length ? modeleSelectHtml(i) : "") +
        "<div class=\"ved-grid\">" +
        inp("ved-m" + i + "-heure", "Heure de prélèvement", m.heure || "") +
        inp("ved-m" + i + "-quantite", "Quantité de béton (m³)", m.quantite == null ? "" : m.quantite) +
        inp("ved-m" + i + "-affaissement", "Affaissement (cm)", m.affaissement == null ? "" : m.affaissement) +
        inp("ved-m" + i + "-temperature", "Température (°C)", m.temperature == null ? "" : m.temperature);
      FORM_FIELDS.forEach(function (fd) {
        html += inp("ved-m" + i + "-" + fd[0], fd[1], f[fd[0]] == null ? "" : f[fd[0]]);
      });
      html += "</div>" +
        "<button type=\"button\" class=\"btn-text\" data-act=\"ved-save-modele\" data-mal=\"" + i + "\" data-ref=\"" + escapeHtml(c.ref) + "\">" +
        "&#128190; Enregistrer cette formulation comme modèle</button>" +
        "</div>";
    });

    html += mediasHtml +
      "<div class=\"oper-actions\">" +
      "<button type=\"button\" class=\"btn-primary\" data-act=\"enregistrer-valider\" data-ref=\"" + escapeHtml(c.ref) + "\">&#128190; Enregistrer les corrections et valider</button>" +
      "<button type=\"button\" class=\"btn-text\" data-act=\"annuler-edit\" data-ref=\"" + escapeHtml(c.ref) + "\">Annuler</button>" +
      "</div>" +
      "<div class=\"valid-result result-card\" hidden></div>" +
      "</div>";
    return html;
  }

  function vval(id) {
    var e = document.getElementById(id);
    return e ? e.value.trim() : "";
  }
  function vset(id, v) {
    var e = document.getElementById(id);
    if (e) { e.value = v == null ? "" : v; }
  }

  // Applique un modèle de formulation aux champs du malaxeur i (correction).
  function applyModeleToVed(i, modeleId) {
    if (!window.CAEKFormulations || !CAEKFormulations.getCached) { return; }
    var list = CAEKFormulations.getCached();
    var fm = null;
    for (var k = 0; k < list.length; k++) { if (list[k].id === modeleId) { fm = list[k]; break; } }
    if (!fm) { return; }
    var p = fm.payload || {};
    vset("ved-m" + i + "-fournisseur", fm.fournisseur || "");
    FORM_FIELDS.forEach(function (fd) {
      if (fd[0] === "fournisseur") { return; }
      if (p[fd[0]] != null && p[fd[0]] !== "") { vset("ved-m" + i + "-" + fd[0], p[fd[0]]); }
    });
  }

  // Enregistre la formulation saisie (malaxeur i) comme modèle réutilisable
  // (admin -> directement validée dans le catalogue).
  function saveModeleFromVed(i, itemEl) {
    var fournisseur = vval("ved-m" + i + "-fournisseur");
    if (!fournisseur) { resultBox(itemEl, "&#9888; Renseignez d'abord le fournisseur / la centrale.", true); return; }
    var nom = window.prompt("Nom du modèle pour « " + fournisseur + " » (ex. N°01) :", "");
    if (nom == null) { return; }
    nom = String(nom).trim();
    if (!nom) { return; }
    var payload = {};
    FORM_FIELDS.forEach(function (fd) {
      if (fd[0] === "fournisseur") { return; }
      payload[fd[0]] = vval("ved-m" + i + "-" + fd[0]);
    });
    CAEKServer.adminUpsertFormulation(CAEKOperateurs.token(), {
      fournisseur: fournisseur, nom: nom, payload: payload, actif: true
    }).then(function (r) {
      if (!r || r.ok !== true) { resultBox(itemEl, "&#9888; Échec de l'enregistrement du modèle.", true); return; }
      resultBox(itemEl, "&#10004; Modèle enregistré : « " + escapeHtml(fournisseur) + " — " + escapeHtml(nom) + " » (réutilisable).", false);
      if (window.CAEKFormulations) { CAEKFormulations.refresh(); }
    }).catch(function (e) { resultBox(itemEl, "&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
  }

  // Reconstruit le payload corrigé depuis le formulaire (clone + surcharges).
  function readEditForm(ref) {
    var row = findRow(ref);
    if (!row) { return null; }
    var c;
    try { c = JSON.parse(JSON.stringify(row.payload || {})); } catch (e) { return null; }
    c.client = vval("ved-client");
    if (c.entreprise) { c.entreprise = c.client; }
    var ouvr = vval("ved-ouvrages");
    c.ouvrages = Array.isArray(row.payload.ouvrages)
      ? ouvr.split("+").map(function (s) { return s.trim(); }).filter(Boolean)
      : ouvr;
    c.bloc = vval("ved-bloc");
    c.etage = vval("ved-etage");
    if (vval("ved-date")) { c.dateCoulage = vval("ved-date"); }
    c.modeCoulage = vval("ved-mode-coulage");
    c.modeCoulageAutre = c.modeCoulage === "autre" ? vval("ved-mode-coulage-autre") : "";
    (c.malaxeurs || []).forEach(function (m, i) {
      m.heure = vval("ved-m" + i + "-heure");
      m.quantite = vval("ved-m" + i + "-quantite");
      m.affaissement = vval("ved-m" + i + "-affaissement");
      m.temperature = vval("ved-m" + i + "-temperature");
      m.formulation = m.formulation || {};
      FORM_FIELDS.forEach(function (fd) {
        m.formulation[fd[0]] = vval("ved-m" + i + "-" + fd[0]);
      });
    });
    // Traçabilité de la correction (visible sur les documents / le détail).
    var s = window.CAEKOperateurs && CAEKOperateurs.session ? CAEKOperateurs.session() : null;
    c.corrigePar = (s && s.nom) || "Vérificateur";
    c.corrigeLe = fmtDate(new Date().toISOString().slice(0, 10));
    return c;
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

  // Résumé des Rc d'un lot testé (depuis payload.essais).
  function rcResume(p) {
    var essais = (p && p.essais) || [];
    var rcs = essais.map(function (e) { return parseFloat(e && e.rc); })
      .filter(function (n) { return !isNaN(n); });
    if (!rcs.length) { return "—"; }
    var min = Math.min.apply(null, rcs), max = Math.max.apply(null, rcs);
    var moy = rcs.reduce(function (a, b) { return a + b; }, 0) / rcs.length;
    return "Rc " + min.toFixed(1) + " à " + max.toFixed(1) + " MPa · moy " + moy.toFixed(1) + " MPa";
  }

  function lotItemHtml(row) {
    var p = row.payload || {};
    var labo = _labos[row.labo_id] || "—";
    var codes = Array.isArray(p.codes) ? p.codes : [];
    return "<div class=\"rep-item\" data-key=\"" + escapeHtml(row.lot_key) + "\">" +
      "<div class=\"rep-row\"><div class=\"rep-open\">" +
      "<div class=\"rep-top\"><span class=\"rep-ref\">" + escapeHtml(row.coulage_ref) +
      " · " + escapeHtml(p.age || (row.age_jours + " j")) + "</span>" +
      "<span class=\"badge badge-teste\">Testé</span></div>" +
      "<div class=\"rep-ent\">" + escapeHtml(rcResume(p)) + "</div>" +
      "<div class=\"rep-sub\">&#127970; " + escapeHtml(labo) + " · " + (p.nombre || codes.length) +
      " épr. (" + escapeHtml(p.type || "cube") + ") · Écrasé par " + escapeHtml(p.operateurEssai || "—") +
      (p.dateEssai ? " le " + fmtDate(p.dateEssai) : "") + "</div>" +
      (codes.length ? "<div class=\"rep-sub\">" + escapeHtml(codes.join(" · ")) + "</div>" : "") +
      "</div></div>" +
      "<div class=\"oper-actions\">" +
      "<button type=\"button\" class=\"btn-primary\" data-act=\"valider-lot\" data-key=\"" +
      escapeHtml(row.lot_key) + "\">&#9989; Valider les résultats</button></div>" +
      "<div class=\"valid-result result-card\" hidden></div>" +
      "</div>";
  }

  function render() {
    var box = $("valid-liste");
    if (!box) { return; }
    var html = "";
    html += "<h3 class=\"block-subtitle\">&#128230; Coulages soumis</h3>";
    html += _rows.length ? _rows.map(itemHtml).join("")
      : "<p class=\"hint\">&#10004; Aucun coulage en attente.</p>";
    html += "<h3 class=\"block-subtitle\">&#128296; Résultats d'écrasement à valider</h3>";
    html += _lotsT.length ? _lotsT.map(lotItemHtml).join("")
      : "<p class=\"hint\">&#10004; Aucun résultat en attente.</p>";
    box.innerHTML = html;
    var cnt = $("valid-count");
    if (cnt) {
      cnt.textContent = _rows.length + " coulage(s) soumis · " +
        _lotsT.length + " résultat(s) d'écrasement à valider";
    }
    updateBadgeDisplay(_rows.length + _lotsT.length);
    loadMedias();
  }

  /* ---------- Médias (photos + audios du coulage ouvert) ---------- */
  var _urls = [];
  function revokeUrls() {
    _urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    _urls = [];
  }

  var CAT_LABEL = {
    formulation: "Formulation / BL", bl: "Bon de livraison", prelevement: "Prélèvement",
    eprouvettes: "Éprouvettes", anomalie: "Anomalie", audio: "Note audio pour l'admin"
  };

  function loadMedias() {
    revokeUrls();
    var wrap = document.querySelector("#valid-liste .valid-medias");
    if (!wrap || !window.CAEKMedias) { return; }
    var ref = wrap.getAttribute("data-ref");
    var row = findRow(ref);
    if (!row) { return; }
    var medias = (row.payload && row.payload.medias) || [];
    var zone = wrap.querySelector(".valid-medias-zone");
    if (!zone) { return; }
    zone.innerHTML = "";
    // La photo de la formulation d'abord : c'est elle que l'admin vérifie.
    var sorted = medias.slice().sort(function (a, b) {
      var pa = (a.categorie === "formulation" || a.categorie === "bl") ? 0 : (a.type === "audio" ? 1 : 2);
      var pb = (b.categorie === "formulation" || b.categorie === "bl") ? 0 : (b.type === "audio" ? 1 : 2);
      return pa - pb;
    });
    sorted.forEach(function (m) {
      CAEKMedias.fetchBlob(m.path).then(function (blob) {
        var u = URL.createObjectURL(blob);
        _urls.push(u);
        var d = document.createElement("div");
        d.className = "valid-media";
        var cat = document.createElement("div");
        cat.className = "photo-cat";
        cat.textContent = (m.type === "audio" ? "🎤 " : "") + (CAT_LABEL[m.categorie] || m.categorie);
        d.appendChild(cat);
        if (m.type === "audio") {
          var au = document.createElement("audio");
          au.controls = true;
          au.src = u;
          d.appendChild(au);
        } else {
          var img = document.createElement("img");
          img.className = "valid-media-img";
          img.src = u;
          img.alt = m.categorie || "photo";
          d.appendChild(img);
        }
        zone.appendChild(d);
      }).catch(function () {
        var d = document.createElement("div");
        d.className = "hint";
        d.textContent = "⚠ Média indisponible (" + (CAT_LABEL[m.categorie] || m.categorie) + ")";
        zone.appendChild(d);
      });
    });
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
      CAEKServer.adminListLabos(CAEKOperateurs.token()),
      CAEKServer.listLots(CAEKOperateurs.token(), null).catch(function () { return []; })
    ]).then(function (out) {
      _labos = {};
      ((out[1] && out[1].labos) || []).forEach(function (b) { _labos[b.id] = b.nom; });
      _rows = (out[0] || []).filter(function (r) { return r.statut === "soumis"; });
      _lotsT = (out[2] || []).filter(function (r) { return r.statut === "teste" && r.lot_key; });
      render();
    }).catch(function (e) {
      if (box) { box.innerHTML = "<p class=\"hint\">&#9888; Chargement impossible (réseau requis) : " + escapeHtml(e && e.message || "") + "</p>"; }
    });
  }

  // Badge accueil (appelé à l'affichage de l'accueil, admin en ligne).
  function updateBadge() {
    if (!ready() || navigator.onLine === false) { return; }
    Promise.all([
      CAEKServer.listCoulages(CAEKOperateurs.token(), null),
      CAEKServer.listLots(CAEKOperateurs.token(), null).catch(function () { return []; })
    ]).then(function (out) {
      var n = (out[0] || []).filter(function (r) { return r.statut === "soumis"; }).length +
        (out[1] || []).filter(function (r) { return r.statut === "teste" && r.lot_key; }).length;
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

  // p_override : payload CORRIGÉ par le vérificateur (formulaire d'édition).
  function valider(ref, itemEl, p_override) {
    var row = findRow(ref);
    if (!row) { return; }
    var confirmMsg = window.I18N && I18N.f
      ? I18N.f("Valider le coulage {ref} ?", { ref: ref }) + "\n" +
        I18N.f("La désignation de l'ouvrage et la formulation sont confirmées. La fiche sera figée.") + "\n" +
        I18N.f("Les photos et audios de ce coulage seront supprimés du serveur après validation.")
      : "Valider le coulage " + ref + " ?\nLa désignation de l'ouvrage et la formulation sont confirmées. La fiche sera figée.\nLes photos et audios de ce coulage seront supprimés du serveur après validation.";
    if (!window.confirm(confirmMsg)) { return; }
    var payload = p_override || row.payload || {};
    var paths = (payload.medias || []).map(function (m) { return m.path; });
    var toSend;
    try { toSend = JSON.parse(JSON.stringify(payload)); } catch (e) { toSend = payload; }
    if (paths.length) { toSend.mediasPurgePending = true; }
    _editRef = null;
    CAEKServer.adminValiderCoulage(CAEKOperateurs.token(), ref, toSend).then(function (r) {
      if (!r || r.ok !== true) {
        resultBox(itemEl, "&#9888; " + (r && r.error === "deja_valide" ? "Déjà validé." : "Échec de la validation."), true);
        return;
      }
      if (!paths.length) {
        revokeUrls();
        resultBox(itemEl, "&#10004; Coulage validé.", false);
        if (window.CAEKCoulages) { CAEKCoulages.pull(); }
        setTimeout(refresh, 800);
        return;
      }
      if (!window.CAEKMedias) {
        resultBox(itemEl, "&#10004; Coulage validé. &#9888; Médias non supprimés (à re-tenter).", true);
        if (window.CAEKCoulages) { CAEKCoulages.pull(); }
        setTimeout(refresh, 800);
        return;
      }
      CAEKMedias.deletePaths(paths).then(function (p) {
        if (!p || p.ok !== true) {
          resultBox(itemEl, "&#10004; Coulage validé. &#9888; Médias non supprimés (à re-tenter).", true);
          if (window.CAEKCoulages) { CAEKCoulages.pull(); }
          setTimeout(refresh, 800);
          return;
        }
        CAEKServer.adminMarquerMediasPurges(CAEKOperateurs.token(), ref).then(function (m) {
          revokeUrls();
          resultBox(itemEl, "&#10004; Coulage validé. " + p.n + " média(s) supprimé(s) du serveur." +
            (m && m.ok === true ? "" : " &#9888; Références médias à nettoyer."), !(m && m.ok === true));
          if (window.CAEKCoulages) { CAEKCoulages.pull(); }
          setTimeout(refresh, 800);
        }).catch(function () {
          revokeUrls();
          resultBox(itemEl, "&#10004; Coulage validé. " + p.n + " média(s) supprimé(s) du serveur. &#9888; Références médias à nettoyer.", true);
          if (window.CAEKCoulages) { CAEKCoulages.pull(); }
          setTimeout(refresh, 800);
        });
      }).catch(function () {
        resultBox(itemEl, "&#10004; Coulage validé. &#9888; Médias non supprimés (à re-tenter).", true);
        if (window.CAEKCoulages) { CAEKCoulages.pull(); }
        setTimeout(refresh, 800);
      });
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

  function validerLot(key, itemEl) {
    if (!window.confirm("Valider ces résultats d'écrasement ?\nIls seront figés et exploitables pour les PV (pont bureau).")) { return; }
    CAEKServer.adminValiderResultatsKey(CAEKOperateurs.token(), key).then(function (r) {
      if (!r || r.ok !== true) {
        resultBox(itemEl, "&#9888; " + (r && r.error === "deja_valide" ? "Déjà validés." : "Échec de la validation."), true);
        return;
      }
      resultBox(itemEl, "&#10004; Résultats validés.", false);
      if (window.CAEKLots) { CAEKLots.pull(); }
      setTimeout(refresh, 800);
    }).catch(function (e) { resultBox(itemEl, "&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
  }

  function onClick(ev) {
    var tgt = ev.target;
    var item = tgt.closest ? tgt.closest(".rep-item") : null;
    var act = tgt.closest ? tgt.closest("[data-act]") : null;
    if (act) {
      var a = act.getAttribute("data-act");
      var ref = act.getAttribute("data-ref");
      if (a === "ved-save-modele") { saveModeleFromVed(act.getAttribute("data-mal"), item); return; }
      if (a === "valider") { valider(ref, item); }
      else if (a === "corriger") { _editRef = ref; _openRef = ref; render(); }
      else if (a === "annuler-edit") { _editRef = null; render(); }
      else if (a === "enregistrer-valider") {
        var corrige = readEditForm(ref);
        if (!corrige) { resultBox(item, "&#9888; Lecture du formulaire impossible.", true); return; }
        valider(ref, item, corrige);
      }
      else if (a === "renvoyer") { renvoyer(ref, item); }
      else if (a === "valider-lot") { validerLot(act.getAttribute("data-key"), item); }
      return;
    }
    var tog = tgt.closest ? tgt.closest(".valid-toggle") : null;
    if (tog) {
      var r = tog.getAttribute("data-ref");
      _openRef = (_openRef === r) ? null : r;
      if (_editRef && _editRef !== _openRef) { _editRef = null; }   // fermer = abandonner l'édition
      render();
    }
  }

  function init() {
    var box = $("valid-liste");
    if (box) {
      box.addEventListener("click", onClick);
      // Choix d'un modèle de formulation dans le formulaire de correction.
      box.addEventListener("change", function (ev) {
        var sel = ev.target;
        if (sel && sel.classList && sel.classList.contains("ved-modele") && sel.value) {
          applyModeleToVed(sel.getAttribute("data-mal"), sel.value);
        }
      });
    }
  }

  return { init: init, refresh: refresh, updateBadge: updateBadge };
})();

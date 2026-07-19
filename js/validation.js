/* ============================================================
   Module Béton - CAEK
   validation.js - V3 : écran ADMIN « Validation ».

   Rôle de la validation (jamais bloquante pour le terrain) :
   confirmer la désignation exacte de l'ouvrage coulé et la
   formulation. L'admin examine le récapitulatif soumis puis :
     - ✔ Valider  (admin_valider_coulage : statut 'valide', figé) ;
     - ↩ Renvoyer (admin_renvoyer_coulage : retour brouillon + motif,
       l'opérateur corrige et resoumet).
   Médias : affichés à la validation, mais JAMAIS supprimés ici.
   La suppression n'a lieu qu'après téléchargement, vérification et
   accusé de réception par l'application bureau (archivage).
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
  function num(v) { var s = window.CAEKModel ? CAEKModel.normDigits(v) : String(v == null ? "" : v); var n = parseFloat(s.replace(",", ".")); return isNaN(n) ? 0 : n; }
  function modeCoulageLabel(c) {
    var mode = (c && c.modeCoulage) || "";
    if (mode === "pompe") { return "Pompe"; }
    if (mode === "benne") { return "Benne"; }
    if (mode === "autre") { return c.modeCoulageAutre ? "Autre : " + c.modeCoulageAutre : "Autre"; }
    return "—";
  }

  function clientConfirmationSnapshot(c) {
    var ouvrage = c.designationOfficielle || c.ouvrageCoule ||
      (Array.isArray(c.ouvrages) ? c.ouvrages.join(" + ") : (c.ouvrages || ""));
    var fournisseur = (c.malaxeurs && c.malaxeurs.length)
      ? ((c.malaxeurs[0].formulation || {}).fournisseur || "") : "";
    if (!fournisseur) { fournisseur = c.centrale || ""; }
    var qte = c.quantiteValidee;
    if (qte == null || qte === "") { qte = c.quantiteEstimee; }
    if (qte == null || qte === "") { qte = c.quantiteObservee || c.totalQuantite || ""; }
    return {
      reference: c.ref || "", client: c.client || c.entreprise || "",
      projet: c.nomProjet || "", ouvrage: ouvrage || "",
      bloc: c.bloc || "", etage: c.etage || "", partie: c.partie || "",
      dateCoulage: c.dateCoulage || "", quantite: qte, fournisseur: fournisseur || ""
    };
  }
  function clientConfirmationMessage(c) {
    var s = clientConfirmationSnapshot(c);
    return [
      "Bonjour, merci de confirmer les informations provisoires du coulage :",
      "Référence : " + (s.reference || "—"),
      "Client / projet : " + [s.client, s.projet].filter(Boolean).join(" — "),
      "Ouvrage : " + (s.ouvrage || "—"),
      "Bloc / étage / partie : " + [s.bloc, s.etage, s.partie].filter(Boolean).join(" / "),
      "Date du coulage : " + (fmtDate(s.dateCoulage) || "—"),
      "Quantité de béton : " + (s.quantite === "" ? "—" : s.quantite + " m³"),
      "Fournisseur du béton : " + (s.fournisseur || "—"),
      "Merci de répondre « Je confirme » ou d'indiquer les corrections nécessaires."
    ].join("\n");
  }
  function clientConfirmationPanel(c) {
    var state = c.clientConfirmation || {};
    var label = { partagee: "Demande partagée", confirme: "Confirmé par le client",
      correction_demandee: "Correction demandée par le client" }[state.statut] || "Aucune demande envoyée";
    return "<div class=\"valid-client-confirm\" hidden>" +
      "<p class=\"hint\"><strong>Informations provisoires uniquement.</strong> Aucun résultat d'essai, média ou commentaire interne ne sera partagé.</p>" +
      "<pre class=\"client-confirm-preview\" data-i18n-skip=\"true\">" + escapeHtml(clientConfirmationMessage(c)) + "</pre>" +
      "<div class=\"valid-line\"><strong>État :</strong> " + escapeHtml(label) + "</div>" +
      "<div class=\"oper-actions\">" +
      "<button type=\"button\" class=\"btn-secondary\" data-client-channel=\"whatsapp\" data-ref=\"" + escapeHtml(c.ref) + "\">WhatsApp</button>" +
      "<button type=\"button\" class=\"btn-secondary\" data-client-channel=\"email\" data-ref=\"" + escapeHtml(c.ref) + "\">E-mail</button>" +
      "<button type=\"button\" class=\"btn-text\" data-client-channel=\"copy\" data-ref=\"" + escapeHtml(c.ref) + "\">Copier</button>" +
      "</div><div class=\"oper-actions client-status-actions\">" +
      "<button type=\"button\" class=\"btn-text\" data-client-status=\"confirme\" data-ref=\"" + escapeHtml(c.ref) + "\">Marquer confirmé par le client</button>" +
      "<button type=\"button\" class=\"btn-text\" data-client-status=\"correction_demandee\" data-ref=\"" + escapeHtml(c.ref) + "\">Le client demande une correction</button>" +
      "</div></div>";
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
        " <span class=\"hint\">— conservés jusqu'à l'archivage bureau</span></div>" +
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
      "<button type=\"button\" class=\"btn-secondary\" data-act=\"client-confirmation\" data-ref=\"" + escapeHtml(c.ref) + "\">&#128172; Demander confirmation au client</button>" +
      "<button type=\"button\" class=\"btn-text\" data-act=\"renvoyer\" data-ref=\"" + escapeHtml(c.ref) + "\">&#8617; Renvoyer à l'opérateur</button>" +
      "</div>" + clientConfirmationPanel(c) +
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

  function inp(id, label, value, type, required) {
    return "<label class=\"field-label\" for=\"" + id + "\">" + label + "</label>" +
      "<input id=\"" + id + "\" class=\"field\" type=\"" + (type || "text") + "\" value=\"" +
      escapeHtml(value == null ? "" : value) + "\" autocomplete=\"off\"" + (required ? " required" : "") + ">";
  }

  function editFormHtml(c, mediasHtml) {
    var ouvr = Array.isArray(c.ouvrages) ? c.ouvrages.join(" + ") : (c.ouvrages || "");
    var html = "<div class=\"valid-detail valid-edit\">" +
      "<p class=\"hint\">&#9999;&#65039; <strong>Correction par le vérificateur</strong> — modifiez les informations saisies par l'opérateur, puis enregistrez et validez. Les prélèvements et la codification ne sont pas modifiables ici.</p>" +
      inp("ved-client", "Client", c.client || c.entreprise || "") +
      inp("ved-ouvrages", "Ouvrage(s) coulé(s)", ouvr) +
      inp("ved-designation-officielle", "Désignation officielle de l'ouvrage (documents)", c.designationOfficielle || "") +
      inp("ved-quantite-validee", "Quantité validée (m³)", c.quantiteValidee == null ? "" : c.quantiteValidee) +
      "<div class=\"ved-grid\">" +
      inp("ved-bloc", "Bloc", c.bloc || "") +
      inp("ved-etage", "Étage", c.etage || "") +
      "</div>" +
      inp("ved-partie", "Partie", c.partie || "") +
      inp("ved-date", "Date du coulage", String(c.dateCoulage || "").slice(0, 10), "date", true) +
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
    c.partie = vval("ved-partie");
    // Phase 2 : désignation OFFICIELLE (documents) + quantité VALIDÉE,
    // distinctes de la saisie terrain (jamais écrasée).
    c.designationOfficielle = vval("ved-designation-officielle");
    c.quantiteValidee = vval("ved-quantite-validee");
    var dateSaisie = vval("ved-date");
    var dateParts = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(dateSaisie);
    var dateObjet = dateParts ? new Date(dateSaisie + "T00:00:00") : null;
    if (!dateParts || !dateObjet || isNaN(dateObjet.getTime()) ||
        dateObjet.getFullYear() !== Number(dateParts[1]) ||
        dateObjet.getMonth() + 1 !== Number(dateParts[2]) ||
        dateObjet.getDate() !== Number(dateParts[3])) {
      return { _error: "La date de coulage est obligatoire et doit etre valide." };
    }
    c.dateCoulage = dateSaisie;
    var ancienneDate = String((row.payload && row.payload.dateCoulage) || "").slice(0, 10);
    var nouvelleDate = String(c.dateCoulage || "").slice(0, 10);
    if (nouvelleDate !== ancienneDate) {
      var motifDate = window.prompt("Motif de la correction de la date de coulage (obligatoire et tracé) :", "");
      if (motifDate == null) { return { _cancelled: true }; }
      motifDate = String(motifDate).trim();
      if (!motifDate) { return { _error: "Le motif de correction de la date est obligatoire." }; }
      c._dateCorrectionMotif = motifDate;
      c._dateCorrectionRequestId = window.CAEKCoulages && CAEKCoulages.newUuid ? CAEKCoulages.newUuid() : String(Date.now());
      c._correctionAppareil = String(navigator.userAgent || "").slice(0, 120);
    }
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
    // Keep the client/document supplier aligned with the corrected formulation.
    if (c.malaxeurs && c.malaxeurs.length) {
      var fournisseurCorrige = String((c.malaxeurs[0].formulation || {}).fournisseur || "").trim();
      if (fournisseurCorrige) { c.centrale = fournisseurCorrige; }
    }
    // Traçabilité de la correction (visible sur les documents / le détail).
    var s = window.CAEKOperateurs && CAEKOperateurs.session ? CAEKOperateurs.session() : null;
    c.corrigePar = (s && s.nom) || "Vérificateur";
    c.corrigeLe = fmtDate(new Date().toISOString().slice(0, 10));
    return c;
  }

  function itemHtml(row) {
    var c = row.payload || {};
    c.ref = row.ref;
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
      escapeHtml(row.lot_key) + "\">&#9989; Valider les résultats</button>" +
      "<button type=\"button\" class=\"btn-secondary\" data-act=\"reviser-lot\" data-key=\"" +
      escapeHtml(row.lot_key) + "\">&#128269; Réviser les éprouvettes</button></div>" +
      "<div class=\"valid-revision\" data-key=\"" + escapeHtml(row.lot_key) + "\" hidden></div>" +
      "<div class=\"valid-result result-card\" hidden></div>" +
      "</div>";
  }

  /* ---------- Phase 3 : révision PAR ÉPROUVETTE ----------
     corriger / recalculer / signaler une incohérence / note interne /
     retourner (ingénieur+) / valider ingénieur / approuver responsable.
     Chaque action est tracée côté serveur dans audit_events (ancien,
     nouveau, auteur, rôle, motif, appareil, request_id). */
  function _roleMetier() {
    return (window.CAEKOperateurs && CAEKOperateurs.roleMetier) ? CAEKOperateurs.roleMetier() : "operator";
  }
  function findLot(key) {
    for (var i = 0; i < _lotsT.length; i++) { if (_lotsT[i].lot_key === key) { return _lotsT[i]; } }
    return null;
  }

  function revNum(v) {
    var s = window.CAEKModel ? CAEKModel.normDigits(v) : String(v == null ? "" : v);
    var n = parseFloat(String(s).replace(",", "."));
    return isNaN(n) ? 0 : n;
  }
  function revSurface(forme, d1, d2) {
    if (forme === "cylindre") { var r = revNum(d1) / 2; return Math.PI * r * r; }
    return revNum(d1) * revNum(d2);
  }
  function revRc(force, forme, d1, d2) {
    var surface = revSurface(forme, d1, d2);
    return surface > 0 ? Math.round((revNum(force) * 1000 / surface) * 100) / 100 : 0;
  }
  function revForce(rc, forme, d1, d2) {
    var surface = revSurface(forme, d1, d2);
    return surface > 0 ? Math.round((revNum(rc) * surface / 1000) * 10) / 10 : 0;
  }
  function classeBetonLot(row) {
    var ref = (row && (row.ref || row.coulage_ref)) || "";
    for (var i = 0; i < _rows.length; i++) {
      if (_rows[i].ref !== ref) { continue; }
      var c = _rows[i].payload || {};
      var mal = (c.malaxeurs || [])[0] || {};
      return (mal.formulation || {}).classe || c.classeBeton || c.classe || "";
    }
    return "";
  }
  function revSummaryHtml(row, essais) {
    var values = (essais || []).map(function (e) {
      return revNum(e.rc) || revRc(e.force, e.forme, e.dim1, e.dim2);
    }).filter(function (n) { return n > 0; });
    if (!values.length) { return "<p class=\"hint rev-summary\">Renseignez les résistances pour afficher la moyenne.</p>"; }
    var mean = Math.round((values.reduce(function (a, n) { return a + n; }, 0) / values.length) * 100) / 100;
    var classe = classeBetonLot(row);
    var m = /C\s*([0-9]+)\s*\/\s*([0-9]+)/i.exec(String(classe));
    var hasCube = (essais || []).some(function (e) { return (e.forme || "cube") !== "cylindre"; });
    var cyl = hasCube && m ? Math.round((mean * Number(m[1]) / Number(m[2])) * 100) / 100 : mean;
    var cible = m ? " · classe " + escapeHtml(classe) + " : cible cyl. " + m[1] + " MPa" : "";
    return "<div class=\"result-card rev-summary is-ok\"><strong>Moyenne Rc : " + mean + " MPa</strong>" +
      "<br>Équivalent cylindre : <strong>" + cyl + " MPa</strong>" + cible + "</div>";
  }

  function revPanelHtml(row) {
    var p = row.payload || {};
    var essais = p.essais || [];
    if (!essais.length) { return "<p class=\"hint\">Aucun essai à réviser.</p>"; }
    var role = _roleMetier();
    var ing = (role === "engineer" || role === "responsable" || role === "principal_admin");
    var resp = (role === "responsable" || role === "principal_admin");
    var html = "<p class=\"hint\">&#128269; <strong>Révision par éprouvette</strong> — chaque action est tracée (auteur, rôle, motif, ancien/nouveau).</p>";
    essais.forEach(function (e) {
      var code = e.code || "";
      var eRc = e.rc != null && e.rc !== "" ? e.rc : revRc(e.force, e.forme, e.dim1, e.dim2);
      var etat = [];
      if (e.incoherence) { etat.push("&#9888; " + escapeHtml(e.incoherence)); }
      if (e.noteInterne) { etat.push("&#128221; note interne"); }
      if (e.revision && e.revision.etat === "retournee") { etat.push("&#8617; retournée"); }
      if (e.valideeIngenieur) { etat.push("&#9989; ing. " + escapeHtml(e.valideeIngenieur.par || "")); }
      if (e.approuveeResponsable) { etat.push("&#9989;&#9989; resp. " + escapeHtml(e.approuveeResponsable.par || "")); }
      html += "<div class=\"valid-mal rev-epr\" data-code=\"" + escapeHtml(code) + "\">" +
        "<div class=\"valid-mal-head\"><strong>" + escapeHtml(code) + "</strong>" +
        (e.rc != null ? " · Rc " + escapeHtml(String(e.rc)) + " MPa" : "") +
        (etat.length ? " · " + etat.join(" · ") : "") + "</div>" +
        "<div class=\"ved-grid\">" +
        "<label class=\"field-label\">Forme</label>" +
        "<select class=\"field rev-forme\"><option value=\"cube\"" + (e.forme === "cylindre" ? "" : " selected") + ">Cube</option><option value=\"cylindre\"" + (e.forme === "cylindre" ? " selected" : "") + ">Cylindre</option></select>" +
        "<label class=\"field-label\">Dimensions (mm)</label>" +
        "<div class=\"ved-grid\"><input class=\"field rev-dim1\" type=\"number\" step=\"any\" min=\"0\" value=\"" + escapeHtml(e.dim1 == null ? "" : e.dim1) + "\"><input class=\"field rev-dim2\" type=\"number\" step=\"any\" min=\"0\" value=\"" + escapeHtml(e.dim2 == null ? "" : e.dim2) + "\"></div>" +
        "<label class=\"field-label\">Masse (kg)</label>" +
        "<input class=\"field rev-masse\" type=\"number\" step=\"any\" min=\"0\" value=\"" + escapeHtml(e.masse == null ? "" : e.masse) + "\">" +
        "<label class=\"field-label\">Date essai</label>" +
        "<input class=\"field rev-date\" type=\"date\" value=\"" + escapeHtml(e.dateEssai || "") + "\">" +
        "<label class=\"field-label\">Force (kN)</label>" +
        "<input class=\"field rev-force\" type=\"number\" step=\"any\" min=\"0\" value=\"" + escapeHtml(e.force == null ? "" : e.force) + "\">" +
        "<label class=\"field-label\">Rc (MPa)</label>" +
        "<input class=\"field rev-rc\" type=\"number\" step=\"any\" min=\"0\" value=\"" + escapeHtml(eRc || "") + "\">" +
        "<label class=\"field-label\">Observation</label>" +
        "<input class=\"field rev-obs\" type=\"text\" value=\"" + escapeHtml(e.observation || "") + "\">" +
        "</div>" +
        "<div class=\"oper-actions\">" +
        "<button type=\"button\" class=\"btn-text\" data-rev=\"corriger\" data-code=\"" + escapeHtml(code) + "\">&#128190; Corriger</button>" +
        "<button type=\"button\" class=\"btn-text\" data-rev=\"recalculer\" data-code=\"" + escapeHtml(code) + "\">&#9851; Recalculer Rc</button>" +
        "<button type=\"button\" class=\"btn-text\" data-rev=\"signaler_incoherence\" data-code=\"" + escapeHtml(code) + "\">&#9888; Signaler une incohérence</button>" +
        "<button type=\"button\" class=\"btn-text\" data-rev=\"note_interne\" data-code=\"" + escapeHtml(code) + "\">&#128221; Note interne</button>" +
        (ing ? "<button type=\"button\" class=\"btn-text\" data-rev=\"retourner\" data-code=\"" + escapeHtml(code) + "\">&#8617; Retourner</button>" +
               "<button type=\"button\" class=\"btn-text\" data-rev=\"valider_ingenieur\" data-code=\"" + escapeHtml(code) + "\">&#9989; Valider (ingénieur)</button>" : "") +
        (resp ? "<button type=\"button\" class=\"btn-text\" data-rev=\"approuver_responsable\" data-code=\"" + escapeHtml(code) + "\">&#9989;&#9989; Approuver (responsable)</button>" : "") +
        "</div></div>";
    });
    html += revSummaryHtml(row, essais);
    return html;
  }

  function revAction(key, code, action, itemEl) {
    var row = findLot(key);
    if (!row) { return; }
    var rev = {
      requestId: (window.CAEKCoulages && CAEKCoulages.newUuid) ? CAEKCoulages.newUuid() : String(Date.now()),
      lotKey: key, code: code, action: action,
      appareil: String(navigator.userAgent || "").slice(0, 120)
    };
    if (action === "corriger") {
      var eprEl = itemEl.querySelector(".rev-epr[data-code=\"" + code + "\"]");
      var norm = function (v) { return window.CAEKModel ? CAEKModel.normDigits(v) : v; };
      rev.valeurs = {
        forme: eprEl.querySelector(".rev-forme").value,
        dim1: norm(eprEl.querySelector(".rev-dim1").value.trim()),
        dim2: norm(eprEl.querySelector(".rev-dim2").value.trim()),
        masse: norm(eprEl.querySelector(".rev-masse").value.trim()),
        dateEssai: eprEl.querySelector(".rev-date").value,
        force: norm(eprEl.querySelector(".rev-force").value.trim()),
        rc: norm(eprEl.querySelector(".rev-rc").value.trim()),
        observation: eprEl.querySelector(".rev-obs").value.trim()
      };
      var motifC = window.prompt("Motif de la correction (obligatoire, tracé) :", "");
      if (motifC == null) { return; }
      motifC = String(motifC).trim();
      if (!motifC) { resultBox(itemEl, "&#9888; Le motif est obligatoire.", true); return; }
      rev.motif = motifC;
    }
    if (action === "signaler_incoherence" || action === "retourner") {
      var motif = window.prompt(action === "retourner"
        ? "Motif du retour (visible par l'opérateur) :" : "Décrire l'incohérence :", "");
      if (motif == null) { return; }
      motif = String(motif).trim();
      if (!motif) { resultBox(itemEl, "&#9888; Indiquez un motif.", true); return; }
      rev.motif = motif;
    }
    if (action === "note_interne") {
      var note = window.prompt("Note interne (jamais imprimée sur les documents) :", "");
      if (note == null) { return; }
      rev.note = String(note).trim();
    }
    CAEKServer.reviserEprouvette(CAEKOperateurs.token(), rev).then(function (r) {
      if (!r || r.ok !== true) {
        var msg = { role: "Rôle insuffisant pour cette action.",
          approuve_verrouille: "Lot approuvé par le responsable : verrouillé.",
          verrouille: "Lot validé : révision réservée à l'ingénieur ou plus." }[r && r.error];
        resultBox(itemEl, "&#9888; " + (msg || "Échec de la révision (" + escapeHtml((r && r.error) || "?") + ")."), true);
        return;
      }
      // Répercute l'essai révisé dans la copie locale puis ré-affiche.
      if (r.essai) {
        var p = row.payload || {};
        (p.essais || []).forEach(function (e, i) {
          if (e.code === code) { p.essais[i] = r.essai; }
        });
      }
      resultBox(itemEl, "&#10004; Révision enregistrée (" + escapeHtml(action) + " — " + escapeHtml(code) + ").", false);
      var panel = itemEl.querySelector(".valid-revision");
      if (panel) { panel.innerHTML = revPanelHtml(row); if (window.I18N) { I18N.translate(panel); } }
      if (window.CAEKLots) { CAEKLots.pull(); }
    }).catch(function (e) { resultBox(itemEl, "&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
  }

  // The two values remain linked, as in technician data entry: editing Rc
  // recalculates force, while force or geometry recalculates Rc.
  function updateRevSummary(panel) {
    var row = findLot(panel.getAttribute("data-key"));
    if (!row) { return; }
    var essais = Array.prototype.slice.call(panel.querySelectorAll(".rev-epr")).map(function (epr) {
      return { forme: epr.querySelector(".rev-forme").value, rc: epr.querySelector(".rev-rc").value };
    });
    var old = panel.querySelector(".rev-summary");
    if (old) { old.outerHTML = revSummaryHtml(row, essais); }
  }
  function onRevisionInput(ev) {
    var target = ev.target;
    var epr = target && target.closest ? target.closest(".rev-epr") : null;
    if (!epr || !(target.classList.contains("rev-force") || target.classList.contains("rev-rc") ||
        target.classList.contains("rev-forme") || target.classList.contains("rev-dim1") || target.classList.contains("rev-dim2"))) { return; }
    var forme = epr.querySelector(".rev-forme").value;
    var d1 = epr.querySelector(".rev-dim1").value;
    var d2 = epr.querySelector(".rev-dim2").value;
    var force = epr.querySelector(".rev-force");
    var rc = epr.querySelector(".rev-rc");
    if (target.classList.contains("rev-rc")) {
      if (rc.value !== "") { force.value = revForce(rc.value, forme, d1, d2); }
    } else if (force.value !== "") {
      rc.value = revRc(force.value, forme, d1, d2);
    } else if (rc.value !== "") {
      force.value = revForce(rc.value, forme, d1, d2);
    }
    var panel = epr.closest(".valid-revision");
    if (panel) { updateRevSummary(panel); }
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
    var labo = (window.CAEKLaboFilter ? CAEKLaboFilter.get() : "") || null;
    return Promise.all([
      CAEKServer.listCoulages(CAEKOperateurs.token(), labo),
      CAEKServer.adminListLabos(CAEKOperateurs.token()),
      CAEKServer.listLots(CAEKOperateurs.token(), labo).catch(function () { return []; })
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

  function clientEvent(ref, type, payload) {
    var rid = window.CAEKCoulages && CAEKCoulages.newUuid ? CAEKCoulages.newUuid() : String(Date.now());
    return CAEKServer.coulageEvent(CAEKOperateurs.token(), {
      eventKey: ref + ":" + type + ":" + rid,
      ref: ref, type: type, payload: payload || {}, requestId: rid,
      appareil: String(navigator.userAgent || "").slice(0, 120)
    });
  }
  function shareClientConfirmation(ref, channel, itemEl) {
    var row = findRow(ref); if (!row) { return; }
    var c = row.payload || {}; c.ref = ref;
    var message = clientConfirmationMessage(c);
    if (!window.confirm("Partager uniquement les informations affichées avec le client ?\n\nCanal : " + channel + "\n\nContinuer ?")) { return; }
    var launched = Promise.resolve();
    if (channel === "whatsapp") {
      var tel = String(c.contactTel || c.telephone || "").replace(/[^0-9]/g, "");
      window.open("https://wa.me/" + tel + "?text=" + encodeURIComponent(message), "_blank", "noopener");
    } else if (channel === "email") {
      window.location.href = "mailto:" + encodeURIComponent(c.email || "") + "?subject=" +
        encodeURIComponent("Confirmation provisoire du coulage " + ref) + "&body=" + encodeURIComponent(message);
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      launched = navigator.clipboard.writeText(message);
    } else {
      window.prompt("Copier le message de confirmation :", message);
    }
    launched.then(function () {
      return clientEvent(ref, "client_confirmation_partagee", {
        canal: channel, snapshot: clientConfirmationSnapshot(c)
      });
    }).then(function (r) {
      resultBox(itemEl, r && r.ok === true
        ? "&#10004; Partage initié et tracé. La réponse du client doit encore être enregistrée."
        : "&#9888; Partage initié, mais sa traçabilité serveur a échoué.", !(r && r.ok === true));
      setTimeout(refresh, 500);
    }).catch(function (e) { resultBox(itemEl, "&#9888; Partage non enregistré : " + escapeHtml(e && e.message || ""), true); });
  }
  function setClientConfirmationStatus(ref, status, itemEl) {
    var question = status === "confirme"
      ? "Confirmer que le client a explicitement validé ces informations ?"
      : "Confirmer que le client a demandé une correction ?";
    if (!window.confirm(question)) { return; }
    var note = "";
    if (status === "correction_demandee") {
      var p = window.prompt("Correction demandée par le client :", "");
      if (p == null) { return; }
      note = String(p).trim();
    }
    clientEvent(ref, "client_confirmation_statut", { statut: status, note: note }).then(function (r) {
      resultBox(itemEl, r && r.ok === true ? "&#10004; État de confirmation client enregistré."
        : "&#9888; État non enregistré.", !(r && r.ok === true));
      setTimeout(refresh, 500);
    }).catch(function (e) { resultBox(itemEl, "&#9888; Réseau requis : " + escapeHtml(e && e.message || ""), true); });
  }

  // p_override : payload CORRIGÉ par le vérificateur (formulaire d'édition).
  function valider(ref, itemEl, p_override) {
    var row = findRow(ref);
    if (!row) { return; }
    var confirmMsg = window.I18N && I18N.f
      ? I18N.f("Valider le coulage {ref} ?", { ref: ref }) + "\n" +
        I18N.f("La désignation de l'ouvrage et la formulation sont confirmées. La fiche sera figée.") + "\n" +
        I18N.f("Les photos et audios restent en ligne jusqu'à leur archivage par le bureau.")
      : "Valider le coulage " + ref + " ?\nLa désignation de l'ouvrage et la formulation sont confirmées. La fiche sera figée.\nLes photos et audios restent en ligne jusqu'à leur archivage par le bureau.";
    if (!window.confirm(confirmMsg)) { return; }
    var payload = p_override || row.payload || {};
    var toSend;
    try { toSend = JSON.parse(JSON.stringify(payload)); } catch (e) { toSend = payload; }
    // GARDE-FOU : aucune suppression de média ici. Les médias restent dans
    // Storage tant que le bureau ne les a pas téléchargés, vérifiés et
    // accusés côté serveur (media_archive_receipts, Phase 4).
    delete toSend.mediasPurgePending;
    _editRef = null;
    CAEKServer.adminValiderCoulage(CAEKOperateurs.token(), ref, toSend).then(function (r) {
      if (!r || r.ok !== true) {
        if (r && r.error === "date_lots_engages" && !toSend._forceDateLotsEngages) {
          var forceMsg = "Au moins un lot est déjà sorti ou testé.\n\n" +
            "Les lots encore dans le bassin seront replanifiés. Les lots déjà engagés garderont leur échéance historique et seront signalés pour révision des âges/résultats.\n\n" +
            "Appliquer quand même la date corrigée avec cette traçabilité ?";
          if (window.confirm(forceMsg)) {
            toSend._forceDateLotsEngages = true;
            CAEKServer.adminValiderCoulage(CAEKOperateurs.token(), ref, toSend).then(function (r2) {
              if (!r2 || r2.ok !== true) { resultBox(itemEl, "&#9888; Correction contrôlée refusée.", true); return; }
              revokeUrls();
              resultBox(itemEl, "&#10004; Coulage validé et date corrigée avec traçabilité : " +
                (r2.lots_replanifies || 0) + " lot(s) replanifié(s), " +
                (r2.lots_engages_signales || 0) + " lot(s) engagé(s) signalé(s) pour révision.", false);
              if (window.CAEKCoulages) { CAEKCoulages.pull(); }
              if (window.CAEKLots) { CAEKLots.pull(); }
              setTimeout(refresh, 800);
            }).catch(function (e2) { resultBox(itemEl, "&#9888; Réseau requis : " + escapeHtml(e2 && e2.message || ""), true); });
          }
          return;
        }
        var errors = {
          deja_valide: "Déjà validé.",
          motif_date_requis: "Le motif de correction de la date est obligatoire.",
          date_lots_engages: "La date ne peut pas être corrigée silencieusement : au moins un lot est déjà sorti ou testé. Renvoyez le dossier pour un traitement contrôlé.",
          date_invalide: "La nouvelle date de coulage est invalide."
        };
        resultBox(itemEl, "&#9888; " + (errors[r && r.error] || "Échec de la validation."), true);
        return;
      }
      revokeUrls();
      resultBox(itemEl, "&#10004; Coulage validé." +
        (r.lots_replanifies ? " " + r.lots_replanifies + " lot(s) du bassin replanifié(s)." : "") +
        " Les médias restent en ligne (archivage bureau).", false);
      if (window.CAEKCoulages) { CAEKCoulages.pull(); }
      if (window.CAEKLots) { CAEKLots.pull(); }
      setTimeout(refresh, 800);
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
        if (corrige._cancelled) { return; }
        if (corrige._error) { resultBox(item, "&#9888; " + escapeHtml(corrige._error), true); return; }
        valider(ref, item, corrige);
      }
      else if (a === "client-confirmation") {
        var cpanel = item ? item.querySelector(".valid-client-confirm") : null;
        if (cpanel) { cpanel.hidden = !cpanel.hidden; }
      }
      else if (a === "renvoyer") { renvoyer(ref, item); }
      else if (a === "valider-lot") { validerLot(act.getAttribute("data-key"), item); }
      else if (a === "reviser-lot") {
        var rkey = act.getAttribute("data-key");
        var rpanel = item ? item.querySelector(".valid-revision") : null;
        var rrow = findLot(rkey);
        if (rpanel && rrow) {
          rpanel.hidden = !rpanel.hidden;
          if (!rpanel.hidden) {
            rpanel.innerHTML = revPanelHtml(rrow);
            if (window.I18N) { I18N.translate(rpanel); }
          }
        }
      }
      return;
    }
    var channelBtn = tgt.closest ? tgt.closest("[data-client-channel]") : null;
    if (channelBtn && item) {
      shareClientConfirmation(channelBtn.getAttribute("data-ref"), channelBtn.getAttribute("data-client-channel"), item);
      return;
    }
    var statusBtn = tgt.closest ? tgt.closest("[data-client-status]") : null;
    if (statusBtn && item) {
      setClientConfirmationStatus(statusBtn.getAttribute("data-ref"), statusBtn.getAttribute("data-client-status"), item);
      return;
    }
    // Actions de révision par éprouvette (Phase 3).
    var revBtn = tgt.closest ? tgt.closest("[data-rev]") : null;
    if (revBtn && item) {
      var rvKey = (item.querySelector(".valid-revision") || {}).getAttribute
        ? item.querySelector(".valid-revision").getAttribute("data-key") : null;
      revAction(rvKey, revBtn.getAttribute("data-code"), revBtn.getAttribute("data-rev"), item);
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
      box.addEventListener("input", onRevisionInput);
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

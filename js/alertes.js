/* ============================================================
   Module Béton - CAEK
   alertes.js — « Alerte coulage » (BF-001), planification + accusé
   de réception. Totalement indépendant de la fiche de coulage :
   aucune lecture ni écriture dans coulages / lots / prelevements.

   - Le responsable / ingénieur / admin annonce un coulage à venir ;
     le laboratoire est déduit du projet (jamais saisi).
   - Le nombre de moules est calculé et figé côté SERVEUR
     (resp_create/update_alerte_coulage) ; l'aperçu affiché ici est
     purement informatif et recalculé localement le temps de la
     saisie (CAEKModel.recommendationEprouvettes), jamais envoyé.
   - Un opérateur du labo clique « J'ai pris en charge » (transition
     atomique côté serveur : le perdant reçoit le nom du gagnant).
   - Bandeau rouge app-wide : urgences non prises en charge (vue
     opérateur) + alertes de non-prise-en-charge (vue responsable).
   ============================================================ */
var CAEKAlertes = (function () {
  "use strict";

  var ICONS = "assets/icons/ouvrages/";
  var OUVRAGE_FAMILIES = [
    { key: "fondation", titre: "Fondation", items: [
      { key: "semelle", label: "Semelle isolée" },
      { key: "semelle_filante", label: "Semelle filante" },
      { key: "radier", label: "Radier" },
      { key: "longrine", label: "Longrine / libage" },
      { key: "pieu", label: "Pieu" },
      { key: "plot", label: "Plot" },
      { key: "mur_soutenement", label: "Mur de soutènement" },
      { key: "ouvrage_enterre", label: "Ouvrage enterré" },
      { key: "regard", label: "Regard" },
      { key: "piscine", label: "Piscine" }
    ]},
    { key: "superstructure", titre: "Superstructure", items: [
      { key: "poteau", label: "Poteau" },
      { key: "voile", label: "Voile" },
      { key: "dalle", label: "Dalle" },
      { key: "poutre", label: "Poutre" },
      { key: "escalier", label: "Escalier" },
      { key: "console_balcon", label: "Console / Balcon" },
      { key: "parapet_acrotere", label: "Parapet / Acrotère" },
      { key: "cuve_bache_eau", label: "Cuve / Bâche à eau" }
    ]}
  ];

  var ETAGES = ["4e sous-sol", "3e sous-sol", "2e sous-sol", "1er sous-sol", "RDC",
    "Mezzanine 1", "Mezzanine 2", "1er étage", "2e étage", "3e étage", "4e étage",
    "5e étage", "6e étage", "7e étage", "8e étage", "9e étage", "10e étage",
    "11e étage", "12e étage", "13e étage", "14e étage", "15e étage", "Buanderie"];

  var _alertes = [];       // liste active (a_prendre_en_charge | prise_en_charge | reportee)
  var _historique = [];    // terminee | annulee (chargé à la demande)
  var _historiqueOuvert = false;
  var _editing = null;     // id en cours de modification, ou null (création)
  var _clients = [];
  var _projets = [];

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function basename(p) { p = String(p || ""); return p.slice(p.lastIndexOf("/") + 1); }

  // Recharge le référentiel depuis icons_manifest.json (même source de
  // vérité que la fiche de coulage), sans dépendre du module CAEKFiche.
  function loadIconsManifest() {
    if (!window.fetch) { return; }
    fetch("icons_manifest.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
      if (!m) { return; }
      var byId = {}; (m.elements || []).forEach(function (e) { byId[e.id] = e; });
      var fams = (m.familles || []).map(function (f) {
        return {
          key: f.id, titre: f.label,
          items: (f.items || []).map(function (id) {
            var e = byId[id] || {};
            return { key: id, label: e.label || id };
          })
        };
      });
      if (fams.length) { OUVRAGE_FAMILIES = fams; populateOuvrageSelect(); }
    }).catch(function () {});
  }

  function ouvrageLabel(k) {
    for (var i = 0; i < OUVRAGE_FAMILIES.length; i++) {
      var it = OUVRAGE_FAMILIES[i].items;
      for (var j = 0; j < it.length; j++) { if (it[j].key === k) { return it[j].label; } }
    }
    return k;
  }

  /* ---------- Contexte utilisateur ---------- */
  function isLogged() { return window.CAEKOperateurs && CAEKOperateurs.isLogged(); }
  function isAdmin() { return window.CAEKOperateurs && CAEKOperateurs.isAdmin(); }
  function roleMetier() { return window.CAEKOperateurs && CAEKOperateurs.roleMetier ? CAEKOperateurs.roleMetier() : null; }
  // Qui peut planifier : responsable, ingénieur ou admin (miroir de
  // _peut_planifier côté serveur — l'affichage seul, le serveur tranche).
  function canPlanifier() {
    if (!isLogged()) { return false; }
    if (isAdmin()) { return true; }
    var r = roleMetier();
    return r === "engineer" || r === "responsable";
  }
  function currentLabo() {
    if (window.CAEKLaboFilter && CAEKLaboFilter.get()) { return CAEKLaboFilter.get(); }
    var own = window.CAEKOperateurs && CAEKOperateurs.laboId ? (CAEKOperateurs.laboId() || "") : "";
    if (own) { return own; }
    var allowed = window.CAEKOperateurs && CAEKOperateurs.adminLabos ? CAEKOperateurs.adminLabos() : null;
    return allowed && allowed.length === 1 ? allowed[0] : "";
  }
  function serverReady() {
    return navigator.onLine !== false && window.CAEKServer && CAEKServer.configured() && isLogged();
  }

  /* ---------- Formatage ---------- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function fmtDateTime(iso) {
    if (!iso) { return "—"; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return "—"; }
    return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear() +
      " à " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  // Valeur d'un <input type="datetime-local"> pour un ISO donné (heure locale).
  function isoToLocalInput(iso) {
    if (!iso) { return ""; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ""; }
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  function localInputToIso(v) {
    if (!v) { return null; }
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  var STATUT_LABEL = {
    a_prendre_en_charge: "À prendre en charge",
    prise_en_charge: "Prise en charge",
    reportee: "Reportée",
    annulee: "Annulée",
    terminee: "Terminée"
  };

  /* ---------- Référentiels (client / projet) ---------- */
  function refreshReferentiels() {
    if (!window.CAEKDB) { return Promise.resolve(); }
    return Promise.all([CAEKDB.getAllClients(), CAEKDB.getAllProjets()]).then(function (out) {
      _clients = (out[0] || []).filter(function (c) { return c.actif !== false; });
      _projets = (out[1] || []).filter(function (p) { return p.actif !== false; });
      populateProjetSelect();
    });
  }
  function clientNom(clientId) {
    for (var i = 0; i < _clients.length; i++) { if (_clients[i].clientId === clientId) { return _clients[i].nom; } }
    return "";
  }
  function projetByCode(code) {
    for (var i = 0; i < _projets.length; i++) { if (_projets[i].codeProjet === code) { return _projets[i]; } }
    return null;
  }
  function populateProjetSelect() {
    var sel = $("ac-projet");
    if (!sel) { return; }
    var liste = _projets.slice().sort(function (a, b) { return a.codeProjet.localeCompare(b.codeProjet); });
    var html = "<option value=\"\">— Choisir un projet —</option>";
    liste.forEach(function (p) {
      var nomClient = clientNom(p.clientId);
      html += "<option value=\"" + escapeHtml(p.codeProjet) + "\">" +
        escapeHtml(p.codeProjet) + " — " + escapeHtml(p.nomProjet) +
        (nomClient ? " (" + escapeHtml(nomClient) + ")" : "") + "</option>";
    });
    sel.innerHTML = html;
  }
  function populateOuvrageSelect() {
    var sel = $("ac-ouvrage");
    if (!sel) { return; }
    var html = "<option value=\"\">— Choisir un ouvrage —</option>";
    OUVRAGE_FAMILIES.forEach(function (fam) {
      html += "<optgroup label=\"" + escapeHtml(fam.titre) + "\">";
      fam.items.forEach(function (it) {
        html += "<option value=\"" + escapeHtml(it.key) + "\">" + escapeHtml(it.label) + "</option>";
      });
      html += "</optgroup>";
    });
    html += "<option value=\"__autre__\">Autres (ouvrage non listé)</option>";
    sel.innerHTML = html;
  }
  function populateEtageSelect() {
    var sel = $("ac-etage");
    if (!sel) { return; }
    var html = "<option value=\"\">— Aucun —</option>";
    ETAGES.forEach(function (e) { html += "<option value=\"" + escapeHtml(e) + "\">" + escapeHtml(e) + "</option>"; });
    sel.innerHTML = html;
  }

  /* ---------- Aperçu moules (informatif, non transmis) ---------- */
  function refreshApercu() {
    var box = $("ac-apercu-moules");
    if (!box || !window.CAEKModel) { return; }
    var q = CAEKModel.floatOrNull($("ac-quantite") ? $("ac-quantite").value : "");
    if (q == null || q <= 0) { box.textContent = ""; return; }
    CAEKModel.loadLaboSettings(currentLabo()).then(function (settings) {
      var n = CAEKModel.recommendationEprouvettes(q, settings);
      box.textContent = "≈ " + n + " moule(s) à préparer (calcul définitif à l'enregistrement).";
    });
  }

  /* ---------- Chargement / rendu ---------- */
  function result(html, isError) {
    var b = $("ac-result"); if (!b) { return; }
    b.hidden = false; b.className = "result-card " + (isError ? "is-error" : "is-ok"); b.innerHTML = html;
  }

  function refresh() {
    if (!serverReady() || !CAEKServer.listAlertesCoulage) {
      _alertes = [];
      renderListe(); renderBadge(); renderBanner();
      return Promise.resolve();
    }
    var labo = currentLabo() || null;
    return CAEKServer.listAlertesCoulage(CAEKOperateurs.token(), labo, false).then(function (r) {
      _alertes = (r && r.ok === true) ? (r.alertes || []) : [];
      renderListe(); renderBadge(); renderBanner();
      return _alertes;
    }).catch(function () {
      renderListe(); renderBadge(); renderBanner();
    });
  }

  function refreshHistorique() {
    if (!serverReady() || !CAEKServer.listAlertesCoulage) { return Promise.resolve(); }
    var labo = currentLabo() || null;
    return CAEKServer.listAlertesCoulage(CAEKOperateurs.token(), labo, true).then(function (r) {
      _historique = (r && r.ok === true) ? (r.alertes || []) : [];
      renderHistorique();
    });
  }

  function renderBadge() {
    var n = _alertes.filter(function (a) { return a.statut !== 'prise_en_charge'; }).length;
    if (window.CAEKBadges) { CAEKBadges.setBadge("badge-alertes", n); }
  }

  // Bandeau rouge app-wide : urgences non prises (tous), et alertes de
  // non-prise-en-charge (visibles par qui peut planifier — responsable,
  // ingénieur, admin — déjà scopées à leur labo par op_list_alertes_coulage ;
  // le serveur reste seul juge de l'identité exacte du créateur).
  function renderBanner() {
    var bar = $("alertes-coulage-banner");
    if (!bar) { return; }
    var urgentesLibres = _alertes.filter(function (a) {
      return a.urgent && a.statut !== "prise_en_charge";
    });
    var mesAlertesIgnorees = canPlanifier() ? _alertes.filter(function (a) {
      return a.alerteEnvoyeeAt && !a.alerteVueAt && a.prisePar == null;
    }) : [];
    if (mesAlertesIgnorees.length) {
      bar.hidden = false;
      bar.innerHTML = "&#9888; <strong>" + mesAlertesIgnorees.length +
        "</strong> alerte(s) de coulage sans prise en charge — personne n'a accusé réception.";
    } else if (urgentesLibres.length) {
      bar.hidden = false;
      bar.innerHTML = "&#128680; <strong>" + urgentesLibres.length +
        "</strong> coulage(s) URGENT annoncé(s) — prise en charge requise.";
    } else {
      bar.hidden = true; bar.innerHTML = "";
    }
  }

  function cardHtml(a, closable) {
    var urgentCls = a.urgent ? " is-urgent" : "";
    var lieu = [a.bloc ? "Bloc " + a.bloc : "", a.etage].filter(Boolean).join(" · ");
    var ouvrage = a.ouvrageKey === "__autre__" ? a.ouvrageAutre : ouvrageLabel(a.ouvrageKey);
    var prise = a.prisePar
      ? "&#10004; Pris en charge par <strong>" + escapeHtml(a.priseParNom) + "</strong> le " + fmtDateTime(a.priseAt)
      : "&#9203; Non pris en charge";
    var actions = "";
    if (!closable) {
      if (!a.prisePar) {
        actions += "<button class=\"btn-primary alerte-btn-prendre\" type=\"button\" data-id=\"" + a.id + "\">&#10004; J'ai pris en charge</button>";
      }
      if (canPlanifier()) {
        actions += "<button class=\"btn-secondary alerte-btn-modifier\" type=\"button\" data-id=\"" + a.id + "\">&#9998; Modifier / reporter</button>" +
          "<button class=\"btn-secondary alerte-btn-terminer\" type=\"button\" data-id=\"" + a.id + "\">&#10004; Terminé</button>" +
          "<button class=\"btn-secondary alerte-btn-annuler\" type=\"button\" data-id=\"" + a.id + "\">&#10005; Annuler</button>";
      }
    }
    return "<div class=\"alerte-card" + urgentCls + "\">" +
      (a.urgent ? "<div class=\"alerte-tag-urgent\">&#128680; URGENT</div>" : "") +
      "<div class=\"alerte-statut\">" + (STATUT_LABEL[a.statut] || a.statut) + "</div>" +
      "<div class=\"alerte-titre\">" + escapeHtml(a.codeProjet || "") +
        (a.clientNom ? " — " + escapeHtml(a.clientNom) : "") + "</div>" +
      "<div class=\"alerte-ligne\">" + escapeHtml(ouvrage || "—") +
        (lieu ? " · " + escapeHtml(lieu) : "") + "</div>" +
      "<div class=\"alerte-ligne\"><strong>" + fmtDateTime(a.prevuAt) + "</strong> · " +
        (a.quantiteM3 != null ? a.quantiteM3 : "—") + " m³ · " +
        "<strong>" + (a.moulesCalcules != null ? a.moulesCalcules : "—") + "</strong> moule(s) à préparer</div>" +
      (a.demandeurNom ? "<div class=\"alerte-ligne hint\">Demandé par <strong>" + escapeHtml(a.demandeurNom) +
        "</strong>" + (a.demandeurFonction ? " (" + escapeHtml(a.demandeurFonction) + ")" : "") + "</div>" : "") +
      (a.observations ? "<div class=\"alerte-ligne hint\">&#128221; " + escapeHtml(a.observations) + "</div>" : "") +
      "<div class=\"alerte-ligne\">" + prise + "</div>" +
      (actions ? "<div class=\"alerte-actions\">" + actions + "</div>" : "") +
      "</div>";
  }

  function renderListe() {
    var box = $("ac-liste");
    if (!box) { return; }
    if (!isLogged()) { box.innerHTML = "<p class=\"hint\">Connectez-vous pour voir les alertes de coulage.</p>"; return; }
    if (!_alertes.length) { box.innerHTML = "<p class=\"hint\">Aucune alerte de coulage active.</p>"; return; }
    var tri = _alertes.slice().sort(function (a, b) {
      if (!!b.urgent !== !!a.urgent) { return b.urgent ? 1 : -1; }
      return new Date(a.prevuAt) - new Date(b.prevuAt);
    });
    box.innerHTML = tri.map(function (a) { return cardHtml(a, false); }).join("");
  }

  function renderHistorique() {
    var box = $("ac-historique");
    if (!box) { return; }
    if (!_historique.length) { box.innerHTML = "<p class=\"hint\">Aucune alerte terminée ou annulée.</p>"; return; }
    var tri = _historique.slice().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
    box.innerHTML = tri.map(function (a) { return cardHtml(a, true); }).join("");
  }

  /* ---------- Formulaire création / modification ---------- */
  function resetForm() {
    _editing = null;
    ["ac-projet", "ac-ouvrage", "ac-bloc", "ac-etage", "ac-date", "ac-quantite",
      "ac-demandeur-nom", "ac-demandeur-fonction", "ac-observations"].forEach(function (id) {
      var el = $(id); if (el) { el.value = ""; }
    });
    if ($("ac-ouvrage-autre")) { $("ac-ouvrage-autre").value = ""; $("ac-ouvrage-autre").hidden = true; }
    if ($("ac-urgent")) { $("ac-urgent").checked = false; }
    if ($("ac-apercu-moules")) { $("ac-apercu-moules").textContent = ""; }
    if ($("ac-form-titre")) { $("ac-form-titre").textContent = "Nouvelle alerte coulage"; }
    if ($("ac-form-valider")) { $("ac-form-valider").innerHTML = "&#10004; Créer l'alerte"; }
  }

  function openForm(alerte) {
    if (!canPlanifier()) { return; }
    resetForm();
    if (alerte) {
      _editing = alerte.id;
      if ($("ac-projet")) { $("ac-projet").value = alerte.codeProjet || ""; }
      if ($("ac-ouvrage")) {
        $("ac-ouvrage").value = alerte.ouvrageKey === "__autre__" || (alerte.ouvrageAutre && !alerte.ouvrageKey) ? "__autre__" : (alerte.ouvrageKey || "");
      }
      if ($("ac-ouvrage-autre")) {
        var estAutre = $("ac-ouvrage") && $("ac-ouvrage").value === "__autre__";
        $("ac-ouvrage-autre").hidden = !estAutre;
        $("ac-ouvrage-autre").value = alerte.ouvrageAutre || "";
      }
      if ($("ac-bloc")) { $("ac-bloc").value = alerte.bloc || ""; }
      if ($("ac-etage")) { $("ac-etage").value = alerte.etage || ""; }
      if ($("ac-date")) { $("ac-date").value = isoToLocalInput(alerte.prevuAt); }
      if ($("ac-quantite")) { $("ac-quantite").value = alerte.quantiteM3 != null ? alerte.quantiteM3 : ""; }
      if ($("ac-urgent")) { $("ac-urgent").checked = !!alerte.urgent; }
      if ($("ac-demandeur-nom")) { $("ac-demandeur-nom").value = alerte.demandeurNom || ""; }
      if ($("ac-demandeur-fonction")) { $("ac-demandeur-fonction").value = alerte.demandeurFonction || ""; }
      if ($("ac-observations")) { $("ac-observations").value = alerte.observations || ""; }
      if ($("ac-form-titre")) { $("ac-form-titre").textContent = "Modifier / reporter l'alerte"; }
      if ($("ac-form-valider")) { $("ac-form-valider").innerHTML = "&#10004; Enregistrer"; }
      refreshApercu();
    }
    var panel = $("ac-form"); if (panel) { panel.hidden = false; }
    var toggleBtn = $("ac-btn-nouveau"); if (toggleBtn) { toggleBtn.hidden = true; }
    if (panel && panel.scrollIntoView) { panel.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }

  function closeForm() {
    resetForm();
    var panel = $("ac-form"); if (panel) { panel.hidden = true; }
    var toggleBtn = $("ac-btn-nouveau"); if (toggleBtn) { toggleBtn.hidden = !canPlanifier(); }
    if ($("ac-result")) { $("ac-result").hidden = true; }
  }

  function submitForm() {
    if (!canPlanifier()) { result("&#9888; Rôle insuffisant pour planifier une alerte coulage.", true); return; }
    if (!serverReady()) { result("&#9888; Réseau requis pour créer ou modifier une alerte coulage.", true); return; }

    var codeProjet = ($("ac-projet") ? $("ac-projet").value : "").trim();
    if (!codeProjet) { result("&#9888; Choisissez un projet.", true); return; }

    var ouvrageSel = $("ac-ouvrage") ? $("ac-ouvrage").value : "";
    var ouvrageKey = ouvrageSel === "__autre__" ? "" : ouvrageSel;
    var ouvrageAutre = ouvrageSel === "__autre__" ? ($("ac-ouvrage-autre") ? $("ac-ouvrage-autre").value.trim() : "") : "";

    var dateVal = $("ac-date") ? $("ac-date").value : "";
    var prevuAt = localInputToIso(dateVal);
    if (!prevuAt) { result("&#9888; Indiquez la date et l'heure prévues.", true); return; }

    var quantite = window.CAEKModel ? CAEKModel.floatOrNull($("ac-quantite") ? $("ac-quantite").value : "") : parseFloat($("ac-quantite") ? $("ac-quantite").value : "");
    if (quantite == null || quantite <= 0) { result("&#9888; Indiquez la quantité de béton prévue (m³).", true); return; }

    var payload = {
      codeProjet: codeProjet,
      clientId: (projetByCode(codeProjet) || {}).clientId || "",
      ouvrageKey: ouvrageKey, ouvrageAutre: ouvrageAutre,
      bloc: $("ac-bloc") ? $("ac-bloc").value.trim() : "",
      etage: $("ac-etage") ? $("ac-etage").value : "",
      prevuAt: prevuAt, quantiteM3: quantite,
      urgent: !!($("ac-urgent") && $("ac-urgent").checked),
      demandeurNom: $("ac-demandeur-nom") ? $("ac-demandeur-nom").value.trim() : "",
      demandeurFonction: $("ac-demandeur-fonction") ? $("ac-demandeur-fonction").value.trim() : "",
      observations: $("ac-observations") ? $("ac-observations").value.trim() : ""
    };

    var btn = $("ac-form-valider"); if (btn) { btn.disabled = true; }
    var op = _editing
      ? CAEKServer.updateAlerteCoulage(CAEKOperateurs.token(), _editing, payload)
      : CAEKServer.createAlerteCoulage(CAEKOperateurs.token(), payload);
    op.then(function (r) {
      if (btn) { btn.disabled = false; }
      if (!r || r.ok !== true) {
        result("&#9888; Échec : " + escapeHtml((r && r.error) || "erreur"), true);
        return;
      }
      result(_editing ? "&#10004; Alerte mise à jour." : "&#10004; Alerte créée et notification envoyée au laboratoire.", false);
      closeForm();
      refresh();
    }).catch(function (e) {
      if (btn) { btn.disabled = false; }
      result("&#9888; " + escapeHtml((e && e.message) || "erreur réseau"), true);
    });
  }

  function prendreEnCharge(id) {
    if (!serverReady()) { result("&#9888; Réseau requis pour prendre en charge une alerte.", true); return; }
    CAEKServer.prendreEnChargeAlerte(CAEKOperateurs.token(), id).then(function (r) {
      if (!r || r.ok !== true) {
        var msg = r && r.error === "deja_prise"
          ? "Déjà pris en charge par " + escapeHtml(r.priseParNom || "un autre opérateur") + "."
          : "Échec : " + escapeHtml((r && r.error) || "erreur");
        result("&#9888; " + msg, true);
        refresh();
        return;
      }
      result("&#10004; Prise en charge confirmée.", false);
      refresh();
    }).catch(function (e) { result("&#9888; " + escapeHtml((e && e.message) || "erreur réseau"), true); });
  }

  function changerStatut(id, statut) {
    if (!canPlanifier()) { return; }
    if (statut === "annulee" && !window.confirm("Annuler cette alerte de coulage ?")) { return; }
    if (!serverReady()) { result("&#9888; Réseau requis.", true); return; }
    CAEKServer.updateAlerteCoulage(CAEKOperateurs.token(), id, { statut: statut }).then(function (r) {
      if (!r || r.ok !== true) { result("&#9888; Échec : " + escapeHtml((r && r.error) || "erreur"), true); return; }
      result("&#10004; Alerte mise à jour.", false);
      refresh();
    }).catch(function (e) { result("&#9888; " + escapeHtml((e && e.message) || "erreur réseau"), true); });
  }

  function findAlerte(id) {
    for (var i = 0; i < _alertes.length; i++) { if (_alertes[i].id === id) { return _alertes[i]; } }
    return null;
  }

  function ackBanner() {
    // Acquitte côté serveur toutes les alertes non-prises portées par ce
    // responsable (second filet applicatif : masque le bandeau localement).
    var candidates = _alertes.filter(function (a) { return a.alerteEnvoyeeAt && !a.alerteVueAt && a.prisePar == null; });
    if (!serverReady() || !candidates.length) { return; }
    candidates.forEach(function (a) { CAEKServer.ackAlerteCoulage(CAEKOperateurs.token(), a.id).catch(function () {}); });
    setTimeout(refresh, 400);
  }

  /* ---------- Liaison DOM ---------- */
  function init() {
    populateOuvrageSelect();
    populateEtageSelect();
    loadIconsManifest();

    var btnNouveau = $("ac-btn-nouveau");
    if (btnNouveau) { btnNouveau.addEventListener("click", function () { openForm(null); }); }
    var btnAnnulerForm = $("ac-form-annuler");
    if (btnAnnulerForm) { btnAnnulerForm.addEventListener("click", closeForm); }
    var btnValider = $("ac-form-valider");
    if (btnValider) { btnValider.addEventListener("click", submitForm); }
    var ouvrageSel = $("ac-ouvrage");
    if (ouvrageSel) {
      ouvrageSel.addEventListener("change", function () {
        if ($("ac-ouvrage-autre")) { $("ac-ouvrage-autre").hidden = ouvrageSel.value !== "__autre__"; }
      });
    }
    var qte = $("ac-quantite");
    if (qte) { qte.addEventListener("input", refreshApercu); }

    var btnHisto = $("ac-btn-historique");
    if (btnHisto) {
      btnHisto.addEventListener("click", function () {
        _historiqueOuvert = !_historiqueOuvert;
        if ($("ac-historique-box")) { $("ac-historique-box").hidden = !_historiqueOuvert; }
        btnHisto.textContent = _historiqueOuvert ? "Masquer l'historique" : "Voir l'historique";
        if (_historiqueOuvert) { refreshHistorique(); }
      });
    }

    var liste = $("ac-liste");
    if (liste) {
      liste.addEventListener("click", function (ev) {
        var btn = ev.target.closest ? ev.target.closest("button[data-id]") : null;
        if (!btn) { return; }
        var id = btn.getAttribute("data-id");
        if (btn.classList.contains("alerte-btn-prendre")) { prendreEnCharge(id); }
        else if (btn.classList.contains("alerte-btn-modifier")) { openForm(findAlerte(id)); }
        else if (btn.classList.contains("alerte-btn-terminer")) { changerStatut(id, "terminee"); }
        else if (btn.classList.contains("alerte-btn-annuler")) { changerStatut(id, "annulee"); }
      });
    }

    var banner = $("alertes-coulage-banner");
    if (banner) {
      banner.addEventListener("click", function () {
        if (window.CAEKApp) { CAEKApp.navigate("screen-alertes-coulage"); }
        ackBanner();
      });
    }

    refreshReferentiels();
    if (btnNouveau) { btnNouveau.hidden = !canPlanifier(); }
    setTimeout(refresh, 1800);
  }

  return {
    init: init, refresh: refresh, refreshReferentiels: refreshReferentiels,
    closeForm: closeForm
  };
})();

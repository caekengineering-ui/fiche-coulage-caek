/* ============================================================
   Fiche de coulage terrain - CAEK
   bassin.js - Module "Bassin de conservation des éprouvettes".
   Trois écrans :
     - À répartir : fiches validées/envoyées avec éprouvettes,
       réparties en LOTS (par âge, par type) ;
     - Bassin virtuel : lots affichés en formes colorées selon
       l'échéance d'écrasement ; écrasement avec profil + motif ;
     - Archives : historique permanent, export Excel + partage par période.
   Couleurs : gris=loin, orange=J-1, rouge=jour J, rouge+R=retard,
   vert=écrasé (<24h, puis archivage automatique).
   Formes : carré=cube, cercle=cylindre, hexagone=mixte.
   ============================================================ */

var CAEKBassin = (function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function intOr0(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // Ajoute n jours à une date "YYYY-MM-DD" et renvoie "YYYY-MM-DD".
  function addDaysStr(ymd, n) {
    var p = String(ymd).slice(0, 10).split("-");
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // Différence en jours entre deux dates "YYYY-MM-DD" (b - a).
  function diffDays(a, b) {
    function toD(ymd) {
      var p = String(ymd).slice(0, 10).split("-");
      return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    }
    return Math.round((toD(b) - toD(a)) / 86400000);
  }

  function fmtDate(d) {
    if (!d) { return "—"; }
    var s = String(d);
    if (s.indexOf("T") >= 0) { s = s.slice(0, 10); }
    var parts = s.split("-");
    return parts.length === 3 ? (parts[2] + "/" + parts[1] + "/" + parts[0]) : s;
  }

  function typeLabel(t) {
    if (t === "cylindre") { return "Cylindre"; }
    if (t === "mixte") { return "Mixte"; }
    return "Cube";
  }

  /* ============================================================
     Icône de l'élément d'ouvrage (mêmes fichiers que le module
     coulage, cf. icons_manifest.json). On normalise le libellé
     (minuscules, sans accent) puis on cherche un mot-clé connu.
     Le plus spécifique d'abord (« semelle filante » avant « semelle »).
     ============================================================ */
  var OUVRAGE_ICONS = [
    { kw: "semelle filante", id: "semelle_filante" },
    { kw: "filante", id: "semelle_filante" },
    { kw: "semelle", id: "semelle" },
    { kw: "radier", id: "radier" },
    { kw: "longrine", id: "longrine" },
    { kw: "libage", id: "longrine" },
    { kw: "pieu", id: "pieu" },
    { kw: "plot", id: "plot" },
    { kw: "soutenement", id: "mur_soutenement" },
    { kw: "mur", id: "mur_soutenement" },
    { kw: "enterre", id: "ouvrage_enterre" },
    { kw: "regard", id: "regard" },
    { kw: "piscine", id: "piscine" },
    { kw: "poteau", id: "poteau" },
    { kw: "voile", id: "voile" },
    { kw: "dalle", id: "dalle" },
    { kw: "poutre", id: "poutre" },
    { kw: "escalier", id: "escalier" },
    { kw: "console", id: "console_balcon" },
    { kw: "balcon", id: "console_balcon" },
    { kw: "parapet", id: "parapet_acrotere" },
    { kw: "acrotere", id: "parapet_acrotere" },
    { kw: "cuve", id: "cuve_bache_eau" },
    { kw: "bache", id: "cuve_bache_eau" },
    { kw: "fondation", id: "fondation" },
    { kw: "superstructure", id: "superstructure" }
  ];

  function normalize(s) {
    var str = String(s == null ? "" : s).toLowerCase();
    if (str.normalize) { str = str.normalize("NFD").replace(/[̀-ͯ]/g, ""); }
    return str;
  }

  function ouvrageIconSrc(label) {
    var n = normalize(label);
    if (!n) { return ""; }
    for (var i = 0; i < OUVRAGE_ICONS.length; i++) {
      if (n.indexOf(OUVRAGE_ICONS[i].kw) >= 0) {
        return "assets/icons/ouvrages/" + OUVRAGE_ICONS[i].id + ".png";
      }
    }
    return "";
  }

  // Icône d'ouvrage (image) avec repli emoji chantier si inconnu.
  function ouvrageIconHtml(label) {
    var src = ouvrageIconSrc(label);
    if (src) {
      return "<img class=\"arch-ouvrage-ico\" src=\"" + src + "\" alt=\"\" " +
        "onerror=\"this.style.display='none'\">";
    }
    return "<span aria-hidden=\"true\">&#127959;&#65039;</span> ";
  }

  /* ============================================================
     Totaux d'éprouvettes d'un coulage + types disponibles.
     Règle métier des types proposés à la répartition :
       - cubes seuls          -> choix figé sur "Cube" ;
       - cylindres seuls      -> choix figé sur "Cylindre" ;
       - cubes + cylindres    -> choix possible Cube / Cylindre / Mixte.
     Forme associée : carré=cube, cercle=cylindre, hexagone=mixte.
     ============================================================ */
  function specimenInfo(coulage) {
    if (window.CAEKModel) { return CAEKModel.typesInfo(coulage); }
    return { total: 0, hasCube: false, hasCyl: false, availableTypes: ["cube"], defaultType: "cube" };
  }

  /* ============================================================
     ÉCRAN « À RÉPARTIR »
     ============================================================ */
  var _repList = [];
  var _doneList = [];
  var _pendingRevoirRef = null;
  // Coulage explicitement rappelé « à répartir » via « Revoir la répartition »
  // depuis le bassin virtuel. Un coulage déjà réparti ne figure plus dans cet
  // écran par défaut ; il y revient seulement sur désignation explicite, puis
  // en ressort une fois la nouvelle répartition enregistrée.
  var _revoirRef = null;

  function refreshRepartir() {
    if (!window.CAEKDB) { return; }
    // Une demande explicite de révision (venue du bassin) devient le coulage
    // courant à re-répartir. Les rafraîchissements ordinaires (filtre labo,
    // synchro) ne touchent pas à ce choix ; seul l'enregistrement le libère.
    if (_pendingRevoirRef) { _revoirRef = _pendingRevoirRef; }
    Promise.all([
      CAEKDB.getAllCoulages(),
      CAEKDB.getAllLots(),
      CAEKDB.getAllArchives()
    ]).then(function (out) {
      var list = out[0] || [], lots = out[1] || [], archives = out[2] || [];
      // Index par ref : présence d'un lot sorti/testé/écrasé ou d'une archive => verrouillé.
      var locked = {};
      lots.forEach(function (l) {
        if (l.statut === "sorti" || l.statut === "teste" || l.statut === "ecrase") { locked[l.ref] = true; }
      });
      archives.forEach(function (a) { locked[a.ref] = true; });

      // Éligible à la répartition : soumise/validée (la validation admin
      // n'est PAS bloquante), avec éprouvettes, ET récupération +
      // codification confirmées (cf. Répertoire).
      var eligibles = list.filter(function (c) {
        var st = c.statut || "brouillon";
        if (st !== "soumis" && st !== "valide" && st !== "validee" && st !== "envoyee") { return false; }
        // Référence PROVISOIRE (hors-ligne, Phase 1) : répartition bloquée
        // tant que la référence officielle n'est pas allouée par le serveur
        // (les codes d'éprouvettes REF-Ei-NN en dérivent).
        if (c.refProvisoire === true) { return false; }
        if (specimenInfo(c).total <= 0) { return false; }
        return window.CAEKModel ? CAEKModel.recuperationOk(c) : true;
      });
      eligibles = eligibles.filter(laboOk);
      // La présence d'un lot est la source de vérité : les anciennes données ou
      // une synchronisation incomplète peuvent ne pas avoir bassinReparti à jour.
      // Dans ce cas, ne jamais proposer une nouvelle répartition en parallèle ;
      // le coulage doit rester accessible en mode correction.
      var hasLot = {};
      lots.forEach(function (l) { if (l && l.ref) { hasLot[l.ref] = true; } });
      _repList = eligibles.filter(function (c) { return !hasLot[c.ref] && !c.bassinReparti; });
      // Coulage rappelé pour révision : UNIQUEMENT celui explicitement désigné
      // via « Revoir la répartition » (bassin virtuel). Il doit encore avoir des
      // lots, n'être pas engagé (aucun sorti/testé/écrasé/archivé) et rester
      // dans le périmètre labo courant. Sinon, aucun coulage réparti n'apparaît.
      _doneList = _revoirRef ? list.filter(function (c) {
        return c.ref === _revoirRef && !!hasLot[c.ref] && !locked[c.ref] && laboOk(c);
      }) : [];
      _doneList.forEach(function (c) { c._editable = true; });

      var byDate = function (a, b) {
        return String(b.dateRepartition || b.dateValidation || b.dateModification || "")
          .localeCompare(String(a.dateRepartition || a.dateValidation || a.dateModification || ""));
      };
      _repList.sort(byDate);
      _doneList.sort(byDate);
      renderRepartir();
    });
  }

  function findCoulage(ref) {
    var i;
    for (i = 0; i < _repList.length; i++) { if (_repList[i].ref === ref) { return _repList[i]; } }
    for (i = 0; i < _doneList.length; i++) { if (_doneList[i].ref === ref) { return _doneList[i]; } }
    return null;
  }

  function repCardInner(c) {
    var info = specimenInfo(c);
    var ref = escapeHtml(c.ref);
    var codif = window.CAEKModel ? CAEKModel.codification(c) : [];
    var prelsTxt = codif.map(function (p) {
      return "<strong>" + escapeHtml(p.numero) + "</strong> " + escapeHtml(typeLabel(p.type)) + " ×" + p.nombre;
    }).join(" · ");
    return "<div class=\"rep-top\"><span class=\"rep-ref\">" + ref + "</span></div>" +
      "<div class=\"rep-ent\">" + escapeHtml(c.client || c.entreprise || "—") + "</div>" +
      "<div class=\"rep-sub\">" + escapeHtml(c.nomProjet || "") +
      (c.dateCoulage ? " · coulé le " + escapeHtml(fmtDate(c.dateCoulage)) : "") + "</div>" +
      "<div class=\"rep-tot\">" + info.total + " éprouvette(s)</div>" +
      (prelsTxt ? "<div class=\"rep-prels\">🧪 " + prelsTxt + "</div>" : "");
  }

  function renderRepartir() {
    var box = $("rep-bassin-liste");
    if (!box) { return; }
    if ($("rep-bassin-count")) {
      $("rep-bassin-count").textContent = _repList.length + " fiche(s) à répartir";
    }

    var html = "";
    if (!_repList.length) {
      html += "<p class=\"screen-placeholder\">Aucune fiche à répartir pour l'instant.</p>";
    } else {
      html += _repList.map(function (c) {
        var ref = escapeHtml(c.ref);
        return "<div class=\"repb-item\" data-ref=\"" + ref + "\">" +
          "<button type=\"button\" class=\"repb-open\" data-ref=\"" + ref + "\">" +
          repCardInner(c) + "</button>" +
          "<div class=\"repb-form\" hidden></div>" +
          "</div>";
      }).join("");
    }

    // Section « Répartition à revoir » : n'apparaît QUE pour le coulage rappelé
    // depuis le bassin virtuel (« Revoir la répartition »). Elle disparaît dès
    // que la nouvelle répartition est enregistrée.
    if (_doneList.length) {
      html += "<div class=\"repb-section-titre\">Répartition à revoir</div>";
      html += _doneList.map(function (c) {
        var ref = escapeHtml(c.ref);
        var action = "<button type=\"button\" class=\"btn-text repb-revoir\" data-ref=\"" + ref + "\">&#9998; Revoir / corriger</button>";
        return "<div class=\"repb-item repb-done\" data-ref=\"" + ref + "\">" +
          "<div class=\"repb-head\">" + repCardInner(c) + "</div>" +
          action +
          "<div class=\"repb-form\" hidden></div>" +
          "</div>";
      }).join("");
    }

    box.innerHTML = html;

    // Ouverture automatique du formulaire de révision (venant du bassin).
    if (_pendingRevoirRef) {
      var ref = _pendingRevoirRef;
      _pendingRevoirRef = null;
      var coulage = findCoulage(ref);
      var item = box.querySelector(".repb-done[data-ref=\"" + ref + "\"]");
      if (coulage && coulage._editable && item) {
        CAEKDB.getLotsByRef(ref).then(function (lots) {
          openRepartForm(item, coulage, lots);
          item.scrollIntoView({ block: "center" });
        });
      }
    }
  }

  /* ---- Répartition en LOTS d'essai (V2.04) ----
     Règle : on ne mélange pas deux prélèvements dans un même lot, et on garde
     au moins 3 éprouvettes du même prélèvement ensemble. Par défaut : 3 à 7 j,
     le reste à 28 j (regroupé par prélèvement). L'opérateur peut changer
     l'échéance de chaque lot (le reste reste à 28 j sauf modification). */

  function ageSelectHtml(sel) {
    function opt(v, lbl) { return "<option value=\"" + v + "\"" + (sel === v ? " selected" : "") + ">" + lbl + "</option>"; }
    return "<select class=\"field lot-age\">" + opt("7j", "7 jours") + opt("28j", "28 jours") + opt("autre", "Autre…") + "</select>";
  }

  // Identité métier d'un lot : un coulage et une échéance. Les codes individuels
  // conservent leur prélèvement d'origine ; celui-ci ne doit pas fragmenter le
  // bassin ni le PV lorsque l'échéance est identique.
  function mergeLotsByEcheance(lots) {
    var byAge = {}, order = [];
    (lots || []).forEach(function (lot) {
      var age = intOr0(lot.ageJours) || 28;
      if (!byAge[age]) { byAge[age] = []; order.push(age); }
      byAge[age].push(lot);
    });
    return order.sort(function (a, b) { return a - b; }).map(function (age) {
      var group = byAge[age], first = group[0], codes = [], prels = [], types = {};
      group.forEach(function (lot) {
        (lot.codes || []).forEach(function (code) { codes.push(code); });
        var p = intOr0(lot.prel);
        if (p && prels.indexOf(p) < 0) { prels.push(p); }
        if (lot.type) { types[lot.type] = true; }
      });
      codes.sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
      var typeList = Object.keys(types);
      return {
        prel: prels[0] || first.prel || 0,
        prels: prels,
        // Un UUID de prélèvement ne peut représenter qu'un prélèvement : il
        // reste donc vide lorsque le lot fusionné en contient plusieurs.
        prelUuid: prels.length === 1 ? (first.prelUuid || null) : null,
        type: typeList.length === 1 ? typeList[0] : "mixte",
        codes: codes,
        nombre: codes.length || group.reduce(function (n, lot) { return n + (lot.nombre || 0); }, 0),
        age: first.age || (age === 7 ? "7j" : (age === 28 ? "28j" : "autre")),
        ageJours: age
      };
    });
  }

  // Lots proposés (défaut, depuis le modèle) ou reconstruits depuis une
  // répartition existante (révision), regroupés par échéance.
  function buildRepLots(coulage, existingLots) {
    if (existingLots && existingLots.length) {
      var rebuilt = existingLots.slice().sort(function (a, b) {
        return (a.prel - b.prel) || (a.ageJours - b.ageJours);
      }).map(function (l) {
        var codes = (l.codes || []).slice();
        return {
          prel: l.prel, prels: l.prels || [l.prel], prelUuid: l.prelUuid || null,
          type: l.type, codes: codes,
          nombre: codes.length || l.nombre || 0,
          age: l.age || "28j", ageJours: l.ageJours || 28
        };
      });
      // Les lots historiques 6 + 3 à la même échéance deviennent d'emblée
      // une seule ligne de 9 dans l'éditeur. L'enregistrement reste explicite.
      return mergeLotsByEcheance(rebuilt);
    }
    return mergeLotsByEcheance(window.CAEKModel ? CAEKModel.proposeRepartition(coulage) : []);
  }

  function lotCodesPlage(lot) {
    var codes = (lot.codes || []).map(function (x) { return x.code; });
    if (!codes.length) { return "—"; }
    if (codes.length <= 3) { return codes.join(", "); }
    return codes[0] + " → " + codes[codes.length - 1] + " (" + codes.length + ")";
  }

  function lotRepRowHtml(lot, idx) {
    var joursVal = (lot.age === "autre" && lot.ageJours) ? (" value=\"" + lot.ageJours + "\"") : "";
    // Un lot d'au moins 2 éprouvettes peut être divisé pour un âge exigé par
    // le client (ex. 3 j) ; le reste garde son échéance (par défaut 28 j).
    var splitBtn = (lot.nombre > 1)
      ? "<button type=\"button\" class=\"btn-text lot-split\" data-idx=\"" + idx + "\">&#9986; Diviser (âge client)</button>"
      : "";
    return "<div class=\"prel-rep-row\" data-idx=\"" + idx + "\">" +
      "<div class=\"prel-rep-head\"><span class=\"prel-num\">" +
      escapeHtml((lot.prels && lot.prels.length ? lot.prels : [lot.prel]).map(function (p) { return "E" + p; }).join(" + ")) +
      "</span> " +
      escapeHtml(typeLabel(lot.type)) + " · <strong>" + lot.nombre + "</strong> épr." +
      ((lot.codes && lot.codes[0] && lot.codes[0].malaxeur) ? " · Malaxeur " + lot.codes[0].malaxeur : "") + "</div>" +
      "<div class=\"prel-rep-codes\">" + escapeHtml(lotCodesPlage(lot)) + "</div>" +
      "<label class=\"prel-rep-age\"><span>Échéance d'essai</span>" + ageSelectHtml(lot.age) +
      "<input class=\"field lot-jours\" type=\"number\" min=\"1\" step=\"1\" inputmode=\"numeric\" placeholder=\"jours\"" +
      joursVal + (lot.age === "autre" ? "" : " hidden") + "></label>" +
      splitBtn +
      "</div>";
  }

  // Reconstruit les lignes de l'éditeur depuis form._repLots (après division).
  function renderRepRows(form) {
    var editor = form.querySelector(".prel-rep-editor");
    if (!editor) { return; }
    editor.innerHTML = (form._repLots || []).map(lotRepRowHtml).join("");
    updateSum(form);
  }

  // Divise un lot : détache K éprouvettes vers un nouvel âge (ex. 3 j exigé
  // par le client). Le lot d'origine conserve le reste (28 j par défaut).
  // Recopie les échéances actuellement choisies dans le DOM vers _repLots
  // (sinon une division réécrit les lignes et perdrait ces choix).
  function syncAgesToLots(form) {
    var lots = form._repLots || [];
    var rows = form.querySelectorAll(".prel-rep-row");
    for (var i = 0; i < rows.length; i++) {
      var base = lots[intOr0(rows[i].getAttribute("data-idx"))];
      if (!base) { continue; }
      var ageSel = rows[i].querySelector(".lot-age").value;
      base.age = ageSel;
      base.ageJours = ageSel === "7j" ? 7 : (ageSel === "28j" ? 28 : intOr0(rows[i].querySelector(".lot-jours").value));
    }
  }

  function splitLot(form, idx) {
    syncAgesToLots(form);
    var lots = form._repLots || [];
    var lot = lots[idx];
    if (!lot || lot.nombre < 2) { return; }
    var kStr = window.prompt("Combien d'éprouvettes détacher de E" + lot.prel +
      " pour un autre âge ? (1 à " + (lot.nombre - 1) + ")", "3");
    if (kStr == null) { return; }
    var k = intOr0(kStr);
    if (k < 1 || k >= lot.nombre) { window.alert("Nombre invalide (1 à " + (lot.nombre - 1) + ")."); return; }
    var jStr = window.prompt("Âge d'essai (en jours) pour ces " + k + " éprouvette(s) ? (ex. 3, 14, 90)", "3");
    if (jStr == null) { return; }
    var j = intOr0(jStr);
    if (j <= 0) { window.alert("Âge invalide."); return; }
    // Détache les K premiers codes ; le reste demeure sur le lot d'origine.
    var codes = (lot.codes || []).slice();
    var head = codes.slice(0, k);
    var tail = codes.slice(k);
    var age = (j === 7) ? "7j" : (j === 28 ? "28j" : "autre");
    var nouveau = { prel: lot.prel, prels: lot.prels || [lot.prel], type: lot.type, codes: head, nombre: head.length,
      age: age, ageJours: j };
    lot.codes = tail; lot.nombre = tail.length;
    lots.splice(idx, 0, nouveau);   // le nouvel âge s'affiche avant le reste
    renderRepRows(form);
  }

  // Action explicite pour les anciennes répartitions déjà fragmentées :
  // mêmes coulage + échéance => un lot unique, avec tous les codes conservés.
  function regrouperLots(form) {
    syncAgesToLots(form);
    form._repLots = mergeLotsByEcheance(form._repLots || []);
    renderRepRows(form);
  }

  function openRepartForm(itemEl, coulage, existingLots) {
    var form = itemEl.querySelector(".repb-form");
    if (!form) { return; }
    if (!form.hidden) { form.hidden = true; form.innerHTML = ""; form._repLots = null; return; }
    var info = specimenInfo(coulage);
    var isEdit = !!(existingLots && existingLots.length);
    var lots = buildRepLots(coulage, existingLots);
    form._repLots = lots;

    var rows = lots.map(lotRepRowHtml).join("");

    var titre = "<p class=\"hint\">Règle d'or : les éprouvettes d'un même coulage et d'une même " +
      "échéance forment <strong>un seul lot et un seul PV</strong>. Les codes individuels et leurs " +
      "prélèvements d'origine restent traçables. Par défaut : <strong>3 à 7 jours</strong>, le reste à " +
      "<strong>28 jours</strong>. Vous pouvez changer l'échéance de chaque lot, ou " +
      "<strong>&#9986; Diviser</strong> un lot pour un âge exigé par le client (ex. 3 j) — " +
      "le reste garde son échéance.</p>";

    form.innerHTML = titre +
      "<div class=\"prel-rep-editor\">" + rows + "</div>" +
      "<div class=\"repb-sum\"></div>" +
      (isEdit ? "<button type=\"button\" class=\"btn-text repb-regrouper\">&#8644; Regrouper les lots de même échéance</button>" : "") +
      "<button type=\"button\" class=\"btn-primary repb-valider\">&#10004; " +
        (isEdit ? "Enregistrer les corrections" : "Confirmer la répartition") + "</button>" +
      "<div class=\"repb-result\" hidden></div>";
    form.setAttribute("data-total", info.total);
    form.hidden = false;
    updateSum(form);
  }

  // Lit l'échéance choisie pour chaque lot (codes déjà figés dans _repLots).
  function readLotRows(form) {
    var lots = form._repLots || [];
    var rowsEls = form.querySelectorAll(".prel-rep-row");
    var out = [];
    for (var i = 0; i < rowsEls.length; i++) {
      var r = rowsEls[i];
      var base = lots[intOr0(r.getAttribute("data-idx"))];
      if (!base) { continue; }
      var ageSel = r.querySelector(".lot-age").value;
      var ageJours = ageSel === "7j" ? 7 : (ageSel === "28j" ? 28 : intOr0(r.querySelector(".lot-jours").value));
      out.push({ prel: base.prel, prels: base.prels || [base.prel], prelUuid: base.prelUuid || null,
        type: base.type, codes: base.codes,
        nombre: base.nombre, age: ageSel, ageJours: ageJours });
    }
    return mergeLotsByEcheance(out);
  }

  // Affiche/masque les champs « jours » et valide le formulaire.
  function updateSum(form) {
    var box = form.querySelector(".repb-sum");
    var btn = form.querySelector(".repb-valider");
    var rows = form.querySelectorAll(".prel-rep-row");
    var bad = false;
    for (var i = 0; i < rows.length; i++) {
      var ageSel = rows[i].querySelector(".lot-age").value;
      var jInput = rows[i].querySelector(".lot-jours");
      if (ageSel === "autre") {
        jInput.hidden = false;
        if (intOr0(jInput.value) <= 0) { bad = true; }
      } else { jInput.hidden = true; }
    }
    if (box) {
      box.className = "repb-sum " + (bad ? "is-warn" : "is-ok");
      box.innerHTML = bad
        ? "&#9888; Indiquez l'âge (jours) pour chaque lot « Autre… »."
        : rows.length + " lot(s) d'essai — un seul lot par échéance.";
    }
    if (btn) { btn.disabled = bad || rows.length === 0; }
  }

  function validerRepartition(form, coulage) {
    var prof = window.CAEKProfil
      ? CAEKProfil.require("Profil opérateur requis. Veuillez renseigner votre nom et qualification.")
      : { nom: "", qualification: "" };
    if (!prof) { return; }
    var total = intOr0(form.getAttribute("data-total"));
    var kept = readLotRows(form);
    if (!kept.length) { window.alert("Aucun lot à répartir."); return; }

    // Validations : âge valide pour chaque lot.
    var bad = "";
    kept.forEach(function (l) {
      if (l.ageJours <= 0) { bad = "Indiquez un âge (jours) valide pour chaque lot."; }
      if (!l.nombre) { bad = "Un lot est vide."; }
    });
    if (bad) { window.alert(bad); return; }

    // Blocage : aucune date prévue d'essai ne doit être déjà dépassée.
    var today = todayStr();
    var dc = coulage.dateCoulage || today;
    for (var k = 0; k < kept.length; k++) {
      var dp = addDaysStr(dc, kept[k].ageJours);
      if (dp < today) {
        window.alert("Impossible de créer le lot E" + kept[k].prel + " à " + kept[k].ageJours +
          " jours : la date prévue d'essai (" + fmtDate(dp) + ") est déjà dépassée.");
        return;
      }
    }
    var isEdit = !!coulage.bassinReparti;
    var confirmMsg = isEdit
      ? "Enregistrer les corrections de cette répartition ?\nLes lots encore en bassin de ce coulage seront remplacés."
      : "Confirmer la répartition des éprouvettes ?";
    if (!window.confirm(confirmMsg)) { return; }

    var now = new Date().toISOString();
    // Chaque lot porte déjà son sous-ensemble de codes (REF-Ei-JJ), sans mélange
    // de prélèvements (V2.04).
    var lots = kept.map(function (l) {
      var datePrevue = addDaysStr(coulage.dateCoulage || todayStr(), l.ageJours);
      var codes = (l.codes || []).map(function (x) {
        return { code: x.code, type: x.type, prel: x.prel, numInterne: x.numInterne,
          malaxeur: x.malaxeur, eprUuid: x.eprUuid || null };
      });
      return {
        ref: coulage.ref,
        prelUuid: l.prelUuid || null,
        client: coulage.client || coulage.entreprise || "",
        nomProjet: coulage.nomProjet || "",
        ouvrage: coulage.ouvrageCoule || coulage.ouvrage || "",
        ouvrageAutre: coulage.ouvrageAutre || "",
        bloc: coulage.bloc || "",
        etage: coulage.etage || "",
        partie: coulage.partie || "",
        dateCoulage: coulage.dateCoulage || "",
        // Classe de beton portee par le LOT : sans elle, l'ecran de validation
        // et l'historique ne peuvent pas deduire le facteur cube->cylindre
        // une fois le coulage valide (il quitte alors la liste des soumis).
        classe: (window.CAEKModel ? CAEKModel.classeBetonLot(null, coulage) : "") || "",
        type: l.type,
        nombre: l.nombre,
        prel: l.prel,
        age: l.age,
        ageJours: l.ageJours,
        datePrevue: datePrevue,
        codes: codes,
        statut: "en_bassin",
        operateurRepartition: prof.nom || "",
        qualificationRepartition: prof.qualification || "",
        dateRepartition: now,
        // Une erreur d'age saisie ici reste invisible jusqu'a l'echeance,
        // donc trop tard. La repartition est SIGNALEE comme a controler par
        // un ingenieur/responsable. Drapeau pose uniquement a cet endroit :
        // les lots anterieurs a cette evolution ne sont pas signales a tort.
        repartitionAValider: true
      };
    });

    // Garde-fou + remplacement : on revérifie qu'aucun lot n'est écrasé
    // et qu'aucune archive n'existe pour ce coulage avant de réécrire.
    Promise.all([CAEKDB.getLotsByRef(coulage.ref), CAEKDB.getAllArchives()]).then(function (out) {
      var existants = out[0] || [];
      var archives = (out[1] || []).filter(function (a) { return a.ref === coulage.ref; });
      var bloque = existants.some(function (l) {
        return l.statut === "sorti" || l.statut === "teste" || l.statut === "ecrase";
      });
      if (bloque || archives.length) {
        window.alert("Cette répartition ne peut plus être modifiée : un lot a déjà été sorti pour essai, testé ou archivé.");
        _revoirRef = null;
        refreshRepartir();
        return Promise.reject({ handled: true });
      }
      // Supprime l'ancienne répartition (lots encore en bassin) puis réécrit.
      return Promise.all(existants.map(function (l) { return CAEKDB.deleteLot(l.id); }));
    }).then(function () {
      return CAEKDB.addLots(lots);
    }).then(function () {
      coulage.bassinReparti = true;
      coulage.dateRepartition = now;
      coulage.dateModification = now;
      return CAEKDB.updateCoulage(coulage);
    }).then(function () {
      // Phase 3 : la répartition devient aussi un ÉVÉNEMENT SERVEUR
      // idempotent (op_coulage_event) — plus seulement un champ local.
      if (window.CAEKCoulages && CAEKCoulages.sendEvent) {
        CAEKCoulages.sendEvent(coulage.ref, "bassin_reparti", { date: now });
      }
      return null;
    }).then(function () {
      return CAEKDB.addJournal({
        type: isEdit ? "repartition_revue" : "repartition", ref: coulage.ref,
        operateur: prof.nom || "", qualification: prof.qualification || "",
        nbLots: lots.length, total: total
      });
    }).then(function () {
      // Nouvelle répartition enregistrée : le coulage a de nouveau des lots et
      // ressort de l'écran « À répartir » (il faudra repasser par le bassin
      // virtuel pour le revoir).
      _revoirRef = null;
      refreshRepartir();
    }).catch(function (err) {
      if (err && err.handled) { return; }
      window.alert("Erreur lors de la répartition : " + (err && err.message || err));
    });
  }

  /* ============================================================
     ÉCRAN « BASSIN VIRTUEL »
     ============================================================ */
  var _lots = [];

  // Statut couleur d'un lot encore en bassin, selon l'échéance d'ESSAI.
  // datePrevue = date prévue d'essai ; les éprouvettes doivent sortir AVANT.
  //   diff >= 3 : loin (gris) · diff === 2 : J-2 (orange) ·
  //   diff === 1 : J-1, à sortir aujourd'hui (rouge) · diff <= 0 : retard (R).
  function colorStatut(lot) {
    var diff = diffDays(todayStr(), lot.datePrevue);
    if (diff >= 3) { return "loin"; }
    if (diff === 2) { return "j2"; }
    if (diff === 1) { return "j1"; }
    return "retard";
  }

  // Archive automatique des lots écrasés depuis plus de 24h.
  function autoArchive(lots) {
    var now = Date.now();
    var pending = [];
    lots.forEach(function (l) {
      if (l.statut === "ecrase" && l.ecraseAt) {
        var age = now - new Date(l.ecraseAt).getTime();
        if (age >= 86400000) { pending.push(l); }
      }
    });
    if (!pending.length) { return Promise.resolve(false); }
    return Promise.all(pending.map(function (l) {
      return CAEKDB.addArchive(toArchive(l)).then(function () { return CAEKDB.deleteLot(l.id); });
    })).then(function () { return true; });
  }

  function toArchive(l) {
    return {
      ref: l.ref, client: l.client, nomProjet: l.nomProjet, ouvrage: l.ouvrage,
      bloc: l.bloc, etage: l.etage, type: l.type, nombre: l.nombre,
      age: l.age, ageJours: l.ageJours, dateCoulage: l.dateCoulage,
      datePrevue: l.datePrevue, dateReelle: l.dateReelle, heureReelle: l.heureReelle,
      ecart: (l.datePrevue && l.dateReelle) ? diffDays(l.datePrevue, l.dateReelle) : "",
      operateur: l.operateurEcrasement || "", qualification: l.qualificationEcrasement || "",
      motif: l.motif || "", observation: l.observationEcrasement || ""
    };
  }

  // Filtre labo (administrateur seulement ; opérateur déjà scopé serveur).
  function laboOk(x) {
    return !window.CAEKLaboFilter || CAEKLaboFilter.match(x && x.laboId);
  }

  /* ---------- Fraîcheur des données du bassin ----------
     Le bassin lit IndexedDB. Sans rappel au serveur, un appareil qui garde
     l'app ouverte (cas courant sur mobile / PWA installée) reste figé sur la
     dernière synchro : les lots sortis du bassin par un collègue continuent
     de s'y afficher, en retard. On resynchronise donc à CHAQUE entrée dans
     l'écran (au plus une fois toutes les SYNC_THROTTLE_MS), et l'état de la
     synchro est affiché : plus de désynchronisation silencieuse. */
  var SYNC_THROTTLE_MS = 15000;
  var _syncEnCours = false;
  var _dernierSync = 0;

  function fmtHeureIso(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? "" : pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function syncEtat(txt, detail, cls) {
    var el = $("bassin-fraicheur");
    if (!el) { return; }
    el.className = "hint bassin-sync" + (cls ? " " + cls : "");
    el.innerHTML = "<span>" + escapeHtml(txt) + "</span>" +
      (detail ? " <span data-i18n-skip>" + escapeHtml(detail) + "</span>" : "");
    el.hidden = false;
  }

  function renderSyncEtat() {
    var el = $("bassin-fraicheur");
    if (!el) { return; }
    if (!window.CAEKLots || !window.CAEKLots.lastPull ||
        !window.CAEKServer || !CAEKServer.configured()) {
      el.hidden = true;
      return;
    }
    if (_syncEnCours) { syncEtat("⏳ Synchronisation du bassin…", "", ""); return; }
    CAEKLots.lastPull().then(function (iso) {
      if (_syncEnCours) { return; }
      var age = iso ? (Date.now() - Date.parse(iso)) : NaN;
      if (!iso || isNaN(age)) {
        syncEtat("⚠ Bassin jamais synchronisé avec le serveur", "", "is-warn");
      } else if (navigator.onLine === false || age > 10 * 60 * 1000) {
        syncEtat("⚠ Bassin non synchronisé — dernière mise à jour :",
          fmtDate(iso) + " " + fmtHeureIso(iso), "is-warn");
      } else {
        syncEtat("✓ Bassin à jour", fmtHeureIso(iso), "is-ok");
      }
    });
  }

  // Rappel serveur en arrière-plan puis redessin si quelque chose a changé.
  function syncBassin() {
    if (!window.CAEKLots || !CAEKLots.autoSync || _syncEnCours) { return; }
    if (Date.now() - _dernierSync < SYNC_THROTTLE_MS) { return; }
    _dernierSync = Date.now();
    _syncEnCours = true;
    renderSyncEtat();
    CAEKLots.autoSync().then(function () {
      _syncEnCours = false;
      chargerLots();
    }).catch(function () {
      _syncEnCours = false;
      renderSyncEtat();
    });
  }

  // Lecture locale + rendu (sans rappel serveur : évite toute boucle).
  function chargerLots() {
    return CAEKDB.getAllLots().then(function (lots) {
      return autoArchive(lots).then(function (changed) {
        return changed ? CAEKDB.getAllLots() : lots;
      });
    }).then(function (lots) {
      _lots = lots.filter(laboOk);
      renderBassin();
      renderVeille();
      renderSyncEtat();
    });
  }

  function refreshBassin() {
    if (!window.CAEKDB) { return; }
    // Entrée dans le bassin : on repart d'un état neutre. Une révision se
    // (re)déclenche explicitement par « Revoir la répartition » sur un lot.
    _revoirRef = null;
    chargerLots();
    syncBassin();
  }

  function renderVeille() {
    var nJour = 0, nRetard = 0, nBientot = 0;
    _lots.forEach(function (l) {
      if (l.statut !== "en_bassin") { return; }
      var st = colorStatut(l);
      if (st === "j1") { nJour++; }
      else if (st === "retard") { nRetard++; }
      else if (st === "j2") { nBientot++; }
    });
    var html = "<strong>" + nJour + "</strong> à sortir aujourd'hui · " +
      "<strong>" + nRetard + "</strong> en retard · " +
      "<strong>" + nBientot + "</strong> bientôt (J-2)";
    var cls = "bassin-alerte" + (nRetard ? " is-retard" : (nJour ? " is-jour" : ""));
    [$("bassin-alerte"), $("bassin-veille")].forEach(function (el) {
      if (!el) { return; }
      el.className = cls;
      el.innerHTML = "&#128276; " + html;
      el.hidden = false;
    });
  }

  /* ---------- Séchage 24 h + passage forcé à la machine ---------- */
  var DELAI_SECHAGE_MS = 24 * 60 * 60 * 1000;
  var MOTIFS_FORCE = ["Éprouvette ayant dépassé son séjour", "Jour férié",
    "Problème machine / presse", "Contrainte exceptionnelle du laboratoire", "Autre"];

  function TT(s) { return (window.I18N && I18N.T) ? I18N.T(s) : s; }

  function sortiAtMs(l) {
    var t = l && l.sortiAt ? Date.parse(l.sortiAt) : NaN;
    return isNaN(t) ? null : t;
  }
  // Prêt pour l'essai : forcé, sans horodatage (ancienne donnée), ou 24 h écoulées.
  function lotPretEssai(l) {
    if (l.forceTest) { return true; }
    var t = sortiAtMs(l);
    if (t == null) { return true; }
    return (Date.now() - t) >= DELAI_SECHAGE_MS;
  }
  function heuresRestantesSechage(l) {
    var t = sortiAtMs(l);
    if (t == null) { return 0; }
    var ms = DELAI_SECHAGE_MS - (Date.now() - t);
    return ms > 0 ? Math.ceil(ms / 3600000) : 0;
  }

  // Passage anticipé (avant 24 h) : exceptionnel, motif obligatoire.
  // L'action se fait DEPUIS LE BASSIN (zone des lots sortis), pas depuis
  // le module compression. Les motifs sont traduits (TT) avant affichage.
  function forcerPassage(id) {
    var lot = null;
    for (var i = 0; i < _lots.length; i++) { if (_lots[i].id === id) { lot = _lots[i]; break; } }
    if (!lot || lot.statut !== "sorti" || lotPretEssai(lot)) { return; }
    var prof = window.CAEKProfil
      ? CAEKProfil.require("Profil opérateur requis pour forcer le passage avant 24 h.")
      : { nom: "", qualification: "" };
    if (!prof) { return; }
    var liste = MOTIFS_FORCE.map(function (m, i2) { return (i2 + 1) + ". " + TT(m); }).join("\n");
    var rep = window.prompt("Passage anticipé (moins de 24 h hors bassin) — action exceptionnelle.\n\n" +
      "Indiquez le motif (numéro ou texte libre) :\n" + liste);
    if (rep == null) { return; }
    rep = String(rep).trim();
    if (!rep) { window.alert("Le motif est obligatoire pour forcer le passage."); return; }
    var n = parseInt(rep, 10);
    var motif = (!isNaN(n) && n >= 1 && n <= MOTIFS_FORCE.length) ? MOTIFS_FORCE[n - 1] : rep;
    if (motif === "Autre") {
      var autre = window.prompt("Précisez le motif :");
      if (autre == null || !String(autre).trim()) { window.alert("Motif obligatoire."); return; }
      motif = String(autre).trim();
    }
    if (!window.confirm("Confirmer le passage anticipé de ce lot en « À tester » ?\n" +
      TT("Motif :") + " " + TT(motif))) { return; }
    lot.forceTest = true;
    lot.forceMotif = motif;
    lot.forceAt = new Date().toISOString();
    lot.forceOperateur = prof.nom || "";
    CAEKDB.updateLot(lot).then(function () {
      return CAEKDB.addJournal({ type: "forcage_essai", ref: lot.ref, lotId: lot.id,
        operateur: prof.nom || "", qualification: prof.qualification || "", motif: motif });
    }).then(function () {
      $("bassin-detail").hidden = true;
      refreshBassin();
      if (window.CAEKBadges) { CAEKBadges.refresh(); }
      if (window.CAEKCompression) { CAEKCompression.refresh(); }
    }).catch(function (err) { window.alert("Erreur : " + (err && err.message || err)); });
  }

  // Forme selon le type : carré=cube, cercle=cylindre, hexagone=mixte.
  function shapeFormClass(type) {
    if (type === "cylindre") { return "shape-cyl"; }
    if (type === "mixte") { return "shape-mixte"; }
    return "shape-cube";
  }

  // Statut d'affichage d'un lot : "sorti" si déjà sorti pour essai, sinon couleur d'échéance.
  function dispStatut(lot) {
    return (lot.statut === "sorti") ? "sorti" : colorStatut(lot);
  }

  function shapeClass(lot) {
    var st = dispStatut(lot);
    var retardR = (st === "retard") ? " has-r" : "";
    return "bassin-shape " + shapeFormClass(lot.type) + " st-" + st + retardR;
  }

  function shapeBtnHtml(l) {
    var st = dispStatut(l);
    var rTag = (st === "retard") ? "<span class=\"shape-r\">R</span>" : "";
    var ageLabel = (l.age === "autre" ? l.ageJours + "j" : l.age);
    // Répartition non encore contrôlée : pastille « ! » visible dès la liste,
    // pour que l'erreur d'âge soit vue AVANT l'échéance.
    var vTag = repartitionEnAttente(l) ? "<span class=\"shape-v\">!</span>" : "";
    var titre = l.ref + " · " + typeLabel(l.type) + " · " + ageLabel +
      (repartitionEnAttente(l) ? " · RÉPARTITION NON VALIDÉE" : "");
    return "<button type=\"button\" class=\"" + shapeClass(l) +
      (repartitionEnAttente(l) ? " has-v" : "") + "\" data-id=\"" + l.id + "\" " +
      "title=\"" + escapeHtml(titre) + "\">" +
      "<span class=\"shape-nb\">" + l.nombre + "</span>" +
      "<span class=\"shape-age\">" + escapeHtml(ageLabel) + "</span>" +
      "<span class=\"shape-ref\">" + escapeHtml(l.ref || "") + "</span>" +
      rTag + vTag + "</button>";
  }

  // Le titre contient des nombres dynamiques : il ne peut pas être traduit
  // correctement par le traducteur textuel après rendu. On le construit donc
  // directement dans la langue active afin d'éviter un mélange FR / AR.
  function ageGroupTitle(age, nbLots, nbEprouvettes) {
    var isAr = window.I18N && I18N.lang && I18N.lang() === "ar";
    if (isAr) {
      return "&#9203; " + age + " أيام — " + nbLots + " مجموعة · " + nbEprouvettes + " عيّنة";
    }
    return "&#9203; " + age + " jours — " + nbLots + " lot(s) · " + nbEprouvettes + " éprouvette(s)";
  }

  function renderBassin() {
    var grid = $("bassin-grille");
    if (!grid) { return; }
    // Lots ENCORE dans le bassin (le bassin virtuel proprement dit).
    var enBassin = _lots.filter(function (l) { return l.statut === "en_bassin"; });
    // Lots SORTIS du bassin (en séchage / attente d'essai) -> zone séparée en bas.
    var sortis = _lots.filter(function (l) { return l.statut === "sorti"; });

    if (!enBassin.length) {
      grid.innerHTML = "<p class=\"screen-placeholder\">Aucun lot dans le bassin. " +
        (sortis.length ? "Tous les lots sont sortis pour essai (voir ci-dessous)." : "Répartissez d'abord des éprouvettes.") +
        "</p>";
      if (window.I18N) { I18N.translate(grid); }
    } else {
      // Tri : retard d'abord, puis J-1, J-2, loin. À priorité et échéance
      // égales, les lots sont rangés par référence croissante : ainsi les
      // lots ECPM144 (dont les anciennes répartitions fractionnées) restent
      // côte à côte, puis ECPM145, etc.
      var order = { retard: 0, j1: 1, j2: 2, loin: 3 };
      var sorted = enBassin.slice().sort(function (a, b) {
        var sa = dispStatut(a), sb = dispStatut(b);
        if (order[sa] !== order[sb]) { return order[sa] - order[sb]; }
        var dateOrder = String(a.datePrevue).localeCompare(String(b.datePrevue));
        if (dateOrder) { return dateOrder; }
        var refOrder = String(a.ref || "").localeCompare(String(b.ref || ""), "fr", {
          numeric: true, sensitivity: "base"
        });
        if (refOrder) { return refOrder; }
        return (intOr0(a.prel) - intOr0(b.prel)) || (intOr0(a.id) - intOr0(b.id));
      });
      // Phase 3 : groupement DYNAMIQUE par âge d'essai (age_jours), sans
      // aucune limite fonctionnelle (3 j, 7 j, 14 j, 90 j… tout âge client).
      var byAge = {};
      sorted.forEach(function (l) {
        var a = l.ageJours || 28;
        (byAge[a] = byAge[a] || []).push(l);
      });
      var ages = Object.keys(byAge).map(Number).sort(function (x, y) { return x - y; });
      grid.innerHTML = ages.map(function (a) {
        var g = byAge[a];
        var nEpr = g.reduce(function (s, l) { return s + (l.nombre || 0); }, 0);
        return "<div class=\"bassin-age-group\">" +
          "<h4 class=\"bassin-age-titre\">" + ageGroupTitle(a, g.length, nEpr) + "</h4>" +
          "<div class=\"bassin-age-grid\">" + g.map(shapeBtnHtml).join("") + "</div>" +
          "</div>";
      }).join("");
      if (window.I18N) { I18N.translate(grid); }
    }

    // Zone « Lots sortis du bassin — en attente d'essai ».
    var section = $("bassin-sortis-section");
    var sgrid = $("bassin-sortis");
    if (section && sgrid) {
      if (!sortis.length) {
        section.hidden = true;
        sgrid.innerHTML = "";
      } else {
        section.hidden = false;
        var sortedOut = sortis.slice().sort(function (a, b) {
          return String(b.dateSortie || "").localeCompare(String(a.dateSortie || ""));
        });
        if ($("bassin-sortis-count")) {
          $("bassin-sortis-count").textContent = sortis.length + " lot(s) sorti(s)";
        }
        sgrid.innerHTML = sortedOut.map(shapeBtnHtml).join("");
        if (window.I18N) { I18N.translate(sgrid); }
      }
    }
  }

  /* ============================================================
     DÉTAIL D'UN LOT + SORTIE POUR ESSAI
     ============================================================ */
  var MOTIFS_ACCORD = ["Accord client", "Accord chef labo", "Contrainte planning", "Jour férié", "Autre"];
  var MOTIFS_RETARD = ["Presse indisponible", "Oubli", "Demande client", "Jour non ouvrable", "Autre"];

  // Texte des codes d'un lot : liste si <=4, sinon premier -> dernier.
  function lotCodesText(lot) {
    var codes = (lot && lot.codes) || [];
    if (!codes.length) { return "—"; }
    if (codes.length <= 4) { return codes.map(function (x) { return x.code; }).join(", "); }
    return codes[0].code + " → " + codes[codes.length - 1].code + " (" + codes.length + ")";
  }

  function openDetail(id) {
    var lot = null;
    for (var i = 0; i < _lots.length; i++) { if (_lots[i].id === id) { lot = _lots[i]; break; } }
    if (!lot) { return; }
    var body = $("bassin-detail-body");
    if (!body) { return; }

    var st = dispStatut(lot);
    var stLabel = {
      loin: "Échéance loin", j2: "À sortir bientôt (J-2)",
      j1: "À sortir aujourd'hui (J-1)", retard: "En retard", sorti: "Sorti pour essai"
    }[st];

    var rows = "" +
      detRow("Référence", lot.ref) +
      detRow("Client", lot.client) +
      detRow("Projet", lot.nomProjet) +
      detRow("Ouvrage", lot.ouvrage) +
      detRow("Bloc / Étage / Partie", [lot.bloc ? "Bloc " + lot.bloc : "", lot.etage, lot.partie].filter(Boolean).join(" · ")) +
      detRow("Date de coulage", fmtDate(lot.dateCoulage)) +
      detRow("Prélèvement", lot.prel ? "E" + lot.prel : "—") +
      detRow("Type", typeLabel(lot.type)) +
      detRow("Nombre", lot.nombre + " éprouvette(s)") +
      detRow("Codification", lotCodesText(lot)) +
      detRow("Âge", lot.age === "autre" ? lot.ageJours + " jours" : lot.age) +
      detRow("Date prévue d'essai", fmtDate(lot.datePrevue)) +
      (lot.revisionAgeRequise ? detRow("Alerte date", "Date de coulage corrigée après engagement — révision des âges requise") : "") +
      detRow("Statut", stLabel) +
      detRow("Opérateur (répartition)", lot.operateurRepartition) +
      // Phase 3 : état de synchronisation VISIBLE (local / en attente /
      // synchronisé / conflit / erreur), complété en asynchrone.
      "<div class=\"det-row\"><span class=\"det-label\">Synchronisation</span>" +
      "<span class=\"det-val\" id=\"bassin-sync-etat\">" +
      (lot._conflit || lot._prelConflit ? "&#9888; Conflit"
        : (lot._syncedAt ? "&#10004; Synchronisé" : "&#128244; Local")) +
      "</span></div>";

    var action;
    if (lot.statut === "sorti") {
      action = "<div class=\"result-card is-ok\">&#10004; Sorti pour essai le " + fmtDate(lot.dateSortie) +
        " à " + escapeHtml(lot.heureSortie || "") + " par " + escapeHtml(lot.operateurSortie || "") +
        (lot.motifSortie ? "<br>Motif : " + escapeHtml(lot.motifSortie) : "") +
        (lot.observationSortie ? "<br>Obs. : " + escapeHtml(lot.observationSortie) : "") +
        "</div>";
      if (!lotPretEssai(lot)) {
        // Encore en séchage : l'essai n'est pas proposé dans le module
        // compression ; le passage forcé se fait ICI (exceptionnel, motif).
        action += "<div class=\"result-card is-warn\">&#9203; En séchage (délai 24 h hors bassin)<br>" +
          "Disponible pour essai dans ~<strong>" + heuresRestantesSechage(lot) + " h</strong></div>" +
          "<button type=\"button\" class=\"btn-primary bassin-forcer\" data-id=\"" + lot.id + "\">" +
          "&#128296; Passage forcé à la machine</button>";
      } else {
        if (lot.forceTest) {
          action += "<div class=\"result-card\">&#128296; Passage forcé" +
            (lot.forceOperateur ? " par " + escapeHtml(lot.forceOperateur) : "") +
            (lot.forceMotif ? "<br>Motif : " + escapeHtml(lot.forceMotif) : "") + "</div>";
        }
        action += "<div class=\"result-card\"><span class=\"opt\">Saisie de l'essai dans le module « Test de compression ».</span></div>";
      }
    } else {
      action = sortieFormHtml(st);
    }

    // Révision possible tant que le lot est encore en bassin (non sorti / non testé).
    var revoir = (lot.statut === "en_bassin")
      ? "<button type=\"button\" class=\"btn-text bassin-revoir\" data-ref=\"" + escapeHtml(lot.ref) + "\">" +
        "&#9998; Revoir la répartition de ce coulage</button>"
      : "";

    body.innerHTML =
      "<h2 class=\"block-title\">Lot " + escapeHtml(lot.ref) + "</h2>" +
      repartitionBanniereHtml(lot) +
      "<div class=\"det-grid\">" + rows + "</div>" +
      "<div id=\"bassin-sortie-zone\" data-id=\"" + lot.id + "\" data-st=\"" + st + "\">" + action + "</div>" +
      revoir;

    // État « en attente » / « erreur » depuis la file de synchro des lots.
    // NB : cible la ligne « Synchronisation » de CETTE fiche détail
    // (#bassin-sync-etat), à ne pas confondre avec le bandeau de fraîcheur
    // de l'écran (#bassin-fraicheur).
    if (window.CAEKLots && CAEKLots.pendingKeys && lot.lotKey) {
      CAEKLots.pendingKeys().then(function (q) {
        var el = $("bassin-sync-etat");
        if (el && q && q[lot.lotKey]) {
          el.innerHTML = "&#8987; En attente de synchronisation";
        }
      }).catch(function () {});
    }

    $("bassin-detail").hidden = false;
  }

  /* ============================================================
     VALIDATION DE LA RÉPARTITION (ingénieur / responsable)
     ------------------------------------------------------------
     Une erreur d'age saisie par l'operateur a la repartition reste
     invisible jusqu'a l'echeance — donc trop tard. La repartition est
     signalee en ROUGE tant qu'un ingenieur/responsable ne l'a pas
     controlee.

     ATTENTION — portée réelle du contrôle : le schéma déployé
     synchronise le lot comme un `jsonb` libre (`op_upsert_lot`),
     sans RPC de validation ni vérification de rôle côté serveur.
     Le contrôle de rôle ci-dessous est donc CLIENT uniquement : il
     guide et trace, il n'est pas opposable à un client modifié. Une
     validation opposable exigerait une migration (cf. le run
     d'audit 2026-08-15 : ne jamais supposer une migration déployée).
     ============================================================ */
  function roleMetier() {
    return (window.CAEKOperateurs && CAEKOperateurs.roleMetier)
      ? CAEKOperateurs.roleMetier() : "operator";
  }
  function peutValiderRepartition() {
    var r = roleMetier();
    return r === "engineer" || r === "responsable" || r === "principal_admin";
  }
  // Répartition en attente de contrôle ? (drapeau posé à la répartition ;
  // les lots antérieurs à cette évolution ne sont jamais signalés à tort.)
  function repartitionEnAttente(lot) {
    return !!(lot && lot.repartitionAValider && !lot.repartitionValideePar);
  }

  function repartitionBanniereHtml(lot) {
    if (lot && lot.repartitionValideePar) {
      return "<div class=\"result-card is-ok repart-valid\">&#10004; Répartition validée par " +
        escapeHtml(lot.repartitionValideePar) +
        (lot.repartitionValideeLe ? " le " + fmtDate(lot.repartitionValideeLe) : "") +
        "</div>";
    }
    if (!repartitionEnAttente(lot)) { return ""; }
    var html = "<div class=\"result-card repart-urgent\">" +
      "<strong>&#9888; URGENT — RÉPARTITION NON VALIDÉE</strong><br>" +
      "Les âges et les dates d'essai n'ont pas encore été contrôlés. " +
      "Une erreur d'âge ne se verra qu'à l'échéance, quand il sera trop tard." +
      "</div>";
    if (peutValiderRepartition()) {
      html += "<button type=\"button\" class=\"btn-primary bassin-valider-repart\" data-ref=\"" +
        escapeHtml(lot.ref) + "\">&#9989; Valider la répartition de ce coulage</button>";
    } else {
      html += "<p class=\"hint\">Seul un ingénieur ou un responsable peut valider la répartition.</p>";
    }
    return html;
  }

  // Valide la répartition de TOUS les lots encore en bassin du coulage :
  // la répartition est un acte global, jamais lot par lot.
  // NB : nom distinct de `validerRepartition(form, coulage)` (ligne ~512), qui
  // SOUMET la répartition côté opérateur. Deux actes différents, et deux
  // déclarations homonymes s'écraseraient silencieusement (hoisting).
  function validerRepartitionParIngenieur(ref) {
    if (!peutValiderRepartition()) { return; }
    var prof = window.CAEKProfil
      ? CAEKProfil.require("Profil requis pour valider une répartition.") : null;
    if (window.CAEKProfil && !prof) { return; }
    CAEKDB.getLotsByRef(ref).then(function (lots) {
      var cibles = (lots || []).filter(repartitionEnAttente);
      if (!cibles.length) { return null; }
      var recap = cibles.map(function (l) {
        return "  · E" + (l.prel || "?") + " — " + l.nombre + " épr. " +
          (l.age === "autre" ? l.ageJours + "j" : l.age) +
          " — essai prévu le " + fmtDate(l.datePrevue);
      }).join("\n");
      if (!window.confirm("Valider la répartition de " + ref + " ?\n\n" + recap +
          "\n\nVérifiez que les âges et les dates d'essai sont corrects.")) { return null; }
      var now = new Date().toISOString();
      return Promise.all(cibles.map(function (l) {
        l.repartitionValideePar = (prof && prof.nom) || "";
        l.repartitionValideeRole = roleMetier();
        l.repartitionValideeLe = now;
        return CAEKDB.updateLot(l);
      })).then(function () { return cibles.length; });
    }).then(function (n) {
      if (!n) { return; }
      $("bassin-detail").hidden = true;
      refreshBassin();
      if (window.CAEKBadges) { CAEKBadges.refresh(); }
      window.alert("Répartition validée : " + n + " lot(s) de " + ref + ".");
    }).catch(function (e) {
      window.alert("Erreur lors de la validation : " + (e && e.message || e));
    });
  }

  function detRow(label, val) {
    return "<div class=\"det-row\"><span class=\"det-label\">" + escapeHtml(label) +
      "</span><span class=\"det-val\">" + escapeHtml(val || "—") + "</span></div>";
  }

  // Formulaire de SORTIE pour essai. J-1 = jour de sortie prévu (sans motif) ;
  // toute autre échéance (loin, J-2, retard) exige un motif.
  function sortieFormHtml(st) {
    var html = "";
    var needMotif = (st !== "j1");
    var motifs = (st === "retard") ? MOTIFS_RETARD : MOTIFS_ACCORD;
    if (st === "retard") {
      html += "<p class=\"hint\">Sortie en retard (échéance d'essai dépassée) : motif obligatoire.</p>";
    } else if (st === "j1") {
      html += "<p class=\"hint\">Jour de sortie prévu (J-1 avant l'essai). Confirmez la sortie pour essai.</p>";
    } else {
      html += "<p class=\"hint\">Sortie anticipée (avant l'échéance d'essai) : motif obligatoire.</p>";
    }
    if (needMotif) {
      html += "<label class=\"field-label\" for=\"sortie-motif\">Motif</label>" +
        "<select id=\"sortie-motif\" class=\"field\"><option value=\"\">— Choisir —</option>" +
        motifs.map(function (m) {
          // value = motif français stable : en AR seul le texte affiché change.
          return "<option value=\"" + escapeHtml(m) + "\">" + escapeHtml(m) + "</option>";
        }).join("") + "</select>";
    }
    html += "<label class=\"field-label\" for=\"sortie-heure\">Heure de sortie</label>" +
      "<input id=\"sortie-heure\" class=\"field\" type=\"time\">" +
      "<label class=\"field-label\" for=\"sortie-obs\">Observation" + (needMotif ? "" : " <span class=\"opt\">(facultatif)</span>") + "</label>" +
      "<textarea id=\"sortie-obs\" class=\"field\" rows=\"2\"></textarea>" +
      "<button type=\"button\" class=\"btn-primary\" id=\"sortie-valider\">&#10004; Confirmer la sortie pour essai</button>";
    return html;
  }

  function confirmSortie() {
    var zone = $("bassin-sortie-zone");
    if (!zone) { return; }
    var id = intOr0(zone.getAttribute("data-id"));
    var st = zone.getAttribute("data-st");
    var lot = null;
    for (var i = 0; i < _lots.length; i++) { if (_lots[i].id === id) { lot = _lots[i]; break; } }
    if (!lot) { return; }

    var prof = window.CAEKProfil
      ? CAEKProfil.require("Profil opérateur requis pour sortir un lot du bassin.")
      : { nom: "", qualification: "" };
    if (!prof) { return; }

    var needMotif = (st !== "j1");
    var motif = "";
    if (needMotif) {
      var sel = $("sortie-motif");
      motif = sel ? sel.value : "";
      if (!motif) { window.alert("Le motif est obligatoire."); return; }
    }
    var heure = ($("sortie-heure") && $("sortie-heure").value) || (pad2(new Date().getHours()) + ":" + pad2(new Date().getMinutes()));
    var obs = ($("sortie-obs") && $("sortie-obs").value.trim()) || "";

    var confirmSortie = window.I18N && I18N.f
      ? I18N.f("Confirmer la sortie pour essai de ce lot ({n} éprouvette(s)) ?", { n: lot.nombre })
      : "Confirmer la sortie pour essai de ce lot (" + lot.nombre + " éprouvette(s)) ?";
    // Répartition jamais contrôlée : dernier moment utile pour voir une erreur
    // d'âge. On AVERTIT sans bloquer — bloquer ferait manquer l'échéance
    // d'essai si aucun ingénieur n'est disponible, ce qui serait pire.
    if (repartitionEnAttente(lot)) {
      confirmSortie = "⚠ RÉPARTITION NON VALIDÉE par un ingénieur/responsable.\n" +
        "Âge : " + (lot.age === "autre" ? lot.ageJours + " jours" : lot.age) +
        " — essai prévu le " + fmtDate(lot.datePrevue) + ".\n" +
        "Vérifiez que l'âge est correct AVANT de sortir le lot.\n\n" + confirmSortie;
    }
    if (!window.confirm(confirmSortie)) { return; }

    lot.statut = "sorti";
    lot.dateSortie = todayStr();
    lot.heureSortie = heure;
    lot.operateurSortie = prof.nom || "";
    lot.qualificationSortie = prof.qualification || "";
    lot.motifSortie = motif;
    lot.observationSortie = obs;
    lot.sortiAt = new Date().toISOString();

    CAEKDB.updateLot(lot).then(function () {
      return CAEKDB.addJournal({
        type: "sortie", ref: lot.ref, lotId: lot.id,
        operateur: prof.nom || "", qualification: prof.qualification || "",
        motif: motif, statutEcheance: st, observation: obs
      });
    }).then(function () {
      $("bassin-detail").hidden = true;
      refreshBassin();
      if (window.CAEKBadges) { CAEKBadges.refresh(); }
    }).catch(function (err) {
      window.alert("Erreur lors de la sortie pour essai : " + (err && err.message || err));
    });
  }

  /* ============================================================
     ÉCRAN « ARCHIVES »
     ============================================================ */
  var _archives = [];

  function refreshArchives() {
    if (!window.CAEKDB) { return; }
    CAEKDB.getAllArchives().then(function (list) {
      list.sort(function (a, b) { return String(b.dateReelle || "").localeCompare(String(a.dateReelle || "")); });
      _archives = list;
      renderArchives();
    });
  }

  function filteredArchives() {
    var du = $("arch-du") ? $("arch-du").value : "";
    var au = $("arch-au") ? $("arch-au").value : "";
    return _archives.filter(function (a) {
      var d = String(a.dateReelle || "").slice(0, 10);
      if (du && d < du) { return false; }
      if (au && d > au) { return false; }
      return true;
    });
  }

  function renderArchives() {
    var box = $("arch-liste");
    if (!box) { return; }
    var list = filteredArchives();
    if ($("arch-count")) { $("arch-count").textContent = list.length + " écrasement(s)"; }
    if (!list.length) {
      box.innerHTML = "<p class=\"screen-placeholder\">Aucun écrasement archivé pour cette période.</p>";
      return;
    }
    box.innerHTML = list.map(function (a) {
      var ecart = (a.ecart === "" || a.ecart == null) ? "" :
        (a.ecart === 0 ? "à l'heure" : (a.ecart > 0 ? "+" + a.ecart + "j" : a.ecart + "j"));
      var glyph = "<span class=\"arch-shape bassin-shape " + shapeFormClass(a.type) + "\" aria-hidden=\"true\"></span>";
      return "<div class=\"arch-item\">" +
        "<div class=\"rep-top\"><span class=\"rep-ref\">&#128274; " + escapeHtml(a.ref) + "</span>" +
        "<span class=\"arch-type\">" + glyph + " " + escapeHtml(typeLabel(a.type)) + " · " +
        escapeHtml(a.age === "autre" ? a.ageJours + "j" : a.age) + "</span></div>" +
        "<div class=\"rep-ent\">" + escapeHtml(a.client || "—") + "</div>" +
        "<div class=\"rep-sub\">" + escapeHtml(a.nomProjet || "") + "</div>" +
        (a.ouvrage ? "<div class=\"arch-ouvrage\">" + ouvrageIconHtml(a.ouvrage) + escapeHtml(a.ouvrage) +
          ([a.bloc, a.etage].filter(Boolean).length ? " <span class=\"opt\">(" + escapeHtml([a.bloc, a.etage].filter(Boolean).join(" / ")) + ")</span>" : "") +
          "</div>" : "") +
        "<div class=\"arch-dates\">Coulé " + fmtDate(a.dateCoulage) +
        " · prévu " + fmtDate(a.datePrevue) +
        " · écrasé <strong>" + fmtDate(a.dateReelle) + "</strong>" + (ecart ? " (" + ecart + ")" : "") + "</div>" +
        "<div class=\"arch-meta\">" + escapeHtml(a.nombre + " épr. · " + (a.operateur || "")) +
        (a.qualification ? " (" + escapeHtml(a.qualification) + ")" : "") +
        (a.motif ? " · motif : " + escapeHtml(a.motif) : "") + "</div>" +
        (a.observation ? "<div class=\"arch-obs\">" + escapeHtml(a.observation) + "</div>" : "") +
        "</div>";
    }).join("");
  }

  var ARCH_HEADERS = ["Référence", "Client", "Projet", "Ouvrage", "Type", "Nombre", "Âge",
    "Date coulage", "Date prévue", "Date réelle", "Écart (j)", "Opérateur", "Qualification", "Motif", "Observation"];

  function archRow(a) {
    return [
      a.ref, a.client, a.nomProjet, a.ouvrage, typeLabel(a.type), a.nombre,
      a.age === "autre" ? a.ageJours + "j" : a.age,
      a.dateCoulage, a.datePrevue, a.dateReelle, a.ecart,
      a.operateur, a.qualification, a.motif, a.observation
    ];
  }

  function periodeSuffix() {
    var du = $("arch-du") ? $("arch-du").value : "";
    var au = $("arch-au") ? $("arch-au").value : "";
    return (du || au) ? ("_" + (du || "debut") + "_" + (au || "fin")) : "_complet";
  }

  function periodeLabel() {
    var du = $("arch-du") ? $("arch-du").value : "";
    var au = $("arch-au") ? $("arch-au").value : "";
    if (!du && !au) { return "(toutes périodes)"; }
    return "du " + (du ? fmtDate(du) : "début") + " au " + (au ? fmtDate(au) : "aujourd'hui");
  }

  function exportArchivesXls() {
    var list = filteredArchives();
    if (!list.length) { window.alert("Aucun écrasement à exporter pour cette période."); return; }
    if (!window.XLSX) { window.alert("Module Excel indisponible."); return; }
    var aoa = [ARCH_HEADERS].concat(list.map(archRow));
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Écrasements");
    XLSX.writeFile(wb, "archives_bassin" + periodeSuffix() + ".xlsx");
  }

  function shareArchives() {
    var list = filteredArchives();
    if (!list.length) { window.alert("Aucun écrasement à partager pour cette période."); return; }
    var titre = "Liste des écrasements effectués " + periodeLabel();
    var lignes = list.map(function (a) {
      var ecart = (a.ecart === "" || a.ecart == null) ? "" :
        (a.ecart === 0 ? " (à l'heure)" : (a.ecart > 0 ? " (+" + a.ecart + "j)" : " (" + a.ecart + "j)"));
      return "• " + a.ref + " — " + typeLabel(a.type) + " " +
        (a.age === "autre" ? a.ageJours + "j" : a.age) + " ×" + a.nombre +
        " — écrasé le " + fmtDate(a.dateReelle) + ecart +
        (a.operateur ? " par " + a.operateur : "") +
        (a.motif ? " — motif : " + a.motif : "");
    });
    var texte = titre + "\n\n" + lignes.join("\n");

    if (navigator.share) {
      navigator.share({ title: titre, text: texte }).catch(function () { /* annulé */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texte).then(
        function () { window.alert("Liste copiée dans le presse-papiers."); },
        function () { window.prompt("Copier la liste :", texte); });
      return;
    }
    window.prompt("Copier la liste :", texte);
  }

  /* ============================================================
     INITIALISATION / ÉVÉNEMENTS
     ============================================================ */
  function init() {
    // À répartir : ouverture du formulaire + édition des lots.
    var repBox = $("rep-bassin-liste");
    if (repBox) {
      repBox.addEventListener("click", function (ev) {
        var t = ev.target;
        var item = t.closest ? t.closest(".repb-item") : null;
        if (!item) { return; }
        var ref = item.getAttribute("data-ref");
        var coulage = findCoulage(ref);
        if (!coulage) { return; }

        if (t.closest(".repb-revoir")) {
          CAEKDB.getLotsByRef(ref).then(function (lots) { openRepartForm(item, coulage, lots); });
          return;
        }
        if (t.closest(".repb-open")) { openRepartForm(item, coulage); return; }
        var splitBtn = t.closest ? t.closest(".lot-split") : null;
        if (splitBtn) {
          var f = t.closest(".repb-form");
          if (f) { splitLot(f, intOr0(splitBtn.getAttribute("data-idx"))); }
          return;
        }
        if (t.closest(".repb-regrouper")) {
          var regroupForm = t.closest(".repb-form");
          if (regroupForm) { regrouperLots(regroupForm); }
          return;
        }
        if (t.closest(".repb-valider")) { validerRepartition(item.querySelector(".repb-form"), coulage); return; }
      });
      // Changement d'échéance d'un lot : révèle « jours » + revalide.
      repBox.addEventListener("change", function (ev) {
        var t = ev.target;
        var form = t.closest ? t.closest(".repb-form") : null;
        if (form && t.classList.contains("lot-age")) { updateSum(form); }
      });
      repBox.addEventListener("input", function (ev) {
        var t = ev.target;
        var form = t.closest ? t.closest(".repb-form") : null;
        if (form && t.classList.contains("lot-jours")) { updateSum(form); }
      });
    }

    // Bassin virtuel + zone des lots sortis : clic sur une forme -> détail.
    ["bassin-grille", "bassin-sortis"].forEach(function (gid) {
      var grid = $(gid);
      if (!grid) { return; }
      grid.addEventListener("click", function (ev) {
        var b = ev.target.closest ? ev.target.closest(".bassin-shape") : null;
        if (b) { openDetail(intOr0(b.getAttribute("data-id"))); }
      });
    });

    // Overlay détail.
    var overlay = $("bassin-detail");
    if (overlay) {
      overlay.addEventListener("click", function (ev) {
        if (ev.target === overlay) { overlay.hidden = true; return; }
        if (ev.target.closest && ev.target.closest("#bassin-detail-close")) { overlay.hidden = true; return; }
        if (ev.target.closest && ev.target.closest("#sortie-valider")) { confirmSortie(); return; }
        var fb = ev.target.closest ? ev.target.closest(".bassin-forcer") : null;
        if (fb) { forcerPassage(intOr0(fb.getAttribute("data-id"))); return; }
        var vr = ev.target.closest ? ev.target.closest(".bassin-valider-repart") : null;
        if (vr) { validerRepartitionParIngenieur(vr.getAttribute("data-ref")); return; }
        var rev = ev.target.closest ? ev.target.closest(".bassin-revoir") : null;
        if (rev) {
          overlay.hidden = true;
          _pendingRevoirRef = rev.getAttribute("data-ref");
          if (window.CAEKApp) { CAEKApp.navigate("screen-repartir"); }
        }
      });
    }

    // Archives : filtre + export.
    ["arch-du", "arch-au"].forEach(function (idf) {
      var el = $(idf);
      if (el) { el.addEventListener("change", renderArchives); }
    });
    var expXls = $("arch-export-xls");
    if (expXls) { expXls.addEventListener("click", exportArchivesXls); }
    var share = $("arch-share");
    if (share) { share.addEventListener("click", shareArchives); }
  }

  return {
    init: init,
    refreshRepartir: refreshRepartir,
    refreshBassin: refreshBassin,
    refreshArchives: refreshArchives
  };
})();

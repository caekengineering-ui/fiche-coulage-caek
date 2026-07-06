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

  function refreshRepartir() {
    if (!window.CAEKDB) { return; }
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
        if (specimenInfo(c).total <= 0) { return false; }
        return window.CAEKModel ? CAEKModel.recuperationOk(c) : true;
      });
      eligibles = eligibles.filter(laboOk);
      _repList = eligibles.filter(function (c) { return !c.bassinReparti; });
      _doneList = eligibles.filter(function (c) { return !!c.bassinReparti; });
      _doneList.forEach(function (c) { c._editable = !locked[c.ref]; });

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

    // Section « Répartitions déjà faites » : modifiable tant qu'aucun
    // lot n'est écrasé ni archivé ; sinon verrouillée.
    if (_doneList.length) {
      html += "<div class=\"repb-section-titre\">Répartitions déjà faites</div>";
      html += _doneList.map(function (c) {
        var ref = escapeHtml(c.ref);
        var action = c._editable
          ? "<button type=\"button\" class=\"btn-text repb-revoir\" data-ref=\"" + ref + "\">&#9998; Revoir / corriger</button>"
          : "<span class=\"repb-lock\">&#128274; Verrouillée : un lot a déjà été écrasé ou archivé.</span>";
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

  // Lots proposés (défaut, depuis le modèle) ou reconstruits depuis une
  // répartition existante (révision). Chaque lot = sous-ensemble d'UN prélèvement.
  function buildRepLots(coulage, existingLots) {
    if (existingLots && existingLots.length) {
      return existingLots.slice().sort(function (a, b) {
        return (a.prel - b.prel) || (a.ageJours - b.ageJours);
      }).map(function (l) {
        var codes = (l.codes || []).slice();
        return {
          prel: l.prel, type: l.type, codes: codes,
          nombre: codes.length || l.nombre || 0,
          age: l.age || "28j", ageJours: l.ageJours || 28
        };
      });
    }
    return window.CAEKModel ? CAEKModel.proposeRepartition(coulage) : [];
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
      "<div class=\"prel-rep-head\"><span class=\"prel-num\">E" + lot.prel + "</span> " +
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
  // On ne mélange jamais deux prélèvements : la division reste dans E<prel>.
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
    var nouveau = { prel: lot.prel, type: lot.type, codes: head, nombre: head.length,
      age: age, ageJours: j };
    lot.codes = tail; lot.nombre = tail.length;
    lots.splice(idx, 0, nouveau);   // le nouvel âge s'affiche avant le reste
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

    var titre = "<p class=\"hint\">Répartition en <strong>lots d'essai</strong>. On ne mélange pas deux " +
      "prélèvements dans un même lot. Par défaut : <strong>3 à 7 jours</strong>, le reste à " +
      "<strong>28 jours</strong>. Vous pouvez changer l'échéance de chaque lot, ou " +
      "<strong>&#9986; Diviser</strong> un lot pour un âge exigé par le client (ex. 3 j) — " +
      "le reste garde son échéance.</p>";

    form.innerHTML = titre +
      "<div class=\"prel-rep-editor\">" + rows + "</div>" +
      "<div class=\"repb-sum\"></div>" +
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
      out.push({ prel: base.prel, type: base.type, codes: base.codes,
        nombre: base.nombre, age: ageSel, ageJours: ageJours });
    }
    return out;
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
        : rows.length + " lot(s) d'essai — aucun mélange de prélèvements.";
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
        return { code: x.code, type: x.type, prel: x.prel, numInterne: x.numInterne, malaxeur: x.malaxeur };
      });
      return {
        ref: coulage.ref,
        client: coulage.client || coulage.entreprise || "",
        nomProjet: coulage.nomProjet || "",
        ouvrage: coulage.ouvrageCoule || coulage.ouvrage || "",
        ouvrageAutre: coulage.ouvrageAutre || "",
        bloc: coulage.bloc || "",
        etage: coulage.etage || "",
        partie: coulage.partie || "",
        dateCoulage: coulage.dateCoulage || "",
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
        dateRepartition: now
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
      return CAEKDB.addJournal({
        type: isEdit ? "repartition_revue" : "repartition", ref: coulage.ref,
        operateur: prof.nom || "", qualification: prof.qualification || "",
        nbLots: lots.length, total: total
      });
    }).then(function () {
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

  function refreshBassin() {
    if (!window.CAEKDB) { return; }
    CAEKDB.getAllLots().then(function (lots) {
      return autoArchive(lots).then(function (changed) {
        return changed ? CAEKDB.getAllLots() : lots;
      });
    }).then(function (lots) {
      _lots = lots.filter(laboOk);
      renderBassin();
      renderVeille();
    });
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
    return "<button type=\"button\" class=\"" + shapeClass(l) + "\" data-id=\"" + l.id + "\" " +
      "title=\"" + escapeHtml(l.ref + " · " + typeLabel(l.type) + " · " + ageLabel) + "\">" +
      "<span class=\"shape-nb\">" + l.nombre + "</span>" +
      "<span class=\"shape-age\">" + escapeHtml(ageLabel) + "</span>" +
      "<span class=\"shape-ref\">" + escapeHtml(l.ref || "") + "</span>" +
      rTag + "</button>";
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
      // Tri : retard d'abord, puis J-1, J-2, loin.
      var order = { retard: 0, j1: 1, j2: 2, loin: 3 };
      var sorted = enBassin.slice().sort(function (a, b) {
        var sa = dispStatut(a), sb = dispStatut(b);
        if (order[sa] !== order[sb]) { return order[sa] - order[sb]; }
        return String(a.datePrevue).localeCompare(String(b.datePrevue));
      });
      grid.innerHTML = sorted.map(shapeBtnHtml).join("");
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
      detRow("Statut", stLabel) +
      detRow("Opérateur (répartition)", lot.operateurRepartition);

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
      "<div class=\"det-grid\">" + rows + "</div>" +
      "<div id=\"bassin-sortie-zone\" data-id=\"" + lot.id + "\" data-st=\"" + st + "\">" + action + "</div>" +
      revoir;

    $("bassin-detail").hidden = false;
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
        motifs.map(function (m) { return "<option>" + m + "</option>"; }).join("") + "</select>";
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

/* ============================================================
   Fiche de coulage terrain - CAEK
   repertoire.js - Liste des fiches + recherche/filtre.
   Actions par fiche :
     - Ouvrir / modifier (brouillon) ou consulter (validée/envoyée) ;
     - Valider (brouillon -> validée : dispo pour le module bassin) ;
     - Partager au bureau (validée/envoyée : message + dossier complet).
   La validation utilise le profil opérateur (obligatoire).
   ============================================================ */

var CAEKRepertoire = (function () {
  "use strict";

  var _all = [];
  var _statut = "";
  var _selected = {};

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

  var STATUT_LABEL = { brouillon: "Brouillon", validee: "Validée", envoyee: "Envoyé" };

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  function pad2(n) { n = parseInt(n, 10) || 0; return (n < 10 ? "0" : "") + n; }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // Difference en jours (b - a) entre deux dates "YYYY-MM-DD".
  function diffDays(a, b) {
    function toD(ymd) {
      var p = String(ymd).slice(0, 10).split("-");
      return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    }
    return Math.round((toD(b) - toD(a)) / 86400000);
  }

  var TYPE_LABEL = { cube: "Cube", cylindre: "Cylindre", mixte: "Mixte (cube + cylindre)" };

  // Date de reference du coulage (pour le delai de recuperation, max 3 jours).
  function coulageDateStr(c) {
    var d = c.dateCoulage || c.dateValidation || c.dateCreation || "";
    return String(d).slice(0, 10);
  }

  // Panneau « Confirmer recuperation des eprouvettes » : codification par
  // prelevement + 2 cases a cocher (recuperees / codification confirmee).
  function recupPanelHtml(c, ref) {
    var codif = window.CAEKModel ? CAEKModel.codification(c) : [];
    var total = window.CAEKModel ? CAEKModel.totalEprouvettes(c) : 0;

    // Etiquettes a inscrire sur les eprouvettes : tous les codes, en gras,
    // groupes par prelevement, recopiables directement.
    var rows = codif.map(function (p) {
      var codesHtml = (p.codes || []).map(function (code) {
        return "<div class=\"recup-code\">" + escapeHtml(code) + "</div>";
      }).join("");
      return "<div class=\"recup-prel\">" +
        "<div class=\"recup-prel-head\"><strong>" + escapeHtml(p.numero) + "</strong> · " +
        escapeHtml(TYPE_LABEL[p.type] || p.type) + " · " + p.nombre + " épr." +
        (p.malaxeur ? " · Malaxeur " + p.malaxeur : "") + " :</div>" +
        "<div class=\"recup-prel-codes\">" + codesHtml + "</div>" +
        "</div>";
    }).join("");

    // Delai depuis le coulage (regle : recuperation sous 3 jours max).
    var cd = coulageDateStr(c);
    var delaiHtml = "";
    if (cd) {
      var d = diffDays(cd, todayStr());
      var cls = d > 3 ? "is-error" : (d === 3 ? "is-warn" : "is-ok");
      var txt = d <= 0 ? "Coulage du jour"
        : (d === 1 ? "1 jour depuis le coulage"
          : d + " jours depuis le coulage");
      if (d > 3) { txt += " — délai de 3 j dépassé"; }
      delaiHtml = "<div class=\"recup-delai " + cls + "\">&#9201; " + txt + "</div>";
    }

    return "<div class=\"rep-recup\" hidden>" +
      "<p class=\"recup-title\">Récupération des éprouvettes — <strong>" + total + "</strong> au total</p>" +
      delaiHtml +
      "<div class=\"recup-etiquettes\">" +
      "<div class=\"recup-etiq-titre\">🏷️ ÉTIQUETTES À INSCRIRE SUR LES ÉPROUVETTES</div>" +
      "<div class=\"recup-liste\">" + rows + "</div>" +
      "</div>" +
      "<label class=\"recup-check\"><input type=\"checkbox\" class=\"recup-c1\" data-ref=\"" + ref + "\"> " +
      "Les éprouvettes ont été récupérées du chantier.</label>" +
      "<label class=\"recup-check\"><input type=\"checkbox\" class=\"recup-c2\" data-ref=\"" + ref + "\"> " +
      "La codification ci-dessus a été vérifiée et confirmée.</label>" +
      "<button type=\"button\" class=\"btn-primary rep-recup-valider\" data-ref=\"" + ref + "\" disabled>" +
      "&#10004; Confirmer la récupération</button>" +
      "<div class=\"rep-recup-result\" hidden></div>" +
      "</div>";
  }

  // Totaux terrain : quantite (m3) sur les malaxeurs, nombre d'eprouvettes
  // via le modele partage (prelevements V2.01, retro-compatible V2).
  function totaux(c) {
    var mals = c.malaxeurs || [];
    var qte = 0;
    for (var i = 0; i < mals.length; i++) {
      qte += num(mals[i].quantite);
    }
    qte = Math.round(qte * 100) / 100;
    var epr = window.CAEKModel ? CAEKModel.totalEprouvettes(c) : 0;
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

  function filteredList() {
    var search = ($("rep-search") ? $("rep-search").value : "").trim().toLowerCase();
    return _all.filter(function (c) {
      if (_statut && (c.statut || "brouillon") !== _statut) { return false; }
      if (!search) { return true; }
      var hay = [c.ref, c.codeProjet, c.entreprise, c.client, c.nomProjet,
        fmtDate(c.dateCoulage), c.dateCoulage].join(" ").toLowerCase();
      return hay.indexOf(search) >= 0;
    });
  }

  // Coulages selectionnes ; si aucun coche -> toute la liste filtree.
  function selectedCoulages() {
    var filtered = filteredList();
    var sel = filtered.filter(function (c) { return _selected[c.ref]; });
    return sel.length ? sel : filtered;
  }

  function updateSelCount() {
    var n = 0; for (var k in _selected) { if (_selected[k]) { n++; } }
    var el = $("rep-sel-count");
    if (el) { el.textContent = n ? (n + " sélectionnée(s)") : "Aucune sélection (export = liste filtrée)"; }
    var all = $("rep-select-all");
    if (all) {
      var filtered = filteredList();
      var allSel = filtered.length && filtered.every(function (c) { return _selected[c.ref]; });
      all.checked = !!allSel;
    }
  }

  function render() {
    var box = $("rep-liste");
    if (!box) { return; }

    var filtered = filteredList();

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
      var ref = escapeHtml(c.ref);

      var isValidee = (st === "validee" || st === "envoyee");
      var needRecup = isValidee && window.CAEKModel &&
        CAEKModel.hasEprouvettes(c) && !CAEKModel.recuperationOk(c);

      var actions = "<div class=\"rep-actions\">";
      if (st === "brouillon") {
        actions += "<button type=\"button\" class=\"rep-act rep-valider\" data-ref=\"" + ref + "\">&#10004; Valider</button>";
      } else {
        if (needRecup) {
          actions += "<button type=\"button\" class=\"rep-act rep-recup-btn\" data-ref=\"" + ref + "\">&#9888; Confirmer récupération éprouvettes</button>";
        }
        actions += "<button type=\"button\" class=\"rep-act rep-partager\" data-ref=\"" + ref + "\">&#128228; Partager au bureau</button>";
      }
      actions += "</div>";

      var recupPanel = needRecup ? recupPanelHtml(c, ref) : "";

      var exportPanel = "<div class=\"rep-export\" hidden>" +
        "<button type=\"button\" class=\"btn-primary rep-share\" data-ref=\"" + ref + "\">&#128228; Partager (message + dossier)</button>" +
        "<button type=\"button\" class=\"btn-secondary rep-zip\" data-ref=\"" + ref + "\">&#128230; Exporter le dossier complet</button>" +
        "<p class=\"hint\">Contient le fichier Excel + photos + pièces jointes du coulage.</p>" +
        "<button type=\"button\" class=\"btn-secondary rep-copy\" data-ref=\"" + ref + "\">&#128203; Copier le message récap</button>" +
        "<button type=\"button\" class=\"btn-text rep-xls\" data-ref=\"" + ref + "\">&#11015; Excel seul</button>" +
        "<div class=\"rep-export-result\" hidden></div>" +
        "</div>";

      var checked = _selected[c.ref] ? " checked" : "";
      return "<div class=\"rep-item\" data-ref=\"" + ref + "\">" +
        "<div class=\"rep-row\">" +
        "<label class=\"rep-pick\" title=\"Sélectionner\"><input type=\"checkbox\" class=\"rep-check\" data-ref=\"" + ref + "\"" + checked + "></label>" +
        "<button type=\"button\" class=\"rep-open\" data-ref=\"" + ref + "\">" +
        "<div class=\"rep-top\"><span class=\"rep-ref\">" + ref + "</span>" +
        "<span class=\"badge badge-" + st + "\">" + (STATUT_LABEL[st] || st) + "</span></div>" +
        "<div class=\"rep-ent\">" + escapeHtml(c.client || c.entreprise || "—") + "</div>" +
        "<div class=\"rep-sub\">" + escapeHtml(c.nomProjet || "") +
        (c.dateCoulage ? " · " + escapeHtml(fmtDate(c.dateCoulage)) : "") + "</div>" +
        "<div class=\"rep-tot\">" + t.qte + " m³ · " + t.epr + " éprouvette(s)</div>" +
        "</button>" +
        "<button type=\"button\" class=\"rep-del\" data-del=\"" + ref + "\" " +
        "aria-label=\"Supprimer la fiche " + ref + "\" title=\"Supprimer\">&#128465;</button>" +
        "</div>" +
        actions +
        recupPanel +
        exportPanel +
        "</div>";
    }).join("");
    updateSelCount();
  }

  /* ---------- Validation (brouillon -> validée) ---------- */
  function validerFiche(ref) {
    var prof = window.CAEKProfil ? CAEKProfil.require("Profil opérateur requis. Veuillez renseigner votre nom et qualification.") : { nom: "" };
    if (!prof) { return; }
    if (!window.confirm("Valider la fiche " + ref + " ?\nElle deviendra disponible pour le module bassin et ne sera plus modifiable.")) { return; }
    CAEKDB.getCoulage(ref).then(function (c) {
      if (!c) { return; }
      c.statut = "validee";
      c.dateValidation = new Date().toISOString();
      if (!c.signatureOperateur && prof.nom) { c.signatureOperateur = prof.nom; }
      c.operateurValidation = prof.nom || c.signatureOperateur || "";
      c.qualificationValidation = prof.qualification || "";
      c.dateModification = new Date().toISOString();
      return CAEKDB.updateCoulage(c).then(refresh);
    });
  }

  /* ---------- Partage au bureau ---------- */
  function exportResultBox(itemEl, html, isError) {
    var box = itemEl.querySelector(".rep-export-result");
    if (!box) { return; }
    box.hidden = false;
    box.className = "rep-export-result result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function markEnvoyee(c) {
    if ((c.statut || "brouillon") === "envoyee") { return Promise.resolve(); }
    c.statut = "envoyee";
    c.dateEnvoi = new Date().toISOString();
    c.dateModification = new Date().toISOString();
    return CAEKDB.updateCoulage(c);
  }

  function withCoulage(ref, fn) { return CAEKDB.getCoulage(ref).then(function (c) { if (c) { return fn(c); } }); }

  function doShare(ref, itemEl) {
    if (!window.CAEKExport) { return; }
    withCoulage(ref, function (c) {
      return CAEKExport.share(c).then(function (res) {
        if (res.shared || res.downloaded) {
          return markEnvoyee(c).then(function () {
            exportResultBox(itemEl, "&#10004; Dossier transmis. Fiche marquée « envoyée ».", false);
            refresh();
          });
        }
      });
    }).catch(function (err) { exportResultBox(itemEl, "&#9888; " + escapeHtml(err && err.message || err), true); });
  }

  function doZip(ref, itemEl) {
    if (!window.CAEKExport) { return; }
    withCoulage(ref, function (c) {
      return CAEKExport.downloadZip(c).then(function () {
        return markEnvoyee(c).then(function () {
          exportResultBox(itemEl, "&#10004; Dossier complet téléchargé.", false);
          refresh();
        });
      });
    }).catch(function (err) { exportResultBox(itemEl, "&#9888; " + escapeHtml(err && err.message || err), true); });
  }

  function doExcel(ref, itemEl) {
    if (!window.CAEKExport) { return; }
    withCoulage(ref, function (c) {
      CAEKExport.download(c);
      exportResultBox(itemEl, "&#10004; Fichier Excel téléchargé.", false);
    }).catch(function (err) { exportResultBox(itemEl, "&#9888; " + escapeHtml(err && err.message || err), true); });
  }

  function doCopyMsg(ref, itemEl) {
    if (!window.CAEKExport) { return; }
    withCoulage(ref, function (c) {
      var t = CAEKExport.buildMessage(c);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(
          function () { exportResultBox(itemEl, "&#10004; Message récap copié.", false); },
          function () { window.prompt("Copier le message :", t); });
      } else { window.prompt("Copier le message :", t); }
    });
  }

  /* ---------- Confirmation de recuperation des eprouvettes ---------- */
  function recupResultBox(itemEl, html, isError) {
    var box = itemEl.querySelector(".rep-recup-result");
    if (!box) { return; }
    box.hidden = false;
    box.className = "rep-recup-result result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function confirmRecuperation(ref, itemEl) {
    var prof = window.CAEKProfil
      ? CAEKProfil.require("Profil opérateur requis pour confirmer la récupération des éprouvettes.")
      : { nom: "" };
    if (!prof) { return; }
    CAEKDB.getCoulage(ref).then(function (c) {
      if (!c) { return; }
      c.eprRecuperees = true;
      c.codificationConfirmee = true;
      c.dateRecuperation = new Date().toISOString();
      c.operateurRecuperation = prof.nom || c.signatureOperateur || "";
      c.qualificationRecuperation = prof.qualification || "";
      c.dateModification = new Date().toISOString();
      return CAEKDB.updateCoulage(c).then(function () {
        recupResultBox(itemEl, "&#10004; Récupération confirmée. Le coulage peut être réparti au bassin.", false);
        if (window.CAEKBadges) { CAEKBadges.refresh(); }
        refresh();
      });
    }).catch(function (err) {
      recupResultBox(itemEl, "&#9888; " + escapeHtml(err && err.message || err), true);
    });
  }

  /* ---------- Export / partage de la liste des coulages ---------- */
  function listResult(html, isError) {
    var box = $("rep-list-result");
    if (!box) { return; }
    box.hidden = false;
    box.className = "result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function doListExport() {
    if (!window.CAEKExport) { return; }
    var coulages = selectedCoulages();
    if (!coulages.length) { listResult("&#9888; Aucune fiche à exporter.", true); return; }
    var lotsP = (window.CAEKDB && CAEKDB.getAllLots) ? CAEKDB.getAllLots() : Promise.resolve([]);
    lotsP.then(function (lots) {
      CAEKExport.downloadList(coulages, lots);
      listResult("&#10004; Liste exportée (" + coulages.length + " fiche(s)).", false);
    }).catch(function (err) { listResult("&#9888; " + escapeHtml(err && err.message || err), true); });
  }

  function doListShare() {
    if (!window.CAEKExport) { return; }
    var coulages = selectedCoulages();
    if (!coulages.length) { listResult("&#9888; Aucune fiche à partager.", true); return; }
    var lotsP = (window.CAEKDB && CAEKDB.getAllLots) ? CAEKDB.getAllLots() : Promise.resolve([]);
    lotsP.then(function (lots) {
      return CAEKExport.shareList(coulages, lots).then(function (r) {
        listResult(r && r.shared ? "&#10004; Liste partagée." : "&#10004; Liste exportée (" + coulages.length + " fiche(s)).", false);
      });
    }).catch(function (err) { listResult("&#9888; " + escapeHtml(err && err.message || err), true); });
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

    var selAll = $("rep-select-all");
    if (selAll) {
      selAll.addEventListener("change", function () {
        var filtered = filteredList();
        filtered.forEach(function (c) {
          if (selAll.checked) { _selected[c.ref] = true; } else { delete _selected[c.ref]; }
        });
        render();
      });
    }
    var listXls = $("rep-list-xls");
    if (listXls) { listXls.addEventListener("click", doListExport); }
    var listShare = $("rep-list-share");
    if (listShare) { listShare.addEventListener("click", doListShare); }

    var box = $("rep-liste");
    if (box) {
      box.addEventListener("click", function (ev) {
        var tgt = ev.target;
        var item = tgt.closest ? tgt.closest(".rep-item") : null;

        var del = tgt.closest ? tgt.closest(".rep-del") : null;
        if (del) {
          ev.stopPropagation();
          var dref = del.getAttribute("data-del");
          if (dref && window.confirm("Voulez-vous vraiment supprimer la fiche " + dref + " ? Cette action est irréversible.")) {
            CAEKDB.deleteCoulage(dref).then(function () { refresh(); });
          }
          return;
        }

        var val0 = tgt.closest ? tgt.closest(".rep-valider") : null;
        if (val0) { validerFiche(val0.getAttribute("data-ref")); return; }

        var part = tgt.closest ? tgt.closest(".rep-partager") : null;
        if (part && item) {
          var panel = item.querySelector(".rep-export");
          if (panel) { panel.hidden = !panel.hidden; }
          return;
        }

        var rb = tgt.closest ? tgt.closest(".rep-recup-btn") : null;
        if (rb && item) {
          var rpanel = item.querySelector(".rep-recup");
          if (rpanel) { rpanel.hidden = !rpanel.hidden; }
          return;
        }

        var rv = tgt.closest ? tgt.closest(".rep-recup-valider") : null;
        if (rv && item) {
          if (rv.disabled) { return; }
          confirmRecuperation(rv.getAttribute("data-ref"), item);
          return;
        }

        var sh = tgt.closest ? tgt.closest(".rep-share") : null;
        if (sh && item) { doShare(sh.getAttribute("data-ref"), item); return; }
        var zp = tgt.closest ? tgt.closest(".rep-zip") : null;
        if (zp && item) { doZip(zp.getAttribute("data-ref"), item); return; }
        var cp = tgt.closest ? tgt.closest(".rep-copy") : null;
        if (cp && item) { doCopyMsg(cp.getAttribute("data-ref"), item); return; }
        var xl = tgt.closest ? tgt.closest(".rep-xls") : null;
        if (xl && item) { doExcel(xl.getAttribute("data-ref"), item); return; }

        var open = tgt.closest ? tgt.closest(".rep-open") : null;
        if (open) {
          var ref = open.getAttribute("data-ref");
          if (ref && window.CAEKFiche) { CAEKFiche.open(ref); }
        }
      });

      box.addEventListener("change", function (ev) {
        var chk = ev.target;
        // Case de selection d'une fiche (export liste).
        if (chk && chk.classList && chk.classList.contains("rep-check")) {
          var r = chk.getAttribute("data-ref");
          if (chk.checked) { _selected[r] = true; } else { delete _selected[r]; }
          updateSelCount();
          return;
        }
        // Cases a cocher de recuperation : activer le bouton quand les 2 sont cochees.
        if (!chk || !chk.classList ||
          !(chk.classList.contains("recup-c1") || chk.classList.contains("recup-c2"))) {
          return;
        }
        var panel = chk.closest ? chk.closest(".rep-recup") : null;
        if (!panel) { return; }
        var c1 = panel.querySelector(".recup-c1");
        var c2 = panel.querySelector(".recup-c2");
        var btn = panel.querySelector(".rep-recup-valider");
        if (btn) { btn.disabled = !(c1 && c1.checked && c2 && c2.checked); }
      });
    }
  }

  return { init: init, refresh: refresh };
})();

/* ============================================================
   Fiche de coulage terrain - CAEK
   compression.js - V2.01 : module "Test de compression".
   Recoit les lots SORTIS du bassin (statut "sorti"), permet de
   saisir l'essai eprouvette par eprouvette (dimensions, masse,
   force, Rc) puis bascule le lot en "teste" (historique).

   Calcul a deux sens :
     Surface cube      = largeur x longueur           (mm^2)
     Surface cylindre  = PI x (diametre / 2)^2         (mm^2)
     Rc (MPa)          = Force(kN) x 1000 / Surface(mm^2)
     Force (kN)        = Rc(MPa) x Surface(mm^2) / 1000
   Dimensions par defaut : Cube 150x150 mm ; Cylindre O160 x 320 mm.
   ============================================================ */

var CAEKCompression = (function () {
  "use strict";

  var DEF_CUBE = { d1: 150, d2: 150 };       // largeur x longueur (mm)
  var DEF_CYL = { d1: 160, d2: 320 };        // diametre x hauteur (mm)

  function $(id) { return document.getElementById(id); }
  function intOr0(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
  function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? 0 : n; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function nowTime() { var d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtDate(d) {
    if (!d) { return "—"; }
    var s = String(d);
    if (s.indexOf("T") >= 0) { s = s.slice(0, 10); }
    var p = s.split("-");
    return p.length === 3 ? (p[2] + "/" + p[1] + "/" + p[0]) : s;
  }
  function diffDays(a, b) {
    function toD(ymd) { var p = String(ymd).slice(0, 10).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
    if (!a || !b) { return ""; }
    return Math.round((toD(b) - toD(a)) / 86400000);
  }
  function formeLabel(f) { return f === "cylindre" ? "Cylindre" : "Cube"; }

  // Forme physique d'une eprouvette a partir du type de codification.
  // "mixte" est ambigu pour une eprouvette isolee -> cube par defaut (modifiable).
  function defaultForme(type) { return type === "cylindre" ? "cylindre" : "cube"; }

  function surfaceMm2(forme, d1, d2) {
    if (forme === "cylindre") { var r = num(d1) / 2; return Math.PI * r * r; }
    return num(d1) * num(d2);
  }
  function rcFromForce(force, surface) { return surface > 0 ? (num(force) * 1000) / surface : 0; }
  function forceFromRc(rc, surface) { return (num(rc) * surface) / 1000; }
  function round1(n) { return Math.round(n * 10) / 10; }
  function round2(n) { return Math.round(n * 100) / 100; }

  // Codes individuels d'un lot (avec repli si lot anterieur a la V2.01).
  function lotCodes(lot) {
    if (lot && Array.isArray(lot.codes) && lot.codes.length) { return lot.codes; }
    var out = [];
    var n = intOr0(lot && lot.nombre);
    for (var j = 1; j <= n; j++) {
      out.push({ code: (lot.ref || "") + "-" + pad2(j), type: (lot && lot.type) || "cube" });
    }
    return out;
  }

  function dimsLabel(e) {
    if (e.forme === "cylindre") { return "&#216;" + (num(e.dim1) || "?") + "×" + (num(e.dim2) || "?") + " mm"; }
    return (num(e.dim1) || "?") + "×" + (num(e.dim2) || "?") + " mm";
  }

  /* ============================================================
     CHARGEMENT / RAFRAICHISSEMENT
     ============================================================ */
  var _aTester = [];
  var _historique = [];

  function refresh() {
    if (!window.CAEKDB) { return; }
    CAEKDB.getAllLots().then(function (lots) {
      _aTester = (lots || []).filter(function (l) { return l.statut === "sorti"; });
      _historique = (lots || []).filter(function (l) { return l.statut === "teste"; });
      _aTester.sort(function (a, b) { return String(a.datePrevue).localeCompare(String(b.datePrevue)); });
      _historique.sort(function (a, b) { return String(b.dateEssai || "").localeCompare(String(a.dateEssai || "")); });
      renderAtester();
      renderHistorique();
    });
  }

  // Une eprouvette est consideree saisie si dimensions + (force ou Rc) presents.
  function essaiFilled(e) {
    return !!e && num(e.dim1) > 0 && num(e.dim2) > 0 && (num(e.force) > 0 || num(e.rc) > 0);
  }
  // Avancement de la saisie d'un lot { filled, total }.
  function essaiProgress(l) {
    var total = intOr0(l.nombre);
    var essais = Array.isArray(l.essais) ? l.essais : [];
    var filled = 0;
    for (var i = 0; i < essais.length; i++) { if (essaiFilled(essais[i])) { filled++; } }
    return { filled: filled, total: total };
  }
  // Lot « sorti » dont la saisie est commencee mais incomplete.
  function isIncomplete(l) {
    if (l.statut !== "sorti") { return false; }
    var p = essaiProgress(l);
    return p.filled > 0 && p.filled < p.total;
  }

  function lotCardInner(l) {
    var p = essaiProgress(l);
    var incomplet = isIncomplete(l)
      ? "<div class=\"comp-incomplet\">&#9888; Essai incomplet — " + p.filled + "/" + p.total + " éprouvette(s) saisie(s)</div>"
      : "";
    return "<div class=\"rep-top\"><span class=\"rep-ref\">" + escapeHtml(l.ref) + "</span>" +
      "<span class=\"comp-type\">" + escapeHtml(formeLabel(defaultForme(l.type))) + " · " +
      escapeHtml(l.age === "autre" ? l.ageJours + "j" : l.age) + "</span></div>" +
      incomplet +
      "<div class=\"rep-ent\">" + escapeHtml(l.client || "—") + "</div>" +
      "<div class=\"rep-sub\">" + escapeHtml(l.nomProjet || "") +
      (l.ouvrage ? " · " + escapeHtml(l.ouvrage) : "") + "</div>" +
      "<div class=\"rep-tot\">" + intOr0(l.nombre) + " éprouvette(s) · prévue le " +
      escapeHtml(fmtDate(l.datePrevue)) +
      (l.dateSortie ? " · sortie le " + escapeHtml(fmtDate(l.dateSortie)) : "") + "</div>";
  }

  function renderAtester() {
    var box = $("comp-atester-liste");
    if (!box) { return; }
    if ($("comp-atester-count")) { $("comp-atester-count").textContent = _aTester.length + " lot(s) à tester"; }
    if (!_aTester.length) {
      box.innerHTML = "<p class=\"screen-placeholder\">Aucun lot sorti pour essai. Sortez d'abord des lots depuis le bassin.</p>";
      return;
    }
    box.innerHTML = _aTester.map(function (l) {
      return "<button type=\"button\" class=\"comp-lot-card\" data-id=\"" + l.id + "\">" + lotCardInner(l) + "</button>";
    }).join("");
  }

  /* ============================================================
     SAISIE D'UN ESSAI (overlay)
     ============================================================ */
  function findLot(list, id) {
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return null;
  }

  function rowHtml(e, i) {
    var isCyl = (e.forme === "cylindre");
    var l1 = isCyl ? "Ø (mm)" : "Larg. (mm)";
    var l2 = isCyl ? "Haut. (mm)" : "Long. (mm)";
    return "<div class=\"comp-row\" data-code=\"" + escapeHtml(e.code) + "\" data-i=\"" + i + "\">" +
      "<div class=\"comp-row-head\"><span class=\"comp-code\">" + escapeHtml(e.code) + "</span>" +
        "<select class=\"field comp-forme\">" +
          "<option value=\"cube\"" + (isCyl ? "" : " selected") + ">Cube</option>" +
          "<option value=\"cylindre\"" + (isCyl ? " selected" : "") + ">Cylindre</option>" +
        "</select></div>" +
      "<div class=\"comp-grid\">" +
        "<label class=\"comp-f\"><span class=\"comp-f-lbl comp-l1\">" + l1 + "</span>" +
          "<input class=\"field comp-d1\" type=\"number\" inputmode=\"decimal\" step=\"any\" min=\"0\" value=\"" + (e.dim1 || "") + "\"></label>" +
        "<label class=\"comp-f\"><span class=\"comp-f-lbl comp-l2\">" + l2 + "</span>" +
          "<input class=\"field comp-d2\" type=\"number\" inputmode=\"decimal\" step=\"any\" min=\"0\" value=\"" + (e.dim2 || "") + "\"></label>" +
        "<label class=\"comp-f\"><span class=\"comp-f-lbl\">Masse (kg)</span>" +
          "<input class=\"field comp-masse\" type=\"number\" inputmode=\"decimal\" step=\"any\" min=\"0\" value=\"" + (e.masse || "") + "\"></label>" +
        "<label class=\"comp-f\"><span class=\"comp-f-lbl\">Date essai</span>" +
          "<input class=\"field comp-date\" type=\"date\" value=\"" + (e.dateEssai || todayStr()) + "\"></label>" +
        "<label class=\"comp-f\"><span class=\"comp-f-lbl\">Force (kN)</span>" +
          "<input class=\"field comp-force\" type=\"number\" inputmode=\"decimal\" step=\"any\" min=\"0\" value=\"" + (e.force || "") + "\"></label>" +
        "<label class=\"comp-f\"><span class=\"comp-f-lbl\">Rc (MPa)</span>" +
          "<input class=\"field comp-rc\" type=\"number\" inputmode=\"decimal\" step=\"any\" min=\"0\" value=\"" + (e.rc || "") + "\"></label>" +
      "</div>" +
      "<div class=\"comp-row-foot\"><span class=\"comp-surface\"></span>" +
        "<input class=\"field comp-obs\" type=\"text\" placeholder=\"Observation\" value=\"" + escapeHtml(e.observation || "") + "\"></div>" +
      "</div>";
  }

  var _editLot = null;
  var _editEssais = [];

  function buildEssaisFromLot(lot) {
    var existing = Array.isArray(lot.essais) ? lot.essais : [];
    var codes = lotCodes(lot);
    return codes.map(function (c, i) {
      var prev = existing[i] || {};
      var forme = prev.forme || defaultForme(c.type);
      var def = (forme === "cylindre") ? DEF_CYL : DEF_CUBE;
      return {
        code: c.code,
        forme: forme,
        dim1: (prev.dim1 != null && prev.dim1 !== "") ? prev.dim1 : def.d1,
        dim2: (prev.dim2 != null && prev.dim2 !== "") ? prev.dim2 : def.d2,
        masse: prev.masse || "",
        dateEssai: prev.dateEssai || todayStr(),
        force: prev.force || "",
        rc: prev.rc || "",
        observation: prev.observation || ""
      };
    });
  }

  function openLotTest(id) {
    var lot = findLot(_aTester, id) || findLot(_historique, id);
    if (!lot) { return; }
    _editLot = lot;
    _editEssais = buildEssaisFromLot(lot);
    var body = $("comp-detail-body");
    if (!body) { return; }

    var rows = _editEssais.map(rowHtml).join("");
    body.innerHTML =
      "<h2 class=\"block-title\">Essai du lot " + escapeHtml(lot.ref) + "</h2>" +
      "<div class=\"det-grid\">" +
        detRow("Client", lot.client) +
        detRow("Projet", lot.nomProjet) +
        detRow("Ouvrage", [lot.ouvrage, [lot.bloc, lot.etage].filter(Boolean).join(" / ")].filter(Boolean).join(" — ")) +
        detRow("Âge", lot.age === "autre" ? lot.ageJours + " jours" : lot.age) +
        detRow("Date de coulage", fmtDate(lot.dateCoulage)) +
        detRow("Nombre", intOr0(lot.nombre) + " éprouvette(s)") +
      "</div>" +
      "<div class=\"comp-defaults\">" +
        "<p class=\"hint\">Dimensions par défaut — Cube : <strong>150×150 mm</strong> · Cylindre : <strong>Ø160×320 mm</strong>.</p>" +
        "<button type=\"button\" class=\"btn-secondary\" id=\"comp-apply-all\">&#128203; Appliquer ces dimensions à tout le lot</button>" +
      "</div>" +
      "<div id=\"comp-rows\">" + rows + "</div>" +
      "<div class=\"comp-valider-wrap\">" +
        "<button type=\"button\" class=\"btn-secondary\" id=\"comp-save-draft\">&#128190; Enregistrer (brouillon)</button>" +
        "<button type=\"button\" class=\"btn-primary\" id=\"comp-valider\">&#10004; Valider l'essai du lot</button>" +
      "</div>" +
      "<div id=\"comp-detail-result\" class=\"result-card\" hidden></div>";

    var rowsBox = $("comp-rows");
    if (rowsBox) {
      _editEssais.forEach(function (e, i) { updateSurfaceDisplay(rowsBox.children[i]); });
    }
    $("comp-detail").hidden = false;
  }

  function detRow(label, val) {
    return "<div class=\"det-row\"><span class=\"det-label\">" + escapeHtml(label) +
      "</span><span class=\"det-val\">" + escapeHtml(val || "—") + "</span></div>";
  }

  function updateSurfaceDisplay(rowEl) {
    if (!rowEl) { return; }
    var forme = rowEl.querySelector(".comp-forme").value;
    var d1 = rowEl.querySelector(".comp-d1").value;
    var d2 = rowEl.querySelector(".comp-d2").value;
    var s = surfaceMm2(forme, d1, d2);
    var span = rowEl.querySelector(".comp-surface");
    if (span) { span.textContent = s > 0 ? ("Surface : " + Math.round(s) + " mm²") : "Surface : —"; }
  }

  // Recalcule en gardant la grandeur saisie en dernier (force prioritaire).
  function recalcRow(rowEl, source) {
    var forme = rowEl.querySelector(".comp-forme").value;
    var d1 = rowEl.querySelector(".comp-d1").value;
    var d2 = rowEl.querySelector(".comp-d2").value;
    var s = surfaceMm2(forme, d1, d2);
    var fEl = rowEl.querySelector(".comp-force");
    var rEl = rowEl.querySelector(".comp-rc");
    if (source === "force") {
      if (s > 0 && fEl.value !== "") { rEl.value = round2(rcFromForce(fEl.value, s)); }
    } else if (source === "rc") {
      if (s > 0 && rEl.value !== "") { fEl.value = round1(forceFromRc(rEl.value, s)); }
    } else {
      // changement de dimension ou de forme : on garde la force si presente.
      if (s > 0 && fEl.value !== "") { rEl.value = round2(rcFromForce(fEl.value, s)); }
      else if (s > 0 && rEl.value !== "") { fEl.value = round1(forceFromRc(rEl.value, s)); }
    }
    updateSurfaceDisplay(rowEl);
  }

  function relabelRow(rowEl) {
    var isCyl = rowEl.querySelector(".comp-forme").value === "cylindre";
    rowEl.querySelector(".comp-l1").textContent = isCyl ? "Ø (mm)" : "Larg. (mm)";
    rowEl.querySelector(".comp-l2").textContent = isCyl ? "Haut. (mm)" : "Long. (mm)";
  }

  function applyDefaultsAll() {
    var rowsBox = $("comp-rows");
    if (!rowsBox) { return; }
    var rows = rowsBox.querySelectorAll(".comp-row");
    for (var i = 0; i < rows.length; i++) {
      var isCyl = rows[i].querySelector(".comp-forme").value === "cylindre";
      var def = isCyl ? DEF_CYL : DEF_CUBE;
      rows[i].querySelector(".comp-d1").value = def.d1;
      rows[i].querySelector(".comp-d2").value = def.d2;
      recalcRow(rows[i], "dim");
    }
  }

  function gatherEssais() {
    var rowsBox = $("comp-rows");
    if (!rowsBox) { return []; }
    var rows = rowsBox.querySelectorAll(".comp-row");
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var forme = r.querySelector(".comp-forme").value;
      var d1 = r.querySelector(".comp-d1").value;
      var d2 = r.querySelector(".comp-d2").value;
      var force = r.querySelector(".comp-force").value;
      var rc = r.querySelector(".comp-rc").value;
      var s = surfaceMm2(forme, d1, d2);
      out.push({
        code: r.getAttribute("data-code"),
        forme: forme,
        dim1: d1 === "" ? "" : num(d1),
        dim2: d2 === "" ? "" : num(d2),
        surface: Math.round(s),
        masse: r.querySelector(".comp-masse").value === "" ? "" : num(r.querySelector(".comp-masse").value),
        dateEssai: r.querySelector(".comp-date").value,
        force: force === "" ? "" : num(force),
        rc: rc === "" ? "" : num(rc),
        observation: r.querySelector(".comp-obs").value.trim()
      });
    }
    return out;
  }

  function compResult(html, isError) {
    var box = $("comp-detail-result");
    if (!box) { return; }
    box.hidden = false;
    box.className = "result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function saveDraft() {
    if (!_editLot) { return; }
    _editLot.essais = gatherEssais();
    CAEKDB.updateLot(_editLot).then(function () {
      compResult("&#10004; Brouillon d'essai enregistré.", false);
    }).catch(function (err) { compResult("&#9888; " + escapeHtml(err && err.message || err), true); });
  }

  function validate() {
    if (!_editLot) { return; }
    var prof = window.CAEKProfil
      ? CAEKProfil.require("Profil opérateur requis pour valider un essai de compression.")
      : { nom: "", qualification: "" };
    if (!prof) { return; }

    var essais = gatherEssais();
    var bad = "";
    for (var i = 0; i < essais.length; i++) {
      var e = essais[i];
      if (!(num(e.dim1) > 0) || !(num(e.dim2) > 0)) { bad = "Dimensions manquantes pour " + e.code + "."; break; }
      if (!e.dateEssai) { bad = "Date d'essai manquante pour " + e.code + "."; break; }
      if (!(num(e.force) > 0) && !(num(e.rc) > 0)) { bad = "Force ou Rc manquant pour " + e.code + "."; break; }
    }
    if (bad) { compResult("&#9888; " + escapeHtml(bad), true); return; }
    if (!window.confirm("Valider l'essai de ce lot (" + essais.length + " éprouvette(s)) ?\nLe lot rejoindra l'historique des essais.")) { return; }

    _editLot.essais = essais;
    _editLot.statut = "teste";
    _editLot.dateEssai = todayStr();
    _editLot.heureEssai = nowTime();
    _editLot.operateurEssai = prof.nom || "";
    _editLot.qualificationEssai = prof.qualification || "";

    CAEKDB.updateLot(_editLot).then(function () {
      return CAEKDB.addJournal({
        type: "essai", ref: _editLot.ref, lotId: _editLot.id,
        operateur: prof.nom || "", qualification: prof.qualification || "",
        nbEprouvettes: essais.length
      });
    }).then(function () {
      $("comp-detail").hidden = true;
      refresh();
      if (window.CAEKBadges) { CAEKBadges.refresh(); }
    }).catch(function (err) { compResult("&#9888; " + escapeHtml(err && err.message || err), true); });
  }

  /* ============================================================
     HISTORIQUE DES ESSAIS
     ============================================================ */

  // Periode de filtrage saisie (du / au), par date d'essai du lot.
  function getPeriode() {
    return {
      du: ($("comp-hist-du") && $("comp-hist-du").value) || "",
      au: ($("comp-hist-au") && $("comp-hist-au").value) || ""
    };
  }
  function inPeriode(dateStr, per) {
    var d = String(dateStr || "").slice(0, 10);
    if (!d) { return !per.du && !per.au; }
    if (per.du && d < per.du) { return false; }
    if (per.au && d > per.au) { return false; }
    return true;
  }
  // Lots testes filtres par la periode (date d'essai du lot).
  function filteredHistLots() {
    var per = getPeriode();
    return _historique.filter(function (l) { return inPeriode(l.dateEssai, per); });
  }

  function renderHistorique() {
    var box = $("comp-historique-liste");
    if (!box) { return; }
    var lots = filteredHistLots();
    if ($("comp-historique-count")) { $("comp-historique-count").textContent = lots.length + " lot(s) testé(s)"; }
    if (!_historique.length) {
      box.innerHTML = "<p class=\"screen-placeholder\">Aucun essai enregistré pour l'instant.</p>";
      return;
    }
    if (!lots.length) {
      box.innerHTML = "<p class=\"screen-placeholder\">Aucun essai sur la période sélectionnée.</p>";
      return;
    }
    box.innerHTML = lots.map(function (l) {
      var essais = Array.isArray(l.essais) ? l.essais : [];
      var lignes = essais.map(function (e) {
        var age = diffDays(l.dateCoulage, e.dateEssai);
        return "<tr><td>" + escapeHtml(e.code) + "</td>" +
          "<td>" + escapeHtml(formeLabel(e.forme)) + "</td>" +
          "<td>" + dimsLabel(e) + "</td>" +
          "<td>" + (e.masse === "" || e.masse == null ? "—" : e.masse) + "</td>" +
          "<td>" + (e.force === "" || e.force == null ? "—" : e.force) + "</td>" +
          "<td><strong>" + (e.rc === "" || e.rc == null ? "—" : e.rc) + "</strong></td>" +
          "<td>" + fmtDate(e.dateEssai) + (age === "" ? "" : " (" + age + "j)") + "</td>" +
          "<td>" + escapeHtml(e.observation || "") + "</td></tr>";
      }).join("");
      return "<div class=\"comp-hist-item\">" +
        "<div class=\"rep-top\"><span class=\"rep-ref\">&#10004; " + escapeHtml(l.ref) + "</span>" +
        "<span class=\"comp-type\">" + escapeHtml(l.age === "autre" ? l.ageJours + "j" : l.age) +
        " · essai le " + escapeHtml(fmtDate(l.dateEssai)) + "</span></div>" +
        "<div class=\"rep-ent\">" + escapeHtml(l.client || "—") + "</div>" +
        "<div class=\"rep-sub\">" + escapeHtml(l.nomProjet || "") +
        (l.ouvrage ? " · " + escapeHtml(l.ouvrage) : "") + "</div>" +
        "<div class=\"comp-hist-table-wrap\"><table class=\"comp-hist-table\">" +
        "<thead><tr><th>Code</th><th>Type</th><th>Dim.</th><th>Masse</th><th>F (kN)</th><th>Rc</th><th>Date (âge)</th><th>Obs.</th></tr></thead>" +
        "<tbody>" + lignes + "</tbody></table></div>" +
        "<div class=\"comp-hist-meta\">Opérateur : " + escapeHtml(l.operateurEssai || "—") +
        (l.qualificationEssai ? " (" + escapeHtml(l.qualificationEssai) + ")" : "") + "</div>" +
        "</div>";
    }).join("");
  }

  var HIST_HEADERS = ["Référence", "Code éprouvette", "Client", "Projet", "Ouvrage", "Âge (j)",
    "Type", "Dimensions (mm)", "Masse (kg)", "Force (kN)", "Rc (MPa)", "Date essai", "Opérateur", "Observation"];

  function dimsText(e) {
    if (e.forme === "cylindre") { return "Ø" + (e.dim1 || "?") + "×" + (e.dim2 || "?"); }
    return (e.dim1 || "?") + "×" + (e.dim2 || "?");
  }

  function histRows() {
    var rows = [];
    filteredHistLots().forEach(function (l) {
      (Array.isArray(l.essais) ? l.essais : []).forEach(function (e) {
        rows.push([
          l.ref, e.code, l.client || "", l.nomProjet || "", l.ouvrage || "",
          diffDays(l.dateCoulage, e.dateEssai), formeLabel(e.forme), dimsText(e),
          e.masse === "" ? "" : e.masse, e.force === "" ? "" : e.force, e.rc === "" ? "" : e.rc,
          e.dateEssai || "", l.operateurEssai || "", e.observation || ""
        ]);
      });
    });
    return rows;
  }

  /* ---------- Partage texte de l'historique (message + presse-papiers) ---------- */

  // Etendue reelle des dates d'essai presentes (pour l'en-tete du message).
  function periodeLabel() {
    var per = getPeriode();
    if (per.du || per.au) {
      return "du " + (per.du ? fmtDate(per.du) : "…") + " au " + (per.au ? fmtDate(per.au) : "…");
    }
    var dates = [];
    filteredHistLots().forEach(function (l) {
      (Array.isArray(l.essais) ? l.essais : []).forEach(function (e) {
        if (e.dateEssai) { dates.push(String(e.dateEssai).slice(0, 10)); }
      });
    });
    if (!dates.length) { return ""; }
    dates.sort();
    return "du " + fmtDate(dates[0]) + " au " + fmtDate(dates[dates.length - 1]);
  }

  function buildHistMessage() {
    var lots = filteredHistLots();
    var lignes = [];
    lots.forEach(function (l) {
      (Array.isArray(l.essais) ? l.essais : []).forEach(function (e) {
        var age = diffDays(l.dateCoulage, e.dateEssai);
        lignes.push("- " + e.code +
          " | " + (age === "" ? (l.age === "autre" ? l.ageJours + "j" : l.age) : age + "j") +
          " | " + formeLabel(e.forme) +
          " | Rc = " + (e.rc === "" || e.rc == null ? "—" : e.rc) + " MPa" +
          " | Force = " + (e.force === "" || e.force == null ? "—" : e.force) + " kN" +
          " | Date essai " + fmtDate(e.dateEssai));
      });
    });
    var per = periodeLabel();
    var entete = "Historique des essais de compression" + (per ? " " + per : "");
    var pied = lignes.length + " éprouvette(s) testée(s) — CAEK Engineering Lab.";
    return entete + "\n" + (lignes.length ? lignes.join("\n") : "Aucun essai sur la période.") + "\n" + pied;
  }

  function histResult(html, isError) {
    var box = $("comp-hist-result");
    if (!box) { return; }
    box.hidden = false;
    box.className = "result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function shareHistorique() {
    if (!histRows().length) { histResult("&#9888; Aucun essai à partager sur cette période.", true); return; }
    var texte = buildHistMessage();
    var titre = "Historique essais de compression CAEK";
    if (navigator.share) {
      navigator.share({ title: titre, text: texte }).then(function () {
        histResult("&#10004; Historique partagé.", false);
      }).catch(function (err) {
        if (err && err.name === "AbortError") { return; }
        copyHist(texte);
      });
      return;
    }
    copyHist(texte);
  }

  function copyHist(texte) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texte).then(
        function () { histResult("&#10004; Historique copié dans le presse-papiers.", false); },
        function () { window.prompt("Copier l'historique :", texte); });
    } else {
      window.prompt("Copier l'historique :", texte);
    }
  }

  function exportHistoriqueXls() {
    var rows = histRows();
    if (!rows.length) { window.alert("Aucun essai à exporter."); return; }
    if (!window.XLSX) { window.alert("Module Excel indisponible."); return; }
    var aoa = [HIST_HEADERS].concat(rows);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 7 },
      { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 9 }, { wch: 12 }, { wch: 18 }, { wch: 24 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Essais compression");
    XLSX.writeFile(wb, "essais_compression.xlsx");
  }

  /* ============================================================
     INITIALISATION
     ============================================================ */
  function init() {
    var aBox = $("comp-atester-liste");
    if (aBox) {
      aBox.addEventListener("click", function (ev) {
        var b = ev.target.closest ? ev.target.closest(".comp-lot-card") : null;
        if (b) { openLotTest(intOr0(b.getAttribute("data-id"))); }
      });
    }

    var overlay = $("comp-detail");
    if (overlay) {
      overlay.addEventListener("click", function (ev) {
        if (ev.target === overlay) { overlay.hidden = true; return; }
        if (ev.target.closest && ev.target.closest("#comp-detail-close")) { overlay.hidden = true; return; }
        if (ev.target.closest && ev.target.closest("#comp-apply-all")) { applyDefaultsAll(); return; }
        if (ev.target.closest && ev.target.closest("#comp-save-draft")) { saveDraft(); return; }
        if (ev.target.closest && ev.target.closest("#comp-valider")) { validate(); return; }
      });
      overlay.addEventListener("input", function (ev) {
        var row = ev.target.closest ? ev.target.closest(".comp-row") : null;
        if (!row) { return; }
        var t = ev.target;
        if (t.classList.contains("comp-force")) { recalcRow(row, "force"); }
        else if (t.classList.contains("comp-rc")) { recalcRow(row, "rc"); }
        else if (t.classList.contains("comp-d1") || t.classList.contains("comp-d2")) { recalcRow(row, "dim"); }
      });
      overlay.addEventListener("change", function (ev) {
        var row = ev.target.closest ? ev.target.closest(".comp-row") : null;
        if (row && ev.target.classList.contains("comp-forme")) { relabelRow(row); recalcRow(row, "dim"); }
      });
    }

    var expXls = $("comp-hist-export-xls");
    if (expXls) { expXls.addEventListener("click", exportHistoriqueXls); }

    var partager = $("comp-hist-partager");
    if (partager) { partager.addEventListener("click", shareHistorique); }

    // Filtre par periode : re-rendu a chaque changement de date.
    var du = $("comp-hist-du"), au = $("comp-hist-au");
    if (du) { du.addEventListener("change", renderHistorique); }
    if (au) { au.addEventListener("change", renderHistorique); }
    var reset = $("comp-hist-periode-reset");
    if (reset) {
      reset.addEventListener("click", function () {
        if (du) { du.value = ""; }
        if (au) { au.value = ""; }
        var rbox = $("comp-hist-result"); if (rbox) { rbox.hidden = true; }
        renderHistorique();
      });
    }
  }

  return {
    init: init,
    refresh: refresh
  };
})();

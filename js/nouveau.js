/* ============================================================
   Fiche de coulage terrain - CAEK
   nouveau.js - T3 : ecran "Nouveau coulage" + compteur ABAxxx
   Selection projet / code direct / client simple,
   generation de reference, creation d'un brouillon.
   (Le tableau des toupies viendra en T4.)
   ============================================================ */

var CAEKNouveau = (function () {
  "use strict";

  var mode = "projet";          // "projet" | "simple"
  var activeCode = "";          // racine de reference (verrouillee)
  var activeProjet = null;      // snapshot projet si connu

  function $(id) { return document.getElementById(id); }

  function cleanCode(v) {
    return String(v == null ? "" : v).trim().toUpperCase().replace(/\s+/g, "");
  }

  function pad3(n) {
    var s = String(n);
    while (s.length < 3) { s = "0" + s; }
    return s;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------- Remplissage des listes ---------- */

  function refresh() {
    if (!window.CAEKDB) { return; }
    CAEKDB.getAllProjets().then(function (list) {
      _projets = list;
      populateEntreprises();
      // reset affichage
      resetSelection();
    });
  }

  var _projets = [];

  function populateEntreprises() {
    var sel = $("nc-entreprise");
    if (!sel) { return; }
    var noms = {};
    _projets.forEach(function (p) { if (p.entreprise) { noms[p.entreprise] = true; } });
    var liste = Object.keys(noms).sort();
    var html = "<option value=\"\">— Choisir une entreprise —</option>";
    liste.forEach(function (n) {
      html += "<option value=\"" + escapeHtml(n) + "\">" + escapeHtml(n) + "</option>";
    });
    sel.innerHTML = html;
    populateProjets("");
  }

  function populateProjets(entreprise) {
    var sel = $("nc-projet");
    if (!sel) { return; }
    var sous = _projets.filter(function (p) { return !entreprise || p.entreprise === entreprise; });
    sous.sort(function (a, b) { return a.codeProjet.localeCompare(b.codeProjet); });
    var html = "<option value=\"\">— Choisir un projet —</option>";
    sous.forEach(function (p) {
      html += "<option value=\"" + escapeHtml(p.codeProjet) + "\">" +
        escapeHtml(p.codeProjet) + " — " + escapeHtml(p.nomProjet) + "</option>";
    });
    sel.innerHTML = html;
  }

  function resetSelection() {
    activeCode = "";
    activeProjet = null;
    if ($("nc-code-affiche")) { $("nc-code-affiche").textContent = "—"; }
    if ($("nc-ref")) { $("nc-ref").textContent = "—"; }
    if ($("nc-numero")) { $("nc-numero").value = ""; }
    hideWarn();
  }

  /* ---------- Selection du code actif ---------- */

  function setActiveCode(code, projet) {
    activeCode = cleanCode(code);
    activeProjet = projet || null;
    if ($("nc-code-affiche")) { $("nc-code-affiche").textContent = activeCode || "—"; }
    if (!activeCode) { resetSelection(); return; }
    CAEKDB.peekNextNumero(activeCode).then(function (n) {
      if ($("nc-numero")) { $("nc-numero").value = n; }
      recomputeRef();
    });
  }

  function currentNumero() {
    var v = parseInt($("nc-numero") ? $("nc-numero").value : "", 10);
    return isNaN(v) ? null : v;
  }

  function recomputeRef() {
    var num = currentNumero();
    if (!activeCode || num === null || num < 1) {
      if ($("nc-ref")) { $("nc-ref").textContent = "—"; }
      hideWarn();
      return;
    }
    var ref = activeCode + pad3(num);
    if ($("nc-ref")) { $("nc-ref").textContent = ref; }
    CAEKDB.refExists(ref).then(function (exists) {
      if (exists) { showWarn("La référence " + ref + " existe déjà. Changez le numéro."); }
      else { hideWarn(); }
    });
  }

  function showWarn(msg) {
    var w = $("nc-ref-warn");
    if (!w) { return; }
    w.hidden = false;
    w.textContent = "⚠ " + msg;
  }

  function hideWarn() {
    var w = $("nc-ref-warn");
    if (w) { w.hidden = true; w.textContent = ""; }
  }

  /* ---------- Creation du brouillon ---------- */

  function showResult(html, isError) {
    var box = $("nc-result");
    if (!box) { return; }
    box.hidden = false;
    box.className = "result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function creerBrouillon() {
    var num = currentNumero();
    if (!activeCode) {
      showResult("⚠ Choisissez un projet, saisissez un code, ou renseignez un client simple.", true);
      return;
    }
    if (num === null || num < 1) {
      showResult("⚠ Numéro de coulage invalide.", true);
      return;
    }
    var ref = activeCode + pad3(num);

    var coulage = {
      ref: ref,
      codeProjet: activeCode,
      numero: num,
      mode: mode,
      statut: "brouillon",
      dateCreation: new Date().toISOString(),
      // Snapshot identification
      entreprise: "",
      client: "",
      nomProjet: "",
      adresse: "",
      contact: "",
      resistance: ""
    };

    if (mode === "projet") {
      if (activeProjet) {
        coulage.entreprise = activeProjet.entreprise || "";
        coulage.client = activeProjet.client || "";
        coulage.nomProjet = activeProjet.nomProjet || "";
        coulage.adresse = activeProjet.adresse || "";
        coulage.contact = activeProjet.contact || "";
        coulage.resistance = (activeProjet.resistance === undefined ? "" : activeProjet.resistance);
      }
      // Si code direct sans projet connu : on garde juste le code.
    } else {
      var nom = ($("nc-simple-nom") ? $("nc-simple-nom").value : "").trim();
      var lieu = ($("nc-simple-lieu") ? $("nc-simple-lieu").value : "").trim();
      if (!nom) {
        showResult("⚠ Renseignez le nom du client / particulier.", true);
        return;
      }
      coulage.client = nom;
      coulage.entreprise = nom;     // pas d'entreprise structuree
      coulage.nomProjet = lieu;
      coulage.adresse = lieu;
    }

    CAEKDB.saveCoulage(coulage).then(function (res) {
      if (!res.ok) { showResult("⚠ " + escapeHtml(res.error), true); recomputeRef(); return; }
      // Ouvre directement la fiche terrain pour completer le coulage
      if (window.CAEKFiche) { CAEKFiche.open(ref); }
      else { showResult("✔ Brouillon créé : <strong>" + escapeHtml(ref) + "</strong>.", false); }
    }).catch(function (err) {
      showResult("⚠ Erreur d'enregistrement : " + escapeHtml(err && err.message), true);
    });
  }

  /* ---------- Bascule de mode ---------- */

  function setMode(m) {
    mode = (m === "simple") ? "simple" : "projet";
    var btns = document.querySelectorAll("#nc-mode-switch .seg");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("is-active", btns[i].getAttribute("data-mode") === mode);
    }
    if ($("nc-mode-projet")) { $("nc-mode-projet").hidden = (mode !== "projet"); }
    if ($("nc-mode-simple")) { $("nc-mode-simple").hidden = (mode !== "simple"); }
    resetSelection();
    if (mode === "projet") {
      var ent = $("nc-entreprise") ? $("nc-entreprise").value : "";
      var proj = $("nc-projet") ? $("nc-projet").value : "";
      var direct = $("nc-code-direct") ? $("nc-code-direct").value : "";
      if (direct) { setActiveCode(direct, findProjet(cleanCode(direct))); }
      else if (proj) { setActiveCode(proj, findProjet(proj)); }
    } else {
      var sc = $("nc-simple-code") ? $("nc-simple-code").value : "";
      if (sc) { setActiveCode(sc, null); }
    }
  }

  function findProjet(code) {
    for (var i = 0; i < _projets.length; i++) {
      if (_projets[i].codeProjet === code) { return _projets[i]; }
    }
    return null;
  }

  /* ---------- Init (branchement des evenements) ---------- */

  function init() {
    var sw = $("nc-mode-switch");
    if (sw) {
      sw.addEventListener("click", function (ev) {
        var b = ev.target.closest ? ev.target.closest(".seg") : null;
        if (b) { setMode(b.getAttribute("data-mode")); }
      });
    }

    var entSel = $("nc-entreprise");
    if (entSel) {
      entSel.addEventListener("change", function () {
        populateProjets(entSel.value);
        if ($("nc-code-direct")) { $("nc-code-direct").value = ""; }
        resetSelection();
      });
    }

    var projSel = $("nc-projet");
    if (projSel) {
      projSel.addEventListener("change", function () {
        if ($("nc-code-direct")) { $("nc-code-direct").value = ""; }
        if (projSel.value) { setActiveCode(projSel.value, findProjet(projSel.value)); }
        else { resetSelection(); }
      });
    }

    var direct = $("nc-code-direct");
    if (direct) {
      direct.addEventListener("input", function () {
        var code = cleanCode(direct.value);
        if (code) { setActiveCode(code, findProjet(code)); }
        else { resetSelection(); }
      });
    }

    var sc = $("nc-simple-code");
    if (sc) {
      sc.addEventListener("input", function () {
        var code = cleanCode(sc.value);
        if (code) { setActiveCode(code, null); }
        else { resetSelection(); }
      });
    }

    var numEl = $("nc-numero");
    if (numEl) { numEl.addEventListener("input", recomputeRef); }

    var btn = $("nc-creer");
    if (btn) { btn.addEventListener("click", creerBrouillon); }
  }

  return { init: init, refresh: refresh };
})();

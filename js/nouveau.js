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
  var activeClient = null;      // snapshot client lie au projet actif

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
    Promise.all([CAEKDB.getAllClients(), CAEKDB.getAllProjets()]).then(function (out) {
      _clients = out[0] || [];
      _projets = out[1] || [];
      _clientsById = {};
      _clients.forEach(function (c) { _clientsById[c.clientId] = c; });
      populateClients();
      // reset affichage
      resetSelection();
    });
  }

  var _projets = [];
  var _clients = [];
  var _clientsById = {};

  // N'affiche que les clients actifs (par defaut). actif !== false => actif.
  function clientActif(c) { return c && c.actif !== false; }
  function projetActif(p) { return p && p.actif !== false; }

  function findClient(clientId) {
    return clientId && _clientsById[clientId] ? _clientsById[clientId] : null;
  }

  // Libelle d'un client : nom (+ ville si presente).
  function clientLabel(c) {
    if (!c) { return ""; }
    return c.ville ? (c.nom + " — " + c.ville) : c.nom;
  }

  function populateClients() {
    var sel = $("nc-entreprise");
    if (!sel) { return; }
    var liste = _clients.filter(clientActif).slice();
    liste.sort(function (a, b) {
      return String(a.nom || "").localeCompare(String(b.nom || ""));
    });
    var html = "<option value=\"\">— Choisir un client —</option>";
    liste.forEach(function (c) {
      html += "<option value=\"" + escapeHtml(c.clientId) + "\">" +
        escapeHtml(clientLabel(c)) + "</option>";
    });
    sel.innerHTML = html;
    populateProjets("");
  }

  // Liste les projets actifs (filtres par clientId si fourni).
  function populateProjets(clientId) {
    var sel = $("nc-projet");
    if (!sel) { return; }
    var sous = _projets.filter(function (p) {
      if (!projetActif(p)) { return false; }
      return !clientId || p.clientId === clientId;
    });
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
    activeClient = null;
    if ($("nc-code-affiche")) { $("nc-code-affiche").textContent = "—"; }
    if ($("nc-ref")) { $("nc-ref").textContent = "—"; }
    if ($("nc-numero")) { $("nc-numero").value = ""; }
    hideWarn();
  }

  /* ---------- Selection du code actif ---------- */

  function setActiveCode(code, projet) {
    activeCode = cleanCode(code);
    activeProjet = projet || null;
    activeClient = activeProjet ? findClient(activeProjet.clientId) : null;
    // Si on a retrouve un projet : aligne les listes client + projet (recherche par code).
    if (activeProjet) {
      if ($("nc-entreprise") && activeProjet.clientId) {
        if ($("nc-entreprise").value !== activeProjet.clientId) {
          $("nc-entreprise").value = activeProjet.clientId;
          populateProjets(activeProjet.clientId);
        }
      }
      if ($("nc-projet")) { $("nc-projet").value = activeProjet.codeProjet; }
    }
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
      clientId: "",
      entreprise: "",            // = nom du client (retro-compat affichage/export)
      client: "",
      nomProjet: "",
      localisation: "",
      adresse: "",
      ville: "",
      contact: "",
      contactNom: "",
      contactTel: "",
      email: "",
      referenceCommande: "",
      referenceDossier: "",
      resistance: ""
    };

    if (mode === "projet") {
      if (activeProjet) {
        var cli = activeClient || findClient(activeProjet.clientId);
        coulage.clientId = activeProjet.clientId || "";
        coulage.nomProjet = activeProjet.nomProjet || "";
        coulage.localisation = activeProjet.localisation || "";
        coulage.referenceCommande = activeProjet.referenceCommande || "";
        coulage.referenceDossier = activeProjet.referenceDossier || "";
        coulage.resistance = (activeProjet.resistance === undefined ? "" : activeProjet.resistance);
        if (cli) {
          coulage.entreprise = cli.nom || "";
          coulage.client = cli.nom || "";
          coulage.adresse = cli.adresse || "";
          coulage.ville = cli.ville || "";
          coulage.contactNom = cli.contactNom || "";
          coulage.contactTel = cli.contactTel || "";
          coulage.email = cli.email || "";
          coulage.contact = [cli.contactNom, cli.contactTel].filter(Boolean).join(" · ");
        }
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
      coulage.localisation = lieu;
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

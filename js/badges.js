/* ============================================================
   Fiche de coulage terrain - CAEK
   badges.js - V2.01 : pastilles de notification (style Messenger)
   sur les boutons du menu principal.

   Pastilles gerees :
     badge-profil      : profil operateur non renseigne ;
     badge-coulage     : fiches validees avec eprouvettes dont la
                         recuperation/codification n'est pas confirmee ;
     badge-bassin      : coulages prets a repartir (valides + recuperes
                         + non repartis) + lots a sortir (J-2/J-1/retard) ;
     badge-compression : lots sortis pour essai mais pas encore testes.

   Une pastille a 0 est masquee ([hidden]). Recalcul a l'ouverture
   de l'app et a chaque retour au menu (cf. app.js / onScreenShown).
   ============================================================ */

var CAEKBadges = (function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // Difference en jours entre deux dates "YYYY-MM-DD" (b - a).
  function diffDays(a, b) {
    function toD(ymd) {
      var p = String(ymd).slice(0, 10).split("-");
      return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    }
    return Math.round((toD(b) - toD(a)) / 86400000);
  }

  function hasEpr(c) {
    return window.CAEKModel ? CAEKModel.hasEprouvettes(c) : false;
  }

  function recupOk(c) {
    return window.CAEKModel ? CAEKModel.recuperationOk(c) : false;
  }

  // Affiche/masque une pastille. n<=0 -> masquee. n>99 -> "99+".
  function setBadge(id, n) {
    var el = $(id);
    if (!el) { return; }
    n = parseInt(n, 10) || 0;
    if (n <= 0) {
      el.hidden = true;
      el.textContent = "";
    } else {
      el.hidden = false;
      el.textContent = (n > 99) ? "99+" : String(n);
    }
  }

  function isEngagee(c) {
    var st = (c && c.statut) || "brouillon";
    // La validation admin n'est pas bloquante pour le travail du laboratoire.
    // V3 : "soumis" / "valide" ; anciens statuts conserves en compatibilite.
    return st === "soumis" || st === "valide" || st === "validee" || st === "envoyee";
  }

  function num(v) { var s = window.CAEKModel ? CAEKModel.normDigits(v) : String(v == null ? "" : v); var n = parseFloat(s.replace(",", ".")); return isNaN(n) ? 0 : n; }
  function intOr0(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

  function coulageDateStr(c) {
    var d = (c && (c.dateCoulage || c.dateValidation || c.dateCreation)) || "";
    return String(d).slice(0, 10);
  }

  // Une eprouvette de lot est consideree saisie si dimensions + (force ou Rc).
  function essaiFilled(e) {
    return !!e && num(e.dim1) > 0 && num(e.dim2) > 0 && (num(e.force) > 0 || num(e.rc) > 0);
  }
  function filledCount(lot) {
    var essais = Array.isArray(lot.essais) ? lot.essais : [];
    var n = 0;
    for (var i = 0; i < essais.length; i++) { if (essaiFilled(essais[i])) { n++; } }
    return n;
  }

  // Synthese chiffree de toutes les alertes, par module.
  function computeStats(coulages, lots, dechets) {
    var today = todayStr();
    var s = {
      // Coulage
      recup: 0, retardRecup: 0, codif: 0, brouillon: 0,
      // Bassin
      aRepartir: 0, j2: 0, j1: 0, retard: 0, sorti: 0,
      // Dechets
      dechetsStock: 0, dechetsSeuil: 0, dechetsAlerte: 0,
      // Compression
      aTester: 0, incomplet: 0, eprRestantes: 0, testeAuj: 0
    };
    if (dechets) {
      s.dechetsStock = intOr0(dechets.stock);
      s.dechetsSeuil = intOr0(dechets.seuil);
      if (s.dechetsSeuil > 0 && s.dechetsStock >= s.dechetsSeuil) { s.dechetsAlerte = 1; }
    }
    (coulages || []).forEach(function (c) {
      var st = (c && c.statut) || "brouillon";
      if (st === "brouillon") { s.brouillon++; return; }
      if (!isEngagee(c) || !hasEpr(c)) { return; }
      if (!c.eprRecuperees) {
        s.recup++;
        if (diffDays(coulageDateStr(c), today) >= 3) { s.retardRecup++; }
      } else if (!c.codificationConfirmee) {
        s.codif++;
      } else if (!c.bassinReparti) {
        s.aRepartir++;
      }
    });
    (lots || []).forEach(function (l) {
      if (l.statut === "en_bassin") {
        var diff = diffDays(today, l.datePrevue);
        if (diff === 2) { s.j2++; }
        else if (diff === 1) { s.j1++; }
        else if (diff <= 0) { s.retard++; }
      } else if (l.statut === "sorti") {
        s.sorti++;
        // « À tester » seulement si le séchage est terminé (ou forcé) : les
        // lots en séchage restent affichés côté bassin uniquement. Règle de
        // JOUR partagée (sorti le jour J -> prêt le lendemain à 8 h).
        if (CAEKModel.lotPretEssai(l)) { s.aTester++; }
        var f = filledCount(l), n = intOr0(l.nombre);
        if (f > 0 && f < n) { s.incomplet++; }
        s.eprRestantes += Math.max(0, n - f);
      } else if (l.statut === "teste") {
        if (String(l.dateEssai || "").slice(0, 10) === today) { s.testeAuj++; }
      }
    });
    return s;
  }

  /* ---------- Barres de synthese detaillee (par module) ---------- */

  function chip(n, label, sev) {
    return "<span class=\"synth-chip sev-" + sev + "\"><strong>" + n + "</strong> " + label + "</span>";
  }

  function fillBar(el, chips, okText) {
    if (!el) { return; }
    if (!chips.length) {
      el.className = "synthese-bar is-ok";
      el.innerHTML = "<span class=\"synth-ico\">&#10004;</span> " + okText;
      return;
    }
    el.className = "synthese-bar has-alertes";
    el.innerHTML = "<span class=\"synth-ico\">&#128276;</span> " +
      chips.join("<span class=\"synth-sep\">&middot;</span>");
  }

  function coulageChips(s) {
    var c = [];
    if (s.recup) { c.push(chip(s.recup, "à récupérer", "orange")); }
    if (s.retardRecup) { c.push(chip(s.retardRecup, "retard récupération", "red")); }
    if (s.codif) { c.push(chip(s.codif, "codification non confirmée", "orange")); }
    if (s.brouillon) { c.push(chip(s.brouillon, s.brouillon > 1 ? "fiches à valider" : "fiche à valider", "neutral")); }
    return c;
  }
  function bassinChips(s) {
    var c = [];
    if (s.aRepartir) { c.push(chip(s.aRepartir, "à répartir", "orange")); }
    if (s.j2) { c.push(chip(s.j2, "bientôt (J-2)", "orange")); }
    if (s.j1) { c.push(chip(s.j1, "à sortir aujourd'hui (J-1)", "red")); }
    if (s.retard) { c.push(chip(s.retard, "en retard", "red")); }
    if (s.sorti) { c.push(chip(s.sorti, s.sorti > 1 ? "sortis pour essai" : "sorti pour essai", "green")); }
    if (s.dechetsAlerte) { c.push(chip(s.dechetsStock, "déchets à évacuer", "red")); }
    return c;
  }
  function compressionChips(s) {
    var c = [];
    if (s.aTester) { c.push(chip(s.aTester, s.aTester > 1 ? "lots à tester" : "lot à tester", "orange")); }
    if (s.incomplet) { c.push(chip(s.incomplet, s.incomplet > 1 ? "essais incomplets" : "essai incomplet", "red")); }
    if (s.eprRestantes) { c.push(chip(s.eprRestantes, s.eprRestantes > 1 ? "éprouvettes restantes" : "éprouvette restante", "neutral")); }
    if (s.testeAuj) { c.push(chip(s.testeAuj, s.testeAuj > 1 ? "essais aujourd'hui" : "essai aujourd'hui", "green")); }
    return c;
  }

  function renderSyntheses(s) {
    var bars = document.querySelectorAll("[data-synth]");
    for (var i = 0; i < bars.length; i++) {
      var el = bars[i];
      var type = el.getAttribute("data-synth");
      if (type === "coulage") { fillBar(el, coulageChips(s), "Aucune alerte coulage en cours"); }
      else if (type === "bassin") { fillBar(el, bassinChips(s), "Aucune alerte bassin en cours"); }
      else if (type === "compression") { fillBar(el, compressionChips(s), "Aucun essai en attente"); }
    }
  }

  function clearAll() {
    setBadge("badge-coulage", 0);
    setBadge("badge-bassin", 0);
    setBadge("badge-compression", 0);
    setBadge("badge-dechets", 0);
    renderSyntheses(computeStats([], []));
  }

  // Recalcule pastilles + barres de synthese a partir d'IndexedDB.
  function refresh() {
    // Profil : independant de la base.
    var profilManquant = window.CAEKProfil ? !CAEKProfil.isRenseigne() : false;
    setBadge("badge-profil", profilManquant ? 1 : 0);

    if (!window.CAEKDB) { clearAll(); return; }

    Promise.all([
      CAEKDB.getAllCoulages(),
      CAEKDB.getAllLots(),
      CAEKDB.getMeta("dechetsStock"),
      CAEKDB.getMeta("dechetsSeuil")
    ]).then(function (out) {
      var dechets = { stock: out[2], seuil: (out[3] == null) ? 300 : out[3] };
      // Filtre labo (administrateur seulement ; opérateur déjà scopé serveur).
      var flt = function (x) { return !window.CAEKLaboFilter || CAEKLaboFilter.match(x && x.laboId); };
      var s = computeStats((out[0] || []).filter(flt), (out[1] || []).filter(flt), dechets);
      setBadge("badge-coulage", s.recup + s.codif);
      setBadge("badge-bassin", s.aRepartir + s.j2 + s.j1 + s.retard + s.dechetsAlerte);
      setBadge("badge-compression", s.aTester);
      setBadge("badge-dechets", s.dechetsAlerte);
      renderSyntheses(s);
      // Notifications LOCALES (opérateur) à partir de la même synthèse.
      if (window.CAEKNotifLocale) { CAEKNotifLocale.emit(s); }
    }).catch(function () {
      clearAll();
    });
  }

  return {
    setBadge: setBadge,
    refresh: refresh
  };
})();

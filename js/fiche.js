/* ============================================================
   Fiche de coulage terrain - CAEK
   fiche.js - T4 : fiche terrain complete (en-tete + toupies)
   Ouvre un brouillon, permet la saisie, calcule les totaux,
   enregistre dans le coulage local.
   ============================================================ */

var CAEKFiche = (function () {
  "use strict";

  var current = null; // coulage en cours d'edition

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function val(id) { var el = $(id); return el ? el.value : ""; }
  function setVal(id, v) { var el = $(id); if (el) { el.value = (v == null ? "" : v); } }

  function num(v) {
    var n = parseFloat(String(v == null ? "" : v).replace(",", "."));
    return isNaN(n) ? 0 : n;
  }
  function intOr0(v) {
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  }

  function isoDateOnly(iso) {
    if (!iso) { return ""; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return (String(iso).indexOf("-") >= 0 ? String(iso).slice(0, 10) : ""); }
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function currentYear() { return new Date().getFullYear(); }

  /* ---------- Ouverture d'un brouillon ---------- */

  function open(ref) {
    if (!window.CAEKDB) { return; }
    CAEKDB.getCoulage(ref).then(function (c) {
      if (!c) { return; }
      current = c;
      populate();
      if (window.CAEKApp) { CAEKApp.navigate("screen-fiche"); }
    });
  }

  function populate() {
    var c = current;
    if ($("fc-ref-titre")) { $("fc-ref-titre").textContent = c.ref; }
    if ($("fc-ref")) { $("fc-ref").textContent = c.ref; }
    setStatut(c.statut || "brouillon");

    if ($("fc-entreprise")) { $("fc-entreprise").textContent = c.client || c.entreprise || "—"; }
    if ($("fc-projet")) { $("fc-projet").textContent = c.nomProjet || "—"; }

    setVal("fc-date", c.dateCoulage ? c.dateCoulage : "");
    setVal("fc-refdossier", c.referenceDossier || (c.codeProjet ? c.codeProjet + "/" + currentYear() : ""));
    setVal("fc-ouvrage-coule", c.ouvrageCoule);
    setVal("fc-type-beton", c.typeBeton);
    setVal("fc-centrale", c.centrale);
    setVal("fc-classe", c.classeBeton);
    setVal("fc-formulation", c.formulation);
    setVal("fc-type-ouvrage", c.typeOuvrage);
    setVal("fc-zone", c.ouvrageZonePartie);
    setVal("fc-obs", c.observations);
    setVal("fc-prel-par", c.prelevementPar);

    renderToupies(c.toupies && c.toupies.length ? c.toupies : [emptyToupie()]);
    recomputeTotals();
    hideResult();
    setVal("fc-operateur", c.signatureOperateur || "");
    applyLockState();
    if (window.CAEKPhotos) {
      CAEKPhotos.refresh(c.ref, (c.statut || "brouillon") !== "brouillon");
    }
  }

  var STATUT_LABEL = { brouillon: "brouillon", validee: "validée", envoyee: "envoyée" };

  function setStatut(s) {
    var el = $("fc-statut");
    if (!el) { return; }
    el.textContent = STATUT_LABEL[s] || s;
    el.className = "badge badge-" + s;
  }

  // Verrouille la fiche si elle n'est pas en brouillon.
  function applyLockState() {
    var statut = (current && current.statut) || "brouillon";
    var locked = (statut !== "brouillon");

    var fields = document.querySelectorAll("#screen-fiche .field");
    for (var i = 0; i < fields.length; i++) { fields[i].disabled = locked; }

    var addBtn = $("fc-add-toupie");
    var saveBtn = $("fc-save");
    var dels = document.querySelectorAll("#fc-toupies .btn-del");
    for (var j = 0; j < dels.length; j++) { dels[j].style.display = locked ? "none" : ""; }
    if (addBtn) { addBtn.style.display = locked ? "none" : ""; }
    if (saveBtn) { saveBtn.style.display = locked ? "none" : ""; }

    if ($("fc-valid-box")) { $("fc-valid-box").hidden = locked; }
    if ($("fc-locked-box")) { $("fc-locked-box").hidden = !locked; }
    if (locked) {
      if ($("fc-locked-statut")) { $("fc-locked-statut").textContent = STATUT_LABEL[statut] || statut; }
      var line = $("fc-signataire-line");
      if (line) {
        line.textContent = current.signatureOperateur ? (" Signée par : " + current.signatureOperateur) : "";
      }
      // L'operateur (signature) reste lisible mais desactive
      if ($("fc-operateur")) { $("fc-operateur").disabled = true; }
    }
  }

  /* ---------- Toupies ---------- */

  function emptyToupie() {
    return { camion: "", heure: "", quantite: "", affaissement: "", temperature: "", nbEprouvettes: "", observations: "" };
  }

  function renderToupies(list) {
    var box = $("fc-toupies");
    if (!box) { return; }
    box.innerHTML = "";
    list.forEach(function (t) { box.appendChild(buildToupieCard(t)); });
    renumber();
  }

  function buildToupieCard(t) {
    var card = document.createElement("div");
    card.className = "toupie-card";
    card.innerHTML =
      "<div class=\"toupie-head\"><span class=\"toupie-num\">Toupie</span>" +
      "<button type=\"button\" class=\"btn-del\" title=\"Supprimer\">&#10006;</button></div>" +
      "<div class=\"tg\">" +
      fld("camion", "N° camion", "text", t.camion) +
      fld("heure", "Heure prélèv.", "time", t.heure) +
      fld("quantite", "Quantité m³", "number", t.quantite) +
      fld("affaissement", "Affaiss. cm", "number", t.affaissement) +
      fld("temperature", "Temp. °C", "number", t.temperature) +
      fld("nbEprouvettes", "Nb éprouv.", "number", t.nbEprouvettes) +
      "</div>" +
      "<label class=\"field-label\">Observations</label>" +
      "<input class=\"field t-obs\" data-k=\"observations\" type=\"text\" value=\"" + escapeHtml(t.observations) + "\">";
    var del = card.querySelector(".btn-del");
    del.addEventListener("click", function () {
      card.parentNode.removeChild(card);
      if (!$("fc-toupies").children.length) { $("fc-toupies").appendChild(buildToupieCard(emptyToupie())); }
      renumber();
      recomputeTotals();
    });
    card.addEventListener("input", recomputeTotals);
    return card;
  }

  function fld(key, label, type, value) {
    var extra = (type === "number") ? " inputmode=\"decimal\" step=\"any\"" : "";
    return "<div class=\"tg-cell\"><label class=\"field-label\">" + label + "</label>" +
      "<input class=\"field t-in\" data-k=\"" + key + "\" type=\"" + type + "\"" + extra +
      " value=\"" + escapeHtml(value) + "\"></div>";
  }

  function renumber() {
    var cards = $("fc-toupies").querySelectorAll(".toupie-card");
    for (var i = 0; i < cards.length; i++) {
      cards[i].querySelector(".toupie-num").textContent = "Toupie " + (i + 1);
    }
  }

  function collectToupies() {
    var cards = $("fc-toupies").querySelectorAll(".toupie-card");
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var t = emptyToupie();
      var inputs = cards[i].querySelectorAll("[data-k]");
      for (var j = 0; j < inputs.length; j++) {
        t[inputs[j].getAttribute("data-k")] = inputs[j].value.trim();
      }
      // ignore les toupies entierement vides
      var vide = !t.camion && !t.heure && !t.quantite && !t.affaissement && !t.temperature && !t.nbEprouvettes && !t.observations;
      if (!vide) { out.push(t); }
    }
    return out;
  }

  function recomputeTotals() {
    var cards = $("fc-toupies").querySelectorAll(".toupie-card");
    var totQte = 0, totEpr = 0;
    for (var i = 0; i < cards.length; i++) {
      var q = cards[i].querySelector("[data-k='quantite']");
      var e = cards[i].querySelector("[data-k='nbEprouvettes']");
      totQte += num(q ? q.value : 0);
      totEpr += intOr0(e ? e.value : 0);
    }
    if ($("fc-total-qte")) { $("fc-total-qte").textContent = (Math.round(totQte * 100) / 100); }
    if ($("fc-total-epr")) { $("fc-total-epr").textContent = totEpr; }
  }

  /* ---------- Enregistrement ---------- */

  function showResult(html, isError) {
    var box = $("fc-result");
    if (!box) { return; }
    box.hidden = false;
    box.className = "result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }
  function hideResult() { var b = $("fc-result"); if (b) { b.hidden = true; } }

  // Recopie les champs du formulaire dans l'objet "current".
  function gather() {
    current.dateCoulage = val("fc-date");
    current.referenceDossier = val("fc-refdossier").trim();
    current.ouvrageCoule = val("fc-ouvrage-coule").trim();
    current.typeBeton = val("fc-type-beton").trim();
    current.centrale = val("fc-centrale").trim();
    current.classeBeton = val("fc-classe").trim();
    current.formulation = val("fc-formulation").trim();
    current.typeOuvrage = val("fc-type-ouvrage").trim();
    current.ouvrageZonePartie = val("fc-zone").trim();
    current.observations = val("fc-obs").trim();
    current.prelevementPar = val("fc-prel-par").trim();
    current.toupies = collectToupies();
    current.totalQuantite = current.toupies.reduce(function (s, t) { return s + num(t.quantite); }, 0);
    current.totalEprouvettes = current.toupies.reduce(function (s, t) { return s + intOr0(t.nbEprouvettes); }, 0);
    current.dateModification = new Date().toISOString();
  }

  function save() {
    if (!current) { return; }
    gather();
    current.statut = current.statut || "brouillon";
    CAEKDB.updateCoulage(current).then(function () {
      showResult("✔ Brouillon enregistré (" + escapeHtml(current.ref) +
        "). Vous pouvez revenir le compléter plus tard.", false);
    }).catch(function (err) {
      showResult("⚠ Erreur d'enregistrement : " + escapeHtml(err && err.message), true);
    });
  }

  function validate() {
    if (!current) { return; }
    var nom = val("fc-operateur").trim();
    if (!nom) {
      showResult("⚠ Saisissez le nom de l'opérateur avant de valider.", true);
      return;
    }
    if (!confirm("Valider la fiche " + current.ref + " ?\nElle sera verrouillée.")) { return; }
    gather();
    current.signatureOperateur = nom;
    current.statut = "validee";
    current.dateValidation = new Date().toISOString();
    CAEKDB.updateCoulage(current).then(function () {
      setStatut("validee");
      applyLockState();
      if (window.CAEKPhotos) { CAEKPhotos.refresh(current.ref, true); }
      showResult("✅ Fiche validée et verrouillée. Signée par : " + escapeHtml(nom) + ".", false);
    }).catch(function (err) {
      showResult("⚠ Erreur de validation : " + escapeHtml(err && err.message), true);
    });
  }

  function signaler() {
    if (!current) { return; }
    var note = prompt("Décrivez la correction à signaler au bureau :", "");
    if (note == null) { return; }
    note = String(note).trim();
    if (!note) { return; }
    if (!current.corrections) { current.corrections = []; }
    current.corrections.push({ texte: note, date: new Date().toISOString() });
    current.dateModification = new Date().toISOString();
    CAEKDB.updateCoulage(current).then(function () {
      showResult("⚠ Correction signalée (" + current.corrections.length +
        " au total). La fiche reste verrouillée.", false);
    }).catch(function (err) {
      showResult("⚠ Erreur : " + escapeHtml(err && err.message), true);
    });
  }

  /* ---------- Export / Partage (T7) ---------- */

  function exporter() {
    if (!current || !window.CAEKExport) { return; }
    CAEKExport.share(current).then(function (res) {
      if (res.shared || res.downloaded) {
        if (current.statut === "validee") {
          current.statut = "envoyee";
          current.dateEnvoi = new Date().toISOString();
          current.dateModification = new Date().toISOString();
          CAEKDB.updateCoulage(current).then(function () {
            setStatut("envoyee");
            applyLockState();
            if (window.CAEKPhotos) { CAEKPhotos.refresh(current.ref, true); }
          });
        }
        showResult(res.shared
          ? "✅ Fiche partagée. Statut : envoyée."
          : "⬇ Fichier Excel téléchargé." + (current.statut === "envoyee" ? " Statut : envoyée." : ""), false);
      }
    }).catch(function (err) {
      showResult("⚠ Erreur de partage : " + escapeHtml(err && err.message), true);
    });
  }

  function telecharger() {
    if (!current || !window.CAEKExport) { return; }
    try {
      CAEKExport.download(current);
      if (current.statut === "validee") {
        current.statut = "envoyee";
        current.dateEnvoi = new Date().toISOString();
        current.dateModification = new Date().toISOString();
        CAEKDB.updateCoulage(current).then(function () {
          setStatut("envoyee");
          applyLockState();
          if (window.CAEKPhotos) { CAEKPhotos.refresh(current.ref, true); }
        });
      }
      showResult("⬇ Fichier Excel téléchargé.", false);
    } catch (err) {
      showResult("⚠ Erreur de téléchargement : " + escapeHtml(err && err.message), true);
    }
  }

  /* ---------- Init ---------- */

  function init() {
    var add = $("fc-add-toupie");
    if (add) {
      add.addEventListener("click", function () {
        $("fc-toupies").appendChild(buildToupieCard(emptyToupie()));
        renumber();
      });
    }
    var btn = $("fc-save");
    if (btn) { btn.addEventListener("click", save); }
    var btnV = $("fc-valider");
    if (btnV) { btnV.addEventListener("click", validate); }
    var btnS = $("fc-signaler");
    if (btnS) { btnS.addEventListener("click", signaler); }
    var btnE = $("fc-exporter");
    if (btnE) { btnE.addEventListener("click", exporter); }
    var btnT = $("fc-telecharger");
    if (btnT) { btnT.addEventListener("click", telecharger); }
  }

  return { init: init, open: open };
})();

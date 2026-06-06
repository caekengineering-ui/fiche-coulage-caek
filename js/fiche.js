/* Fiche de coulage terrain - CAEK
   fiche.js - V1 : assistant pas-a-pas (projet -> malaxeurs -> recap).
   ============================================================ */
var CAEKFiche = (function () {
  "use strict";

  var current = null;
  var step = "projet";
  var malaxeurIdx = 0;
  var malaxeurDraft = null;
  var pendingMalPhoto = null;
  var selectedFamilies = {};
  var selectedOuvrages = {};
  var ouvragesLocked = false;
  var thumbUrls = [];

  function $(id) { return document.getElementById(id); }
  function val(id) { var e = $(id); return e ? e.value : ""; }
  function setVal(id, v) { var e = $(id); if (e) { e.value = (v == null ? "" : v); } }
  function show(id, b) { var e = $(id); if (e) { e.hidden = !b; } }
  function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? 0 : n; }
  function intOr0(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function todayDate() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function nowTime() { var d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function revokeThumbs() { thumbUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); thumbUrls = []; }

  /* ---- Ouvrages (familles + items) ----
     Source de verite = icons_manifest.json (charge a l'init).
     Le tableau ci-dessous n'est qu'un FALLBACK minimal si le manifest
     est introuvable (1er lancement hors-ligne avant mise en cache). */
  var ICONS = "assets/icons/ouvrages/";
  var OUVRAGE_FAMILIES = [
    { key: "fondation", titre: "Fondation", icone: "fondation.png", items: [
      { key: "semelle", label: "Semelle isolée", icone: "semelle.png" },
      { key: "semelle_filante", label: "Semelle filante", icone: "semelle_filante.png" },
      { key: "radier", label: "Radier", icone: "radier.png" },
      { key: "longrine", label: "Longrine / libage", icone: "longrine.png" },
      { key: "pieu", label: "Pieu", icone: "pieu.png" },
      { key: "plot", label: "Plot", icone: "plot.png" },
      { key: "mur_soutenement", label: "Mur de soutènement", icone: "mur_soutenement.png" },
      { key: "ouvrage_enterre", label: "Ouvrage enterré", icone: "ouvrage_enterre.png" },
      { key: "regard", label: "Regard", icone: "regard.png" },
      { key: "piscine", label: "Piscine", icone: "piscine.png" }
    ]},
    { key: "superstructure", titre: "Superstructure", icone: "superstructure.png", items: [
      { key: "poteau", label: "Poteau", icone: "poteau.png" },
      { key: "voile", label: "Voile", icone: "voile.png" },
      { key: "dalle", label: "Dalle", icone: "dalle.png" },
      { key: "poutre", label: "Poutre", icone: "poutre.png" },
      { key: "escalier", label: "Escalier", icone: "escalier.png" },
      { key: "console_balcon", label: "Console / Balcon", icone: "console_balcon.png" },
      { key: "parapet_acrotere", label: "Parapet / Acrotère", icone: "parapet_acrotere.png" },
      { key: "cuve_bache_eau", label: "Cuve / Bâche à eau", icone: "cuve_bache_eau.png" }
    ]}
  ];

  function basename(p) { p = String(p || ""); return p.slice(p.lastIndexOf("/") + 1); }

  // Charge icons_manifest.json et reconstruit OUVRAGE_FAMILIES + icones eprouvettes.
  function loadIconsManifest() {
    if (!window.fetch) { return; }
    fetch("icons_manifest.json").then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
      if (!m) { return; }
      var byId = {}; (m.elements || []).forEach(function (e) { byId[e.id] = e; });
      var fams = (m.familles || []).map(function (f) {
        return {
          key: f.id, titre: f.label, icone: basename(f.card || f.thumb || (f.id + ".png")),
          items: (f.items || []).map(function (id) {
            var e = byId[id] || {};
            return { key: id, label: e.label || id, icone: basename(e.card || e.thumb || (id + ".png")) };
          })
        };
      });
      if (fams.length) {
        OUVRAGE_FAMILIES = fams;
        if (step === "projet" && current) { renderOuvrages(); }
      }
      var eb = {}; (m.eprouvettes || []).forEach(function (e) { eb[e.id] = e; });
      setEprIcon("cube", eb.moule_cubique);
      setEprIcon("cylindre", eb.moule_cylindrique);
    }).catch(function () {});
  }

  function setEprIcon(key, entry) {
    if (!entry) { return; }
    var img = document.querySelector(".epr-types [data-epr='" + key + "'] .epr-img");
    if (img) { img.src = entry.thumb || entry.card; }
  }

  function ouvrageLabel(k) {
    for (var i = 0; i < OUVRAGE_FAMILIES.length; i++) {
      var it = OUVRAGE_FAMILIES[i].items;
      for (var j = 0; j < it.length; j++) { if (it[j].key === k) { return it[j].label; } }
    }
    return k;
  }
  function familyByKey(k) {
    for (var i = 0; i < OUVRAGE_FAMILIES.length; i++) { if (OUVRAGE_FAMILIES[i].key === k) { return OUVRAGE_FAMILIES[i]; } }
    return null;
  }
  function familyOfItem(ik) {
    for (var i = 0; i < OUVRAGE_FAMILIES.length; i++) {
      var it = OUVRAGE_FAMILIES[i].items;
      for (var j = 0; j < it.length; j++) { if (it[j].key === ik) { return OUVRAGE_FAMILIES[i].key; } }
    }
    return null;
  }

  function renderOuvrages() {
    var box = $("fc-ouvrages"); if (!box) { return; }
    box.innerHTML = "";
    var fw = document.createElement("div"); fw.className = "family-choice";
    OUVRAGE_FAMILIES.forEach(function (fam) {
      var on = !!selectedFamilies[fam.key];
      var b = document.createElement("button");
      b.type = "button";
      b.className = "family-card" + (on ? " is-selected" : "");
      b.setAttribute("data-family", fam.key);
      b.disabled = ouvragesLocked;
      b.innerHTML =
        "<span class=\"family-check\">✓</span>" +
        "<img class=\"family-img\" src=\"" + ICONS + fam.icone + "\" alt=\"\">" +
        "<span class=\"family-name\">" + escapeHtml(fam.titre) + "</span>";
      b.addEventListener("click", function () { toggleFamily(fam.key); });
      fw.appendChild(b);
    });
    box.appendChild(fw);

    var iw = document.createElement("div"); iw.className = "ouvrage-items-wrap";
    var any = false;
    OUVRAGE_FAMILIES.forEach(function (fam) {
      if (!selectedFamilies[fam.key]) { return; }
      any = true;
      var sec = document.createElement("div"); sec.className = "ouvrage-section";
      sec.innerHTML = "<div class=\"ouvrage-section-title\">" + escapeHtml(fam.titre) + "</div>";
      var g = document.createElement("div"); g.className = "ouvrage-grid";
      fam.items.forEach(function (it) {
        var sel = !!selectedOuvrages[it.key];
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ouvrage-item" + (sel ? " is-selected" : "");
        btn.setAttribute("data-ouvrage", it.key);
        btn.disabled = ouvragesLocked;
        btn.innerHTML =
          "<span class=\"ouvrage-check\">✓</span>" +
          "<img class=\"ouvrage-img\" src=\"" + ICONS + it.icone + "\" alt=\"\">" +
          "<span class=\"ouvrage-label\">" + escapeHtml(it.label) + "</span>";
        btn.addEventListener("click", function () { toggleOuvrage(it.key, btn); });
        g.appendChild(btn);
      });
      sec.appendChild(g); iw.appendChild(sec);
    });
    if (!any) { iw.innerHTML = "<p class=\"hint\">Choisissez d'abord une famille ci-dessus.</p>"; }
    box.appendChild(iw);
    updateOuvrageResume();
  }
  function toggleFamily(k) {
    if (ouvragesLocked) { return; }
    if (selectedFamilies[k]) {
      delete selectedFamilies[k];
      var f = familyByKey(k);
      if (f) { f.items.forEach(function (it) { delete selectedOuvrages[it.key]; }); }
    } else { selectedFamilies[k] = true; }
    renderOuvrages();
  }
  function toggleOuvrage(k, btn) {
    if (ouvragesLocked) { return; }
    if (selectedOuvrages[k]) { delete selectedOuvrages[k]; } else { selectedOuvrages[k] = true; }
    var on = !!selectedOuvrages[k];
    btn.classList.toggle("is-selected", on);
    updateOuvrageResume();
  }
  function selectedOuvrageKeys() { return Object.keys(selectedOuvrages).filter(function (k) { return selectedOuvrages[k]; }); }
  function selectedOuvrageLabels() { return selectedOuvrageKeys().map(ouvrageLabel); }
  function updateOuvrageResume() {
    var r = $("fc-ouvrages-resume"); var labels = selectedOuvrageLabels();
    setVal("fc-ouvrage-coule", labels.join(" + "));
    if (!r) { return; }
    if (!labels.length) { r.hidden = true; r.textContent = ""; return; }
    r.hidden = false; r.textContent = "Sélection : " + labels.join(" · ");
  }

  /* ---- Open + step navigation ---- */
  function open(ref) {
    if (!window.CAEKDB) { return; }
    CAEKDB.getCoulage(ref).then(function (c) {
      if (!c) { return; }
      current = c;
      if (!c.malaxeurs) { c.malaxeurs = []; }
      populateProjet();
      var locked = (c.statut || "brouillon") !== "brouillon";
      if (locked || c.malaxeurs.length > 0) { gotoStep("recap"); }
      else { gotoStep("projet"); }
      if (window.CAEKApp) { CAEKApp.navigate("screen-fiche"); }
    });
  }

  var STEP_ORDER = ["projet", "malaxeur", "recap"];
  function updateStepper(s) {
    var idx = STEP_ORDER.indexOf(s); if (idx < 0) { idx = 0; }
    var dots = document.querySelectorAll("#fc-stepper .step-dot");
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle("is-active", i === idx);
      dots[i].classList.toggle("is-done", i < idx);
    }
    var fill = $("fc-stepper-fill");
    if (fill) { fill.style.width = (idx / (STEP_ORDER.length - 1) * 100) + "%"; }
  }

  function gotoStep(s) {
    step = s;
    show("fc-step-projet", s === "projet");
    show("fc-step-malaxeur", s === "malaxeur");
    show("fc-step-recap", s === "recap");
    updateStepper(s);
    if (s === "recap") { renderRecap(); }
    window.scrollTo(0, 0);
  }

  function setStatut(s) {
    var el = $("fc-statut"); if (!el) { return; }
    var lbl = ({ brouillon: "Brouillon", envoyee: "Envoyé" })[s] || s;
    el.textContent = lbl;
    el.className = "badge badge-" + s;
  }

  function populateProjet() {
    var c = current;
    if ($("fc-ref-titre")) { $("fc-ref-titre").textContent = c.ref; }
    if ($("fc-ref")) { $("fc-ref").textContent = c.ref; }
    setStatut(c.statut || "brouillon");
    function ro(id, v) { var e = $(id); if (e) { e.textContent = (v == null || v === "") ? "—" : v; } }
    var av = [c.adresse, c.ville].filter(Boolean).join(" — ");
    var contact = "";
    if (c.contactNom || c.contactTel) {
      contact = c.contactNom || "";
      if (c.contactTel) { contact += (contact ? " — " : "") + "Tél : " + c.contactTel; }
    } else if (c.contact) { contact = c.contact; }
    ro("fc-entreprise", c.client || c.entreprise);
    ro("fc-adresse-ville", av);
    ro("fc-projet", c.nomProjet);
    ro("fc-code-projet", c.codeProjet);
    ro("fc-contact", contact);

    setVal("fc-date", c.dateCoulage || todayDate());

    selectedOuvrages = {};
    (c.ouvrages || []).forEach(function (k) { selectedOuvrages[k] = true; });
    selectedFamilies = {};
    if (c.ouvrageFamilies && c.ouvrageFamilies.length) {
      c.ouvrageFamilies.forEach(function (k) { selectedFamilies[k] = true; });
    } else {
      (c.ouvrages || []).forEach(function (k) { var fk = familyOfItem(k); if (fk) { selectedFamilies[fk] = true; } });
    }
    ouvragesLocked = (c.statut || "brouillon") !== "brouillon";
    renderOuvrages();

    setVal("fc-bloc", c.bloc || "");
    setVal("fc-etage", c.etage || "");
    setOptToggle("fc-bloc-on", "fc-bloc", !!c.bloc);
    setOptToggle("fc-etage-on", "fc-etage", !!c.etage);
    setVal("fc-operateur", c.signatureOperateur || "");
  }

  function gatherProjetStep() {
    current.dateCoulage = val("fc-date") || todayDate();
    current.ouvrages = selectedOuvrageKeys();
    current.ouvrageFamilies = Object.keys(selectedFamilies).filter(function (k) { return selectedFamilies[k]; });
    current.ouvrageCoule = selectedOuvrageLabels().join(" + ");
    current.bloc = val("fc-bloc").trim();
    current.etage = val("fc-etage");
    var parts = [];
    if (current.bloc) { parts.push("Bloc " + current.bloc); }
    if (current.etage) { parts.push(current.etage); }
    current.ouvrageZonePartie = parts.join(" · ");
    current.dateModification = new Date().toISOString();
  }

  /* ---- Malaxeur step ---- */
  function emptyMalaxeur() {
    return {
      heure: nowTime(), quantite: "", affaissement: "", temperature: "",
      numCamion: "", numBL: "",
      preleve: null, eprCube: false, eprCylindre: false, eprNombre: "",
      formulation: { reprise: false, mode: "structure", fournisseur: "", classe: "", ciment: "", dosage: "", dmax: "", adjuvant: "", photoId: null }
    };
  }

  function goMalaxeur(idx) {
    if ((current.statut || "brouillon") !== "brouillon") { return; }
    gatherProjetStep();
    malaxeurIdx = (typeof idx === "number") ? idx : current.malaxeurs.length;
    var existing = current.malaxeurs[malaxeurIdx];
    malaxeurDraft = existing ? JSON.parse(JSON.stringify(existing)) : emptyMalaxeur();
    if (!existing && malaxeurIdx > 0) { malaxeurDraft.formulation.reprise = true; }
    pendingMalPhoto = null;
    populateMalaxeur();
    gotoStep("malaxeur");
  }

  function setSeg(switchId, attr, value) {
    var sw = $(switchId); if (!sw) { return; }
    var btns = sw.querySelectorAll(".seg");
    for (var i = 0; i < btns.length; i++) { btns[i].classList.toggle("is-active", btns[i].getAttribute("data-" + attr) === value); }
  }
  function setEprType(k, on) {
    var b = document.querySelector(".epr-types [data-epr='" + k + "']");
    if (b) { b.classList.toggle("is-selected", on); }
  }
  function setSelectOrAutre(selId, value, preset) {
    var s = $(selId); var a = $(selId + "-autre"); if (!s) { return; }
    if (value && preset.indexOf(value) < 0) {
      s.value = "autre"; if (a) { a.hidden = false; a.value = value; }
    } else {
      s.value = value || ""; if (a) { a.hidden = true; a.value = ""; }
    }
  }
  function readSelectOrAutre(selId) {
    var s = $(selId); var a = $(selId + "-autre"); if (!s) { return ""; }
    if (s.value === "autre") { return a ? a.value.trim() : ""; }
    return s.value;
  }

  function populateMalaxeur() {
    var m = malaxeurDraft;
    if ($("fc-mal-titre")) { $("fc-mal-titre").textContent = "Malaxeur " + pad2(malaxeurIdx + 1); }
    setVal("fc-mal-heure", m.heure || nowTime());
    setVal("fc-mal-quantite", m.quantite);
    setVal("fc-mal-affaissement", m.affaissement);
    setVal("fc-mal-temperature", m.temperature);
    setVal("fc-mal-camion", m.numCamion);
    setVal("fc-mal-bl", m.numBL);
    setOptToggle("fc-mal-camion-on", "fc-mal-camion", !!m.numCamion);
    setOptToggle("fc-mal-bl-on", "fc-mal-bl", !!m.numBL);

    setSeg("fc-mal-prel-switch", "prel", m.preleve === true ? "oui" : (m.preleve === false ? "non" : ""));
    show("fc-mal-epr", m.preleve === true);
    setEprType("cube", !!m.eprCube);
    setEprType("cylindre", !!m.eprCylindre);
    setVal("fc-mal-epr-nb", m.eprNombre);

    var showReprise = (malaxeurIdx > 0);
    show("fc-mal-reprise", showReprise);
    if (showReprise) {
      var rep = (m.formulation.reprise !== false);
      setSeg("fc-mal-reprise-switch", "reprise", rep ? "oui" : "non");
      m.formulation.reprise = rep;
      show("fc-mal-form", !rep);
    } else {
      m.formulation.reprise = false;
      show("fc-mal-form", true);
    }
    var mode = m.formulation.mode || "structure";
    setSeg("fc-mal-form-mode", "fmode", mode);
    show("fc-mal-form-structure", mode === "structure");
    show("fc-mal-form-photo", mode === "photo");
    setVal("fc-mal-fournisseur", m.formulation.fournisseur);
    setSelectOrAutre("fc-mal-classe", m.formulation.classe, ["C25/30", "C30/37", "C35/45", "C40/50"]);
    setSelectOrAutre("fc-mal-ciment", m.formulation.ciment, ["CRS", "CPJ"]);
    setSelectOrAutre("fc-mal-dosage", m.formulation.dosage, ["350", "380", "400"]);
    setSelectOrAutre("fc-mal-dmax", m.formulation.dmax, ["15", "25"]);
    setSelectOrAutre("fc-mal-adjuvant", m.formulation.adjuvant, ["Superplastifiant", "Hydrofuge", "Entraîneur d'air"]);
    renderMalFormPhotoPreview();
  }

  function gatherMalaxeur() {
    var m = malaxeurDraft;
    m.heure = val("fc-mal-heure");
    m.quantite = val("fc-mal-quantite");
    m.affaissement = val("fc-mal-affaissement");
    m.temperature = val("fc-mal-temperature");
    m.numCamion = val("fc-mal-camion").trim();
    m.numBL = val("fc-mal-bl").trim();
    m.eprNombre = val("fc-mal-epr-nb");
    if (m.formulation.reprise && malaxeurIdx > 0) {
      var prev = current.malaxeurs[malaxeurIdx - 1];
      if (prev) {
        m.formulation = JSON.parse(JSON.stringify(prev.formulation));
        m.formulation.reprise = true;
      }
    } else {
      m.formulation.reprise = false;
      if (m.formulation.mode === "structure" || !m.formulation.mode) {
        m.formulation.mode = "structure";
        m.formulation.fournisseur = val("fc-mal-fournisseur").trim();
        m.formulation.classe = readSelectOrAutre("fc-mal-classe");
        m.formulation.ciment = readSelectOrAutre("fc-mal-ciment");
        m.formulation.dosage = readSelectOrAutre("fc-mal-dosage");
        m.formulation.dmax = readSelectOrAutre("fc-mal-dmax");
        m.formulation.adjuvant = readSelectOrAutre("fc-mal-adjuvant");
      }
    }
  }

  function saveMalaxeurToCoulage() {
    gatherMalaxeur();
    current.malaxeurs[malaxeurIdx] = malaxeurDraft;
    var attach = Promise.resolve();
    if (pendingMalPhoto && window.CAEKDB && CAEKDB.addPhoto) {
      attach = CAEKDB.addPhoto(current.ref, "formulation", pendingMalPhoto, { malaxeur: malaxeurIdx })
        .then(function (id) { if (typeof id === "number") { malaxeurDraft.formulation.photoId = id; } pendingMalPhoto = null; })
        .catch(function () {});
    }
    return attach.then(function () {
      computeTotals();
      current.dateModification = new Date().toISOString();
      return CAEKDB.updateCoulage(current);
    });
  }

  function computeTotals() {
    var totQ = 0, totE = 0;
    (current.malaxeurs || []).forEach(function (m) {
      totQ += num(m.quantite);
      if (m.preleve === true) { totE += intOr0(m.eprNombre); }
    });
    current.totalQuantite = Math.round(totQ * 100) / 100;
    current.totalEprouvettes = totE;
  }

  function renderMalFormPhotoPreview() {
    var box = $("fc-mal-form-photo-preview"); if (!box) { return; }
    revokeThumbs();
    box.innerHTML = "";
    if (pendingMalPhoto) {
      var u = URL.createObjectURL(pendingMalPhoto); thumbUrls.push(u);
      box.innerHTML = "<div class=\"photo-card\"><img class=\"photo-thumb\" src=\"" + u + "\"><span class=\"photo-cat\">BL/Formulation</span></div>";
    } else if (malaxeurDraft && malaxeurDraft.formulation && malaxeurDraft.formulation.photoId && window.CAEKDB) {
      CAEKDB.getPhotosByRef(current.ref).then(function (list) {
        var p = list.filter(function (x) { return x.id === malaxeurDraft.formulation.photoId; })[0];
        if (!p) { return; }
        var u2 = URL.createObjectURL(p.blob); thumbUrls.push(u2);
        box.innerHTML = "<div class=\"photo-card\"><img class=\"photo-thumb\" src=\"" + u2 + "\"><span class=\"photo-cat\">BL/Formulation</span></div>";
      });
    }
  }

  /* ---- Recap step ---- */
  function fmtDateFr(s) {
    if (!s) { return "—"; }
    var p = String(s).split("-");
    return (p.length === 3) ? (p[2] + "/" + p[1] + "/" + p[0]) : s;
  }
  function renderRecap() {
    computeTotals();
    var c = current;
    var locked = (c.statut || "brouillon") !== "brouillon";
    var html = "";
    html += "<div class=\"ro-grid ro-locked\">";
    html += "<div><span class=\"ro-label\">Client</span><span class=\"ro-val\">" + escapeHtml(c.client || c.entreprise || "—") + "</span></div>";
    html += "<div><span class=\"ro-label\">Projet</span><span class=\"ro-val\">" + escapeHtml(c.nomProjet || "—") + "</span></div>";
    html += "<div><span class=\"ro-label\">Code projet</span><span class=\"ro-val\">" + escapeHtml(c.codeProjet || "—") + "</span></div>";
    html += "<div><span class=\"ro-label\">Réf. coulage</span><span class=\"ro-val\">" + escapeHtml(c.ref || "") + "</span></div>";
    html += "<div><span class=\"ro-label\">Date</span><span class=\"ro-val\">" + fmtDateFr(c.dateCoulage) + "</span></div>";
    html += "<div><span class=\"ro-label\">Ouvrages</span><span class=\"ro-val\">" + escapeHtml(c.ouvrageCoule || "—") + "</span></div>";
    html += "<div><span class=\"ro-label\">Bloc / Étage</span><span class=\"ro-val\">" + escapeHtml(c.ouvrageZonePartie || "—") + "</span></div>";
    html += "<div><span class=\"ro-label\">Malaxeurs</span><span class=\"ro-val\">" + (c.malaxeurs || []).length + "</span></div>";
    html += "<div><span class=\"ro-label\">Quantité totale</span><span class=\"ro-val\">" + (c.totalQuantite || 0) + " m³</span></div>";
    html += "<div><span class=\"ro-label\">Total éprouvettes</span><span class=\"ro-val\">" + (c.totalEprouvettes || 0) + "</span></div>";
    html += "</div>";

    html += "<h3 class=\"block-subtitle\">Détail des malaxeurs</h3>";
    (c.malaxeurs || []).forEach(function (m, i) {
      var f = m.formulation || {};
      var fdesc = f.reprise ? "Idem précédent"
        : [f.fournisseur, f.classe, f.ciment, (f.dosage ? f.dosage + " kg/m³" : ""), (f.dmax ? "Dmax " + f.dmax : ""), f.adjuvant].filter(Boolean).join(" · ");
      var epr = (m.preleve === true)
        ? ((m.eprCube ? "Cube " : "") + (m.eprCylindre ? "Cyl " : "") + (m.eprNombre || 0) + " éprouv.")
        : "Pas de prélèvement";
      html += "<div class=\"recap-mal\">" +
        "<div class=\"recap-mal-head\"><strong>Malaxeur " + pad2(i + 1) + "</strong>" +
        (locked ? "" : " <button type=\"button\" class=\"btn-link recap-mal-edit\" data-idx=\"" + i + "\">Modifier</button>") +
        (locked ? "" : " <button type=\"button\" class=\"btn-link recap-mal-del\" data-idx=\"" + i + "\">Supprimer</button>") +
        "</div>" +
        "<div class=\"recap-mal-body\">" +
        "⏰ " + escapeHtml(m.heure || "—") +
        " · 🚚 " + (m.quantite || 0) + " m³" +
        " · 🔻 " + (m.affaissement || 0) + " cm" +
        " · 🌡️ " + (m.temperature || 0) + "°C" +
        (m.numCamion ? " · 🚛 " + escapeHtml(m.numCamion) : "") +
        (m.numBL ? " · 📄 " + escapeHtml(m.numBL) : "") +
        "<br>🧊 " + escapeHtml(epr) +
        "<br>📄 " + escapeHtml(fdesc || "—") +
        "</div></div>";
    });
    if (!(c.malaxeurs || []).length) { html += "<p class=\"hint\">Aucun malaxeur saisi.</p>"; }

    $("fc-recap").innerHTML = html;

    show("fc-recap-add", !locked);
    setVal("fc-anomalie-texte", (c.anomalie && c.anomalie.texte) || "");
    renderAnomaliePhotos();
    setVal("fc-operateur", c.signatureOperateur || "");

    show("fc-export-box", true);
    show("fc-locked-note", locked);
    if (locked) {
      var sgn = $("fc-signataire-line");
      if (sgn) { sgn.textContent = c.signatureOperateur ? " Signée par : " + c.signatureOperateur : ""; }
      var sv = $("fc-save"); if (sv) { sv.hidden = true; }
    } else {
      var sv2 = $("fc-save"); if (sv2) { sv2.hidden = false; }
    }

    var rec = $("fc-recap");
    rec.querySelectorAll(".recap-mal-edit").forEach(function (b) {
      b.addEventListener("click", function () { goMalaxeur(parseInt(b.getAttribute("data-idx"), 10)); });
    });
    rec.querySelectorAll(".recap-mal-del").forEach(function (b) {
      b.addEventListener("click", function () {
        var idx = parseInt(b.getAttribute("data-idx"), 10);
        if (!confirm("Supprimer le Malaxeur " + pad2(idx + 1) + " ?")) { return; }
        current.malaxeurs.splice(idx, 1);
        computeTotals();
        CAEKDB.updateCoulage(current).then(renderRecap);
      });
    });
  }

  function renderAnomaliePhotos() {
    var box = $("fc-anomalie-photos"); if (!box || !window.CAEKDB || !current) { return; }
    CAEKDB.getPhotosByRef(current.ref).then(function (list) {
      box.innerHTML = "";
      list.filter(function (p) { return p.categorie === "anomalie"; }).forEach(function (p) {
        var u = URL.createObjectURL(p.blob); thumbUrls.push(u);
        box.innerHTML += "<div class=\"photo-card\"><img class=\"photo-thumb\" src=\"" + u + "\"><span class=\"photo-cat\">Anomalie</span></div>";
      });
    });
  }

  /* ---- Events ---- */
  function bindSegSwitch(id, attr, onPick) {
    var sw = $(id); if (!sw) { return; }
    sw.addEventListener("click", function (ev) {
      var b = ev.target.closest ? ev.target.closest(".seg") : null; if (!b) { return; }
      var v = b.getAttribute("data-" + attr);
      var btns = sw.querySelectorAll(".seg");
      for (var i = 0; i < btns.length; i++) { btns[i].classList.toggle("is-active", btns[i] === b); }
      onPick(v);
    });
  }

  // Case a cocher qui revele un champ facultatif (et le vide si decoche).
  function bindOptToggle(checkId, fieldId) {
    var cb = $(checkId); var fld = $(fieldId); if (!cb || !fld) { return; }
    cb.addEventListener("change", function () {
      fld.hidden = !cb.checked;
      if (cb.checked) { fld.focus(); }
      else { fld.value = ""; }
    });
  }
  // Met l'etat de la case selon la presence d'une valeur.
  function setOptToggle(checkId, fieldId, hasValue) {
    var cb = $(checkId); var fld = $(fieldId); if (!cb || !fld) { return; }
    cb.checked = !!hasValue;
    fld.hidden = !hasValue;
  }

  function showResult(html, isError) {
    var box = $("fc-result"); if (!box) { return; }
    box.hidden = false;
    box.className = "result-card " + (isError ? "is-error" : "is-ok");
    box.innerHTML = html;
  }

  function ensureSign() {
    var nom = val("fc-operateur").trim();
    if (!nom) { alert("Saisissez le nom de l'opérateur avant d'envoyer."); return null; }
    current.signatureOperateur = nom;
    return nom;
  }
  function markEnvoyee() {
    current.statut = "envoyee";
    current.dateEnvoi = new Date().toISOString();
    return CAEKDB.updateCoulage(current).then(function () { setStatut("envoyee"); renderRecap(); });
  }

  function init() {
    loadIconsManifest();

    var go = $("fc-go-malaxeur");
    if (go) { go.addEventListener("click", function () { goMalaxeur(); }); }

    bindSegSwitch("fc-mal-prel-switch", "prel", function (v) {
      if (!malaxeurDraft) { return; }
      if (v === "oui") { malaxeurDraft.preleve = true; show("fc-mal-epr", true); }
      else { malaxeurDraft.preleve = false; show("fc-mal-epr", false); }
    });

    var etypes = document.querySelector(".epr-types");
    if (etypes) {
      etypes.addEventListener("click", function (ev) {
        var b = ev.target.closest ? ev.target.closest(".epr-type") : null;
        if (!b || !malaxeurDraft) { return; }
        var k = b.getAttribute("data-epr");
        var key = (k === "cube") ? "eprCube" : "eprCylindre";
        malaxeurDraft[key] = !malaxeurDraft[key];
        b.classList.toggle("is-selected", malaxeurDraft[key]);
      });
    }

    bindSegSwitch("fc-mal-reprise-switch", "reprise", function (v) {
      if (!malaxeurDraft) { return; }
      malaxeurDraft.formulation.reprise = (v === "oui");
      show("fc-mal-form", v !== "oui");
    });

    bindSegSwitch("fc-mal-form-mode", "fmode", function (v) {
      if (!malaxeurDraft) { return; }
      malaxeurDraft.formulation.mode = v;
      show("fc-mal-form-structure", v === "structure");
      show("fc-mal-form-photo", v === "photo");
      // Clic utilisateur sur "Photo BL" : ouvrir directement l'appareil photo.
      if (v === "photo" && !pendingMalPhoto) {
        var inp = $("fc-mal-form-photo-input");
        if (inp) { inp.click(); }
      }
    });

    // Champs facultatifs : la case a cocher ouvre le champ (et le vide si decoche).
    bindOptToggle("fc-mal-camion-on", "fc-mal-camion");
    bindOptToggle("fc-mal-bl-on", "fc-mal-bl");
    bindOptToggle("fc-bloc-on", "fc-bloc");
    bindOptToggle("fc-etage-on", "fc-etage");

    ["fc-mal-classe", "fc-mal-ciment", "fc-mal-dosage", "fc-mal-dmax", "fc-mal-adjuvant"].forEach(function (id) {
      var s = $(id); if (!s) { return; }
      s.addEventListener("change", function () { var a = $(id + "-autre"); if (a) { a.hidden = (s.value !== "autre"); } });
    });

    var pi = $("fc-mal-form-photo-input");
    if (pi) {
      pi.addEventListener("change", function () {
        var f = pi.files && pi.files[0]; pi.value = "";
        if (!f) { return; }
        var p = (window.CAEKPhotos && CAEKPhotos.compress) ? CAEKPhotos.compress(f) : Promise.resolve(f);
        p.then(function (blob) { pendingMalPhoto = blob; renderMalFormPhotoPreview(); })
          .catch(function (e) { alert("Photo : " + (e && e.message || e)); });
      });
    }

    var cont = $("fc-mal-continuer");
    if (cont) {
      cont.addEventListener("click", function () {
        saveMalaxeurToCoulage().then(function () {
          malaxeurIdx = current.malaxeurs.length;
          malaxeurDraft = emptyMalaxeur();
          if (malaxeurIdx > 0) { malaxeurDraft.formulation.reprise = true; }
          pendingMalPhoto = null;
          populateMalaxeur();
          window.scrollTo(0, 0);
        });
      });
    }
    var term = $("fc-mal-terminer");
    if (term) {
      term.addEventListener("click", function () {
        if (!window.confirm("Confirmez-vous que le coulage est bien terminé ?")) { return; }
        saveMalaxeurToCoulage().then(function () { gotoStep("recap"); });
      });
    }
    var ann = $("fc-mal-annuler");
    if (ann) { ann.addEventListener("click", function () { gotoStep((current.malaxeurs || []).length ? "recap" : "projet"); }); }

    var add = $("fc-recap-add");
    if (add) { add.addEventListener("click", function () { goMalaxeur(); }); }

    var apx = $("fc-anomalie-photo-input");
    if (apx) {
      apx.addEventListener("change", function () {
        var f = apx.files && apx.files[0]; apx.value = "";
        if (!f || !current) { return; }
        var p = (window.CAEKPhotos && CAEKPhotos.compress) ? CAEKPhotos.compress(f) : Promise.resolve(f);
        p.then(function (b) { return CAEKDB.addPhoto(current.ref, "anomalie", b); })
          .then(renderAnomaliePhotos)
          .catch(function (e) { alert("Photo : " + (e && e.message || e)); });
      });
    }
    var atx = $("fc-anomalie-texte");
    if (atx) {
      atx.addEventListener("input", function () {
        if (!current) { return; }
        if (!current.anomalie) { current.anomalie = {}; }
        current.anomalie.texte = atx.value;
      });
    }

    var sv = $("fc-save");
    if (sv) {
      sv.addEventListener("click", function () {
        if (!current) { return; }
        gatherProjetStep();
        current.signatureOperateur = val("fc-operateur").trim();
        current.statut = current.statut || "brouillon";
        computeTotals();
        CAEKDB.updateCoulage(current).then(function () {
          showResult("✔ Brouillon enregistré (" + current.ref + ").", false);
        }).catch(function (err) { showResult("⚠ " + (err && err.message || err), true); });
      });
    }

    var msg = $("fc-copy-msg");
    if (msg) {
      msg.addEventListener("click", function () {
        if (!window.CAEKExport) { return; }
        var t = CAEKExport.buildMessage(current);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(function () { showResult("✔ Message récap copié.", false); },
            function () { prompt("Copier le message :", t); });
        } else { prompt("Copier le message :", t); }
      });
    }
    var zip = $("fc-zip");
    if (zip) {
      zip.addEventListener("click", function () {
        if (!ensureSign()) { return; }
        gatherProjetStep(); computeTotals();
        CAEKExport.downloadZip(current).then(markEnvoyee)
          .catch(function (err) { showResult("⚠ ZIP : " + (err && err.message || err), true); });
      });
    }
    var exp = $("fc-exporter");
    if (exp) {
      exp.addEventListener("click", function () {
        if (!ensureSign()) { return; }
        gatherProjetStep(); computeTotals();
        CAEKExport.share(current).then(function (res) { if (res.shared || res.downloaded) { return markEnvoyee(); } })
          .catch(function (err) { showResult("⚠ " + (err && err.message || err), true); });
      });
    }
    var dl = $("fc-telecharger");
    if (dl) {
      dl.addEventListener("click", function () {
        if (!ensureSign()) { return; }
        gatherProjetStep(); computeTotals();
        try { CAEKExport.download(current); markEnvoyee(); }
        catch (err) { showResult("⚠ " + (err && err.message || err), true); }
      });
    }
  }

  return { init: init, open: open };
})();

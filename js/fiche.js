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
  var audioUrls = [];
  var mediaRec = null;
  var audioChunks = [];
  var audioTimer = null;
  var audioStartTs = 0;

  function $(id) { return document.getElementById(id); }
  function val(id) { var e = $(id); return e ? e.value : ""; }
  function setVal(id, v) { var e = $(id); if (e) { e.value = (v == null ? "" : v); } }
  function show(id, b) { var e = $(id); if (e) { e.hidden = !b; } }
  function num(v) { var s = window.CAEKModel ? CAEKModel.normDigits(v) : String(v == null ? "" : v); var n = parseFloat(s.replace(",", ".")); return isNaN(n) ? 0 : n; }
  function intOr0(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function todayDate() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function nowTime() { var d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function revokeThumbs() { thumbUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); thumbUrls = []; }

  // Nom de l'operateur a utiliser par defaut : profil global s'il est renseigne.
  function profilNom() {
    return (window.CAEKProfil && CAEKProfil.isRenseigne()) ? CAEKProfil.get().nom : "";
  }
  // Affiche la qualification du profil sous le champ operateur (indicatif).
  function refreshOperateurHint() {
    var h = $("fc-operateur-hint"); if (!h) { return; }
    var p = (window.CAEKProfil && CAEKProfil.isRenseigne()) ? CAEKProfil.get() : null;
    if (p && p.qualification) { h.hidden = false; h.textContent = "Profil : " + p.qualification + " (pré-rempli, modifiable)."; }
    else if (p) { h.hidden = false; h.textContent = "Pré-rempli depuis le profil opérateur (modifiable)."; }
    else { h.hidden = false; h.textContent = "Astuce : renseignez votre profil pour pré-remplir ce champ."; }
  }

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
    }).catch(function () {});
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
      if (!locked && c.statutSaisie === "incomplete" && c.saisieEnCours && c.saisieEnCours.malaxeur) {
        malaxeurIdx = intOr0(c.saisieEnCours.index);
        malaxeurDraft = JSON.parse(JSON.stringify(c.saisieEnCours.malaxeur));
        if (!malaxeurDraft.formulation) { malaxeurDraft.formulation = emptyMalaxeur().formulation; }
        pendingMalPhoto = null;
        populateMalaxeur();
        gotoStep("malaxeur");
      } else if (locked || c.malaxeurs.length > 0) { gotoStep("recap"); }
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

  // Bouton "Retour" de l'en-tete : recule d'une etape, sinon revient au
  // sous-menu Coulage beton (respect de la hierarchie de navigation).
  function goBack() {
    stopAudioIfRecording();
    if (step === "malaxeur") {
      gotoStep((current && current.malaxeurs && current.malaxeurs.length) ? "recap" : "projet");
    } else {
      gotoCoulageMenu();
    }
  }
  function gotoCoulageMenu() {
    stopAudioIfRecording();
    if (window.CAEKApp) { CAEKApp.navigate("screen-coulage"); }
  }
  function gotoAccueil() {
    stopAudioIfRecording();
    if (window.CAEKApp) { CAEKApp.navigate("screen-accueil"); }
  }

  function setStatut(s) {
    var el = $("fc-statut"); if (!el) { return; }
    var lbl = ({ brouillon: "Brouillon", soumis: "Soumis", valide: "Validé", validee: "Validée", envoyee: "Envoyé" })[s] || s;
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
    setSeg("fc-mode-coulage", "mode-coulage", c.modeCoulage || "");
    setVal("fc-mode-coulage-autre", c.modeCoulageAutre || "");
    show("fc-mode-coulage-autre", c.modeCoulage === "autre");

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

    setVal("fc-ouvrage-autre", c.ouvrageAutre || "");
    setOptToggle("fc-ouvrage-autre-on", "fc-ouvrage-autre", !!c.ouvrageAutre);

    setVal("fc-bloc", c.bloc || "");
    setVal("fc-etage", c.etage || "");
    setVal("fc-partie", c.partie || "");
    setOptToggle("fc-bloc-on", "fc-bloc", !!c.bloc);
    setOptToggle("fc-etage-on", "fc-etage", !!c.etage);
    setOptToggle("fc-partie-on", "fc-partie", !!c.partie);

    // Phase 2 : centrale + formulation portées par le COULAGE.
    if (window.CAEKCentrales) { CAEKCentrales.fillSelect(); }
    populateFormulationModele();
    var centrales = window.CAEKCentrales ? CAEKCentrales.getCached().map(function (x) { return x.nom; }) : [];
    setSelectOrAutre("fc-centrale", c.centrale || "", centrales);
    if ($("fc-formulation-modele")) { $("fc-formulation-modele").value = c.formulationId || ""; }
    setVal("fc-quantite-estimee", c.quantiteEstimee == null ? "" : c.quantiteEstimee);
    updateSamplingRecommendation(c.quantiteEstimee);

    setVal("fc-operateur", c.signatureOperateur || profilNom());
    refreshOperateurHint();
  }

  // Options du sélecteur de formulation (niveau coulage) depuis le catalogue.
  function populateFormulationModele() {
    var sel = $("fc-formulation-modele");
    if (!sel || !window.CAEKFormulations) { return; }
    var cur = sel.value;
    var html = "<option value=\"\">— Choisir un modèle —</option>";
    var byFour = {};
    CAEKFormulations.getCached().forEach(function (f) {
      var k = f.fournisseur || "Autres";
      (byFour[k] = byFour[k] || []).push(f);
    });
    Object.keys(byFour).sort().forEach(function (four) {
      html += "<optgroup label=\"" + escapeHtml(four) + "\">";
      byFour[four].forEach(function (f) {
        html += "<option value=\"" + escapeHtml(f.id) + "\">" + escapeHtml(four) + " — " + escapeHtml(f.nom) + "</option>";
      });
      html += "</optgroup>";
    });
    sel.innerHTML = html;
    if (cur) { sel.value = cur; }
  }

  function updateSamplingRecommendation(value) {
    var box = $("fc-recommandation-epr");
    if (!box || !window.CAEKModel || !CAEKModel.loadLaboSettings) { return; }
    var q = num(value);
    if (q <= 0) { box.hidden = true; box.textContent = ""; return; }
    CAEKModel.loadLaboSettings(current && current.laboId).then(function (settings) {
      if (!current) { return; }
      var n = CAEKModel.recommendationEprouvettes(q, settings);
      current.recommandationEprouvettes = n;
      current.regleEchantillonnage = settings;
      box.hidden = false;
      box.innerHTML = "&#129514; Recommandation du laboratoire : <strong>" + n +
        " éprouvettes</strong> pour " + q + " m³.";
    });
  }

  function gatherProjetStep() {
    current.dateCoulage = val("fc-date") || todayDate();
    current.modeCoulage = segActive("fc-mode-coulage", "mode-coulage");
    current.modeCoulageAutre = current.modeCoulage === "autre" ? val("fc-mode-coulage-autre").trim() : "";
    current.ouvrages = selectedOuvrageKeys();
    current.ouvrageFamilies = Object.keys(selectedFamilies).filter(function (k) { return selectedFamilies[k]; });
    var labels = selectedOuvrageLabels();
    current.ouvrageAutre = ($("fc-ouvrage-autre-on") && $("fc-ouvrage-autre-on").checked) ? val("fc-ouvrage-autre").trim() : "";
    if (current.ouvrageAutre) { labels = labels.concat(["Autres : " + current.ouvrageAutre]); }
    current.ouvrageCoule = labels.join(" + ");
    current.bloc = val("fc-bloc").trim();
    current.etage = val("fc-etage");
    current.partie = ($("fc-partie-on") && $("fc-partie-on").checked) ? val("fc-partie").trim() : "";
    var parts = [];
    if (current.bloc) { parts.push("Bloc " + current.bloc); }
    if (current.etage) { parts.push(current.etage); }
    if (current.partie) { parts.push(current.partie); }
    current.ouvrageZonePartie = parts.join(" · ");
    // Phase 2 : centrale + formulation + quantité estimée au niveau coulage ;
    // désignation TERRAIN séparée de la désignation OFFICIELLE (posée à la
    // validation/au bureau, jamais écrasée ici).
    current.centrale = readSelectOrAutre("fc-centrale");
    current.formulationId = val("fc-formulation-modele") || "";
    current.quantiteEstimee = val("fc-quantite-estimee").trim();
    if (window.CAEKModel && current.regleEchantillonnage) {
      current.recommandationEprouvettes = CAEKModel.recommendationEprouvettes(
        current.quantiteEstimee, current.regleEchantillonnage);
    }
    current.designationTerrain = current.ouvrageCoule || "";
    current.dateModification = new Date().toISOString();
  }

  /* ---- Malaxeur step ---- */
  function emptyMalaxeur() {
    return {
      heure: nowTime(), quantite: "", affaissement: "", temperature: "",
      numCamion: "", numBL: "",
      preleve: false, prelType: "", prelNombre: "", prelObs: "",
      formulation: {
        // mode "" = pas encore choisi : les champs restent fermés tant que
        // l'opérateur n'a pas choisi « Photo » ou « Saisie ».
        reprise: false, mode: "", fournisseur: "", classe: "", ciment: "",
        cimentProvenance: "", dosage: "", dmax: "", adjuvant: "", adjuvantDosage: "", adjuvantProvenance: "",
        sable1Fraction: "", sable1Qte: "", sable1Provenance: "",
        sable2Fraction: "", sable2Qte: "", sable2Provenance: "",
        gravier38: "", gravier38Provenance: "", gravier815: "", gravier815Provenance: "",
        gravier1525: "", gravier1525Provenance: "", eau: "", eauProvenance: "", photoId: null
      }
    };
  }

  function goMalaxeur(idx) {
    if ((current.statut || "brouillon") !== "brouillon") { return; }
    gatherProjetStep();
    if (!current.modeCoulage) {
      alert("Choisissez le mode de coulage : Pompe, Benne ou Autre.");
      return;
    }
    if (current.modeCoulage === "autre" && !current.modeCoulageAutre) {
      alert("Précisez le mode de coulage.");
      return;
    }
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
  // Valeur du segment actif d'un commutateur (sinon "").
  function segActive(switchId, attr) {
    var sw = $(switchId); if (!sw) { return ""; }
    var a = sw.querySelector(".seg.is-active");
    return a ? (a.getAttribute("data-" + attr) || "") : "";
  }
  function modeCoulageLabel(c) {
    var mode = (c && c.modeCoulage) || "";
    if (mode === "pompe") { return "Pompe"; }
    if (mode === "benne") { return "Benne"; }
    if (mode === "autre") { return c.modeCoulageAutre ? "Autre : " + c.modeCoulageAutre : "Autre"; }
    return "—";
  }

  /* ---- Prelevement porte par le malaxeur (V2.02) ---- */
  function setMoldBtn(mold, on) {
    var box = $("fc-mal-mold"); if (!box) { return; }
    var b = box.querySelector(".mold-btn[data-mold='" + mold + "']");
    if (b) { b.classList.toggle("is-selected", !!on); }
  }
  function moldSelected(mold) {
    var box = $("fc-mal-mold"); if (!box) { return false; }
    var b = box.querySelector(".mold-btn[data-mold='" + mold + "']");
    return !!(b && b.classList.contains("is-selected"));
  }
  function currentMoldType() {
    var cube = moldSelected("cube"), cyl = moldSelected("cylindre");
    if (cube && cyl) { return "mixte"; }
    if (cyl) { return "cylindre"; }
    if (cube) { return "cube"; }
    return "";
  }
  function typeLabelLong(t) { return t === "cylindre" ? "Cylindre" : (t === "mixte" ? "Mixte (cube + cylindre)" : "Cube"); }

  // Apercu codification du prelevement en cours : REF-E{n} (n = rang du prelevement).
  function updatePrelCodif() {
    var box = $("fc-mal-prel-codif"); if (!box || !current) { return; }
    var fait = segActive("fc-mal-prel-switch", "prel") === "oui";
    var type = currentMoldType();
    var nb = intOr0(val("fc-mal-prel-nb"));
    if (!fait || !type || !nb) { box.hidden = true; box.innerHTML = ""; return; }
    // Rang E parmi les malaxeurs (hors celui-ci) ayant deja un prelevement, +1.
    var rang = 1;
    for (var i = 0; i < malaxeurIdx; i++) {
      var m = current.malaxeurs[i];
      if (window.CAEKModel ? CAEKModel.malaxeurHasPrel(m) : (m && m.preleve)) { rang++; }
    }
    var ref = current.ref || "";
    var prem = window.CAEKModel ? CAEKModel.eproCode(ref, rang, 1) : (ref + "-E" + rang + "-01");
    var dern = window.CAEKModel ? CAEKModel.eproCode(ref, rang, nb) : (ref + "-E" + rang + "-" + pad2(nb));
    box.hidden = false;
    box.innerHTML = "Codification : <strong>" + escapeHtml(nb > 1 ? (prem + " → " + dern) : prem) +
      "</strong> · " + escapeHtml(typeLabelLong(type)) + " · " + nb + " éprouvette(s)";
  }

  function populatePrelevement(m) {
    var fait = m && m.preleve === true;
    setSeg("fc-mal-prel-switch", "prel", fait ? "oui" : "non");
    show("fc-mal-prel-detail", fait);
    var t = (m && m.prelType) || "";
    setMoldBtn("cube", t === "cube" || t === "mixte");
    setMoldBtn("cylindre", t === "cylindre" || t === "mixte");
    setVal("fc-mal-prel-nb", (m && m.prelNombre) || "");
    setVal("fc-mal-prel-obs", (m && m.prelObs) || "");
    setOptToggle("fc-mal-prel-obs-on", "fc-mal-prel-obs", !!(m && m.prelObs));
    updatePrelCodif();
  }

  function gatherPrelevement(m) {
    var fait = segActive("fc-mal-prel-switch", "prel") === "oui";
    if (fait) {
      m.preleve = true;
      m.prelType = currentMoldType();
      m.prelNombre = intOr0(val("fc-mal-prel-nb"));
      m.prelObs = ($("fc-mal-prel-obs-on") && $("fc-mal-prel-obs-on").checked) ? val("fc-mal-prel-obs").trim() : "";
      // Phase 3 : identité UUID du prélèvement + de chaque éprouvette
      // (stable hors-ligne ; le n° E officiel est alloué par le serveur).
      if (!m.prelUuid) {
        m.prelUuid = (window.CAEKCoulages && CAEKCoulages.newUuid) ? CAEKCoulages.newUuid()
          : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
      }
      m.eprUuids = Array.isArray(m.eprUuids) ? m.eprUuids : [];
      while (m.eprUuids.length < m.prelNombre) {
        m.eprUuids.push((window.CAEKCoulages && CAEKCoulages.newUuid) ? CAEKCoulages.newUuid()
          : String(Date.now()) + "-" + Math.random().toString(16).slice(2));
      }
      m.eprUuids = m.eprUuids.slice(0, m.prelNombre);
    } else {
      m.preleve = false; m.prelType = ""; m.prelNombre = ""; m.prelObs = "";
      m.prelUuid = null; m.eprUuids = [];
    }
  }

  // Verifie la coherence du prelevement avant de poursuivre (retourne un message ou "").
  function prelError() {
    if (segActive("fc-mal-prel-switch", "prel") !== "oui") { return ""; }
    if (!currentMoldType()) { return "Sélectionnez le type de moule (cube et/ou cylindre)."; }
    if (intOr0(val("fc-mal-prel-nb")) <= 0) { return "Indiquez le nombre total d'éprouvettes prélevées."; }
    return "";
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

  function formulationParts(f) {
    f = f || {};
    var parts = [f.fournisseur, f.classe,
      f.ciment ? "Ciment " + f.ciment + (f.cimentProvenance ? " (" + f.cimentProvenance + ")" : "") : "",
      (f.dosage ? f.dosage + " kg ciment" : ""),
      (f.dmax ? "Dmax " + f.dmax : ""),
      f.adjuvant ? f.adjuvant + (f.adjuvantDosage ? " " + f.adjuvantDosage + " %" : "") +
        (f.adjuvantProvenance ? " (" + f.adjuvantProvenance + ")" : "") : ""];
    if (f.sable1Fraction || f.sable1Qte) {
      parts.push("Sable 01" + (f.sable1Fraction ? " " + f.sable1Fraction : "") +
        (f.sable1Qte ? " " + f.sable1Qte + " kg" : "") +
        (f.sable1Provenance ? " (" + f.sable1Provenance + ")" : ""));
    }
    if (f.sable2Fraction || f.sable2Qte) {
      parts.push("Sable 02" + (f.sable2Fraction ? " " + f.sable2Fraction : "") +
        (f.sable2Qte ? " " + f.sable2Qte + " kg" : "") +
        (f.sable2Provenance ? " (" + f.sable2Provenance + ")" : ""));
    }
    if (f.gravier38) { parts.push("Agrégat 3/8 " + f.gravier38 + " kg" + (f.gravier38Provenance ? " (" + f.gravier38Provenance + ")" : "")); }
    if (f.gravier815) { parts.push("Agrégat 8/15 " + f.gravier815 + " kg" + (f.gravier815Provenance ? " (" + f.gravier815Provenance + ")" : "")); }
    if (f.gravier1525) { parts.push("Agrégat 15/25 " + f.gravier1525 + " kg" + (f.gravier1525Provenance ? " (" + f.gravier1525Provenance + ")" : "")); }
    if (f.eau) { parts.push("Eau " + f.eau + " Litre" + (f.eauProvenance ? " (" + f.eauProvenance + ")" : "")); }
    return parts.filter(Boolean);
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
    var mode = m.formulation.mode || "";
    setSeg("fc-mal-form-mode", "fmode", mode);
    show("fc-mal-form-structure", mode === "structure");
    show("fc-mal-form-photo", mode === "photo");
    show("fc-mal-form-hint", mode === "");
    setVal("fc-mal-fournisseur", m.formulation.fournisseur);
    setSelectOrAutre("fc-mal-classe", m.formulation.classe, ["C25/30", "C30/37", "C35/45", "C40/50"]);
    setSelectOrAutre("fc-mal-ciment", m.formulation.ciment, ["CRS", "CPJ"]);
    setVal("fc-mal-ciment-prov", m.formulation.cimentProvenance);
    setSelectOrAutre("fc-mal-dosage", m.formulation.dosage, ["350", "380", "400"]);
    setSelectOrAutre("fc-mal-dmax", m.formulation.dmax, ["15", "25"]);
    setSelectOrAutre("fc-mal-adjuvant", m.formulation.adjuvant, ["Superplastifiant", "Hydrofuge", "Entraîneur d'air"]);
    setVal("fc-mal-adjuvant-dosage", m.formulation.adjuvantDosage);
    setVal("fc-mal-adjuvant-prov", m.formulation.adjuvantProvenance);
    setVal("fc-mal-sable1-fraction", m.formulation.sable1Fraction);
    setVal("fc-mal-sable1-qte", m.formulation.sable1Qte);
    setVal("fc-mal-sable1-prov", m.formulation.sable1Provenance);
    setVal("fc-mal-sable2-fraction", m.formulation.sable2Fraction);
    setVal("fc-mal-sable2-qte", m.formulation.sable2Qte);
    setVal("fc-mal-sable2-prov", m.formulation.sable2Provenance);
    setVal("fc-mal-grav-38", m.formulation.gravier38);
    setVal("fc-mal-grav-38-prov", m.formulation.gravier38Provenance);
    setVal("fc-mal-grav-815", m.formulation.gravier815);
    setVal("fc-mal-grav-815-prov", m.formulation.gravier815Provenance);
    setVal("fc-mal-grav-1525", m.formulation.gravier1525);
    setVal("fc-mal-grav-1525-prov", m.formulation.gravier1525Provenance);
    setVal("fc-mal-eau", m.formulation.eau);
    setVal("fc-mal-eau-prov", m.formulation.eauProvenance);
    // Observation générale du malaxeur.
    setVal("fc-mal-observation", m.observation || "");
    setOptToggle("fc-mal-observation-on", "fc-mal-observation", !!m.observation);
    renderMalFormPhotoPreview();
    populatePrelevement(m);
  }

  function gatherMalaxeur() {
    var m = malaxeurDraft;
    m.heure = val("fc-mal-heure");
    m.quantite = val("fc-mal-quantite");
    m.affaissement = val("fc-mal-affaissement");
    m.temperature = val("fc-mal-temperature");
    m.numCamion = val("fc-mal-camion").trim();
    m.numBL = val("fc-mal-bl").trim();
    m.observation = ($("fc-mal-observation-on") && $("fc-mal-observation-on").checked)
      ? val("fc-mal-observation").trim() : "";
    if (m.formulation.reprise && malaxeurIdx > 0) {
      var prev = current.malaxeurs[malaxeurIdx - 1];
      if (prev) {
        m.formulation = JSON.parse(JSON.stringify(prev.formulation));
        m.formulation.reprise = true;
      }
    } else {
      m.formulation.reprise = false;
      // Ne lire les champs manuels QUE si l'opérateur a choisi « Saisie »
      // (mode "" = aucun choix : on ne touche pas à la formulation).
      if (m.formulation.mode === "structure") {
        m.formulation.fournisseur = val("fc-mal-fournisseur").trim();
        m.formulation.classe = readSelectOrAutre("fc-mal-classe");
        m.formulation.ciment = readSelectOrAutre("fc-mal-ciment");
        m.formulation.cimentProvenance = val("fc-mal-ciment-prov").trim();
        m.formulation.dosage = readSelectOrAutre("fc-mal-dosage");
        m.formulation.dmax = readSelectOrAutre("fc-mal-dmax");
        m.formulation.adjuvant = readSelectOrAutre("fc-mal-adjuvant");
        m.formulation.adjuvantDosage = val("fc-mal-adjuvant-dosage").trim();
        m.formulation.adjuvantProvenance = val("fc-mal-adjuvant-prov").trim();
        m.formulation.sable1Fraction = val("fc-mal-sable1-fraction").trim();
        m.formulation.sable1Qte = val("fc-mal-sable1-qte").trim();
        m.formulation.sable1Provenance = val("fc-mal-sable1-prov").trim();
        m.formulation.sable2Fraction = val("fc-mal-sable2-fraction").trim();
        m.formulation.sable2Qte = val("fc-mal-sable2-qte").trim();
        m.formulation.sable2Provenance = val("fc-mal-sable2-prov").trim();
        m.formulation.gravier38 = val("fc-mal-grav-38").trim();
        m.formulation.gravier38Provenance = val("fc-mal-grav-38-prov").trim();
        m.formulation.gravier815 = val("fc-mal-grav-815").trim();
        m.formulation.gravier815Provenance = val("fc-mal-grav-815-prov").trim();
        m.formulation.gravier1525 = val("fc-mal-grav-1525").trim();
        m.formulation.gravier1525Provenance = val("fc-mal-grav-1525-prov").trim();
        m.formulation.eau = val("fc-mal-eau").trim();
        m.formulation.eauProvenance = val("fc-mal-eau-prov").trim();
      }
    }
    gatherPrelevement(m);
  }

  function attachPendingMalPhoto() {
    if (!pendingMalPhoto || !window.CAEKDB || !CAEKDB.addPhoto) { return Promise.resolve(); }
    return CAEKDB.addPhoto(current.ref, "formulation", pendingMalPhoto, { malaxeur: malaxeurIdx })
      .then(function (id) {
        if (typeof id === "number") { malaxeurDraft.formulation.photoId = id; }
        pendingMalPhoto = null;
      }).catch(function () {});
  }

  function saveMalaxeurToCoulage() {
    gatherMalaxeur();
    current.malaxeurs[malaxeurIdx] = malaxeurDraft;
    if (current.origineDuplication) { current.copieIntacte = false; }
    delete current.saisieEnCours;
    return attachPendingMalPhoto().then(function () {
      computeTotals();
      current.dateModification = new Date().toISOString();
      return CAEKDB.updateCoulage(current);
    });
  }

  function computeTotals() {
    var totQ = 0;
    (current.malaxeurs || []).forEach(function (m) { totQ += num(m.quantite); });
    current.totalQuantite = Math.round(totQ * 100) / 100;
    // Phase 2 : la quantité OBSERVÉE = somme des malaxeurs (dual-write) ;
    // estimée = saisie identification ; validée = posée par le vérificateur.
    current.quantiteObservee = current.totalQuantite;
    current.totalEprouvettes = window.CAEKModel ? CAEKModel.totalEprouvettes(current) : 0;
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
    html += "<div><span class=\"ro-label\">Mode de coulage</span><span class=\"ro-val\">" + escapeHtml(modeCoulageLabel(c)) + "</span></div>";
    html += "<div><span class=\"ro-label\">Ouvrages</span><span class=\"ro-val\">" + escapeHtml(c.ouvrageCoule || "—") + "</span></div>";
    html += "<div><span class=\"ro-label\">Bloc / Étage</span><span class=\"ro-val\">" + escapeHtml([c.bloc ? "Bloc " + c.bloc : "", c.etage].filter(Boolean).join(" · ") || "—") + "</span></div>";
    html += "<div><span class=\"ro-label\">Partie</span><span class=\"ro-val\">" + escapeHtml(c.partie || "—") + "</span></div>";
    html += "<div><span class=\"ro-label\">Malaxeurs</span><span class=\"ro-val\">" + (c.malaxeurs || []).length + "</span></div>";
    html += "<div><span class=\"ro-label\">Quantité totale</span><span class=\"ro-val\">" + (c.totalQuantite || 0) + " m³</span></div>";
    html += "<div><span class=\"ro-label\">Total éprouvettes</span><span class=\"ro-val\">" + (c.totalEprouvettes || 0) + "</span></div>";
    if (intOr0(c.recommandationEprouvettes) > 0) {
      var manque = Math.max(0, intOr0(c.recommandationEprouvettes) - intOr0(c.totalEprouvettes));
      html += "<div><span class=\"ro-label\">Recommandation laboratoire</span><span class=\"ro-val\">" +
        intOr0(c.recommandationEprouvettes) + " éprouvette(s)" +
        (manque ? " · <strong>reste recommandé : " + manque + "</strong>" : " · atteint") + "</span></div>";
    }
    html += "</div>";

    html += "<h3 class=\"block-subtitle\">Détail des malaxeurs</h3>";
    (c.malaxeurs || []).forEach(function (m, i) {
      var f = m.formulation || {};
      var fdesc = f.reprise ? "Idem précédent"
        : formulationParts(f).join(" · ");
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
        "<br>📄 " + escapeHtml(fdesc || "—") +
        "</div></div>";
    });
    if (!(c.malaxeurs || []).length) { html += "<p class=\"hint\">Aucun malaxeur saisi.</p>"; }

    $("fc-recap").innerHTML = html;
    renderPrelevements();

    show("fc-recap-add", !locked);
    setVal("fc-anomalie-texte", (c.anomalie && c.anomalie.texte) || "");
    renderAnomaliePhotos();
    renderAudioNotes();
    show("fc-audio-wrap", !locked);
    setVal("fc-operateur", c.signatureOperateur || profilNom());
    refreshOperateurHint();

    show("fc-export-box", true);
    show("fc-locked-note", locked);
    if (locked) {
      var sgn = $("fc-signataire-line");
      if (sgn) { sgn.textContent = c.signatureOperateur ? " Signée par : " + c.signatureOperateur : ""; }
    }
    _dirty = false;
    var st0 = $("fc-save-state"); if (st0) { st0.textContent = ""; }
    refreshSaveBar();

    var rec = $("fc-recap");
    rec.querySelectorAll(".recap-mal-edit").forEach(function (b) {
      b.addEventListener("click", function () { goMalaxeur(parseInt(b.getAttribute("data-idx"), 10)); });
    });
    rec.querySelectorAll(".recap-mal-del").forEach(function (b) {
      b.addEventListener("click", function () {
        var idx = parseInt(b.getAttribute("data-idx"), 10);
        var msg = window.I18N && I18N.f ? I18N.f("Supprimer le Malaxeur {n} ?", { n: pad2(idx + 1) }) : "Supprimer le Malaxeur " + pad2(idx + 1) + " ?";
        if (!confirm(msg)) { return; }
        current.malaxeurs.splice(idx, 1);
        computeTotals();
        CAEKDB.updateCoulage(current).then(renderRecap);
      });
    });
  }

  /* ---- Prelevements d'eprouvettes (V2.02 : lecture seule au recap) ----
     Les prelevements sont declares PENDANT la saisie de chaque malaxeur.
     Le recap ne fait que les AFFICHER (avec malaxeur lie + code REF-Ei). */
  function typeLabel(t) {
    if (t === "cylindre") { return "Cylindre"; }
    if (t === "mixte") { return "Mixte (cube + cylindre)"; }
    return "Cube";
  }

  function renderPrelevements() {
    var box = $("fc-prelevements"); if (!box) { return; }
    var codif = window.CAEKModel ? CAEKModel.codification(current) : [];
    var total = window.CAEKModel ? CAEKModel.totalEprouvettes(current) : 0;
    if (!codif.length) {
      box.innerHTML = "<p class=\"hint\">Aucun prélèvement déclaré. Indiquez-le pendant la saisie d'un malaxeur (question « Avez-vous effectué un prélèvement ? »).</p>";
      return;
    }
    var rows = codif.map(function (p) {
      var plage = p.nombre > 1 ? (escapeHtml(p.premier) + " → " + escapeHtml(p.dernier))
        : escapeHtml(p.premier || p.prefixe);
      return "<div class=\"prel-ro\">" +
        "<div class=\"prel-ro-head\"><span class=\"prel-num\">" + escapeHtml(p.numero) + "</span>" +
        "<span class=\"prel-ro-code\">" + escapeHtml(p.prefixe) + "</span></div>" +
        "<div class=\"prel-ro-body\">" +
        (p.malaxeur ? "Malaxeur " + pad2(p.malaxeur) + " · " : "") +
        escapeHtml(typeLabel(p.type)) + " · <strong>" + p.nombre + "</strong> éprouvette(s)" +
        (p.heure ? " · ⏰ " + escapeHtml(p.heure) : "") +
        "<br>🏷️ <strong>" + plage + "</strong>" +
        (p.observation ? "<br>📝 " + escapeHtml(p.observation) : "") +
        "</div></div>";
    }).join("");
    box.innerHTML = rows +
      "<div class=\"prel-total\">Total éprouvettes : <strong>" + total + "</strong></div>";
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

  /* ---- Notes audio (signalement) ---- */
  function audioSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }
  function pickAudioMime() {
    var cands = ["audio/webm", "audio/mp4", "audio/ogg"];
    if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
      for (var i = 0; i < cands.length; i++) { if (MediaRecorder.isTypeSupported(cands[i])) { return cands[i]; } }
    }
    return "";
  }
  function fmtChrono(sec) { return pad2(Math.floor(sec / 60)) + ":" + pad2(sec % 60); }
  function stopAudioIfRecording() {
    if (mediaRec && mediaRec.state === "recording") { try { mediaRec.stop(); } catch (e) {} }
  }
  function toggleAudioRec() {
    var btn = $("fc-audio-rec"); var status = $("fc-audio-status");
    if (!btn || !current) { return; }
    if (mediaRec && mediaRec.state === "recording") { mediaRec.stop(); return; }
    if (!audioSupported()) { alert("L'enregistrement audio n'est pas disponible sur cet appareil/navigateur."); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mime = pickAudioMime();
      try { mediaRec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
      catch (e) { mediaRec = new MediaRecorder(stream); }
      audioChunks = [];
      mediaRec.ondataavailable = function (e) { if (e.data && e.data.size) { audioChunks.push(e.data); } };
      mediaRec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (audioTimer) { clearInterval(audioTimer); audioTimer = null; }
        btn.classList.remove("is-recording");
        btn.innerHTML = "🎤 Enregistrer une note audio";
        if (status) { status.textContent = ""; }
        var blob = new Blob(audioChunks, { type: (mediaRec && mediaRec.mimeType) || mime || "audio/webm" });
        audioChunks = [];
        if (current && blob.size && window.CAEKDB) {
          CAEKDB.addPhoto(current.ref, "audio", blob).then(renderAudioNotes).catch(function () {});
        }
      };
      mediaRec.start();
      audioStartTs = Date.now();
      btn.classList.add("is-recording");
      btn.innerHTML = "⏹ Arrêter (00:00)";
      if (status) { status.textContent = "● Enregistrement en cours…"; }
      audioTimer = setInterval(function () {
        var s = Math.floor((Date.now() - audioStartTs) / 1000);
        btn.innerHTML = "⏹ Arrêter (" + fmtChrono(s) + ")";
      }, 500);
    }).catch(function (err) {
      alert("Micro indisponible : " + (err && err.message || err) + "\nAutorisez l'accès au micro.");
    });
  }
  function renderAudioNotes() {
    var box = $("fc-audio-list"); if (!box || !window.CAEKDB || !current) { return; }
    var locked = (current.statut || "brouillon") !== "brouillon";
    CAEKDB.getPhotosByRef(current.ref).then(function (list) {
      audioUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); audioUrls = [];
      box.innerHTML = "";
      var audios = list.filter(function (p) { return p.categorie === "audio"; });
      if (!audios.length) { box.hidden = true; return; }
      box.hidden = false;
      audios.forEach(function (p, i) {
        var u = URL.createObjectURL(p.blob); audioUrls.push(u);
        var card = document.createElement("div"); card.className = "audio-card";
        var head = "<span class=\"audio-cat\">🎤 Note " + pad2(i + 1) + "</span>";
        if (!locked) { head += " <button type=\"button\" class=\"btn-link audio-del\" data-id=\"" + p.id + "\">Supprimer</button>"; }
        card.innerHTML = head + "<audio controls preload=\"metadata\" src=\"" + u + "\"></audio>";
        box.appendChild(card);
      });
      box.querySelectorAll(".audio-del").forEach(function (b) {
        b.addEventListener("click", function () {
          if (!confirm("Supprimer cette note audio ?")) { return; }
          CAEKDB.deletePhoto(parseInt(b.getAttribute("data-id"), 10)).then(renderAudioNotes);
        });
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

  /* ---- Indicateur "modifications non enregistrees" (recap) ---- */
  var _dirty = false;
  var _saveTimer = null;
  function recapLocked() { return !!(current && (current.statut || "brouillon") !== "brouillon"); }
  function refreshSaveBar() {
    var bar = $("fc-save-bar"), btn = $("fc-save"), st = $("fc-save-state");
    if (!bar) { return; }
    if (recapLocked()) { bar.hidden = true; if (btn) { btn.hidden = true; } return; }
    if (_dirty) {
      bar.hidden = false;
      if (btn) { btn.hidden = false; }
      if (st) { st.textContent = "Modifications non enregistrées"; st.className = "fc-save-state is-dirty"; }
    } else {
      if (btn) { btn.hidden = true; }
      if (!st || !st.textContent) { bar.hidden = true; }
    }
  }
  function markDirty() {
    if (recapLocked()) { return; }
    _dirty = true;
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    refreshSaveBar();
  }
  function markSaved() {
    _dirty = false;
    var bar = $("fc-save-bar"), btn = $("fc-save"), st = $("fc-save-state");
    if (btn) { btn.hidden = true; }
    if (bar) { bar.hidden = false; }
    if (st) { st.textContent = "✔ Brouillon enregistré"; st.className = "fc-save-state is-saved"; }
    if (_saveTimer) { clearTimeout(_saveTimer); }
    _saveTimer = setTimeout(function () {
      if (!_dirty) { var s = $("fc-save-state"); if (s) { s.textContent = ""; } var b = $("fc-save-bar"); if (b) { b.hidden = true; } }
    }, 2500);
  }

  function closeFinDialog() { show("fc-fin-dialog", false); }
  function finishIntervention(assisteTout) {
    if (!current || !malaxeurDraft) { return; }
    var note = val("fc-fin-note").trim();
    current.finIntervention = {
      assisteTout: assisteTout === true,
      // Champs historiques conservés pour les anciens exports.
      etat: assisteTout === true ? "termine" : "en_cours",
      par: profilNom() || (current.signatureOperateur || ""),
      date: new Date().toISOString(),
      note: note
    };
    current.statutSaisie = "terminee";
    delete current.interruption;
    closeFinDialog();
    saveMalaxeurToCoulage().then(function () { gotoStep("recap"); });
  }
  function interruptSaisie() {
    if (!current || !malaxeurDraft) { return; }
    var msg = "Interrompre la saisie ?\n\nLa fiche restera INCOMPLÈTE dans le Répertoire. " +
      "Elle ne sera pas soumise au laboratoire et vous pourrez la reprendre à tout moment.";
    if (!window.confirm(msg)) { return; }
    gatherMalaxeur();
    attachPendingMalPhoto().then(function () {
      current.statutSaisie = "incomplete";
      if (current.origineDuplication) { current.copieIntacte = false; }
      current.interruption = {
        par: profilNom() || (current.signatureOperateur || ""),
        date: new Date().toISOString(), etape: "malaxeur", index: malaxeurIdx
      };
      current.saisieEnCours = {
        index: malaxeurIdx,
        malaxeur: JSON.parse(JSON.stringify(malaxeurDraft))
      };
      current.dateModification = new Date().toISOString();
      return CAEKDB.updateCoulage(current);
    }).then(function () {
      if (window.CAEKRepertoire) { CAEKRepertoire.refresh(); }
      if (window.CAEKApp) { CAEKApp.navigate("screen-repertoire"); }
    }).catch(function (e) { showResult("&#9888; Interruption non enregistrée : " + escapeHtml(e && e.message || e), true); });
  }

  function init() {
    loadIconsManifest();

    var go = $("fc-go-malaxeur");
    if (go) { go.addEventListener("click", function () { goMalaxeur(); }); }

    var back = $("fc-back");
    if (back) { back.addEventListener("click", goBack); }
    var home = $("fc-accueil");
    if (home) { home.addEventListener("click", gotoAccueil); }
    var arec = $("fc-audio-rec");
    if (arec) { arec.addEventListener("click", toggleAudioRec); }

    bindSegSwitch("fc-mode-coulage", "mode-coulage", function (v) {
      if (!current) { return; }
      current.modeCoulage = v;
      show("fc-mode-coulage-autre", v === "autre");
      if (v !== "autre") {
        setVal("fc-mode-coulage-autre", "");
        current.modeCoulageAutre = "";
      }
      markDirty();
    });
    var modeAutre = $("fc-mode-coulage-autre");
    if (modeAutre) {
      modeAutre.addEventListener("input", function () {
        if (current) { current.modeCoulageAutre = modeAutre.value.trim(); }
        markDirty();
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
      show("fc-mal-form-hint", false);
      // En mode photo, l'opérateur choisit lui-même : appareil OU galerie
      // (deux boutons dans le panneau — plus d'ouverture automatique).
    });

    // Champs facultatifs : la case a cocher ouvre le champ (et le vide si decoche).
    bindOptToggle("fc-mal-camion-on", "fc-mal-camion");
    bindOptToggle("fc-mal-bl-on", "fc-mal-bl");
    bindOptToggle("fc-bloc-on", "fc-bloc");
    bindOptToggle("fc-etage-on", "fc-etage");
    bindOptToggle("fc-mal-observation-on", "fc-mal-observation");

    ["fc-mal-classe", "fc-mal-ciment", "fc-mal-dosage", "fc-mal-dmax", "fc-mal-adjuvant", "fc-centrale"].forEach(function (id) {
      var s = $(id); if (!s) { return; }
      s.addEventListener("change", function () { var a = $(id + "-autre"); if (a) { a.hidden = (s.value !== "autre"); } });
    });

    // Photo formulation : appareil photo OU image de la galerie (2 entrées).
    ["fc-mal-form-photo-input", "fc-mal-form-photo-galerie"].forEach(function (pid) {
      var pi = $(pid);
      if (!pi) { return; }
      pi.addEventListener("change", function () {
        var f = pi.files && pi.files[0]; pi.value = "";
        if (!f) { return; }
        var p = (window.CAEKPhotos && CAEKPhotos.compress) ? CAEKPhotos.compress(f) : Promise.resolve(f);
        p.then(function (blob) { pendingMalPhoto = blob; renderMalFormPhotoPreview(); })
          .catch(function (e) { alert("Photo : " + (e && e.message || e)); });
      });
    });

    var cont = $("fc-mal-continuer");
    if (cont) {
      cont.addEventListener("click", function () {
        var err = prelError(); if (err) { alert(err); return; }
        current.statutSaisie = "en_cours";
        delete current.interruption;
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
    var interrupt = $("fc-mal-interrompre");
    if (interrupt) { interrupt.addEventListener("click", interruptSaisie); }
    var term = $("fc-mal-terminer");
    if (term) {
      term.addEventListener("click", function () {
        var err = prelError(); if (err) { alert(err); return; }
        setVal("fc-fin-note", "");
        show("fc-fin-dialog", true);
      });
    }
    var finOui = $("fc-fin-oui"); if (finOui) { finOui.addEventListener("click", function () { finishIntervention(true); }); }
    var finNon = $("fc-fin-non"); if (finNon) { finNon.addEventListener("click", function () { finishIntervention(false); }); }
    var finCancel = $("fc-fin-cancel"); if (finCancel) { finCancel.addEventListener("click", closeFinDialog); }

    var add = $("fc-recap-add");
    if (add) { add.addEventListener("click", function () { goMalaxeur(); }); }

    // Prelevement porte par le malaxeur (V2.02).
    bindSegSwitch("fc-mal-prel-switch", "prel", function (v) {
      var fait = (v === "oui");
      if (malaxeurDraft) { malaxeurDraft.preleve = fait; }
      show("fc-mal-prel-detail", fait);
      updatePrelCodif();
    });
    var moldBox = $("fc-mal-mold");
    if (moldBox) {
      moldBox.addEventListener("click", function (ev) {
        var b = ev.target.closest ? ev.target.closest(".mold-btn") : null;
        if (!b) { return; }
        b.classList.toggle("is-selected");
        updatePrelCodif();
      });
    }
    var prelNb = $("fc-mal-prel-nb");
    if (prelNb) { prelNb.addEventListener("input", updatePrelCodif); }
    bindOptToggle("fc-mal-prel-obs-on", "fc-mal-prel-obs");

    // Ouvrage "Autres" + Partie (champs facultatifs de l'etape projet).
    bindOptToggle("fc-ouvrage-autre-on", "fc-ouvrage-autre");
    bindOptToggle("fc-partie-on", "fc-partie");

    var qEst = $("fc-quantite-estimee");
    if (qEst) { qEst.addEventListener("input", function () { updateSamplingRecommendation(qEst.value); }); }

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
        markDirty();
      });
    }
    var opName = $("fc-operateur");
    if (opName) { opName.addEventListener("input", markDirty); }

    var sv = $("fc-save");
    if (sv) {
      sv.addEventListener("click", function () {
        if (!current) { return; }
        gatherProjetStep();
        current.signatureOperateur = val("fc-operateur").trim();
        current.statut = current.statut || "brouillon";
        computeTotals();
        CAEKDB.updateCoulage(current).then(function () {
          markSaved();
          if (window.CAEKBadges) { CAEKBadges.refresh(); }
        }).catch(function (err) { showResult("⚠ " + (err && err.message || err), true); });
      });
    }

    // Validation et partage au bureau : desormais geres depuis le Repertoire.
  }

  return { init: init, open: open };
})();

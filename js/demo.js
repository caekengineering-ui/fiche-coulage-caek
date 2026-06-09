/* ============================================================
   Fiche de coulage terrain - CAEK
   demo.js - V2.01 : jeu de donnees d'EXEMPLE pour controle.

   Cree des donnees fictives clairement identifiees par le prefixe
   "DEMO-" couvrant tous les cas : recuperation d'eprouvettes,
   retard de recuperation, a repartir, toutes les couleurs du bassin,
   lots a tester / incomplet / historique de compression.

   - Ne s'active JAMAIS automatiquement : l'utilisateur clique
     volontairement sur « Charger donnees exemple V2.01 ».
   - La suppression ne touche QUE les enregistrements prefixes DEMO-.
   ============================================================ */

var CAEKDemo = (function () {
  "use strict";

  var PREFIX = "DEMO-";

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function nowIso() { return new Date().toISOString(); }

  function isDemoRef(ref) { return String(ref || "").indexOf(PREFIX) === 0; }

  // Codes individuels REF-JJ-Ei pour un lot d'un seul prelevement.
  function makeCodes(ref, nombre, type) {
    var out = [];
    for (var j = 1; j <= nombre; j++) {
      out.push({ code: ref + "-" + pad2(j) + "-E1", type: type });
    }
    return out;
  }

  // Coulage d'exemple (statut validee par defaut).
  function demoCoulage(ref, opts) {
    opts = opts || {};
    var coulageDate = opts.dateCoulage || ymd(-1);
    return {
      ref: ref,
      statut: opts.statut || "validee",
      dateCreation: nowIso(),
      dateValidation: nowIso(),
      dateCoulage: coulageDate,
      dateModification: nowIso(),
      estDemo: true,
      client: opts.client || "Client DEMO",
      entreprise: opts.client || "Client DEMO",
      nomProjet: opts.nomProjet || "Projet exemple V2.01",
      codeProjet: "DEMO",
      ouvrageCoule: opts.ouvrage || "Semelle",
      ouvrageZonePartie: "Bloc DEMO / RDC",
      signatureOperateur: "Op DEMO",
      malaxeurs: [
        { heure: "10:00", quantite: 6, affaissement: 8, temperature: 22, numCamion: "C1", numBL: "BL1",
          formulation: { classe: "C25/30", fournisseur: "Centrale DEMO", dosage: 350 } }
      ],
      prelevements: opts.prelevements || [
        { numero: "E1", heure: "10:30", type: "cube", nombre: 3, observation: "" },
        { numero: "E2", heure: "11:00", type: "cylindre", nombre: 2, observation: "Exemple" }
      ],
      eprRecuperees: !!opts.eprRecuperees,
      codificationConfirmee: !!opts.codificationConfirmee,
      bassinReparti: !!opts.bassinReparti
    };
  }

  // Lot d'exemple pour le bassin / la compression.
  function demoLot(ref, opts) {
    opts = opts || {};
    var type = opts.type || "cube";
    var nombre = opts.nombre || 3;
    return {
      ref: ref,
      estDemo: true,
      client: opts.client || "Client DEMO",
      nomProjet: opts.nomProjet || "Projet exemple V2.01",
      ouvrage: opts.ouvrage || "Semelle",
      bloc: "DEMO", etage: "RDC",
      dateCoulage: opts.dateCoulage || ymd(-7),
      type: type,
      nombre: nombre,
      age: opts.age || "28j",
      ageJours: opts.ageJours || 28,
      datePrevue: opts.datePrevue || ymd(5),
      codes: makeCodes(ref, nombre, type === "cylindre" ? "cylindre" : (type === "mixte" ? "cube" : "cube")),
      statut: opts.statut || "en_bassin",
      operateurRepartition: "Op DEMO",
      qualificationRepartition: "Technicien",
      dateRepartition: nowIso(),
      dateSortie: opts.dateSortie,
      heureSortie: opts.heureSortie,
      operateurSortie: opts.operateurSortie,
      motifSortie: opts.motifSortie,
      observationSortie: opts.observationSortie,
      essais: opts.essais,
      dateEssai: opts.dateEssai,
      heureEssai: opts.heureEssai,
      operateurEssai: opts.operateurEssai,
      qualificationEssai: opts.qualificationEssai
    };
  }

  // Construit un tableau d'essais : nbFilled remplis, le reste vide.
  function makeEssais(ref, nombre, type, nbFilled) {
    var codes = makeCodes(ref, nombre, type);
    var dims = (type === "cylindre") ? { d1: 160, d2: 320 } : { d1: 150, d2: 150 };
    var surface = (type === "cylindre")
      ? Math.PI * (dims.d1 / 2) * (dims.d1 / 2)
      : dims.d1 * dims.d2;
    return codes.map(function (c, i) {
      if (i < nbFilled) {
        var force = 450 + i * 20;
        var rc = Math.round((force * 1000 / surface) * 100) / 100;
        return {
          code: c.code, forme: type, dim1: dims.d1, dim2: dims.d2,
          surface: Math.round(surface), masse: 8 + i * 0.1,
          dateEssai: ymd(0), force: force, rc: rc, observation: ""
        };
      }
      return {
        code: c.code, forme: type, dim1: dims.d1, dim2: dims.d2,
        surface: Math.round(surface), masse: "", dateEssai: ymd(0),
        force: "", rc: "", observation: ""
      };
    });
  }

  /* ---------- Chargement ---------- */
  function load() {
    if (!window.CAEKDB) { return Promise.reject(new Error("Base indisponible.")); }

    // Coulages (cas A, B, C)
    var coulages = [
      // A. Eprouvettes non recuperees -> badge Coulage
      demoCoulage(PREFIX + "RECUP", { nomProjet: "A. Eprouvettes a recuperer", dateCoulage: ymd(-1) }),
      // B. Retard de recuperation (> 3 jours)
      demoCoulage(PREFIX + "RETARD-RECUP", { nomProjet: "B. Retard recuperation", dateCoulage: ymd(-5) }),
      // C. Validee + recuperee + non repartie -> A repartir + badge Bassin
      demoCoulage(PREFIX + "A-REPARTIR", {
        nomProjet: "C. A repartir au bassin", dateCoulage: ymd(-1),
        eprRecuperees: true, codificationConfirmee: true
      }),
      // C2. Recuperee mais codification NON confirmee -> synthese Coulage
      demoCoulage(PREFIX + "CODIF", {
        nomProjet: "C2. Codification a confirmer", dateCoulage: ymd(-1),
        eprRecuperees: true, codificationConfirmee: false
      }),
      // C3. Fiche brouillon (a valider) -> synthese Coulage
      demoCoulage(PREFIX + "BROUILLON", {
        nomProjet: "C3. Fiche a valider", dateCoulage: ymd(0), statut: "brouillon"
      })
    ];

    // Lots (cas D, E, F, G)
    var lots = [
      // D. Toutes les couleurs du bassin + formes (cube/cylindre/mixte)
      demoLot(PREFIX + "LOIN", { nomProjet: "D. Echeance loin", type: "cube",
        age: "28j", ageJours: 28, datePrevue: ymd(5), nombre: 3 }),
      demoLot(PREFIX + "J2", { nomProjet: "D. J-2 (a sortir bientot)", type: "cylindre",
        age: "7j", ageJours: 7, datePrevue: ymd(2), nombre: 2 }),
      demoLot(PREFIX + "J1", { nomProjet: "D. J-1 (a sortir aujourd'hui)", type: "mixte",
        age: "7j", ageJours: 7, datePrevue: ymd(1), nombre: 4 }),
      demoLot(PREFIX + "RETARD", { nomProjet: "D. Retard (R)", type: "cube",
        age: "7j", ageJours: 7, datePrevue: ymd(-1), nombre: 3 }),
      demoLot(PREFIX + "SORTI", { nomProjet: "D. Sorti pour essai", type: "cylindre",
        age: "7j", ageJours: 7, datePrevue: ymd(0), nombre: 2,
        statut: "sorti", dateSortie: ymd(0), heureSortie: "09:30",
        operateurSortie: "Op DEMO", motifSortie: "Accord client", observationSortie: "Exemple" }),

      // E. Sorti pour essai mais non teste -> A tester + badge Compression
      demoLot(PREFIX + "COMP-A-TESTER", { nomProjet: "E. A tester", type: "cube",
        age: "7j", ageJours: 7, datePrevue: ymd(0), nombre: 3,
        statut: "sorti", dateSortie: ymd(0), heureSortie: "09:00", operateurSortie: "Op DEMO" }),

      // F. Partiellement teste -> alerte essai incomplet (2/4 saisies)
      demoLot(PREFIX + "COMP-INCOMPLET", { nomProjet: "F. Essai incomplet", type: "cube",
        age: "7j", ageJours: 7, datePrevue: ymd(0), nombre: 4,
        statut: "sorti", dateSortie: ymd(0), heureSortie: "09:15", operateurSortie: "Op DEMO",
        essais: makeEssais(PREFIX + "COMP-INCOMPLET", 4, "cube", 2) }),

      // G. Historique : lot teste (toutes eprouvettes saisies)
      demoLot(PREFIX + "HISTO", { nomProjet: "G. Historique", type: "cube",
        age: "28j", ageJours: 28, datePrevue: ymd(-2), nombre: 3,
        statut: "teste", dateEssai: ymd(0), heureEssai: "10:00",
        operateurEssai: "Op DEMO", qualificationEssai: "Technicien",
        essais: makeEssais(PREFIX + "HISTO", 3, "cube", 3) })
    ];

    // Ecrit d'abord les coulages (sequentiellement), puis les lots.
    var chain = Promise.resolve();
    coulages.forEach(function (c) {
      chain = chain.then(function () { return CAEKDB.saveCoulage(c); });
    });
    return chain.then(function () { return CAEKDB.addLots(lots); })
      .then(function () { return { coulages: coulages.length, lots: lots.length }; });
  }

  /* ---------- Suppression (UNIQUEMENT les DEMO-) ---------- */
  function clear() {
    if (!window.CAEKDB) { return Promise.reject(new Error("Base indisponible.")); }
    return Promise.all([CAEKDB.getAllCoulages(), CAEKDB.getAllLots()]).then(function (out) {
      var coulages = (out[0] || []).filter(function (c) { return isDemoRef(c.ref); });
      var lots = (out[1] || []).filter(function (l) { return isDemoRef(l.ref); });
      var chain = Promise.resolve();
      coulages.forEach(function (c) { chain = chain.then(function () { return CAEKDB.deleteCoulage(c.ref); }); });
      lots.forEach(function (l) { chain = chain.then(function () { return CAEKDB.deleteLot(l.id); }); });
      return chain.then(function () { return { coulages: coulages.length, lots: lots.length }; });
    });
  }

  return { load: load, clear: clear, isDemoRef: isDemoRef, PREFIX: PREFIX };
})();

/* ============================================================
   Fiche de coulage terrain - CAEK
   demo.js - V2.02 : jeu de donnees d'EXEMPLE pour controle.

   Donnees fictives prefixees "DEMO-" couvrant : recuperation,
   retard de recuperation, codification a confirmer, brouillon,
   ouvrage "Autres", Partie, prelevement porte par le malaxeur
   (cube / cylindre / mixte / sans), toutes les couleurs du bassin,
   lots a tester / incomplet / historique compression complet.

   - Ne s'active JAMAIS automatiquement.
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
  // Horodatage ISO il y a (days) jours et (hours) heures.
  function isoAgo(days, hours) {
    var d = new Date();
    if (days) { d.setDate(d.getDate() - days); }
    if (hours) { d.setHours(d.getHours() - hours); }
    return d.toISOString();
  }
  function isDemoRef(ref) { return String(ref || "").indexOf(PREFIX) === 0; }

  // Malaxeur d'exemple, avec ou sans prelevement (V2.02 : prelevement porte
  // par le malaxeur). opts.prel = "cube"|"cylindre"|"mixte" ; opts.nombre.
  function mal(opts) {
    opts = opts || {};
    var m = {
      heure: opts.heure || "10:00", quantite: opts.quantite || 6,
      affaissement: 8, temperature: 22, numCamion: opts.numCamion || "", numBL: opts.numBL || "",
      preleve: false, prelType: "", prelNombre: "", prelObs: "",
      formulation: { reprise: false, mode: "structure", fournisseur: "Centrale DEMO",
        classe: "C25/30", ciment: "CPJ", dosage: "350", dmax: "25", adjuvant: "", photoId: null }
    };
    if (opts.prel) {
      m.preleve = true; m.prelType = opts.prel; m.prelNombre = opts.nombre || 3;
      m.prelObs = opts.prelObs || "";
    }
    return m;
  }

  // Malaxeurs par defaut : M1 cube(3) preleve · M2 sans prelevement · M3 cylindre(2).
  // -> demontre la numerotation E1 (M1) puis E2 (M3, pas E2 sur M2).
  function defaultMalaxeurs() {
    return [
      mal({ prel: "cube", nombre: 3, heure: "10:30" }),
      mal({ heure: "10:50" }),
      mal({ prel: "cylindre", nombre: 2, heure: "11:10" })
    ];
  }

  function demoCoulage(ref, opts) {
    opts = opts || {};
    var brouillon = opts.statut === "brouillon";
    var bloc = opts.bloc || "A", etage = opts.etage || "RDC", partie = opts.partie || "";
    var zone = [bloc ? "Bloc " + bloc : "", etage, partie].filter(Boolean).join(" · ");
    return {
      ref: ref,
      statut: opts.statut || "validee",
      dateCreation: nowIso(),
      dateValidation: brouillon ? "" : nowIso(),
      dateCoulage: opts.dateCoulage || ymd(-1),
      dateModification: nowIso(),
      estDemo: true,
      client: opts.client || "Client DEMO",
      entreprise: opts.client || "Client DEMO",
      nomProjet: opts.nomProjet || "Projet exemple V2.02",
      codeProjet: "DEMO",
      ouvrageCoule: opts.ouvrageCoule || "Semelle isolée",
      ouvrageAutre: opts.ouvrageAutre || "",
      bloc: bloc, etage: etage, partie: partie,
      ouvrageZonePartie: zone,
      signatureOperateur: "Op DEMO",
      operateurValidation: brouillon ? "" : "Op DEMO",
      qualificationValidation: brouillon ? "" : "Technicien",
      malaxeurs: opts.malaxeurs || defaultMalaxeurs(),
      eprRecuperees: !!opts.eprRecuperees,
      codificationConfirmee: !!opts.codificationConfirmee,
      bassinReparti: !!opts.bassinReparti
    };
  }

  // Codes individuels d'un lot (V2.03 : REF-Ei-JJ).
  function lotCodes(ref, nombre, type, prel, malaxeur) {
    var t = (type === "cylindre") ? "cylindre" : "cube";
    var e = prel || 1;
    var out = [];
    for (var j = 1; j <= nombre; j++) {
      out.push({ code: ref + "-E" + e + "-" + pad2(j), type: t, prel: e, numInterne: j, malaxeur: malaxeur || 1 });
    }
    return out;
  }

  function demoLot(ref, opts) {
    opts = opts || {};
    var type = opts.type || "cube";
    var nombre = opts.nombre || 3;
    return {
      ref: ref,
      estDemo: true,
      client: opts.client || "Client DEMO",
      nomProjet: opts.nomProjet || "Projet exemple V2.02",
      ouvrage: opts.ouvrage || "Semelle isolée",
      ouvrageAutre: opts.ouvrageAutre || "",
      bloc: opts.bloc || "A", etage: opts.etage || "RDC", partie: opts.partie || "",
      dateCoulage: opts.dateCoulage || ymd(-7),
      type: type,
      nombre: nombre,
      age: opts.age || "28j",
      ageJours: opts.ageJours || 28,
      datePrevue: opts.datePrevue || ymd(5),
      codes: lotCodes(ref, nombre, type, opts.prel || 1, opts.malaxeur || 1),
      statut: opts.statut || "en_bassin",
      operateurRepartition: "Op DEMO",
      qualificationRepartition: "Technicien",
      dateRepartition: nowIso(),
      dateSortie: opts.dateSortie,
      heureSortie: opts.heureSortie,
      operateurSortie: opts.operateurSortie,
      motifSortie: opts.motifSortie,
      observationSortie: opts.observationSortie,
      sortiAt: opts.sortiAt,
      forceTest: opts.forceTest,
      essais: opts.essais,
      dateEssai: opts.dateEssai,
      heureEssai: opts.heureEssai,
      operateurEssai: opts.operateurEssai,
      qualificationEssai: opts.qualificationEssai,
      agePrevu: opts.agePrevu,
      ageReelMin: opts.ageReelMin,
      ageReelMax: opts.ageReelMax,
      ecartEssai: opts.ecartEssai,
      motifEcart: opts.motifEcart,
      justificationEcart: opts.justificationEcart
    };
  }

  // Tableau d'essais : nbFilled remplis, le reste vide. Codes REF-Ei + n° interne.
  function makeEssais(ref, nombre, type, nbFilled) {
    var dims = (type === "cylindre") ? { d1: 160, d2: 320 } : { d1: 150, d2: 150 };
    var surface = (type === "cylindre") ? Math.PI * (dims.d1 / 2) * (dims.d1 / 2) : dims.d1 * dims.d2;
    var out = [];
    for (var i = 0; i < nombre; i++) {
      var base = {
        code: ref + "-E1-" + pad2(i + 1), prel: 1, numInterne: i + 1, prelInterne: i + 1, malaxeur: 1,
        forme: type, dim1: dims.d1, dim2: dims.d2, surface: Math.round(surface), dateEssai: ymd(0)
      };
      if (i < nbFilled) {
        var force = 450 + i * 20;
        base.masse = Math.round((8 + i * 0.1) * 100) / 100;
        base.force = force;
        base.rc = Math.round((force * 1000 / surface) * 100) / 100;
        base.observation = "";
      } else {
        base.masse = ""; base.force = ""; base.rc = ""; base.observation = "";
      }
      out.push(base);
    }
    return out;
  }

  // Sauvegarde les valeurs reelles de dechets (1 fois) puis pose des valeurs
  // DEMO (stock 320 > seuil 300 -> alerte + 1 evacuation partielle d'historique).
  function setupDechetsDemo() {
    if (!window.CAEKDB) { return Promise.resolve(); }
    return CAEKDB.getMeta("dechetsDemoBackup").then(function (bak) {
      var save = bak ? Promise.resolve() : Promise.all([
        CAEKDB.getMeta("dechetsStock"), CAEKDB.getMeta("dechetsSeuil"),
        CAEKDB.getMeta("dechetsPoidsMoyen"), CAEKDB.getMeta("dechetsEvacuations")
      ]).then(function (o) {
        return CAEKDB.setMeta("dechetsDemoBackup", {
          stock: (o[0] == null) ? null : o[0], seuil: (o[1] == null) ? null : o[1],
          poidsMoyen: (o[2] == null) ? null : o[2], evacuations: Array.isArray(o[3]) ? o[3] : null
        });
      });
      return save.then(function () {
        var evac = [{ date: ymd(-3), heure: "14:00", quantite: 300,
          observation: "Évacuation partielle (camion)", operateur: "Op DEMO",
          qualification: "Technicien", resteApres: 320, at: nowIso() }];
        return Promise.all([
          CAEKDB.setMeta("dechetsStock", 320),
          CAEKDB.setMeta("dechetsSeuil", 300),
          CAEKDB.setMeta("dechetsPoidsMoyen", 8),
          CAEKDB.setMeta("dechetsEvacuations", evac)
        ]);
      });
    });
  }

  // Restaure les valeurs reelles de dechets sauvegardees au chargement DEMO.
  function restoreDechetsDemo() {
    if (!window.CAEKDB) { return Promise.resolve(); }
    return CAEKDB.getMeta("dechetsDemoBackup").then(function (bak) {
      if (!bak) { return null; }
      return Promise.all([
        CAEKDB.setMeta("dechetsStock", bak.stock == null ? 0 : bak.stock),
        CAEKDB.setMeta("dechetsSeuil", bak.seuil == null ? 300 : bak.seuil),
        CAEKDB.setMeta("dechetsPoidsMoyen", bak.poidsMoyen == null ? 8 : bak.poidsMoyen),
        CAEKDB.setMeta("dechetsEvacuations", bak.evacuations == null ? [] : bak.evacuations),
        CAEKDB.setMeta("dechetsDemoBackup", null)
      ]);
    });
  }

  /* ---------- Chargement ---------- */
  function load() {
    if (!window.CAEKDB) { return Promise.reject(new Error("Base indisponible.")); }

    var coulages = [
      // A. Eprouvettes non recuperees -> badge / synthese Coulage
      demoCoulage(PREFIX + "RECUP", { nomProjet: "A. Eprouvettes a recuperer", dateCoulage: ymd(-1) }),
      // B. Retard de recuperation (> 3 jours)
      demoCoulage(PREFIX + "RETARD-RECUP", { nomProjet: "B. Retard recuperation", dateCoulage: ymd(-5) }),
      // C. Validee + recuperee + non repartie -> A repartir + badge Bassin
      // Cas 3 : E1 = 6 cubes, E2 = 3 cylindres -> defaut 3@7j(E1) + 3@28j(E1) + 3@28j(E2).
      demoCoulage(PREFIX + "A-REPARTIR", { nomProjet: "C. A repartir (E1=6, E2=3 - Cas 3)", dateCoulage: ymd(-1),
        malaxeurs: [
          mal({ prel: "cube", nombre: 6, heure: "10:30" }),
          mal({ heure: "10:50" }),
          mal({ prel: "cylindre", nombre: 3, heure: "11:10" })
        ],
        eprRecuperees: true, codificationConfirmee: true }),
      // C1b. Cas 1 : un seul prelevement de 9 cubes -> defaut 3@7j + 6@28j.
      demoCoulage(PREFIX + "REPART9", { nomProjet: "C. A repartir (1 prel. de 9 - Cas 1)", dateCoulage: ymd(-1),
        malaxeurs: [ mal({ prel: "cube", nombre: 9, heure: "09:00" }) ],
        eprRecuperees: true, codificationConfirmee: true }),
      // C2. Recuperee mais codification NON confirmee -> synthese Coulage
      demoCoulage(PREFIX + "CODIF", { nomProjet: "C2. Codification a confirmer", dateCoulage: ymd(-1),
        eprRecuperees: true, codificationConfirmee: false }),
      // C3. Brouillon (a valider) -> synthese Coulage
      demoCoulage(PREFIX + "BROUILLON", { nomProjet: "C3. Fiche a valider", dateCoulage: ymd(0), statut: "brouillon" }),
      // H. Ouvrage "Autres" + Partie + malaxeur mixte (deja traitee : aucun badge)
      demoCoulage(PREFIX + "OUVRAGE-AUTRE", {
        nomProjet: "H. Ouvrage Autres + Partie", dateCoulage: ymd(-2),
        ouvrageCoule: "Autres : Massif d'ancrage", ouvrageAutre: "Massif d'ancrage",
        bloc: "B", etage: "2e étage", partie: "Partie 2",
        malaxeurs: [
          mal({ prel: "cube", nombre: 3, heure: "08:30" }),
          mal({ heure: "08:50" }),
          mal({ prel: "mixte", nombre: 4, heure: "09:10", prelObs: "Cube + cylindre" })
        ],
        eprRecuperees: true, codificationConfirmee: true, bassinReparti: true })
    ];

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
        statut: "sorti", dateSortie: ymd(-2), heureSortie: "09:30", sortiAt: isoAgo(2),
        operateurSortie: "Op DEMO", motifSortie: "Accord client", observationSortie: "Exemple" }),

      // E. Sorti depuis > 24 h -> PRET a tester + badge Compression
      demoLot(PREFIX + "COMP-A-TESTER", { nomProjet: "E. A tester (sorti > 24 h)", type: "cube",
        age: "7j", ageJours: 7, datePrevue: ymd(0), nombre: 3,
        statut: "sorti", dateSortie: ymd(-2), heureSortie: "09:00", sortiAt: isoAgo(2), operateurSortie: "Op DEMO" }),

      // E2. Sorti il y a 2 h -> EN SECHAGE (delai 24 h) -> demontre le forçage
      demoLot(PREFIX + "SECHAGE", { nomProjet: "E2. En sechage (24 h)", type: "cube",
        age: "7j", ageJours: 7, datePrevue: ymd(1), nombre: 3,
        statut: "sorti", dateSortie: ymd(0), heureSortie: "08:00", sortiAt: isoAgo(0, 2), operateurSortie: "Op DEMO" }),

      // F. Partiellement teste -> alerte essai incomplet (2/4 saisies)
      demoLot(PREFIX + "COMP-INCOMPLET", { nomProjet: "F. Essai incomplet", type: "cube",
        age: "7j", ageJours: 7, datePrevue: ymd(0), nombre: 4,
        statut: "sorti", dateSortie: ymd(-2), heureSortie: "09:15", sortiAt: isoAgo(2), operateurSortie: "Op DEMO",
        essais: makeEssais(PREFIX + "COMP-INCOMPLET", 4, "cube", 2) }),

      // G. Historique complet : lot teste a l'echeance prevue (aucun ecart)
      demoLot(PREFIX + "HISTO", { nomProjet: "G. Historique complet", type: "cube",
        ouvrage: "Voile", bloc: "B", etage: "2e étage", partie: "Partie 1",
        age: "28j", ageJours: 28, dateCoulage: ymd(-28), datePrevue: ymd(0), nombre: 3,
        statut: "teste", dateEssai: ymd(0), heureEssai: "10:00", agePrevu: 28, ecartEssai: false,
        operateurEssai: "Op DEMO", qualificationEssai: "Technicien",
        essais: makeEssais(PREFIX + "HISTO", 3, "cube", 3) }),

      // G2. Historique avec ECART : essai realise hors date prevue + justification
      demoLot(PREFIX + "HISTO-ECART", { nomProjet: "G2. Historique - essai hors date prevue", type: "cube",
        ouvrage: "Poteau", bloc: "C", etage: "RDC", partie: "",
        age: "7j", ageJours: 7, dateCoulage: ymd(-8), datePrevue: ymd(-1), nombre: 3,
        statut: "teste", dateEssai: ymd(0), heureEssai: "11:00",
        agePrevu: 7, ageReelMin: 8, ageReelMax: 8, ecartEssai: true,
        motifEcart: "Jour férié / non ouvrable", justificationEcart: "Presse fermée le jour prévu (férié).",
        operateurEssai: "Op DEMO", qualificationEssai: "Technicien",
        essais: makeEssais(PREFIX + "HISTO-ECART", 3, "cube", 3) })
    ];

    var chain = Promise.resolve();
    coulages.forEach(function (c) { chain = chain.then(function () { return CAEKDB.saveCoulage(c); }); });
    return chain.then(function () { return CAEKDB.addLots(lots); })
      .then(function () { return setupDechetsDemo(); })
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
      return chain.then(function () { return restoreDechetsDemo(); })
        .then(function () { return { coulages: coulages.length, lots: lots.length }; });
    });
  }

  return { load: load, clear: clear, isDemoRef: isDemoRef, PREFIX: PREFIX };
})();

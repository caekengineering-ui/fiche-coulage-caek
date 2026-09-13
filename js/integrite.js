/* Conservation des identités : une éprouvette = un code = un résultat. */
var CAEKIntegrite = (function () {
  "use strict";
  function code(x) { return typeof x === "string" ? x : String((x || {}).code || ""); }
  function codes(lot) { return (lot.codes || []).map(code); }
  function verifier(coulage, lots) {
    var attendus = CAEKModel.allCodes(coulage).map(code), vus = {}, erreurs = [];
    (lots || []).forEach(function (l) {
      var cs = codes(l);
      if (!cs.length || cs.length !== Number(l.nombre)) { erreurs.push("Nombre et codes du lot incohérents."); }
      cs.forEach(function (c) {
        if (!c || vus[c]) { erreurs.push("Code vide ou en double : " + c); }
        if (attendus.indexOf(c) < 0) { erreurs.push("Code absent du prélèvement : " + c); }
        vus[c] = true;
      });
    });
    var manquants = attendus.filter(function (c) { return !vus[c]; });
    if (manquants.length) { erreurs.push(manquants.length + " éprouvette(s) non répartie(s) : " + manquants.join(", ")); }
    return { ok: !erreurs.length && attendus.length > 0, erreurs: erreurs,
      total: attendus.length, reparties: Object.keys(vus).length, manquants: manquants };
  }
  function verifierEssais(lot, essais) {
    var cs = codes(lot), vus = {};
    if (!cs.length || Number(lot.nombre) !== cs.length || essais.length !== cs.length) {
      return "Le nombre d'essais doit correspondre au nombre d'éprouvettes du lot.";
    }
    for (var i = 0; i < essais.length; i++) {
      var c = code(essais[i]);
      if (!c || vus[c] || cs.indexOf(c) < 0) { return "Code d'essai absent du lot ou en double : " + c; }
      vus[c] = true;
    }
    return "";
  }
  function message(r) {
    var errors = {
      auth: "Reconnectez-vous.", admin: "Cette action nécessite le responsable du laboratoire.",
      conflit_revision: "Ce lot a changé sur un autre poste. Synchronisez et recommencez.",
      conflit_repartition: "La répartition a changé sur un autre poste. Synchronisez et recommencez.",
      lots_engages: "Un lot a déjà été sorti ou testé. Utilisez la correction depuis Test.",
      code_occupe: "Une éprouvette est déjà affectée à un autre lot.",
      code_inconnu: "Un code ne figure pas dans le prélèvement. Le responsable doit rectifier le prélèvement d'origine.",
      retrait_interdit: "La correction complémentaire doit conserver toutes les éprouvettes existantes.",
      sans_ajout: "Aucune éprouvette supplémentaire sélectionnée.",
      repartition_incomplete: "La répartition doit contenir toutes les éprouvettes prélevées, une seule fois.",
      essais_incoherents: "Les codes et le nombre des résultats ne correspondent pas au lot.",
      correction_en_attente: "Le responsable doit autoriser le complément d'éprouvettes avant validation.",
      mise_a_jour_requise: "Mettez l'application à jour pour enregistrer une répartition complète."
    };
    return errors[r && r.error] || (r && r.error) || "Enregistrement impossible.";
  }
  return { code: code, codes: codes, verifier: verifier, verifierEssais: verifierEssais, message: message };
})();

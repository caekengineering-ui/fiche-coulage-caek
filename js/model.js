/* ============================================================
   Fiche de coulage terrain - CAEK
   model.js - V2.02 : modele partage des prelevements d'eprouvettes
   et de la codification.

   Source de verite (V2.02) = prelevement porte par CHAQUE malaxeur :
     malaxeur.preleve   = true/false (prelevement effectue ?)
     malaxeur.prelType  = "cube" | "cylindre" | "mixte"
     malaxeur.prelNombre= nombre TOTAL d'eprouvettes prelevees
     malaxeur.prelObs   = observation (facultatif)

   Numerotation E1, E2, E3 : suit uniquement les malaxeurs AYANT
   reellement effectue un prelevement (pas le numero du malaxeur).
     Malaxeur 1 preleve -> E1 ; Malaxeur 2 sans -> rien ;
     Malaxeur 3 preleve -> E2.

   Codification (V2.03) : codification individuelle par eprouvette, au
   format REF-Echantillon-NumeroEprouvette :
     REF-E1-01, REF-E1-02 ... (prelevement E1)
     REF-E2-01, REF-E2-02 ... (prelevement E2)
   Ex. ABA001-E1-01 .. ABA001-E1-06 (prelevement E1 de 6 eprouvettes).

   Retro-compatibilite :
     - V2.01 : tableau coulage.prelevements[] (sans lien malaxeur) ;
     - V2    : anciens champs malaxeur preleve/eprCube/eprCylindre/eprNombre.
   ============================================================ */

var CAEKModel = (function () {
  "use strict";

  // Chiffres arabes-indiens (٠-٩) et persans (۰-۹) -> occidentaux, et
  // séparateur décimal arabe (٫) -> point. Toujours appliqué AVANT parsing :
  // l'arabe est une langue d'affichage, les valeurs internes restent stables.
  var AR_DIGITS = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5",
    "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2",
    "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "٫": ".", "٬": "," };
  function normDigits(v) {
    if (v == null) { return ""; }
    return String(v).replace(/[٠-٩۰-۹٫٬]/g, function (ch) { return AR_DIGITS[ch] || ch; });
  }

  function pad2(n) { n = parseInt(n, 10) || 0; return (n < 10 ? "0" : "") + n; }
  function intOr0(v) { var n = parseInt(normDigits(v), 10); return isNaN(n) ? 0 : n; }
  function floatOrNull(v) {
    var n = parseFloat(normDigits(v).replace(",", "."));
    return isNaN(n) ? null : n;
  }

  /* ---- Paramètres d'échantillonnage par laboratoire (Phase 5) ----
     Le serveur est la source de vérité ; IndexedDB n'est qu'un cache pour
     continuer à calculer la recommandation hors ligne. */
  var DEFAULT_LABO_SETTINGS = {
    seuilDechets: 100, poidsMoyenDechets: 8,
    echantPremiereTrancheM3: 50, echantPremiereTrancheNb: 9,
    echantTrancheSuivanteM3: 50, echantTrancheSuivanteNb: 3
  };
  function normalizeLaboSettings(s) {
    s = s || {};
    function pos(v, d) { var n = floatOrNull(v); return n != null && n > 0 ? n : d; }
    return {
      laboId: s.laboId || "",
      seuilDechets: pos(s.seuilDechets, DEFAULT_LABO_SETTINGS.seuilDechets),
      poidsMoyenDechets: pos(s.poidsMoyenDechets, DEFAULT_LABO_SETTINGS.poidsMoyenDechets),
      echantPremiereTrancheM3: pos(s.echantPremiereTrancheM3, DEFAULT_LABO_SETTINGS.echantPremiereTrancheM3),
      echantPremiereTrancheNb: Math.round(pos(s.echantPremiereTrancheNb, DEFAULT_LABO_SETTINGS.echantPremiereTrancheNb)),
      echantTrancheSuivanteM3: pos(s.echantTrancheSuivanteM3, DEFAULT_LABO_SETTINGS.echantTrancheSuivanteM3),
      echantTrancheSuivanteNb: Math.round(pos(s.echantTrancheSuivanteNb, DEFAULT_LABO_SETTINGS.echantTrancheSuivanteNb))
    };
  }
  function settingsLaboId(laboId) {
    if (laboId) { return laboId; }
    if (window.CAEKLaboFilter && CAEKLaboFilter.get()) { return CAEKLaboFilter.get(); }
    if (window.CAEKOperateurs && CAEKOperateurs.laboId) { return CAEKOperateurs.laboId() || ""; }
    return "";
  }
  function loadLaboSettings(laboId) {
    var id = settingsLaboId(laboId);
    var key = "laboSettings:" + (id || "default");
    var local = window.CAEKDB ? CAEKDB.getMeta(key).catch(function () { return null; }) : Promise.resolve(null);
    return local.then(function (cached) {
      var fallback = normalizeLaboSettings(cached || DEFAULT_LABO_SETTINGS);
      var online = navigator.onLine !== false && window.CAEKServer && CAEKServer.configured && CAEKServer.configured() &&
        window.CAEKOperateurs && CAEKOperateurs.isLogged && CAEKOperateurs.isLogged() && CAEKServer.getLaboSettings;
      if (!online) { return fallback; }
      return CAEKServer.getLaboSettings(CAEKOperateurs.token(), id || null).then(function (r) {
        if (!r || r.ok !== true) { return fallback; }
        var fresh = normalizeLaboSettings(r);
        var freshKey = "laboSettings:" + (fresh.laboId || id || "default");
        if (window.CAEKDB) { CAEKDB.setMeta(freshKey, fresh).catch(function () {}); }
        return fresh;
      }).catch(function () { return fallback; });
    });
  }
  function recommendationEprouvettes(quantite, settings) {
    var q = floatOrNull(quantite);
    if (q == null || q <= 0) { return 0; }
    var s = normalizeLaboSettings(settings);
    var total = s.echantPremiereTrancheNb;
    if (q > s.echantPremiereTrancheM3) {
      total += Math.ceil((q - s.echantPremiereTrancheM3) / s.echantTrancheSuivanteM3) *
        s.echantTrancheSuivanteNb;
    }
    return Math.max(0, Math.round(total));
  }

  // Type d'eprouvette d'un ancien malaxeur (retro-compat V2).
  function malaxeurType(m) {
    if (!m) { return "cube"; }
    var cube = !!m.eprCube, cyl = !!m.eprCylindre;
    if (cube && cyl) { return "mixte"; }
    if (cube) { return "cube"; }
    if (cyl) { return "cylindre"; }
    return "cube";
  }

  // Un malaxeur porte-t-il un prelevement V2.02 ?
  function malaxeurHasPrel(m) {
    return !!(m && m.preleve === true && (m.prelType || intOr0(m.prelNombre) > 0));
  }

  // Reconstruit des prelevements a partir des anciens malaxeurs V2.
  function derivePrelevements(c) {
    var out = [];
    var mals = (c && c.malaxeurs) || [];
    var k = 0;
    for (var i = 0; i < mals.length; i++) {
      var m = mals[i];
      if (m && m.preleve === true) {
        var nb = intOr0(m.eprNombre);
        if (nb > 0) {
          k++;
          out.push({ numero: "E" + k, malaxeur: i + 1, heure: m.heure || "",
            type: malaxeurType(m), nombre: nb, observation: "" });
        }
      }
    }
    return out;
  }

  // Liste normalisee des prelevements du coulage (E1, E2, ...).
  function prelevements(c) {
    var mals = (c && c.malaxeurs) || [];
    // Priorite 1 : prelevements portes par les malaxeurs (V2.02).
    var anyMal = false;
    for (var a = 0; a < mals.length; a++) { if (malaxeurHasPrel(mals[a])) { anyMal = true; break; } }
    if (anyMal) {
      var out = [], k = 0;
      for (var i = 0; i < mals.length; i++) {
        var m = mals[i];
        if (malaxeurHasPrel(m)) {
          k++;
          out.push({
            numero: "E" + k, malaxeur: i + 1, heure: m.heure || "",
            type: m.prelType || "cube", nombre: intOr0(m.prelNombre),
            observation: m.prelObs || ""
          });
        }
      }
      return out;
    }
    // Priorite 2 : tableau standalone V2.01.
    if (c && Array.isArray(c.prelevements)) {
      return c.prelevements.map(function (p, i) {
        return {
          numero: "E" + (i + 1), malaxeur: p.malaxeur || "", heure: p.heure || "",
          type: p.type || "cube", nombre: intOr0(p.nombre), observation: p.observation || ""
        };
      });
    }
    // Priorite 3 : anciens malaxeurs V2.
    return derivePrelevements(c);
  }

  function totalEprouvettes(c) {
    var t = 0;
    prelevements(c).forEach(function (p) { t += intOr0(p.nombre); });
    return t;
  }

  function hasEprouvettes(c) { return totalEprouvettes(c) > 0; }

  // Prefixe d'un prelevement : REF-Ei (sert d'etiquette de groupe).
  function prelCode(ref, ei) { return (ref || "") + "-E" + ei; }
  // Code individuel d'une eprouvette : REF-Ei-JJ (JJ = n° dans le prelevement).
  function eproCode(ref, ei, j) { return (ref || "") + "-E" + ei + "-" + pad2(j); }

  // Toutes les eprouvettes individuelles (pour repartition en lots).
  // Chaque eprouvette a son code REF-Ei-JJ.
  // -> [{ code, type, prel (1-based), numInterne (1..nombre du prelevement), malaxeur }]
  function allCodes(c) {
    var ref = (c && c.ref) || "";
    var list = prelevements(c);
    var mals = (c && c.malaxeurs) || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var nb = intOr0(p.nombre);
      var ei = i + 1;
      // Phase 3 : uuids du prélèvement/des éprouvettes (portés par le
      // malaxeur d'origine) — identité stable pour la synchronisation.
      var mal = p.malaxeur ? mals[p.malaxeur - 1] : null;
      var prelUuid = (mal && mal.prelUuid) || null;
      var eprUuids = (mal && Array.isArray(mal.eprUuids)) ? mal.eprUuids : [];
      for (var j = 1; j <= nb; j++) {
        out.push({
          code: eproCode(ref, ei, j),
          type: p.type || "cube",
          prel: ei,
          numInterne: j,
          malaxeur: p.malaxeur || "",
          prelUuid: prelUuid,
          eprUuid: eprUuids[j - 1] || null
        });
      }
    }
    return out;
  }

  // Codification groupee par prelevement (pour les recaps / exports / etiquettes).
  // -> [{ numero, malaxeur, type, heure, nombre, observation,
  //        prefixe (REF-Ei), codes:[REF-Ei-01 ...], premier, dernier }]
  function codification(c) {
    var ref = (c && c.ref) || "";
    var list = prelevements(c);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var ei = i + 1;
      var nb = intOr0(p.nombre);
      var codes = [];
      for (var j = 1; j <= nb; j++) { codes.push(eproCode(ref, ei, j)); }
      out.push({
        numero: p.numero || ("E" + ei),
        malaxeur: p.malaxeur || "",
        type: p.type || "cube",
        heure: p.heure || "",
        nombre: nb,
        observation: p.observation || "",
        prefixe: prelCode(ref, ei),
        codes: codes,
        premier: codes.length ? codes[0] : "",
        dernier: codes.length ? codes[codes.length - 1] : ""
      });
    }
    return out;
  }

  // Repartition par defaut des eprouvettes en LOTS d'essai (V2.04).
  // Regles :
  //   - ne pas melanger plusieurs prelevements dans un meme lot d'essai ;
  //   - garder au moins 3 eprouvettes du meme prelevement ensemble (si possible) ;
  //   - par defaut : 3 eprouvettes a 7 jours (depuis le plus gros prelevement
  //     ayant au moins 3 eprouvettes), le reste a 28 jours, regroupe par prelevement.
  // Exemples : 1 prel. de 9 -> 3@7j + 6@28j ; deux prel. de 3 -> 3@7j(E1) + 3@28j(E2) ;
  //   E1=6,E2=3 -> 3@7j(E1) + 3@28j(E1) + 3@28j(E2).
  // -> [{ prel, type, codes:[{code,type,prel,numInterne,malaxeur}], nombre, age, ageJours }]
  function repLot(prel, group, age, jours) {
    return {
      prel: prel,
      type: group.length ? group[0].type : "cube",
      prelUuid: group.length ? (group[0].prelUuid || null) : null,
      codes: group.map(function (x) {
        return { code: x.code, type: x.type, prel: x.prel, numInterne: x.numInterne,
          malaxeur: x.malaxeur, eprUuid: x.eprUuid || null };
      }),
      nombre: group.length,
      age: age,
      ageJours: jours
    };
  }

  function ageLabel(j) { return j === 7 ? "7j" : (j === 28 ? "28j" : "autre"); }

  // Ages d'essai exiges (defaut 7 et 28). Le PLUS GRAND age = "reste" ; les
  // ages plus petits (ex. 3, 7) prennent chacun 3 eprouvettes du plus gros
  // prelevement. Jamais de melange entre prelevements.
  function proposeRepartition(c) {
    var codes = allCodes(c);
    var byPrel = {}, order = [];
    codes.forEach(function (x) {
      if (!byPrel[x.prel]) { byPrel[x.prel] = []; order.push(x.prel); }
      byPrel[x.prel].push(x);
    });
    // Ages exiges par le projet (repli 7/28), tries croissants, uniques.
    var ages = (c && Array.isArray(c.agesEssai) && c.agesEssai.length) ? c.agesEssai : [7, 28];
    ages = ages.map(function (a) { return parseInt(a, 10); })
      .filter(function (a) { return a > 0; })
      .sort(function (a, b) { return a - b; });
    var seen = {}; ages = ages.filter(function (a) { if (seen[a]) { return false; } seen[a] = 1; return true; });
    if (!ages.length) { ages = [7, 28]; }
    var resteAge = ages[ages.length - 1];         // le plus grand = reste (28 j)
    var petits = ages.slice(0, -1);               // ex. [3, 7]
    // Plus gros prelevement (>= 3) : il porte les ages courts.
    var bigPrel = 0, best = 2;
    order.forEach(function (p) {
      if (byPrel[p].length > best) { best = byPrel[p].length; bigPrel = p; }
    });
    var lots = [];
    order.forEach(function (p) {
      var g = byPrel[p];
      if (p === bigPrel && petits.length) {
        var idx = 0;
        petits.forEach(function (a) {
          // On ne detache 3 eprouvettes que s'il en reste strictement plus de
          // 3 (pour garder au moins 1 eprouvette au "reste").
          if (g.length - idx > 3) {
            lots.push(repLot(p, g.slice(idx, idx + 3), ageLabel(a), a));
            idx += 3;
          }
        });
        if (g.length - idx > 0) { lots.push(repLot(p, g.slice(idx), ageLabel(resteAge), resteAge)); }
      } else {
        lots.push(repLot(p, g, ageLabel(resteAge), resteAge));
      }
    });
    return lots;
  }

  // Synthese des types presents (pour le bassin : formes carre/cercle/hexagone).
  function typesInfo(c) {
    var list = prelevements(c);
    var hasCube = false, hasCyl = false;
    list.forEach(function (p) {
      var t = p.type || "cube";
      if (t === "cube") { hasCube = true; }
      else if (t === "cylindre") { hasCyl = true; }
      else if (t === "mixte") { hasCube = true; hasCyl = true; }
    });
    var available = [];
    if (hasCube) { available.push("cube"); }
    if (hasCyl) { available.push("cylindre"); }
    var deflt = hasCube ? "cube" : (hasCyl ? "cylindre" : "cube");
    return {
      total: totalEprouvettes(c),
      hasCube: hasCube,
      hasCyl: hasCyl,
      availableTypes: available,
      defaultType: deflt
    };
  }

  // Les eprouvettes ont-elles ete recuperees ET la codification confirmee ?
  function recuperationOk(c) {
    return !!(c && c.eprRecuperees && c.codificationConfirmee);
  }

  /* ================= Conversion cube -> cylindre =================
     Miroir EXACT de la regle bureau (documents_beton.facteur_conversion_
     classe) : la classe s'ecrit C<fck,cyl>/<fck,cube> et le facteur est le
     rapport des deux resistances caracteristiques, arrondi a 2 decimales
     (C35/45 -> 0.78 ; C30/37 -> 0.81). La saisie terrain est libre : le « C »
     peut manquer (« 30/37 ») et le separateur etre mal frappe (« C35l45 ») ;
     en revanche fck,cyl doit rester INFERIEUR a fck,cube, sinon ce n'est pas
     une classe et rien n'est deduit (on ne devine jamais un facteur).
     ATTENTION : sans classe exploitable il n'y a PAS de valeur cylindrique.
     Afficher la valeur cubique a sa place serait un faux resultat. */
  function classePaire(classe) {
    var s = normDigits(classe == null ? "" : classe);
    var m = /C?\s*(\d{1,3}(?:[.,]\d+)?)\s*[/\\|lL_-]\s*(\d{1,3}(?:[.,]\d+)?)/.exec(String(s));
    if (!m) { return null; }
    var cyl = parseFloat(m[1].replace(",", "."));
    var cube = parseFloat(m[2].replace(",", "."));
    if (!(cyl > 0) || !(cube > 0) || cyl >= cube) { return null; }
    return { cyl: cyl, cube: cube, facteur: Math.round((cyl / cube) * 100) / 100 };
  }

  function facteurConversionClasse(classe) {
    var p = classePaire(classe);
    return p ? p.facteur : null;
  }

  // Classe de beton d'un LOT. Le lot porte sa classe depuis la repartition
  // (`classe`) ; les lots anterieurs a cette evolution ne l'ont pas, d'ou le
  // repli sur le coulage passe en second argument (peut etre absent).
  function classeBetonLot(lot, coulage) {
    var l = lot || {};
    var direct = l.classe || l.classeBeton || (l.formulation || {}).classe;
    if (direct) { return direct; }
    var c = coulage || {};
    var mal = (c.malaxeurs || [])[0] || {};
    return (mal.formulation || {}).classe || c.classeBeton || c.classe || "";
  }

  // Conversion d'une valeur cubique en cylindrique. Retourne null si la
  // classe ne permet pas de deduire un facteur : l'appelant DOIT alors
  // afficher l'absence de valeur, jamais la valeur cubique.
  function cubeVersCylindre(valeurCubique, classe) {
    var f = facteurConversionClasse(classe);
    var v = parseFloat(valeurCubique);
    if (f == null || !isFinite(v)) { return null; }
    return Math.round(v * f * 100) / 100;
  }

  /* Jalon temoin a 7 jours : la resistance doit atteindre 75 % de la classe.
     Comparaison faite sur la MEME base que la mesure — une moyenne cubique se
     compare a fck,cube, une moyenne cylindrique a fck,cyl. Ex. classe 35/45,
     moyenne cubique 29 MPa : seuil 45 x 0.75 = 33.75 > 29 -> sous le jalon. */
  var SEUIL_JALON_7J = 0.75;

  function jalon7j(moyenne, classe, base) {
    var p = classePaire(classe);
    var m = parseFloat(moyenne);
    if (!p || !isFinite(m)) { return null; }
    var reference = (base === "cylindre") ? p.cyl : p.cube;
    var seuil = Math.round(reference * SEUIL_JALON_7J * 100) / 100;
    return { seuil: seuil, reference: reference, atteint: m >= seuil, moyenne: m };
  }

  return {
    normDigits: normDigits,
    floatOrNull: floatOrNull,
    DEFAULT_LABO_SETTINGS: DEFAULT_LABO_SETTINGS,
    normalizeLaboSettings: normalizeLaboSettings,
    loadLaboSettings: loadLaboSettings,
    recommendationEprouvettes: recommendationEprouvettes,
    pad2: pad2,
    intOr0: intOr0,
    malaxeurType: malaxeurType,
    malaxeurHasPrel: malaxeurHasPrel,
    derivePrelevements: derivePrelevements,
    prelevements: prelevements,
    totalEprouvettes: totalEprouvettes,
    hasEprouvettes: hasEprouvettes,
    prelCode: prelCode,
    eproCode: eproCode,
    allCodes: allCodes,
    codification: codification,
    proposeRepartition: proposeRepartition,
    typesInfo: typesInfo,
    recuperationOk: recuperationOk,
    classePaire: classePaire,
    facteurConversionClasse: facteurConversionClasse,
    classeBetonLot: classeBetonLot,
    cubeVersCylindre: cubeVersCylindre,
    jalon7j: jalon7j,
    SEUIL_JALON_7J: SEUIL_JALON_7J
  };
})();

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

  function pad2(n) { n = parseInt(n, 10) || 0; return (n < 10 ? "0" : "") + n; }
  function intOr0(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

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
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var nb = intOr0(p.nombre);
      var ei = i + 1;
      for (var j = 1; j <= nb; j++) {
        out.push({
          code: eproCode(ref, ei, j),
          type: p.type || "cube",
          prel: ei,
          numInterne: j,
          malaxeur: p.malaxeur || ""
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
      codes: group.map(function (x) {
        return { code: x.code, type: x.type, prel: x.prel, numInterne: x.numInterne, malaxeur: x.malaxeur };
      }),
      nombre: group.length,
      age: age,
      ageJours: jours
    };
  }

  function proposeRepartition(c) {
    var codes = allCodes(c);
    var byPrel = {}, order = [];
    codes.forEach(function (x) {
      if (!byPrel[x.prel]) { byPrel[x.prel] = []; order.push(x.prel); }
      byPrel[x.prel].push(x);
    });
    // Prelevement portant le test 7 jours = le plus gros ayant >= 3 eprouvettes.
    var sevenPrel = 0, best = 2;
    order.forEach(function (p) {
      if (byPrel[p].length > best) { best = byPrel[p].length; sevenPrel = p; }
    });
    var lots = [];
    order.forEach(function (p) {
      var g = byPrel[p];
      if (p === sevenPrel) {
        lots.push(repLot(p, g.slice(0, 3), "7j", 7));
        if (g.length > 3) { lots.push(repLot(p, g.slice(3), "28j", 28)); }
      } else {
        lots.push(repLot(p, g, "28j", 28));
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

  return {
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
    recuperationOk: recuperationOk
  };
})();

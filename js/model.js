/* ============================================================
   Fiche de coulage terrain - CAEK
   model.js - V2.01 : modele partage des prelevements d'eprouvettes
   et de la codification.

   Source de verite des eprouvettes = coulage.prelevements (Array) :
     [{ numero:"E1", heure:"10:30", type:"cube|cylindre|mixte",
        nombre:6, observation:"" }, ...]

   Retro-compatibilite V2 : si un coulage n'a pas de tableau
   prelevements, on le derive des anciens malaxeurs (champs preleve /
   eprCube / eprCylindre / eprNombre).

   Codification d'une eprouvette : REF-JJ-Ei
     REF = ref du coulage (ex. API031)
     JJ  = numero de l'eprouvette dans le prelevement (01, 02, ...)
     Ei  = numero du prelevement (E1, E2, E3, ...)
   Exemple : API031-01-E1 ... API031-06-E1 (prelevement E1 de 6).
   ============================================================ */

var CAEKModel = (function () {
  "use strict";

  function pad2(n) { n = parseInt(n, 10) || 0; return (n < 10 ? "0" : "") + n; }
  function intOr0(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

  // Type d'eprouvette d'un ancien malaxeur (retro-compat V2).
  function malaxeurType(m) {
    if (!m) { return ""; }
    var cube = !!m.eprCube, cyl = !!m.eprCylindre;
    if (cube && cyl) { return "mixte"; }
    if (cube) { return "cube"; }
    if (cyl) { return "cylindre"; }
    return "cube"; // prelevement sans type explicite : cube par defaut
  }

  // Reconstruit des prelevements a partir des anciens malaxeurs.
  function derivePrelevements(c) {
    var out = [];
    var mals = (c && c.malaxeurs) || [];
    for (var i = 0; i < mals.length; i++) {
      var m = mals[i];
      if (m && m.preleve === true) {
        var nb = intOr0(m.eprNombre);
        if (nb > 0) {
          out.push({
            heure: m.heure || "",
            type: malaxeurType(m),
            nombre: nb,
            observation: ""
          });
        }
      }
    }
    return out;
  }

  // Liste normalisee des prelevements du coulage.
  function prelevements(c) {
    if (c && Array.isArray(c.prelevements)) { return c.prelevements; }
    return derivePrelevements(c);
  }

  function totalEprouvettes(c) {
    var t = 0;
    prelevements(c).forEach(function (p) { t += intOr0(p.nombre); });
    return t;
  }

  function hasEprouvettes(c) { return totalEprouvettes(c) > 0; }

  // Numero affiche d'un prelevement : "E" + (index 1-based).
  function prelLabel(i) { return "E" + (i + 1); }

  // Toutes les eprouvettes avec leur codification individuelle.
  // -> [{ code, type, prel (1-based), index (1-based) }]
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
          code: ref + "-" + pad2(j) + "-E" + ei,
          type: p.type || "cube",
          prel: ei,
          index: j
        });
      }
    }
    return out;
  }

  // Codification groupee par prelevement (pour les recaps / exports).
  // -> [{ numero, type, heure, nombre, observation, premier, dernier, codes:[] }]
  function codification(c) {
    var ref = (c && c.ref) || "";
    var list = prelevements(c);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var nb = intOr0(p.nombre);
      var ei = i + 1;
      var codes = [];
      for (var j = 1; j <= nb; j++) {
        codes.push(ref + "-" + pad2(j) + "-E" + ei);
      }
      out.push({
        numero: prelLabel(i),
        type: p.type || "cube",
        heure: p.heure || "",
        nombre: nb,
        observation: p.observation || "",
        premier: codes.length ? codes[0] : "",
        dernier: codes.length ? codes[codes.length - 1] : "",
        codes: codes
      });
    }
    return out;
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
    derivePrelevements: derivePrelevements,
    prelevements: prelevements,
    totalEprouvettes: totalEprouvettes,
    hasEprouvettes: hasEprouvettes,
    allCodes: allCodes,
    codification: codification,
    typesInfo: typesInfo,
    recuperationOk: recuperationOk
  };
})();

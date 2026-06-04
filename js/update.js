/* ============================================================
   Fiche de coulage terrain - CAEK
   update.js - T2 : import du fichier UPDATE projets (.xlsx)
   Lecture via SheetJS -> validation -> fusion IndexedDB.
   ============================================================ */

var CAEKUpdate = (function () {
  "use strict";

  // Normalise un en-tete : minuscules, sans accents, sans espaces/_/-
  function normHeader(h) {
    return String(h == null ? "" : h)
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[\s_\-./]/g, "");
  }

  // Aliases acceptes -> champ interne
  var HEADER_MAP = {
    entreprise: "entreprise", societe: "entreprise", raisonsociale: "entreprise",
    client: "client",
    codeprojet: "codeProjet", code: "codeProjet",
    nomprojet: "nomProjet", projet: "nomProjet", nom: "nomProjet",
    adresse: "adresse", localisation: "adresse", ville: "adresse",
    contact: "contact", contactnom: "contact", telephone: "contact", tel: "contact",
    resistancerequisempa: "resistance", resistancerequise: "resistance",
    resistance: "resistance", resistancempa: "resistance"
  };

  function cleanStr(v) {
    return v == null ? "" : String(v).trim();
  }

  function cleanCode(v) {
    return cleanStr(v).toUpperCase().replace(/\s+/g, "");
  }

  function toNumberOrEmpty(v) {
    if (v == null || v === "") { return ""; }
    var n = parseFloat(String(v).replace(",", "."));
    return isNaN(n) ? null : n; // null = valeur presente mais invalide
  }

  // Analyse un ArrayBuffer Excel -> { ok, error, projets, stats }
  function parseWorkbook(buffer) {
    var wb;
    try {
      wb = XLSX.read(buffer, { type: "array" });
    } catch (e) {
      return { ok: false, error: "Format non reconnu. Importez un fichier Excel (.xlsx) envoyé par le bureau." };
    }

    var sheetName = wb.SheetNames.indexOf("PROJETS") >= 0 ? "PROJETS" : wb.SheetNames[0];
    if (!sheetName) {
      return { ok: false, error: "Le fichier ne contient aucune feuille lisible." };
    }
    var ws = wb.Sheets[sheetName];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
    if (!rows.length) {
      return { ok: false, error: "Le fichier ne contient aucun projet valide." };
    }

    // Ligne d'en-tete = premiere ligne
    var headers = rows[0].map(normHeader);
    var colIndex = {};
    headers.forEach(function (h, idx) {
      var field = HEADER_MAP[h];
      if (field && colIndex[field] === undefined) { colIndex[field] = idx; }
    });

    var manquantes = ["codeProjet", "entreprise", "nomProjet"].filter(function (f) {
      return colIndex[f] === undefined;
    });
    if (manquantes.length) {
      return {
        ok: false,
        error: "Colonnes obligatoires introuvables : CodeProjet, Entreprise, NomProjet. Vérifiez la première ligne du fichier."
      };
    }

    var get = function (row, field) {
      var i = colIndex[field];
      return i === undefined ? "" : row[i];
    };

    var seen = {};
    var projets = [];
    var stats = { ignorees: 0, doublons: 0, resInvalides: 0 };
    var nowIso = new Date().toISOString();

    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var code = cleanCode(get(row, "codeProjet"));
      var entreprise = cleanStr(get(row, "entreprise"));
      var nomProjet = cleanStr(get(row, "nomProjet"));

      if (!code || !entreprise || !nomProjet) { stats.ignorees++; continue; }

      var res = toNumberOrEmpty(get(row, "resistance"));
      if (res === null) { stats.resInvalides++; res = ""; }

      var item = {
        codeProjet: code,
        entreprise: entreprise,
        client: cleanStr(get(row, "client")),
        nomProjet: nomProjet,
        adresse: cleanStr(get(row, "adresse")),
        contact: cleanStr(get(row, "contact")),
        resistance: res,
        dateMaj: nowIso
      };
      if (seen[code] !== undefined) {
        // Doublon dans le fichier : la derniere occurrence l'emporte
        stats.doublons++;
        projets[seen[code]] = item;
      } else {
        seen[code] = projets.length;
        projets.push(item);
      }
    }

    if (!projets.length) {
      return { ok: false, error: "Le fichier ne contient aucun projet valide." };
    }
    return { ok: true, projets: projets, stats: stats };
  }

  // Import complet : parse -> fusion -> meta. Retourne un objet bilan.
  function importBuffer(buffer, fileName) {
    var parsed = parseWorkbook(buffer);
    if (!parsed.ok) { return Promise.resolve({ ok: false, error: parsed.error }); }

    return CAEKDB.upsertProjets(parsed.projets).then(function (res) {
      var nowIso = new Date().toISOString();
      return Promise.all([
        CAEKDB.setMeta("lastImportDate", nowIso),
        CAEKDB.setMeta("lastImportFileName", fileName || ""),
        CAEKDB.countProjets()
      ]).then(function (out) {
        var total = out[2];
        return CAEKDB.setMeta("lastImportCount", total).then(function () {
          return {
            ok: true,
            ajoutes: res.ajoutes,
            misAJour: res.misAJour,
            ignorees: parsed.stats.ignorees,
            doublons: parsed.stats.doublons,
            resInvalides: parsed.stats.resInvalides,
            total: total,
            date: nowIso
          };
        });
      });
    });
  }

  return {
    parseWorkbook: parseWorkbook,
    importBuffer: importBuffer
  };
})();

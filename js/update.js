/* ============================================================
   Fiche de coulage terrain - CAEK
   update.js - Import du fichier bureau client.xlsx (.xlsx)
   V1 : 2 feuilles CLIENTS + PROJETS, jointure par ClientID.
   Repli : ancien format mono-feuille PROJETS (entreprise) -> clients synthetises.
   Lecture via SheetJS -> validation -> fusion IndexedDB.
   ============================================================ */

var CAEKUpdate = (function () {
  "use strict";

  // Normalise un en-tete : minuscules, sans accents, sans espaces/_/-/.
  function normHeader(h) {
    return String(h == null ? "" : h)
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[\s_\-./'’]/g, "");
  }

  function cleanStr(v) { return v == null ? "" : String(v).trim(); }
  function cleanCode(v) { return cleanStr(v).toUpperCase().replace(/\s+/g, ""); }

  function isActif(v) {
    var s = cleanStr(v).toLowerCase();
    if (s === "") { return true; } // absence => considere actif
    return (s === "oui" || s === "yes" || s === "true" || s === "1" || s === "actif" || s === "o");
  }

  function toNumberOrEmpty(v) {
    if (v == null || v === "") { return ""; }
    var n = parseFloat(String(v).replace(",", "."));
    return isNaN(n) ? null : n; // null = present mais invalide
  }

  function parseAges(v) {
    var raw = cleanStr(v);
    if (!raw) { return [7, 28]; }
    var seen = {};
    var out = raw.split(/[;,/|+\s]+/).map(function (x) { return parseInt(x, 10); })
      .filter(function (n) {
        if (!(n > 0) || seen[n]) { return false; }
        seen[n] = true;
        return true;
      })
      .sort(function (a, b) { return a - b; });
    return out.length ? out : [7, 28];
  }

  // Construit { champInterne: indexColonne } a partir d'une ligne d'en-tete.
  function resolveCols(headerRow, map) {
    var headers = headerRow.map(normHeader);
    var colIndex = {};
    headers.forEach(function (h, idx) {
      var field = map[h];
      if (field && colIndex[field] === undefined) { colIndex[field] = idx; }
    });
    return colIndex;
  }

  function cell(row, colIndex, field) {
    var i = colIndex[field];
    return i === undefined ? "" : row[i];
  }

  function rowsOf(ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
  }

  // --- Mappages d'en-tetes (apres normalisation) ---
  var CLIENT_MAP = {
    clientid: "clientId",
    nomclientraisonsociale: "nom", nomclient: "nom", raisonsociale: "nom", nom: "nom", client: "nom",
    adresse: "adresse",
    ville: "ville",
    contactnom: "contactNom", contact: "contactNom",
    contacttel: "contactTel", telephone: "contactTel", tel: "contactTel",
    email: "email",
    notes: "notes",
    actif: "actif"
  };

  var PROJET_MAP = {
    projetid: "projetId",
    clientid: "clientId",
    codeprojet: "codeProjet", code: "codeProjet",
    nomprojet: "nomProjet", projet: "nomProjet",
    localisation: "localisation", adresse: "localisation", ville: "localisation",
    resistancerequisempa: "resistance", resistancerequise: "resistance", resistance: "resistance", resistancempa: "resistance",
    referencecommande: "referenceCommande", refcommande: "referenceCommande",
    referencedossier: "referenceDossier", refdossier: "referenceDossier",
    agesessai: "agesEssai", agesdessai: "agesEssai", ageessai: "agesEssai", agedessai: "agesEssai",
    ages: "agesEssai", echeances: "agesEssai", echeancesessai: "agesEssai",
    entreprise: "entreprise", societe: "entreprise"
  };

  // Pseudo-clientId pour l'ancien format (base sur le nom d'entreprise).
  function slugClient(nom) {
    return "ENT_" + normHeader(nom).slice(0, 24).toUpperCase();
  }

  // Analyse un ArrayBuffer Excel -> { ok, error, clients, projets, stats }
  function parseWorkbook(buffer) {
    var wb;
    try {
      wb = XLSX.read(buffer, { type: "array" });
    } catch (e) {
      return { ok: false, error: "Format non reconnu. Importez le fichier Excel (.xlsx) du bureau." };
    }

    var hasClients = wb.SheetNames.indexOf("CLIENTS") >= 0;
    var hasProjets = wb.SheetNames.indexOf("PROJETS") >= 0;

    var stats = { clientsIgnores: 0, projetsIgnores: 0, doublonsClients: 0, doublonsProjets: 0, resInvalides: 0, orphelins: 0 };
    var nowIso = new Date().toISOString();

    var clients = [];
    var clientsSeen = {};
    var projets = [];
    var projetsSeen = {};

    // ---------- Feuille CLIENTS ----------
    if (hasClients) {
      var rowsC = rowsOf(wb.Sheets["CLIENTS"]);
      if (rowsC.length) {
        var colC = resolveCols(rowsC[0], CLIENT_MAP);
        if (colC.clientId === undefined || colC.nom === undefined) {
          return { ok: false, error: "Feuille CLIENTS : colonnes ClientID et NomClient/RaisonSociale requises." };
        }
        for (var i = 1; i < rowsC.length; i++) {
          var rC = rowsC[i];
          var cid = cleanStr(cell(rC, colC, "clientId"));
          var nom = cleanStr(cell(rC, colC, "nom"));
          if (!cid || !nom) { stats.clientsIgnores++; continue; }
          var itemC = {
            clientId: cid,
            nom: nom,
            adresse: cleanStr(cell(rC, colC, "adresse")),
            ville: cleanStr(cell(rC, colC, "ville")),
            contactNom: cleanStr(cell(rC, colC, "contactNom")),
            contactTel: cleanStr(cell(rC, colC, "contactTel")),
            email: cleanStr(cell(rC, colC, "email")),
            actif: isActif(cell(rC, colC, "actif")),
            dateMaj: nowIso
          };
          if (clientsSeen[cid] !== undefined) { stats.doublonsClients++; clients[clientsSeen[cid]] = itemC; }
          else { clientsSeen[cid] = clients.length; clients.push(itemC); }
        }
      }
    }

    // ---------- Feuille PROJETS ----------
    var projSheet = hasProjets ? "PROJETS" : (hasClients ? null : wb.SheetNames[0]);
    if (!projSheet) {
      return { ok: false, error: "Feuille PROJETS introuvable dans le fichier." };
    }
    var rowsP = rowsOf(wb.Sheets[projSheet]);
    if (!rowsP.length) {
      return { ok: false, error: "La feuille PROJETS est vide." };
    }
    var colP = resolveCols(rowsP[0], PROJET_MAP);
    if (colP.codeProjet === undefined || colP.nomProjet === undefined) {
      return { ok: false, error: "Feuille PROJETS : colonnes CodeProjet et NomProjet requises." };
    }
    var ancienFormat = !hasClients; // pas de feuille CLIENTS => entreprise dans PROJETS

    for (var j = 1; j < rowsP.length; j++) {
      var rP = rowsP[j];
      var code = cleanCode(cell(rP, colP, "codeProjet"));
      var nomProjet = cleanStr(cell(rP, colP, "nomProjet"));
      if (!code || !nomProjet) { stats.projetsIgnores++; continue; }

      var clientId = cleanStr(cell(rP, colP, "clientId"));

      // Ancien format : pas de ClientID -> on synthetise un client depuis l'entreprise.
      if (ancienFormat) {
        var ent = cleanStr(cell(rP, colP, "entreprise")) || nomProjet;
        clientId = slugClient(ent);
        if (clientsSeen[clientId] === undefined) {
          clientsSeen[clientId] = clients.length;
          clients.push({
            clientId: clientId, nom: ent, adresse: cleanStr(cell(rP, colP, "localisation")),
            ville: "", contactNom: "", contactTel: "", email: "", actif: true, dateMaj: nowIso
          });
        }
      } else if (clientId && clientsSeen[clientId] === undefined) {
        stats.orphelins++; // projet referencant un client absent de la feuille CLIENTS
      }

      var res = toNumberOrEmpty(cell(rP, colP, "resistance"));
      if (res === null) { stats.resInvalides++; res = ""; }

      var itemP = {
        codeProjet: code,
        clientId: clientId,
        nomProjet: nomProjet,
        localisation: cleanStr(cell(rP, colP, "localisation")),
        referenceCommande: cleanStr(cell(rP, colP, "referenceCommande")),
        referenceDossier: cleanStr(cell(rP, colP, "referenceDossier")),
        resistance: res,
        agesEssai: parseAges(cell(rP, colP, "agesEssai")),
        actif: isActif(cell(rP, colP, "actif")),
        dateMaj: nowIso
      };
      if (projetsSeen[code] !== undefined) { stats.doublonsProjets++; projets[projetsSeen[code]] = itemP; }
      else { projetsSeen[code] = projets.length; projets.push(itemP); }
    }

    if (!projets.length) {
      return { ok: false, error: "Le fichier ne contient aucun projet valide." };
    }
    return { ok: true, clients: clients, projets: projets, stats: stats };
  }

  // Import complet : parse -> fusion clients + projets -> meta. Retourne un bilan.
  function importBuffer(buffer, fileName) {
    var parsed = parseWorkbook(buffer);
    if (!parsed.ok) { return Promise.resolve({ ok: false, error: parsed.error }); }

    var pClients = parsed.clients.length
      ? CAEKDB.upsertClients(parsed.clients)
      : Promise.resolve({ ajoutes: 0, misAJour: 0 });

    return pClients.then(function (resC) {
      return CAEKDB.upsertProjets(parsed.projets).then(function (resP) {
        var nowIso = new Date().toISOString();
        return Promise.all([
          CAEKDB.setMeta("lastImportDate", nowIso),
          CAEKDB.setMeta("lastImportFileName", fileName || ""),
          CAEKDB.countProjets(),
          CAEKDB.countClients()
        ]).then(function (out) {
          return {
            ok: true,
            clientsAjoutes: resC.ajoutes, clientsMisAJour: resC.misAJour,
            projetsAjoutes: resP.ajoutes, projetsMisAJour: resP.misAJour,
            // alias retro-compat affichage
            ajoutes: resP.ajoutes, misAJour: resP.misAJour,
            ignorees: parsed.stats.projetsIgnores,
            doublons: parsed.stats.doublonsProjets,
            resInvalides: parsed.stats.resInvalides,
            orphelins: parsed.stats.orphelins,
            totalProjets: out[2],
            totalClients: out[3],
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

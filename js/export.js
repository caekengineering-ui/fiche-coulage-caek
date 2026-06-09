/* ============================================================
   Fiche de coulage terrain - CAEK
   export.js - V1 : message recap + Excel (.xlsx) + ZIP complet + partage
   Modele V1 : c.malaxeurs[] (1 ligne = 1 malaxeur), formulation par malaxeur,
   eprouvettes par malaxeur, anomalie, signature operateur.
   Nommage des fichiers par reference : ABA014_fiche_coulage.xlsx,
   ABA014_photo_BL_01.jpg, ABA014_photo_anomalie_01.jpg, ABA014_export.zip ...
   Compat bureau v1.04 : RAPPORT_COULAGE!B7 (ouvrages), B8 (bloc+etage),
   B11 (affaissement du 1er malaxeur).
   ============================================================ */

var CAEKExport = (function () {
  "use strict";

  /* ---------- Utilitaires ---------- */

  function fmtDateFr(iso) {
    if (!iso) { return ""; }
    if (/^\d{4}-\d{2}-\d{2}/.test(String(iso))) {
      var p = String(iso).slice(0, 10).split("-");
      return p[2] + "/" + p[1] + "/" + p[0];
    }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ""; }
    var q = function (n) { return (n < 10 ? "0" : "") + n; };
    return q(d.getDate()) + "/" + q(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  function safeName(s) { return String(s == null ? "" : s).replace(/[^A-Za-z0-9_-]+/g, "_"); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? 0 : n; }

  function statutLabel(s) {
    return ({ brouillon: "Brouillon", validee: "Validée", envoyee: "Envoyé" })[s] || (s || "Brouillon");
  }

  // Totaux recalcules : quantite sur les malaxeurs, eprouvettes via le modele
  // partage (prelevements V2.01, retro-compatible avec les anciens malaxeurs).
  function totals(c) {
    var q = 0;
    (c.malaxeurs || []).forEach(function (m) { q += num(m.quantite); });
    var e = window.CAEKModel ? CAEKModel.totalEprouvettes(c) : 0;
    return { quantite: Math.round(q * 100) / 100, eprouvettes: e };
  }

  var TYPE_LABEL_XLS = { cube: "Cube", cylindre: "Cylindre", mixte: "Mixte" };

  // Description texte d'une formulation (resolue : reprise deja appliquee a la saisie).
  function formuDesc(f) {
    if (!f) { return ""; }
    if (f.mode === "photo") { return "Voir photo BL/formulation"; }
    return [f.fournisseur, f.classe, f.ciment,
      (f.dosage ? f.dosage + " kg/m³" : ""), (f.dmax ? "Dmax " + f.dmax : ""), f.adjuvant]
      .filter(Boolean).join(" · ");
  }

  /* ---------- 1) Message recap (WhatsApp / e-mail) ---------- */

  function buildMessage(c) {
    var t = totals(c);
    return "Fiche de coulage " + (c.ref || "") +
      " — Client : " + (c.client || c.entreprise || "—") +
      " — Projet : " + (c.nomProjet || "—") +
      " — Date : " + (fmtDateFr(c.dateCoulage) || "—") +
      " — Quantité totale : " + t.quantite + " m³" +
      " — Éprouvettes : " + t.eprouvettes +
      " — Statut : " + statutLabel(c.statut) + ".";
  }

  /* ---------- 2) Classeur Excel ---------- */

  function buildWorkbook(c) {
    var t = totals(c);
    var aoa = [];
    aoa.push(["CAEK ENGINEERING LAB"]);
    aoa.push(["Fiche de coulage terrain"]);
    aoa.push([]);
    aoa.push(["Référence", c.ref || ""]);
    aoa.push(["Statut", statutLabel(c.statut)]);
    aoa.push(["Date du coulage", fmtDateFr(c.dateCoulage)]);
    aoa.push([]);
    aoa.push(["Client / Entreprise", c.client || c.entreprise || ""]);
    aoa.push(["Projet", c.nomProjet || ""]);
    aoa.push(["Code projet", c.codeProjet || ""]);
    aoa.push(["Adresse", c.adresse || ""]);
    aoa.push(["Ville", c.ville || ""]);
    aoa.push(["Contact", c.contact || [c.contactNom, c.contactTel].filter(Boolean).join(" — ")]);
    aoa.push(["Référence commande", c.referenceCommande || ""]);
    aoa.push(["Référence dossier", c.referenceDossier || ""]);
    aoa.push([]);
    aoa.push(["Ouvrage(s) coulé(s)", c.ouvrageCoule || ""]);
    aoa.push(["Bloc / Étage", c.ouvrageZonePartie || ""]);
    aoa.push([]);
    aoa.push(["MALAXEURS"]);
    aoa.push(["N°", "Heure", "Quantité (m³)", "Affaiss. (cm)", "Temp. (°C)",
      "N° camion", "N° BL", "Formulation / centrale"]);
    (c.malaxeurs || []).forEach(function (m, i) {
      aoa.push([
        i + 1, m.heure || "", num(m.quantite) || "", m.affaissement || "", m.temperature || "",
        m.numCamion || "", m.numBL || "", formuDesc(m.formulation)
      ]);
    });
    aoa.push([]);

    // --- Prelevements d'eprouvettes + codification (V2.01) ---
    var codif = window.CAEKModel ? CAEKModel.codification(c) : [];
    aoa.push(["PRÉLÈVEMENTS D'ÉPROUVETTES"]);
    aoa.push(["Prélèvement", "Heure", "Type", "Nombre", "Codification", "Observation"]);
    if (codif.length) {
      codif.forEach(function (p) {
        var plage = p.nombre > 1 ? (p.premier + " → " + p.dernier) : (p.premier || "");
        aoa.push([
          p.numero, p.heure || "", TYPE_LABEL_XLS[p.type] || p.type || "",
          p.nombre || "", plage, p.observation || ""
        ]);
      });
    } else {
      aoa.push(["Aucun prélèvement", "", "", "", "", ""]);
    }
    aoa.push([]);
    aoa.push(["Quantité totale (m³)", t.quantite]);
    aoa.push(["Total éprouvettes", t.eprouvettes]);
    aoa.push(["Nombre de malaxeurs", (c.malaxeurs || []).length]);
    aoa.push([]);
    if (c.anomalie && c.anomalie.texte) {
      aoa.push(["Anomalie signalée", c.anomalie.texte]);
    }
    aoa.push(["Opérateur (signature interne)", c.signatureOperateur || ""]);

    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 13 }, { wch: 9 }, { wch: 13 }, { wch: 12 }, { wch: 22 },
      { wch: 14 }, { wch: 12 }, { wch: 34 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fiche coulage");
    appendCompatSheets(wb, c);
    return wb;
  }

  /* ---------- Compat bureau (mapping v1.04) ---------- */

  function toDate(iso) {
    if (!iso) { return null; }
    if (/^\d{4}-\d{2}-\d{2}/.test(String(iso))) {
      var p = String(iso).slice(0, 10).split("-");
      var d0 = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      return isNaN(d0.getTime()) ? null : d0;
    }
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function setCell(ws, addr, value, isDate) {
    if (value === "" || value == null) { return; }
    if (isDate && value instanceof Date) { ws[addr] = { t: "d", v: value, z: "dd/mm/yyyy" }; }
    else if (typeof value === "number" && !isNaN(value)) { ws[addr] = { t: "n", v: value }; }
    else { ws[addr] = { t: "s", v: String(value) }; }
  }

  function numOrNull(v) { var n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? null : n; }

  // 1er malaxeur = valeurs principales pour la compat bureau.
  function appendCompatSheets(wb, c) {
    var m0 = (c.malaxeurs && c.malaxeurs.length) ? c.malaxeurs[0] : {};
    var f0 = m0.formulation || {};

    // --- PROJET ---
    var wsP = {};
    setCell(wsP, "A3", "Code projet"); setCell(wsP, "B3", c.codeProjet || "");
    setCell(wsP, "A4", "Nom projet"); setCell(wsP, "B4", c.nomProjet || "");
    setCell(wsP, "A5", "Client"); setCell(wsP, "B5", c.client || c.entreprise || "");
    setCell(wsP, "A11", "Conversion (Oui/Non)"); setCell(wsP, "B11", "Non");
    wsP["!ref"] = "A1:B13";
    wsP["!cols"] = [{ wch: 22 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsP, "PROJET");

    // --- RAPPORT_COULAGE ---
    var wsR = {};
    var aff = numOrNull(m0.affaissement);
    setCell(wsR, "A4", "Référence coulage"); setCell(wsR, "B4", c.ref || "");
    setCell(wsR, "A5", "Date du coulage"); setCell(wsR, "B5", toDate(c.dateCoulage), true);
    setCell(wsR, "A7", "Ouvrage"); setCell(wsR, "B7", c.ouvrageCoule || "");        // B7 = ouvrages
    setCell(wsR, "A8", "Partie / zone"); setCell(wsR, "B8", c.ouvrageZonePartie || ""); // B8 = bloc+etage
    setCell(wsR, "A11", "Affaissement (cm)"); if (aff != null) { setCell(wsR, "B11", aff); } // B11 = 1er malaxeur
    setCell(wsR, "A13", "Technicien prélèvement"); setCell(wsR, "B13", c.signatureOperateur || "");
    setCell(wsR, "A16", "Classe béton"); setCell(wsR, "B16", f0.classe || "");
    var aCAEK = window.CAEKModel ? CAEKModel.hasEprouvettes(c) : (m0.preleve === true);
    setCell(wsR, "A18", "Prélèvement par CAEK"); setCell(wsR, "B18", aCAEK ? "Oui" : "");
    setCell(wsR, "A20", "Formulation / dosage"); setCell(wsR, "B20", formuDesc(f0));
    setCell(wsR, "A21", "Centrale / fournisseur"); setCell(wsR, "B21", f0.fournisseur || "");
    wsR["!ref"] = "A1:H21";
    wsR["!cols"] = [{ wch: 24 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, wsR, "RAPPORT_COULAGE");

    // --- ESSAIS_7J / ESSAIS_28J : feuilles vides (le bureau saisit les resistances) ---
    var head = [["N°", "Âge (j)", "Date essai", "", "", "Rc (MPa)", "Charge", "Poids"]];
    var ws7 = XLSX.utils.aoa_to_sheet(head); ws7["!ref"] = "A1:H110";
    XLSX.utils.book_append_sheet(wb, ws7, "ESSAIS_7J");
    var ws28 = XLSX.utils.aoa_to_sheet(head); ws28["!ref"] = "A1:H110";
    XLSX.utils.book_append_sheet(wb, ws28, "ESSAIS_28J");
  }

  function toBlob(c) {
    var wb = buildWorkbook(c);
    var out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  function xlsxName(c) { return safeName(c.ref) + "_fiche_coulage.xlsx"; }
  // Fichier unique nomme par la reference seule : ex. ABA014.zip
  function zipName(c) { return safeName(c.ref) + ".zip"; }

  /* ---------- Telechargement utilitaire ---------- */

  function triggerDownload(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // Excel seul.
  function download(c) { triggerDownload(toBlob(c), xlsxName(c)); }

  /* ---------- Nommage des photos par reference ---------- */

  function ext(mime) {
    mime = String(mime || "").split(";")[0];
    if (mime === "image/png") { return "png"; }
    if (mime === "image/webp") { return "webp"; }
    if (mime === "audio/mp4" || mime === "audio/m4a") { return "m4a"; }
    if (mime === "audio/mpeg") { return "mp3"; }
    if (mime === "audio/webm") { return "webm"; }
    if (mime === "audio/ogg") { return "ogg"; }
    if (mime === "audio/wav" || mime === "audio/x-wav") { return "wav"; }
    return "jpg";
  }

  // Jeton de categorie pour le nom de fichier (formulation/bl -> BL).
  function catToken(cat) {
    if (cat === "formulation" || cat === "bl") { return "BL"; }
    if (cat === "audio") { return "note"; }
    return cat || "photo";
  }

  // Renvoie [{name, blob}] des pieces jointes (photos/audios) nommees par reference.
  function attachments(c) {
    if (!window.CAEKDB || !CAEKDB.getPhotosByRef) { return Promise.resolve([]); }
    return CAEKDB.getPhotosByRef(c.ref).then(function (list) {
      var counters = {};
      return list.map(function (p) {
        var isAudio = p.blob && p.blob.type && p.blob.type.indexOf("audio") === 0;
        var token = catToken(p.categorie);
        var key = (isAudio ? "audio_" : "photo_") + token;
        counters[key] = (counters[key] || 0) + 1;
        var kind = isAudio ? "audio" : "photo";
        var name = safeName(c.ref) + "_" + kind + "_" + token + "_" + pad2(counters[key]) + "." + ext(p.blob.type);
        return { name: name, blob: p.blob };
      });
    }).catch(function () { return []; });
  }

  /* ---------- 3) ZIP complet (Excel + photos + audios) ---------- */

  function downloadZip(c) {
    return buildZipBlob(c).then(function (zipBlob) {
      triggerDownload(zipBlob, zipName(c));
      return { ok: true };
    });
  }

  /* ---------- 4) Partage (Web Share API) ----------
     Strategie V1.1 : on ne partage qu'UN SEUL fichier compresse (ABxxx.zip)
     contenant Excel + photos + notes audio, pour ne pas saturer le receveur.
     Le recap textuel est mis en description (text) du message. */

  function buildZipBlob(c) {
    if (!window.CAEKZip) { return Promise.reject(new Error("Module ZIP indisponible.")); }
    return attachments(c).then(function (atts) {
      var files = [{ name: xlsxName(c), data: toBlob(c) }];
      atts.forEach(function (a) { files.push({ name: a.name, data: a.blob }); });
      return CAEKZip.create(files);
    });
  }

  function share(c) {
    var titre = "Fiche de coulage " + (c.ref || "");
    var texte = buildMessage(c);
    return buildZipBlob(c).then(function (zipBlob) {
      var zipFile = null;
      try { zipFile = new File([zipBlob], zipName(c), { type: "application/zip" }); } catch (e) { zipFile = null; }

      if (zipFile && navigator.canShare && navigator.canShare({ files: [zipFile] })) {
        return navigator.share({ files: [zipFile], title: titre, text: texte })
          .then(function () { return { shared: true, downloaded: false }; })
          .catch(function (err) {
            if (err && err.name === "AbortError") { return { shared: false, downloaded: false }; }
            triggerDownload(zipBlob, zipName(c));
            return { shared: false, downloaded: true };
          });
      }
      // Pas de partage de fichier possible : on telecharge le fichier unique.
      triggerDownload(zipBlob, zipName(c));
      return { shared: false, downloaded: true };
    });
  }

  return {
    buildMessage: buildMessage,
    toBlob: toBlob,
    fileName: xlsxName,
    download: download,
    downloadZip: downloadZip,
    share: share
  };
})();

/* ============================================================
   Fiche de coulage terrain - CAEK
   export.js - T7 : export Excel (.xlsx) + partage (WhatsApp / e-mail)
   Genere un classeur lisible de la fiche terrain et le partage via
   l'API Web Share (avec repli telechargement). Marque la fiche "envoyee".
   La compatibilite bureau (mapping v1.04) est traitee en T8.
   ============================================================ */

var CAEKExport = (function () {
  "use strict";

  function fmtDateFr(iso) {
    if (!iso) { return ""; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) {
      return (String(iso).indexOf("-") >= 0 ? String(iso).slice(0, 10) : "");
    }
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  function safeName(s) {
    return String(s == null ? "" : s).replace(/[^A-Za-z0-9_-]+/g, "_");
  }

  // Construit le classeur a partir d'un objet coulage.
  function buildWorkbook(c) {
    var aoa = [];
    aoa.push(["CAEK ENGINEERING LAB"]);
    aoa.push(["Fiche de coulage terrain"]);
    aoa.push([]);
    aoa.push(["Référence", c.ref || ""]);
    aoa.push(["Statut", c.statut || ""]);
    aoa.push(["Date du coulage", fmtDateFr(c.dateCoulage)]);
    aoa.push(["Référence dossier", c.referenceDossier || ""]);
    aoa.push([]);
    aoa.push(["Client / Entreprise", c.client || c.entreprise || ""]);
    aoa.push(["Projet", c.nomProjet || ""]);
    aoa.push(["Adresse", c.adresse || ""]);
    aoa.push(["Contact", c.contact || ""]);
    aoa.push([]);
    aoa.push(["Ouvrage coulé", c.ouvrageCoule || ""]);
    aoa.push(["Type de béton", c.typeBeton || ""]);
    aoa.push(["Centrale / fournisseur", c.centrale || ""]);
    aoa.push(["Classe béton", c.classeBeton || ""]);
    aoa.push(["Formulation / dosage", c.formulation || ""]);
    aoa.push(["Type d'ouvrage", c.typeOuvrage || ""]);
    aoa.push(["Ouvrage / zone / partie", c.ouvrageZonePartie || ""]);
    aoa.push(["Observations générales", c.observations || ""]);
    aoa.push([]);
    aoa.push(["Toupies / camions"]);
    aoa.push(["N°", "N° camion", "Heure", "Quantité (m³)", "Affaiss. (cm)", "Temp. (°C)", "Nb éprouvettes", "Observations"]);
    var toupies = c.toupies || [];
    for (var i = 0; i < toupies.length; i++) {
      var t = toupies[i];
      aoa.push([
        i + 1, t.camion || "", t.heure || "", t.quantite || "",
        t.affaissement || "", t.temperature || "", t.nbEprouvettes || "", t.observations || ""
      ]);
    }
    aoa.push([]);
    aoa.push(["Quantité totale (m³)", c.totalQuantite || 0]);
    aoa.push(["Total éprouvettes", c.totalEprouvettes || 0]);
    aoa.push([]);
    aoa.push(["Prélèvement effectué par", c.prelevementPar || ""]);
    aoa.push(["Opérateur (signature interne)", c.signatureOperateur || ""]);
    aoa.push(["Date de validation", fmtDateFr(c.dateValidation)]);
    if (c.corrections && c.corrections.length) {
      aoa.push([]);
      aoa.push(["Corrections signalées"]);
      for (var k = 0; k < c.corrections.length; k++) {
        aoa.push([fmtDateFr(c.corrections[k].date), c.corrections[k].texte || ""]);
      }
    }

    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 26 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 13 }, { wch: 12 }, { wch: 16 }, { wch: 30 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fiche coulage");

    // T8 : feuilles compatibles avec le logiciel bureau (v1.04) pour reimport.
    appendCompatSheets(wb, c);
    return wb;
  }

  /* ---------- T8 : compatibilite bureau (mapping v1.04) ---------- */

  function toDate(iso) {
    if (!iso) { return null; }
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function setCell(ws, addr, value, isDate) {
    if (value === "" || value == null) { return; }
    if (isDate && value instanceof Date) { ws[addr] = { t: "d", v: value, z: "dd/mm/yyyy" }; }
    else if (typeof value === "number" && !isNaN(value)) { ws[addr] = { t: "n", v: value }; }
    else { ws[addr] = { t: "s", v: String(value) }; }
  }

  function numOrNull(v) {
    var n = parseFloat(String(v == null ? "" : v).replace(",", "."));
    return isNaN(n) ? null : n;
  }

  // Cree les feuilles PROJET / RAPPORT_COULAGE / ESSAIS_7J / ESSAIS_28J
  // aux cellules exactes lues par WorkbookPVParser de la v1.04.
  function appendCompatSheets(wb, c) {
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
    var aff = (c.toupies && c.toupies.length) ? numOrNull(c.toupies[0].affaissement) : null;
    setCell(wsR, "A4", "Référence coulage"); setCell(wsR, "B4", c.ref || "");
    setCell(wsR, "A5", "Date du coulage"); setCell(wsR, "B5", toDate(c.dateCoulage), true);
    setCell(wsR, "A7", "Ouvrage"); setCell(wsR, "B7", c.ouvrageCoule || "");
    setCell(wsR, "A8", "Partie / zone"); setCell(wsR, "B8", c.ouvrageZonePartie || "");
    setCell(wsR, "A11", "Affaissement (cm)"); if (aff != null) { setCell(wsR, "B11", aff); }
    setCell(wsR, "A13", "Technicien prélèvement"); setCell(wsR, "B13", c.prelevementPar || "");
    setCell(wsR, "A15", "Dmax"); setCell(wsR, "B15", "");
    setCell(wsR, "A16", "Classe béton"); setCell(wsR, "B16", c.classeBeton || "");
    setCell(wsR, "A17", "Dimension éprouvette"); setCell(wsR, "B17", "");
    setCell(wsR, "A18", "Prélèvement par CAEK"); setCell(wsR, "B18", c.prelevementPar ? "Oui" : "");
    setCell(wsR, "A20", "Formulation / dosage"); setCell(wsR, "B20", c.formulation || "");
    setCell(wsR, "A21", "Centrale / fournisseur"); setCell(wsR, "B21", c.centrale || "");
    setCell(wsR, "F12", c.formulation || "");
    setCell(wsR, "G12", "");
    wsR["!ref"] = "A1:H21";
    wsR["!cols"] = [{ wch: 24 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, wsR, "RAPPORT_COULAGE");

    // --- ESSAIS_7J / ESSAIS_28J : feuilles vides (le bureau saisit les résistances) ---
    var head = [["N°", "Âge (j)", "Date essai", "", "", "Rc (MPa)", "Charge", "Poids"]];
    var ws7 = XLSX.utils.aoa_to_sheet(head); ws7["!ref"] = "A1:H110";
    XLSX.utils.book_append_sheet(wb, ws7, "ESSAIS_7J");
    var ws28 = XLSX.utils.aoa_to_sheet(head); ws28["!ref"] = "A1:H110";
    XLSX.utils.book_append_sheet(wb, ws28, "ESSAIS_28J");
  }

  // Renvoie un Blob .xlsx pour un coulage.
  function toBlob(c) {
    var wb = buildWorkbook(c);
    var out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  function fileName(c) {
    return "Fiche_coulage_" + safeName(c.ref) + ".xlsx";
  }

  // Telechargement direct (repli si partage indisponible).
  function download(c) {
    var blob = toBlob(c);
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName(c);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function ext(mime) {
    if (mime === "image/png") { return "png"; }
    if (mime === "image/webp") { return "webp"; }
    return "jpg";
  }

  // Recupere les photos de la fiche sous forme de File[] (vide si aucune / indispo).
  function photoFiles(c) {
    if (!window.CAEKDB || !CAEKDB.getPhotosByRef) { return Promise.resolve([]); }
    return CAEKDB.getPhotosByRef(c.ref).then(function (list) {
      var files = [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        try {
          files.push(new File(
            [p.blob],
            safeName(c.ref) + "_" + (p.categorie || "photo") + "_" + (i + 1) + "." + ext(p.blob.type),
            { type: p.blob.type || "image/jpeg" }
          ));
        } catch (e) { /* File non supporte : on ignore */ }
      }
      return files;
    }).catch(function () { return []; });
  }

  // Partage via Web Share API (WhatsApp, e-mail, etc.). Repli : telechargement.
  // Joint le .xlsx + les photos de la fiche si l'appareil le permet.
  // Renvoie une Promise { shared:bool, downloaded:bool }.
  function share(c) {
    var blob = toBlob(c);
    var name = fileName(c);
    var titre = "Fiche de coulage " + (c.ref || "");
    var texte = "Fiche de coulage terrain — " + (c.ref || "") +
      "\nClient : " + (c.client || c.entreprise || "") +
      "\nProjet : " + (c.nomProjet || "") +
      "\nDate : " + fmtDateFr(c.dateCoulage);

    var xlsxFile = null;
    try { xlsxFile = new File([blob], name, { type: blob.type }); } catch (e) { xlsxFile = null; }

    if (!xlsxFile || !navigator.canShare) {
      download(c);
      return Promise.resolve({ shared: false, downloaded: true });
    }

    return photoFiles(c).then(function (photos) {
      var files = [xlsxFile].concat(photos);
      // Certains systemes limitent le partage simultane fichiers+photos :
      // on retombe sur le seul .xlsx si le lot complet n'est pas partageable.
      if (!navigator.canShare({ files: files })) {
        files = [xlsxFile];
      }
      if (!navigator.canShare({ files: files })) {
        download(c);
        return { shared: false, downloaded: true };
      }
      return navigator.share({ files: files, title: titre, text: texte })
        .then(function () { return { shared: true, downloaded: false }; })
        .catch(function (err) {
          if (err && err.name === "AbortError") { return { shared: false, downloaded: false }; }
          download(c);
          return { shared: false, downloaded: true };
        });
    });
  }

  return {
    toBlob: toBlob,
    fileName: fileName,
    download: download,
    share: share
  };
})();

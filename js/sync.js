/* ============================================================
   Module Béton - CAEK
   sync.js - V3 : synchronisation clients/projets avec le serveur.

   Principe : le serveur (tables clients/projets, gérées par
   l'administrateur) est la SOURCE DE VÉRITÉ ; IndexedDB reste le
   cache local pour travailler hors-ligne (nouveau.js lit CAEKDB,
   inchangé).

   - pullReferentiels() : op_list_clients + op_list_projets ->
     fusion dans IndexedDB ; les éléments locaux absents du serveur
     sont marqués inactifs (désactivation faite par l'admin).
   - pushClientXlsx(buffer, nom) : ADMIN — parse le client.xlsx
     (CAEKUpdate.parseWorkbook, inchangé) puis pousse chaque client
     et projet sur le serveur (admin_upsert_client / admin_save_projet),
     et resynchronise le cache local.
   - Synchro automatique : au démarrage (si connecté + réseau) et au
     retour du réseau ; bouton manuel sur l'écran Données.
   ============================================================ */
var CAEKSync = (function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function ready() {
    return !!(window.CAEKServer && CAEKServer.configured() &&
      window.CAEKOperateurs && CAEKOperateurs.isLogged() && window.CAEKDB);
  }

  /* ---------- Serveur -> local ---------- */
  function mapClient(c) {
    return {
      clientId: c.client_id, nom: c.nom || "",
      adresse: c.adresse || "", ville: c.ville || "",
      contactNom: c.contact_nom || "", contactTel: c.contact_tel || "",
      email: c.email || "", labo: c.labo || "",
      actif: c.actif !== false,
      dateMaj: new Date().toISOString()
    };
  }
  function mapProjet(p) {
    var res = "";
    if (p.resistance_mpa != null && p.resistance_mpa !== "") {
      var n = parseFloat(String(p.resistance_mpa).replace(",", "."));
      if (!isNaN(n)) { res = n; }
    }
    return {
      codeProjet: p.code_projet, clientId: p.client_id || "",
      nomProjet: p.nom_projet || "", localisation: p.localisation || "",
      referenceCommande: p.reference_commande || "",
      referenceDossier: p.reference_dossier || "",
      resistance: res,
      conversionDefaut: p.conversion_defaut || "",
      facteurConversion: p.facteur_conversion || "",
      agesEssai: Array.isArray(p.ages_essai) ? p.ages_essai : [7, 28],
      labo: p.labo || "",
      laboId: p.labo_id || "",
      actif: p.actif !== false,
      dateMaj: new Date().toISOString()
    };
  }

  // Marque inactifs les éléments locaux absents de la liste serveur
  // (le serveur ne renvoie que les actifs).
  function desactiverAbsents(locaux, presents, keyField, upsertFn) {
    var aDesactiver = (locaux || []).filter(function (x) {
      return x.actif !== false && !presents[x[keyField]];
    }).map(function (x) {
      x.actif = false;
      x.dateMaj = new Date().toISOString();
      return x;
    });
    return aDesactiver.length ? upsertFn(aDesactiver) : Promise.resolve();
  }

  function pullReferentiels() {
    if (!ready()) { return Promise.resolve({ ok: false, error: "hors_ligne_ou_deconnecte" }); }
    var token = CAEKOperateurs.token();
    return Promise.all([
      CAEKServer.listClients(token),
      CAEKServer.listProjets(token)
    ]).then(function (out) {
      var clients = (out[0] || []).map(mapClient);
      var projets = (out[1] || []).map(mapProjet);
      var seenC = {}, seenP = {};
      clients.forEach(function (c) { seenC[c.clientId] = true; });
      projets.forEach(function (p) { seenP[p.codeProjet] = true; });
      return Promise.all([CAEKDB.getAllClients(), CAEKDB.getAllProjets()]).then(function (loc) {
        var ops = [];
        if (clients.length) { ops.push(CAEKDB.upsertClients(clients)); }
        if (projets.length) { ops.push(CAEKDB.upsertProjets(projets)); }
        ops.push(desactiverAbsents(loc[0], seenC, "clientId", CAEKDB.upsertClients));
        ops.push(desactiverAbsents(loc[1], seenP, "codeProjet", CAEKDB.upsertProjets));
        return Promise.all(ops);
      }).then(function () {
        return CAEKDB.setMeta("lastImportDate", new Date().toISOString());
      }).then(function () {
        return { ok: true, clients: clients.length, projets: projets.length };
      });
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || "réseau" };
    });
  }

  /* ---------- Local (xlsx) -> serveur (ADMIN) ---------- */
  function seq(items, fn) {
    // Exécution séquentielle (évite de saturer le serveur gratuit).
    return items.reduce(function (p, item) {
      return p.then(function (acc) {
        return fn(item).then(function () { return acc + 1; });
      });
    }, Promise.resolve(0));
  }

  function pushClientXlsx(buffer, fileName) {
    if (!ready()) {
      return Promise.resolve({ ok: false, error: "Connexion et réseau requis." });
    }
    if (!CAEKOperateurs.isAdmin()) {
      return Promise.resolve({ ok: false, error: "Import réservé à l'administrateur." });
    }
    var parsed = CAEKUpdate.parseWorkbook(buffer);
    if (!parsed.ok) { return Promise.resolve({ ok: false, error: parsed.error }); }
    var token = CAEKOperateurs.token();

    return seq(parsed.clients, function (c) {
      return CAEKServer.adminUpsertClient(token, {
        clientId: c.clientId, nom: c.nom, adresse: c.adresse, ville: c.ville,
        contactNom: c.contactNom, contactTel: c.contactTel, email: c.email,
        labo: c.labo || "",
        notes: "", actif: c.actif !== false
      });
    }).then(function (nC) {
      return seq(parsed.projets, function (p) {
        return CAEKServer.adminSaveProjet(token, {
          codeProjet: p.codeProjet, clientId: p.clientId, nomProjet: p.nomProjet,
          localisation: p.localisation,
          resistanceMpa: (p.resistance === "" || p.resistance == null) ? "" : String(p.resistance),
          conversionDefaut: p.conversionDefaut || "",
          facteurConversion: p.facteurConversion || "",
          referenceCommande: p.referenceCommande, referenceDossier: p.referenceDossier,
          agesEssai: Array.isArray(p.agesEssai) && p.agesEssai.length ? p.agesEssai : [7, 28],
          labo: p.labo || "",
          actif: p.actif !== false
        });
      }).then(function (nP) { return { nC: nC, nP: nP }; });
    }).then(function (n) {
      return CAEKDB.setMeta("lastImportFileName", fileName || "").then(function () {
        return pullReferentiels().then(function () {
          return {
            ok: true,
            clientsAjoutes: n.nC, clientsMisAJour: 0,
            projetsAjoutes: n.nP, projetsMisAJour: 0,
            ajoutes: n.nP, misAJour: 0,
            ignorees: parsed.stats.projetsIgnores,
            doublons: parsed.stats.doublonsProjets,
            resInvalides: parsed.stats.resInvalides,
            orphelins: parsed.stats.orphelins
          };
        });
      });
    }).catch(function (e) {
      return { ok: false, error: "Envoi au serveur interrompu : " + ((e && e.message) || "réseau") };
    });
  }

  /* ---------- UI (écran Données & synchronisation) ---------- */
  function syncResult(html, isError) {
    var box = $("update-result"); if (!box) { return; }
    box.hidden = false; box.className = "result-card " + (isError ? "is-error" : "is-ok"); box.innerHTML = html;
  }

  function refreshStatusCard() {
    // Rafraîchit la carte de statut de l'écran (délégué à app.js si présent).
    var ev; try { ev = new Event("caek-sync-done"); } catch (e) { return; }
    document.dispatchEvent(ev);
  }

  function manualSync() {
    var btn = $("btn-sync");
    if (btn) { btn.disabled = true; btn.textContent = "Synchronisation…"; }
    pullReferentiels().then(function (r) {
      if (btn) { btn.disabled = false; btn.textContent = "🔄 Synchroniser depuis le serveur"; }
      if (!r.ok) {
        syncResult("&#9888; Synchronisation impossible : " +
          (r.error === "hors_ligne_ou_deconnecte" ? "connectez-vous et vérifiez le réseau." : escapeHtml(r.error)), true);
        return;
      }
      syncResult("&#10004; Synchronisé : <strong>" + r.clients + "</strong> client(s), <strong>" +
        r.projets + "</strong> projet(s) actifs récupérés du serveur.", false);
      refreshStatusCard();
    });
  }

  function autoSync() {
    if (!ready() || !navigator.onLine) { return; }
    pullReferentiels().then(function (r) {
      if (r.ok) { refreshStatusCard(); }
    });
    if (window.CAEKFormulations) { CAEKFormulations.refresh(); }
  }

  function init() {
    var btn = $("btn-sync");
    if (btn) { btn.addEventListener("click", manualSync); }
    window.addEventListener("online", autoSync);
    // Synchro silencieuse au démarrage (laisser le temps à l'init de la DB).
    setTimeout(autoSync, 800);
  }

  return {
    init: init,
    pullReferentiels: pullReferentiels,
    pushClientXlsx: pushClientXlsx,
    autoSync: autoSync
  };
})();

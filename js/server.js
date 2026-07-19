"use strict";
/* ============================================================
   Module Béton - CAEK
   server.js - Client Supabase (RPC via fetch), aucune dépendance.

   Toutes les opérations passent par des fonctions SQL SECURITY
   DEFINER (op_* / admin_*) : la clé anon seule ne donne AUCUN
   accès direct aux tables (RLS strict). Voir supabase_schema.sql.

   Multi-labos : les fonctions de liste acceptent un labo optionnel
   (uuid) — utilisé par l'ADMIN pour basculer entre laboratoires ;
   pour un opérateur, le serveur force son propre labo.
   ============================================================ */
var CAEKServer = (function () {

  function configured() {
    return !!(window.CAEK_CONFIG &&
      CAEK_CONFIG.SUPABASE_URL && CAEK_CONFIG.SUPABASE_URL.indexOf("VOTRE-PROJET") < 0 &&
      CAEK_CONFIG.SUPABASE_ANON && CAEK_CONFIG.SUPABASE_ANON.indexOf("VOTRE_CLE") < 0);
  }

  function NetworkError(message) {
    var e = new Error(message || "network");
    e.name = "NetworkError";
    return e;
  }

  function _rpc(fn, params) {
    if (!configured()) {
      return Promise.reject(new Error("Serveur non configuré (js/config.js)."));
    }
    var url = CAEK_CONFIG.SUPABASE_URL + "/rest/v1/rpc/" + fn;
    return fetch(url, {
      method: "POST",
      headers: {
        "apikey": CAEK_CONFIG.SUPABASE_ANON,
        "Authorization": "Bearer " + CAEK_CONFIG.SUPABASE_ANON,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params || {})
    }).catch(function (e) {
      throw NetworkError(e && e.message);      // hors-ligne / DNS / réseau
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error("Serveur (" + res.status + ") " + (j.message || ""));
        });
      }
      return res.json();
    });
  }

  /* ---------- Auth ---------- */
  function login(identifiant, pin) { return _rpc("op_login", { p_identifiant: identifiant, p_pin: pin }); }
  function verify(token) { return _rpc("op_verify", { p_token: token }); }
  function changePin(token, oldPin, newPin) {
    return _rpc("op_change_pin", { p_token: token, p_old_pin: oldPin, p_new_pin: newPin });
  }

  /* ---------- Coulages ---------- */
  function nextRef(token, code) { return _rpc("op_next_ref", { p_token: token, p_code: code }); }
  // Phase 1 : synchronisation idempotente et versionnée (op_sync_coulage).
  // op = { clientUuid, idempotencyKey, action, baseVersion, ref,
  //        refProvisoire, codeProjet, payload }
  function syncCoulage(token, op) {
    return _rpc("op_sync_coulage", { p_token: token, p_op: op });
  }
  function saveCoulage(token, ref, payload) {
    return _rpc("op_save_coulage", { p_token: token, p_ref: ref, p_payload: payload });
  }
  function soumettreCoulage(token, ref, payload) {
    return _rpc("op_soumettre_coulage", { p_token: token, p_ref: ref, p_payload: payload });
  }
  function listCoulages(token, labo) {
    return _rpc("op_list_coulages", { p_token: token, p_labo: labo || null });
  }
  function deleteCoulage(token, ref) {
    return _rpc("op_delete_coulage", { p_token: token, p_ref: ref });
  }

  /* ---------- Lots (bassin / écrasement) ---------- */
  function saveRepartition(token, ref, lots) {
    return _rpc("op_save_repartition", { p_token: token, p_ref: ref, p_lots: lots });
  }
  function listLots(token, labo) { return _rpc("op_list_lots", { p_token: token, p_labo: labo || null }); }
  function sortirLot(token, id) { return _rpc("op_sortir_lot", { p_token: token, p_id: id }); }
  function retourBassin(token, id) { return _rpc("op_retour_bassin", { p_token: token, p_id: id }); }
  function testerLot(token, id, resultats) {
    return _rpc("op_tester_lot", { p_token: token, p_id: id, p_resultats: resultats });
  }
  function upsertLot(token, key, lot) {
    return _rpc("op_upsert_lot", { p_token: token, p_key: key, p_lot: lot });
  }
  function deleteLotByKey(token, key) {
    return _rpc("op_delete_lot", { p_token: token, p_key: key });
  }
  function adminValiderResultatsKey(token, key) {
    return _rpc("admin_valider_resultats_key", { p_token: token, p_key: key });
  }
  /* ---------- Phase 3 : prélèvements / événements / révision ---------- */
  function allocPrels(token, ref, prels) {
    return _rpc("op_alloc_prels", { p_token: token, p_ref: ref, p_prels: prels });
  }
  function coulageEvent(token, event) {
    return _rpc("op_coulage_event", { p_token: token, p_event: event });
  }
  function reviserEprouvette(token, rev) {
    return _rpc("op_reviser_eprouvette", { p_token: token, p_rev: rev });
  }
  function listAudit(token, entity, id) {
    return _rpc("op_list_audit", { p_token: token, p_entity: entity, p_id: id });
  }

  /* ---------- Formulations ---------- */
  function listFormulations(token) { return _rpc("op_list_formulations", { p_token: token }); }
  /* ---------- Centrales (Phase 2) ---------- */
  function listCentrales(token) { return _rpc("op_list_centrales", { p_token: token }); }
  function adminUpsertCentrale(token, c) {
    return _rpc("admin_upsert_centrale", {
      p_token: token, p_id: c.id || null, p_nom: c.nom,
      p_localisation: c.localisation || "", p_actif: c.actif !== false
    });
  }
  function proposerFormulation(token, fournisseur, nom, payload) {
    return _rpc("op_proposer_formulation",
      { p_token: token, p_fournisseur: fournisseur, p_nom: nom, p_payload: payload });
  }

  /* ---------- Référentiels ---------- */
  function listClients(token) { return _rpc("op_list_clients", { p_token: token }); }
  function listProjets(token) { return _rpc("op_list_projets", { p_token: token }); }

  /* ---------- Évacuations (déchets) ---------- */
  function listEvacuations(token, labo) {
    return _rpc("op_list_evacuations", { p_token: token, p_labo: labo || null });
  }
  function addEvacuation(token, nombre, note) {
    return _rpc("op_add_evacuation", { p_token: token, p_nombre: nombre, p_note: note || "" });
  }
  function getDechetsState(token, labo) {
    return _rpc("op_get_dechets_state", { p_token: token, p_labo: labo || null });
  }
  function addEvacuationV2(token, labo, nombre, note, requestId) {
    return _rpc("op_add_evacuation_v2", {
      p_token: token, p_labo: labo || null, p_nombre: nombre,
      p_note: note || "", p_request_id: requestId
    });
  }

  /* ---------- Paramètres métier du laboratoire (Phase 5) ---------- */
  function getLaboSettings(token, labo) {
    return _rpc("op_get_labo_settings", { p_token: token, p_labo: labo || null });
  }
  function adminSetLaboSettings(token, labo, settings, requestId) {
    return _rpc("admin_set_labo_settings", {
      p_token: token, p_labo: labo, p_settings: settings || {},
      p_request_id: requestId || null
    });
  }

  /* ---------- Alerte coulage (BF-001) — indépendante de la fiche ---------- */
  function listAlertesCoulage(token, labo, historique) {
    return _rpc("op_list_alertes_coulage", { p_token: token, p_labo: labo || null, p_historique: !!historique });
  }
  function createAlerteCoulage(token, alerte) {
    return _rpc("resp_create_alerte_coulage", { p_token: token, p_alerte: alerte });
  }
  function updateAlerteCoulage(token, id, alerte) {
    return _rpc("resp_update_alerte_coulage", { p_token: token, p_id: id, p_alerte: alerte });
  }
  function prendreEnChargeAlerte(token, id) {
    return _rpc("op_prendre_en_charge_alerte", { p_token: token, p_id: id });
  }
  function ackAlerteCoulage(token, id) {
    return _rpc("resp_ack_alerte_coulage", { p_token: token, p_id: id });
  }

  /* ---------- Notifications (abonnements push) ---------- */
  function savePushSubscription(token, sub) {
    return _rpc("op_save_push_subscription", { p_token: token, p_sub: sub });
  }
  function deletePushSubscription(token, endpoint) {
    return _rpc("op_delete_push_subscription", { p_token: token, p_endpoint: endpoint });
  }

  /* ---------- Admin : validation ---------- */
  function adminValiderCoulage(token, ref, payload) {
    return _rpc("admin_valider_coulage", { p_token: token, p_ref: ref, p_payload: payload });
  }
  function adminMarquerMediasPurges(token, ref) {
    return _rpc("admin_marquer_medias_purges", { p_token: token, p_ref: ref });
  }
  function adminRenvoyerCoulage(token, ref, motif) {
    return _rpc("admin_renvoyer_coulage", { p_token: token, p_ref: ref, p_motif: motif || "" });
  }
  function adminDeleteCoulage(token, ref) {
    return _rpc("admin_delete_coulage", { p_token: token, p_ref: ref });
  }
  function adminValiderResultats(token, id) {
    return _rpc("admin_valider_resultats", { p_token: token, p_id: id });
  }

  /* ---------- Admin : formulations ---------- */
  function adminListFormulations(token) { return _rpc("admin_list_formulations", { p_token: token }); }
  function adminUpsertFormulation(token, form) {
    return _rpc("admin_upsert_formulation", { p_token: token, p_form: form });
  }
  function adminValiderFormulation(token, id) {
    return _rpc("admin_valider_formulation", { p_token: token, p_id: id });
  }
  function adminDeleteFormulation(token, id) {
    return _rpc("admin_delete_formulation", { p_token: token, p_id: id });
  }

  /* ---------- Admin : clients / projets ---------- */
  function adminUpsertClient(token, client) {
    return _rpc("admin_upsert_client", { p_token: token, p_client: client });
  }
  function adminSaveProjet(token, projet) {
    return _rpc("admin_save_projet", { p_token: token, p_projet: projet });
  }
  function adminDeleteProjet(token, code) {
    return _rpc("admin_delete_projet", { p_token: token, p_code: code });
  }

  /* ---------- Admin : labos / opérateurs ---------- */
  function adminListLabos(token) { return _rpc("admin_list_labos", { p_token: token }); }
  function adminUpsertLabo(token, labo) {
    return _rpc("admin_upsert_labo", {
      p_token: token, p_id: labo.id || null, p_nom: labo.nom,
      p_localisation: labo.localisation || "", p_seuil: labo.seuilDechets || null,
      p_actif: labo.actif !== false
    }).then(function (r) {
      var id = labo.id || (r && r.id);
      if (!r || r.ok !== true || !id || !labo.settings) { return r; }
      return adminSetLaboSettings(token, id, labo.settings, labo.requestId).then(function (sr) {
        if (!sr || sr.ok !== true) { return sr || { ok: false, error: "parametres" }; }
        r.settings = sr.settings;
        return r;
      });
    });
  }
  function adminListOperators(token) { return _rpc("admin_list_operators", { p_token: token }); }
  function adminUpsertOperator(token, op) {
    var base = {
      p_token: token, p_id: op.id || null, p_identifiant: op.identifiant,
      p_pin: op.pin || "", p_nom: op.nom, p_fonction: op.fonction || "",
      p_is_admin: !!op.is_admin, p_actif: op.actif !== false, p_labo: op.labo_id || null,
      p_admin_labos: (op.admin_labos && op.admin_labos.length) ? op.admin_labos : null
    };
    var withRole = {};
    for (var k in base) { withRole[k] = base[k]; }
    withRole.p_role = op.role || null;
    return _rpc("admin_upsert_operator", withRole).catch(function (e) {
      // Serveur non migré Phase 2 (pas de p_role) : repli signature historique.
      var m = String((e && e.message) || "");
      if (m.indexOf("404") >= 0 || m.toLowerCase().indexOf("could not find the function") >= 0) {
        return _rpc("admin_upsert_operator", base);
      }
      throw e;
    });
  }
  function adminSetOperatorActive(token, id, actif) {
    return _rpc("admin_set_operator_active", { p_token: token, p_id: id, p_actif: actif });
  }

  return {
    configured: configured,
    login: login, verify: verify, changePin: changePin,
    nextRef: nextRef, syncCoulage: syncCoulage,
    saveCoulage: saveCoulage, soumettreCoulage: soumettreCoulage,
    listCoulages: listCoulages, deleteCoulage: deleteCoulage,
    saveRepartition: saveRepartition, listLots: listLots,
    sortirLot: sortirLot, retourBassin: retourBassin, testerLot: testerLot,
    upsertLot: upsertLot, deleteLotByKey: deleteLotByKey,
    adminValiderResultatsKey: adminValiderResultatsKey,
    allocPrels: allocPrels, coulageEvent: coulageEvent,
    reviserEprouvette: reviserEprouvette, listAudit: listAudit,
    listFormulations: listFormulations, proposerFormulation: proposerFormulation,
    listCentrales: listCentrales, adminUpsertCentrale: adminUpsertCentrale,
    listClients: listClients, listProjets: listProjets,
    listEvacuations: listEvacuations, addEvacuation: addEvacuation,
    getDechetsState: getDechetsState, addEvacuationV2: addEvacuationV2,
    getLaboSettings: getLaboSettings, adminSetLaboSettings: adminSetLaboSettings,
    listAlertesCoulage: listAlertesCoulage, createAlerteCoulage: createAlerteCoulage,
    updateAlerteCoulage: updateAlerteCoulage, prendreEnChargeAlerte: prendreEnChargeAlerte,
    ackAlerteCoulage: ackAlerteCoulage,
    savePushSubscription: savePushSubscription, deletePushSubscription: deletePushSubscription,
    adminValiderCoulage: adminValiderCoulage, adminMarquerMediasPurges: adminMarquerMediasPurges,
    adminRenvoyerCoulage: adminRenvoyerCoulage,
    adminDeleteCoulage: adminDeleteCoulage, adminValiderResultats: adminValiderResultats,
    adminListFormulations: adminListFormulations, adminUpsertFormulation: adminUpsertFormulation,
    adminValiderFormulation: adminValiderFormulation, adminDeleteFormulation: adminDeleteFormulation,
    adminUpsertClient: adminUpsertClient, adminSaveProjet: adminSaveProjet,
    adminDeleteProjet: adminDeleteProjet,
    adminListLabos: adminListLabos, adminUpsertLabo: adminUpsertLabo,
    adminListOperators: adminListOperators, adminUpsertOperator: adminUpsertOperator,
    adminSetOperatorActive: adminSetOperatorActive
  };
})();

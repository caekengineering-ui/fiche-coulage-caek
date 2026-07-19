/* ============================================================
   Module Béton - CAEK
   coulages.js - V3 : synchronisation des coulages avec le serveur.

   Cycle V3 : brouillon (op, modifiable) -> soumis (op, verrouillé,
   en attente admin) -> valide (admin). Le renvoi admin remet la
   fiche en brouillon avec un motif (retourAdmin).

   Fonctionnement hors-ligne :
   - IndexedDB reste la copie de travail (fiche.js/bassin.js inchangés) ;
   - toute sauvegarde LOCALE d'un brouillon est poussée au serveur
     (op_save_coulage) via un hook sur CAEKDB.updateCoulage/addCoulage ;
   - la soumission (op_soumettre_coulage) passe par soumettre(ref) ;
   - sans réseau, les actions sont mises en FILE D'ATTENTE (meta
     "coulagesQueue") et rejouées au retour du réseau ;
   - pull() rapatrie les coulages du serveur (scopés par labo côté
     serveur) : validations/renvois admin, fiches des collègues du
     même labo. Les champs opérationnels locaux (récupération,
     codification confirmée) sont conservés au merge.
   - Les fiches locales connues du serveur (_syncedAt) qui n'y sont
     plus ont été supprimées par l'admin -> suppression locale.
     Les données DEMO- restent locales.
   ============================================================ */
var CAEKCoulages = (function () {
  "use strict";

  var QUEUE_KEY = "coulagesQueue";   // meta HISTORIQUE (migrée vers l'outbox)
  var _pushTimer = null;
  var _pushRefs = {};                // refs en attente de push différé
  var _syncRpcAbsent = false;        // op_sync_coulage absent du serveur -> repli legacy

  // Phase 1 : identité stable de la fiche, indépendante de la référence.
  function newUuid() {
    if (window.crypto && crypto.randomUUID) { return crypto.randomUUID(); }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (ch) {
      var r = Math.random() * 16 | 0;
      return (ch === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function ensureUuid(c) {
    if (c && !c.uuid) { c.uuid = newUuid(); }
    return c ? c.uuid : null;
  }

  // Champs opérationnels gérés LOCALEMENT après soumission (bassin) :
  // conservés lors d'un merge serveur -> local.
  var LOCAL_FIELDS = ["eprRecuperees", "codificationConfirmee", "dateRecuperation",
    "operateurRecuperation", "qualificationRecuperation"];

  function ready() {
    return !!(window.CAEKServer && CAEKServer.configured() &&
      window.CAEKOperateurs && CAEKOperateurs.isLogged() && window.CAEKDB);
  }
  function online() { return navigator.onLine !== false; }
  function token() { return CAEKOperateurs.token(); }
  function isDemo(ref) { return String(ref || "").indexOf("DEMO") === 0; }

  /* ---------- Outbox persistante (Phase 1) ----------
     Une entrée par (fiche, action) : { key, ref, uuid, action, attempts,
     lastError, createdAt, ackAt }. La clé (idempotencyKey) est RÉUTILISÉE
     par les re-tentatives (rejouage idempotent côté serveur) et REMPLACÉE
     quand le contenu local change (nouvelle opération logique). */
  function outboxFind(ref, action) {
    return CAEKDB.outboxByRef(ref).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].action === action && !list[i].ackAt) { return list[i]; }
      }
      return null;
    });
  }
  function enqueue(ref, action, error, freshKey) {
    return CAEKDB.getCoulage(ref).then(function (c) {
      var hadUuid = !!(c && c.uuid);
      var uuid = c ? ensureUuid(c) : null;
      // Persiste l'uuid fraîchement attribué SANS repasser par le hook de push.
      var keep = (c && !hadUuid && rawUpdate) ? rawUpdate(c) : Promise.resolve();
      return keep.then(function () {
        return outboxFind(ref, action).then(function (e) {
          if (e && !freshKey) {
            e.attempts = (e.attempts || 0) + (error ? 1 : 0);
            e.lastError = error || e.lastError || "";
            return CAEKDB.outboxPut(e);
          }
          var entry = {
            key: (uuid || ref) + ":" + action + ":" + Date.now(),
            ref: ref, uuid: uuid, action: action,
            attempts: error ? 1 : 0, lastError: error || "",
            createdAt: new Date().toISOString(), ackAt: null
          };
          var drop = e ? CAEKDB.outboxDelete(e.key) : Promise.resolve();
          return drop.then(function () { return CAEKDB.outboxPut(entry); });
        });
      });
    });
  }
  function dequeue(ref, ack) {
    return CAEKDB.outboxByRef(ref).then(function (list) {
      return Promise.all(list.map(function (e) {
        if (ack) {
          // Accusé : l'entrée est conservée marquée ackAt (traçabilité) puis
          // remplacée à la prochaine opération sur la même fiche.
          e.ackAt = new Date().toISOString();
          e.lastError = "";
          return CAEKDB.outboxPut(e);
        }
        return CAEKDB.outboxDelete(e.key);
      }));
    });
  }
  function getQueue() {
    // Compat : vue { ref: action } des entrées en attente (non accusées).
    return CAEKDB.outboxAll().then(function (list) {
      var q = {};
      list.forEach(function (e) {
        if (e.ackAt) { return; }
        if (q[e.ref] !== "soumettre") { q[e.ref] = e.action; }
      });
      return q;
    });
  }
  function pendingCount() {
    return getQueue().then(function (q) { return Object.keys(q).length; });
  }
  // Migration de l'ancienne file meta -> outbox (une seule fois).
  function migrateLegacyQueue() {
    return CAEKDB.getMeta(QUEUE_KEY).then(function (q) {
      if (!q || !Object.keys(q).length) { return; }
      var refs = Object.keys(q);
      return refs.reduce(function (p, ref) {
        return p.then(function () { return enqueue(ref, q[ref], "", true); });
      }, Promise.resolve()).then(function () {
        return CAEKDB.setMeta(QUEUE_KEY, {});
      });
    }).catch(function () {});
  }

  /* ---------- Push : brouillons ---------- */
  // Appelé (via le hook DB) après chaque sauvegarde locale.
  function schedulePush(c) {
    if (!c || !c.ref || isDemo(c.ref)) { return; }
    if ((c.statut || "brouillon") !== "brouillon") { return; }
    _pushRefs[c.ref] = true;
    if (_pushTimer) { clearTimeout(_pushTimer); }
    _pushTimer = setTimeout(flushPush, 1500);
  }

  // saveCoulage() creates a record in one IndexedDB transaction and does not
  // pass through the update hook. New drafts must therefore enter the outbox
  // explicitly, including when they were created offline.
  function registerLocalDraft(ref) {
    if (!ref || isDemo(ref) || !window.CAEKDB) { return Promise.resolve(); }
    return CAEKDB.getCoulage(ref).then(function (c) {
      if (!c || (c.statut || "brouillon") !== "brouillon") { return; }
      return enqueue(ref, "save").then(function () {
        if (ready() && online()) { return processQueue(); }
      });
    });
  }

  function flushPush() {
    _pushTimer = null;
    var refs = Object.keys(_pushRefs);
    _pushRefs = {};
    refs.forEach(function (ref) { pushBrouillon(ref); });
  }

  /* ---------- Phase 1 : envoi versionné + idempotent ---------- */
  function isRpcMissing(e) {
    var m = String((e && e.message) || "");
    return m.indexOf("404") >= 0 || m.toLowerCase().indexOf("could not find the function") >= 0;
  }

  function syncOp(c, action, entry) {
    return CAEKServer.syncCoulage(token(), {
      clientUuid: ensureUuid(c),
      idempotencyKey: entry.key,
      action: action,
      baseVersion: c._version || 0,
      ref: c.ref,
      refProvisoire: c.refProvisoire === true,
      codeProjet: c.codeProjet || "",
      payload: c
    });
  }

  // Applique le résultat d'op_sync_coulage : accusé, version, adoption de la
  // référence officielle, ou CONFLIT VISIBLE (jamais d'écrasement silencieux).
  function handleSyncResult(ref, c, action, r) {
    if (r && r.ok === true) {
      var adopted = (r.ref && r.ref !== c.ref);
      var chain = adopted ? CAEKDB.rekeyCoulage(c.ref, r.ref) : Promise.resolve();
      return chain.then(function () {
        var newRef = adopted ? r.ref : c.ref;
        return CAEKDB.getCoulage(newRef).then(function (cc) {
          cc = cc || c;
          cc.ref = newRef;
          cc.refProvisoire = false;
          cc._version = r.version || cc._version || 1;
          cc._conflit = null;
          cc._syncedAt = new Date().toISOString();
          return rawUpdate(cc).then(function () {
            return dequeue(newRef, true).then(function () {
              if (adopted) {
                if (window.CAEKRepertoire && CAEKRepertoire.refresh) { CAEKRepertoire.refresh(); }
                if (window.CAEKBadges) { CAEKBadges.refresh(); }
              }
              return { ok: true, ref: newRef };
            });
          });
        });
      });
    }
    if (r && r.error === "conflit") {
      // Une version plus récente existe sur le serveur : on N'ÉCRASE RIEN,
      // le conflit devient visible (badge Répertoire) et la file s'arrête.
      c._conflit = r.server || { version: null };
      c._conflit.detecteLe = new Date().toISOString();
      return rawUpdate(c).then(function () {
        return dequeue(ref, false).then(function () { return { ok: false, error: "conflit" }; });
      });
    }
    if (r && (r.error === "verrouille" || r.error === "deja_valide" || r.error === "ref_prise")) {
      return dequeue(ref, false).then(pull).then(function () { return { ok: false, error: r.error }; });
    }
    // labo_requis / paramètres / autres : erreur CONSERVÉE et VISIBLE dans
    // l'outbox (lastError), re-tentative au prochain passage.
    return enqueue(ref, action, (r && r.error) || "inconnu")
      .then(function () { return { ok: false, error: (r && r.error) || "inconnu" }; });
  }

  function legacySave(ref, c) {
    return CAEKServer.saveCoulage(token(), ref, c).then(function (r) {
      if (r && r.ok === true) {
        c._syncedAt = new Date().toISOString();
        return rawUpdate(c).then(function () { return dequeue(ref, true); });
      }
      if (r && (r.error === "verrouille")) {
        return dequeue(ref, false).then(pull);
      }
      return enqueue(ref, "save", (r && r.error) || "inconnu");
    }).catch(function (e) { return enqueue(ref, "save", (e && e.message) || "réseau"); });
  }

  function pushBrouillon(ref) {
    if (!window.CAEKDB) { return Promise.resolve(); }
    return CAEKDB.getCoulage(ref).then(function (c) {
      if (!c || (c.statut || "brouillon") !== "brouillon") { return; }
      if (c._conflit) { return; }               // conflit à résoudre d'abord
      if (!ready() || !online()) { return enqueue(ref, "save"); }
      if (_syncRpcAbsent || !CAEKServer.syncCoulage) { return legacySave(ref, c); }
      return enqueue(ref, "save").then(function () {
        return outboxFind(ref, "save");
      }).then(function (entry) {
        return syncOp(c, "save", entry).then(function (r) {
          return handleSyncResult(ref, c, "save", r);
        }).catch(function (e) {
          if (isRpcMissing(e)) { _syncRpcAbsent = true; return legacySave(ref, c); }
          return enqueue(ref, "save", (e && e.message) || "réseau");
        });
      });
    });
  }

  /* ---------- Soumission ---------- */
  // Verrouille localement puis envoie au serveur (ou met en file).
  function soumettre(ref, signature) {
    return CAEKDB.getCoulage(ref).then(function (c) {
      if (!c) { return { ok: false, error: "Fiche introuvable." }; }
      if ((c.statut || "brouillon") === "valide") { return { ok: false, error: "Fiche déjà validée." }; }
      c.statut = "soumis";
      c.dateSoumission = new Date().toISOString();
      c.retourAdmin = "";
      if (signature) {
        if (!c.signatureOperateur) { c.signatureOperateur = signature.nom || ""; }
        c.operateurSoumission = signature.nom || "";
        c.qualificationSoumission = signature.qualification || "";
      }
      c.dateModification = new Date().toISOString();
      return rawUpdate(c).then(function () {
        if (isDemo(ref)) { return { ok: true, offline: false }; }
        if (!ready() || !online()) {
          return enqueue(ref, "soumettre").then(function () { return { ok: true, offline: true }; });
        }
        // Téléversement des médias (photos + audios) AVANT la soumission :
        // l'admin les examinera à la validation. Échec (bucket absent,
        // réseau instable) => on soumet quand même, médias marqués incomplets.
        var up = window.CAEKMedias
          ? CAEKMedias.uploadForRef(ref)
          : Promise.resolve({ medias: [], incomplet: false });
        return up.then(function (m) {
          c.medias = m.medias;
          c.mediasIncomplets = (m.incomplet === true);
          return rawUpdate(c);
        }).then(function () {
        // Phase 1 : envoi versionné/idempotent, repli legacy si RPC absente.
        var envoi;
        if (!_syncRpcAbsent && CAEKServer.syncCoulage) {
          envoi = enqueue(ref, "soumettre").then(function () {
            return outboxFind(ref, "soumettre");
          }).then(function (entry) {
            return syncOp(c, "soumettre", entry).then(function (r) {
              if (r && r.ok === true) {
                return handleSyncResult(ref, c, "soumettre", r).then(function (h) {
                  return { ok: true, offline: false, ref: h.ref };
                });
              }
              if (r && r.error === "conflit") {
                return handleSyncResult(ref, c, "soumettre", r).then(function () {
                  return { ok: false, error: "Conflit de versions : la fiche a été modifiée ailleurs. Consultez le Répertoire pour résoudre." };
                });
              }
              if (r && r.error === "deja_valide") {
                return pull().then(function () { return { ok: false, error: "Cette fiche a déjà été validée par l'administrateur." }; });
              }
              if (r && r.error === "labo_requis") {
                return enqueue(ref, "soumettre", "labo_requis").then(function () {
                  return { ok: false, error: "Aucun laboratoire affecté à votre compte : contactez l'administrateur." };
                });
              }
              return enqueue(ref, "soumettre", (r && r.error) || "inconnu")
                .then(function () { return { ok: true, offline: true }; });
            }).catch(function (e) {
              if (isRpcMissing(e)) { _syncRpcAbsent = true; return null; }
              return enqueue(ref, "soumettre", (e && e.message) || "réseau")
                .then(function () { return { ok: true, offline: true }; });
            });
          }).then(function (res) {
            if (res !== null) { return res; }
            return legacySoumettre();     // RPC absente : repli immédiat
          });
        } else {
          envoi = legacySoumettre();
        }
        function legacySoumettre() {
          return CAEKServer.soumettreCoulage(token(), ref, c).then(function (r) {
            if (r && r.ok === true) {
              c._syncedAt = new Date().toISOString();
              return rawUpdate(c).then(function () {
                return dequeue(ref, true).then(function () { return { ok: true, offline: false }; });
              });
            }
            if (r && r.error === "deja_valide") {
              return pull().then(function () { return { ok: false, error: "Cette fiche a déjà été validée par l'administrateur." }; });
            }
            if (r && r.error === "labo_requis") {
              return enqueue(ref, "soumettre", "labo_requis").then(function () {
                return { ok: false, error: "Aucun laboratoire affecté à votre compte : contactez l'administrateur." };
              });
            }
            return enqueue(ref, "soumettre", (r && r.error) || "inconnu")
              .then(function () { return { ok: true, offline: true }; });
          }).catch(function (e) {
            return enqueue(ref, "soumettre", (e && e.message) || "réseau")
              .then(function () { return { ok: true, offline: true }; });
          });
        }
        return envoi;
        });   // fin téléversement médias
      });
    });
  }

  /* ---------- Suppression (brouillon) ---------- */
  function deleteOnServer(ref) {
    if (isDemo(ref) || !ready() || !online()) { return Promise.resolve(); }
    return CAEKServer.deleteCoulage(token(), ref).catch(function () {});
  }

  /* ---------- File : rejouer (outbox, clés idempotentes réutilisées) ---------- */
  function processQueue() {
    if (!ready() || !online()) { return Promise.resolve(); }
    return getQueue().then(function (q) {
      var refs = Object.keys(q);
      return refs.reduce(function (p, ref) {
        return p.then(function () {
          return CAEKDB.getCoulage(ref).then(function (c) {
            if (!c) { return dequeue(ref, false); }
            if (c._conflit) { return; }          // conflit à résoudre d'abord
            var action = q[ref];
            // Rejouer une soumission : re-tenter d'abord les médias.
            var prep = (action === "soumettre" && window.CAEKMedias)
              ? CAEKMedias.uploadForRef(ref).then(function (m) {
                  c.medias = m.medias;
                  c.mediasIncomplets = (m.incomplet === true);
                  return rawUpdate(c);
                })
              : Promise.resolve();
            return prep.then(function () {
              if (!_syncRpcAbsent && CAEKServer.syncCoulage) {
                // Rejouage idempotent : MÊME clé -> même réponse serveur.
                return outboxFind(ref, action).then(function (entry) {
                  if (!entry) { return; }
                  return syncOp(c, action, entry).then(function (r) {
                    return handleSyncResult(ref, c, action, r);
                  }).catch(function (e) {
                    if (isRpcMissing(e)) { _syncRpcAbsent = true; return; }
                    return enqueue(ref, action, (e && e.message) || "réseau");
                  });
                });
              }
              var fn = (action === "soumettre")
                ? CAEKServer.soumettreCoulage(token(), ref, c)
                : CAEKServer.saveCoulage(token(), ref, c);
              return fn.then(function (r) {
                if (r && (r.ok === true || r.error === "verrouille" || r.error === "deja_valide")) {
                  if (r.ok === true) { c._syncedAt = new Date().toISOString(); }
                  return rawUpdate(c).then(function () { return dequeue(ref, r.ok === true); });
                }
                // échec non réseau (ex. labo_requis) : erreur consignée, en file.
                return enqueue(ref, action, (r && r.error) || "inconnu");
              }).catch(function (e) {
                return enqueue(ref, action, (e && e.message) || "réseau");
              });
            });   // fin prep médias
          });
        });
      }, Promise.resolve());
    });
  }

  /* ---------- Pull : serveur -> local ---------- */
  function mergeRow(row, local, queue) {
    var ref = row.ref;
    if (queue[ref]) { return Promise.resolve(false); }   // push local en attente : ne pas écraser
    if (local && local._conflit) { return Promise.resolve(false); }  // conflit à résoudre : on n'écrase pas
    var srv = row.payload || {};
    var merged = srv;
    merged.ref = ref;
    merged.statut = row.statut || srv.statut || "brouillon";
    merged.retourAdmin = row.retour_admin || srv.retourAdmin || "";
    merged.laboId = row.labo_id || srv.laboId || "";
    merged.uuid = (local && local.uuid) || row.client_uuid || merged.uuid;
    merged._version = row.version || merged._version || 1;
    merged._syncedAt = new Date().toISOString();
    var retourNouveau = !!merged.retourAdmin && (!local ||
      (local.statut || "brouillon") !== "brouillon" ||
      String(local.retourAdmin || "") !== String(merged.retourAdmin));
    if (local) {
      LOCAL_FIELDS.forEach(function (f) {
        if (local[f] !== undefined && merged[f] === undefined) { merged[f] = local[f]; }
        // La confirmation locale prime (travail bassin déjà fait).
        if ((f === "eprRecuperees" || f === "codificationConfirmee") && local[f] === true) { merged[f] = true; }
      });
      var changed = JSON.stringify(local) !== JSON.stringify(merged);
      if (!changed) { return Promise.resolve(false); }
    }
    return rawUpdate(merged).then(function () {
      if (retourNouveau && window.CAEKNotifLocale && CAEKNotifLocale.notifyRenvoi) {
        CAEKNotifLocale.notifyRenvoi(merged);
      }
      return true;
    });
  }

  function pull() {
    if (!ready() || !online()) { return Promise.resolve({ ok: false, changed: false }); }
    return CAEKServer.listCoulages(token(), null).then(function (rows) {
      rows = rows || [];
      var onServer = {};
      rows.forEach(function (r) { onServer[r.ref] = true; });
      return Promise.all([CAEKDB.getAllCoulages(), getQueue()]).then(function (out) {
        var locals = out[0] || [], queue = out[1] || {};
        var byRef = {};
        locals.forEach(function (c) { byRef[c.ref] = c; });
        var work = rows.map(function (row) { return mergeRow(row, byRef[row.ref], queue); });
        // Fiches locales connues du serveur mais disparues (supprimées par l'admin).
        locals.forEach(function (c) {
          if (!onServer[c.ref] && c._syncedAt && !queue[c.ref] && !isDemo(c.ref)) {
            work.push(CAEKDB.deleteCoulage(c.ref).then(function () { return true; }));
          }
        });
        return Promise.all(work).then(function (flags) {
          var changed = flags.some(function (x) { return x === true; });
          if (changed && window.CAEKBadges) { CAEKBadges.refresh(); }
          return { ok: true, changed: changed };
        });
      });
    }).catch(function () { return { ok: false, changed: false }; });
  }

  /* ---------- Hook sur la base locale ---------- */
  var rawUpdate = null;   // updateCoulage ORIGINAL (sans push) pour usage interne

  function installHook() {
    if (!window.CAEKDB || rawUpdate) { return; }
    rawUpdate = CAEKDB.updateCoulage.bind(CAEKDB);
    CAEKDB.updateCoulage = function (c) {
      return rawUpdate(c).then(function (res) { schedulePush(c); return res; });
    };
    if (CAEKDB.addCoulage) {
      var rawAdd = CAEKDB.addCoulage.bind(CAEKDB);
      CAEKDB.addCoulage = function (c) {
        return rawAdd(c).then(function (res) { schedulePush(c); return res; });
      };
    }
  }

  function autoSync() {
    if (!ready() || !online()) { return; }
    processEvents();
    processQueue().then(pull).then(function (r) {
      if (r && r.changed && window.CAEKRepertoire) {
        var s = document.getElementById("screen-repertoire");
        if (s && s.classList.contains("is-active")) { CAEKRepertoire.refresh(); }
      }
      // Les lots dépendent des coulages (labo, existence) : on les
      // synchronise APRÈS, pour résoudre les coulage_introuvable.
      if (window.CAEKLots) { CAEKLots.autoSync(); }
    });
  }

  /* ---------- Phase 3 : événements serveur IDEMPOTENTS ----------
     Récupération des éprouvettes / répartition au bassin : jusqu'ici purement
     locaux (LOCAL_FIELDS), désormais aussi ENREGISTRÉS côté serveur via
     op_coulage_event. L'IDENTITÉ d'une occurrence = requestId (UUID) : rejouer
     la MÊME occurrence (retry réseau) est sans effet, mais deux occurrences
     distinctes (2ᵉ récupération, re-répartition légitime) sont acceptées.
     eventKey = ref:type:requestId (unique par occurrence, plus par ref:type). */
  var EVENTS_KEY = "eventsQueue";
  var _eventsRpcAbsent = false;

  function sendEvent(ref, type, payload) {
    if (!ref || isDemo(ref)) { return Promise.resolve(); }
    var rid = newUuid();
    var ev = {
      eventKey: ref + ":" + type + ":" + rid,
      ref: ref, type: type, payload: payload || {},
      appareil: String(navigator.userAgent || "").slice(0, 120),
      requestId: rid
    };
    return CAEKDB.getMeta(EVENTS_KEY).then(function (q) {
      q = Array.isArray(q) ? q : [];
      // dédoublonnage par requestId (identité d'occurrence) : ne perd jamais
      // une nouvelle occurrence, ne double jamais un retry de la même.
      if (!q.some(function (e) { return e.requestId === ev.requestId; })) { q.push(ev); }
      return CAEKDB.setMeta(EVENTS_KEY, q);
    }).then(processEvents);
  }

  function processEvents() {
    if (!ready() || !online() || _eventsRpcAbsent || !CAEKServer.coulageEvent) { return Promise.resolve(); }
    return CAEKDB.getMeta(EVENTS_KEY).then(function (q) {
      q = Array.isArray(q) ? q : [];
      if (!q.length) { return; }
      return q.reduce(function (p, ev) {
        return p.then(function () {
          return CAEKServer.coulageEvent(token(), ev).then(function (r) {
            if (r && (r.ok === true || r.error === "coulage_introuvable")) {
              // coulage_introuvable : le coulage n'est pas encore monté ->
              // on garde l'événement pour le prochain passage.
              if (r.ok === true) {
                return CAEKDB.getMeta(EVENTS_KEY).then(function (q2) {
                  q2 = (Array.isArray(q2) ? q2 : []).filter(function (e) { return e.eventKey !== ev.eventKey; });
                  return CAEKDB.setMeta(EVENTS_KEY, q2);
                });
              }
            }
          }).catch(function (e) {
            if (isRpcMissing(e)) { _eventsRpcAbsent = true; }
          });
        });
      }, Promise.resolve());
    });
  }

  /* ---------- Résolution d'un conflit de versions (choix VISIBLE) ---------- */
  // choix = "serveur"  : adopter la fiche serveur (mes modifications locales
  //                      non synchronisées sont abandonnées) ;
  // choix = "local"    : conserver MA fiche et la renvoyer, rebasée sur la
  //                      version serveur (nouvelle opération idempotente).
  function resoudreConflit(ref, choix) {
    return CAEKDB.getCoulage(ref).then(function (c) {
      if (!c || !c._conflit) { return { ok: false, error: "aucun_conflit" }; }
      var srv = c._conflit;
      if (choix === "serveur") {
        var merged = (srv.payload && typeof srv.payload === "object") ? srv.payload : c;
        merged.ref = ref;
        merged.uuid = c.uuid;
        merged.statut = srv.statut || merged.statut || "brouillon";
        merged._version = srv.version || 1;
        merged._conflit = null;
        merged._syncedAt = new Date().toISOString();
        LOCAL_FIELDS.forEach(function (f) {
          if (c[f] !== undefined && merged[f] === undefined) { merged[f] = c[f]; }
        });
        return rawUpdate(merged).then(function () { return { ok: true, choix: "serveur" }; });
      }
      // choix "local" : rebase + renvoi
      c._version = srv.version || c._version || 1;
      c._conflit = null;
      return rawUpdate(c).then(function () {
        return enqueue(ref, "save", "", true).then(function () {
          return processQueue().then(function () { return { ok: true, choix: "local" }; });
        });
      });
    });
  }

  function init() {
    installHook();
    migrateLegacyQueue();
    window.addEventListener("online", autoSync);
    setTimeout(autoSync, 1200);
  }

  return {
    init: init,
    schedulePush: schedulePush,
    registerLocalDraft: registerLocalDraft,
    soumettre: soumettre,
    deleteOnServer: deleteOnServer,
    processQueue: processQueue,
    pull: pull,
    pendingCount: pendingCount,
    resoudreConflit: resoudreConflit,
    sendEvent: sendEvent,
    processEvents: processEvents,
    newUuid: newUuid,
    autoSync: autoSync
  };
})();

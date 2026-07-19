/* ============================================================
   CAEK — Gestion des déchets (Phase 5).
   Source de vérité : serveur (lots testés/validés - évacuations).
   IndexedDB : cache hors ligne + file d'évacuations idempotentes.
   ============================================================ */
var CAEKDechets = (function () {
  "use strict";

  var DEFAULT_SEUIL = 100;
  var DEFAULT_POIDS = 8;
  var PENDING_KEY = "dechetsEvacPending";

  function $(id) { return document.getElementById(id); }
  function num(v) { var s = window.CAEKModel ? CAEKModel.normDigits(v) : String(v == null ? "" : v); var n = parseFloat(s.replace(",", ".")); return isNaN(n) ? 0 : n; }
  function intOr0(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function escapeHtml(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function nowTime() { var d = new Date(); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function fmtDate(d) {
    if (!d) { return "—"; }
    var s = String(d); if (s.indexOf("T") >= 0) { s = s.slice(0, 10); }
    var p = s.split("-"); return p.length === 3 ? (p[2] + "/" + p[1] + "/" + p[0]) : s;
  }
  function newId() {
    return window.CAEKCoulages && CAEKCoulages.newUuid ? CAEKCoulages.newUuid()
      : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
  }
  function currentLabo() {
    if (window.CAEKLaboFilter && CAEKLaboFilter.get()) { return CAEKLaboFilter.get(); }
    var own = window.CAEKOperateurs && CAEKOperateurs.laboId ? (CAEKOperateurs.laboId() || "") : "";
    if (own) { return own; }
    // Un admin limité sans labo de rattachement peut gérer son unique labo
    // autorisé ; l'API serveur conserve le contrôle de périmètre.
    var allowed = window.CAEKOperateurs && CAEKOperateurs.adminLabos ? CAEKOperateurs.adminLabos() : null;
    return allowed && allowed.length === 1 ? allowed[0] : "";
  }
  function serverReady() {
    return navigator.onLine !== false && window.CAEKServer && CAEKServer.configured() &&
      window.CAEKOperateurs && CAEKOperateurs.isLogged();
  }

  function localParams() {
    if (!window.CAEKDB) { return Promise.resolve({ stock: 0, seuil: DEFAULT_SEUIL, poidsMoyen: DEFAULT_POIDS, evacuations: [], sync: "local" }); }
    return Promise.all([
      CAEKDB.getMeta("dechetsStock"), CAEKDB.getMeta("dechetsSeuil"),
      CAEKDB.getMeta("dechetsPoidsMoyen"), CAEKDB.getMeta("dechetsEvacuations"),
      CAEKDB.getMeta(PENDING_KEY)
    ]).then(function (o) {
      return {
        stock: intOr0(o[0]), seuil: o[1] == null ? DEFAULT_SEUIL : intOr0(o[1]),
        poidsMoyen: o[2] == null ? DEFAULT_POIDS : num(o[2]),
        evacuations: Array.isArray(o[3]) ? o[3] : [],
        pending: Array.isArray(o[4]) ? o[4] : [], sync: navigator.onLine === false ? "hors_ligne" : "local"
      };
    });
  }

  function saveServerCache(state, rows) {
    var list = (rows || []).map(function (e) {
      return { id: e.id, date: e.date_evac || e.date, heure: "", quantite: intOr0(e.nombre || e.quantite),
        observation: e.note || e.observation || "", operateur: e.operateur || "", requestId: e.request_id || "", sync: "synchronise" };
    });
    return Promise.all([
      CAEKDB.setMeta("dechetsStock", intOr0(state.stock)),
      CAEKDB.setMeta("dechetsSeuil", intOr0(state.seuilDechets) || DEFAULT_SEUIL),
      CAEKDB.setMeta("dechetsPoidsMoyen", num(state.poidsMoyenDechets) || DEFAULT_POIDS),
      CAEKDB.setMeta("dechetsEvacuations", list)
    ]).then(function () { return list; });
  }

  function processPending() {
    if (!window.CAEKDB || !serverReady() || !CAEKServer.addEvacuationV2) { return Promise.resolve({ sent: 0 }); }
    return CAEKDB.getMeta(PENDING_KEY).then(function (q) {
      q = Array.isArray(q) ? q : [];
      var sent = 0;
      return q.reduce(function (p, entry) {
        return p.then(function () {
          if (entry.error) { return; }
          return CAEKServer.addEvacuationV2(CAEKOperateurs.token(), entry.laboId || null,
            entry.quantite, entry.observation, entry.requestId).then(function (r) {
            if (r && r.ok === true) {
              sent++;
              q = q.filter(function (x) { return x.requestId !== entry.requestId; });
              return CAEKDB.setMeta(PENDING_KEY, q);
            }
            if (r && r.error && r.error !== "network") {
              entry.error = r.error;
              entry.stockServeur = r.stock;
              return CAEKDB.setMeta(PENDING_KEY, q);
            }
          }).catch(function () {});
        });
      }, Promise.resolve()).then(function () { return { sent: sent, pending: q }; });
    });
  }

  function getParams() {
    return processPending().then(localParams).then(function (cached) {
      if (!serverReady() || !CAEKServer.getDechetsState) { return cached; }
      var labo = currentLabo() || null;
      return Promise.all([
        CAEKServer.getDechetsState(CAEKOperateurs.token(), labo),
        CAEKServer.listEvacuations(CAEKOperateurs.token(), labo)
      ]).then(function (out) {
        var state = out[0];
        if (!state || state.ok !== true) {
          cached.sync = state && state.error === "labo_requis" ? "labo_requis" : "erreur";
          return cached;
        }
        return saveServerCache(state, out[1] || []).then(function (list) {
          return localParams().then(function (latest) {
            return { stock: intOr0(state.stock), seuil: intOr0(state.seuilDechets) || DEFAULT_SEUIL,
              poidsMoyen: num(state.poidsMoyenDechets) || DEFAULT_POIDS,
              evacuations: list, pending: latest.pending || [], sync: "synchronise", laboId: state.laboId || labo || "" };
          });
        });
      }).catch(function () { cached.sync = "erreur"; return cached; });
    });
  }

  // Optimisme local uniquement. Le serveur déduit le stock des lots synchronisés.
  function addCasse(n) {
    n = intOr0(n);
    if (n <= 0 || !window.CAEKDB) { return Promise.resolve(); }
    return CAEKDB.getMeta("dechetsStock").then(function (v) { return CAEKDB.setMeta("dechetsStock", intOr0(v) + n); });
  }

  function result(html, isError) {
    var b = $("dechets-result"); if (!b) { return; }
    b.hidden = false; b.className = "result-card " + (isError ? "is-error" : "is-ok"); b.innerHTML = html;
  }
  function renderEvac(list, pending) {
    var box = $("dechets-evac-liste"); if (!box) { return; }
    var all = (pending || []).map(function (e) {
      var c = {}; Object.keys(e).forEach(function (k) { c[k] = e[k]; });
      c.sync = e.error ? "erreur" : "en_attente"; return c;
    }).concat(list || []);
    if (!all.length) { box.innerHTML = "<p class=\"hint\">Aucune évacuation enregistrée.</p>"; return; }
    box.innerHTML = all.map(function (e) {
      var etat = e.sync === "en_attente" ? " · ⏳ en attente de synchronisation"
        : (e.sync === "erreur" ? " · ⚠ erreur : " + escapeHtml(e.error || "synchronisation") : " · ✓ synchronisé");
      return "<div class=\"dechets-evac-item\"><strong>" + intOr0(e.quantite) +
        " éprouvette(s)</strong> évacuée(s) · " + escapeHtml(fmtDate(e.date)) +
        (e.operateur ? " · " + escapeHtml(e.operateur) : "") + etat +
        (e.observation ? "<br>📝 " + escapeHtml(e.observation) : "") + "</div>";
    }).join("");
  }
  function renderSync(p) {
    var e = $("dechets-sync-etat"); if (!e) { return; }
    var msg = { synchronise: "✓ Synchronisé avec le serveur", hors_ligne: "⏳ Hors ligne — synchronisation en attente",
      erreur: "⚠ Synchronisation impossible", local: "Stock local en attente",
      labo_requis: "Choisissez un laboratoire dans le filtre pour afficher son stock." }[p.sync] || "";
    e.textContent = msg; e.className = "hint dechets-sync " + (p.sync === "synchronise" ? "is-ok" : "is-warn");
  }
  function refresh() {
    return getParams().then(function (p) {
      var poids = Math.round(p.stock * p.poidsMoyen * 10) / 10;
      if ($("dechets-stock")) { $("dechets-stock").textContent = p.stock; }
      if ($("dechets-poids")) { $("dechets-poids").textContent = poids; }
      if ($("dechets-seuil-aff")) { $("dechets-seuil-aff").textContent = p.seuil; }
      if ($("dechets-seuil") && document.activeElement !== $("dechets-seuil")) { $("dechets-seuil").value = p.seuil; }
      if ($("dechets-poidsmoyen") && document.activeElement !== $("dechets-poidsmoyen")) { $("dechets-poidsmoyen").value = p.poidsMoyen; }
      var labo = p.laboId || currentLabo();
      if (labo && window.CAEKModel && CAEKModel.loadLaboSettings) {
        CAEKModel.loadLaboSettings(labo).then(function (settings) {
          var fields = [["dechets-echant-v1", "echantPremiereTrancheM3"], ["dechets-echant-n1", "echantPremiereTrancheNb"],
            ["dechets-echant-v2", "echantTrancheSuivanteM3"], ["dechets-echant-n2", "echantTrancheSuivanteNb"]];
          fields.forEach(function (f) {
            var el = $(f[0]);
            if (el && document.activeElement !== el) { el.value = settings[f[1]] == null ? "" : settings[f[1]]; }
          });
        });
      }
      var al = $("dechets-alerte");
      if (al && p.sync !== "labo_requis" && p.seuil > 0 && p.stock >= p.seuil) {
        al.hidden = false; al.className = "bassin-alerte is-retard";
        al.innerHTML = "&#9888; Seuil atteint (" + p.stock + "/" + p.seuil + "). Prévoir l'évacuation des déchets béton.";
      } else if (al) { al.hidden = true; }
      renderSync(p); renderEvac(p.evacuations, p.pending);
      return p;
    });
  }

  function saveParams() {
    if (window.CAEKOperateurs && !CAEKOperateurs.requireAdmin("modifier les paramètres déchets")) { return; }
    var seuil = intOr0($("dechets-seuil") ? $("dechets-seuil").value : 0);
    var pm = num($("dechets-poidsmoyen") ? $("dechets-poidsmoyen").value : 0);
    var v1 = num($("dechets-echant-v1") ? $("dechets-echant-v1").value : 0);
    var n1 = intOr0($("dechets-echant-n1") ? $("dechets-echant-n1").value : 0);
    var v2 = num($("dechets-echant-v2") ? $("dechets-echant-v2").value : 0);
    var n2 = intOr0($("dechets-echant-n2") ? $("dechets-echant-n2").value : 0);
    var labo = currentLabo();
    if (!labo) { result("&#9888; Choisissez d'abord un laboratoire dans le filtre.", true); return; }
    if (seuil <= 0 || pm <= 0) { result("&#9888; Le seuil et le poids moyen doivent être supérieurs à 0.", true); return; }
    if (!serverReady() || !CAEKServer.adminSetLaboSettings) { result("&#9888; Réseau requis pour modifier les paramètres du laboratoire.", true); return; }
    if (v1 <= 0 || n1 <= 0 || v2 <= 0 || n2 <= 0) { result("&#9888; Renseignez une regle d'echantillonnage valide.", true); return; }
    CAEKModel.loadLaboSettings(labo).then(function (settings) {
      settings.seuilDechets = seuil; settings.poidsMoyenDechets = pm;
      settings.echantPremiereTrancheM3 = v1; settings.echantPremiereTrancheNb = n1;
      settings.echantTrancheSuivanteM3 = v2; settings.echantTrancheSuivanteNb = n2;
      return CAEKServer.adminSetLaboSettings(CAEKOperateurs.token(), labo, settings, newId());
    }).then(function (r) {
      if (!r || r.ok !== true) { result("&#9888; Paramètres non enregistrés sur le serveur.", true); return; }
      return Promise.all([CAEKDB.setMeta("dechetsSeuil", seuil), CAEKDB.setMeta("dechetsPoidsMoyen", pm)]).then(function () {
        result("&#10004; Paramètres synchronisés avec le serveur.", false); refresh();
      });
    }).catch(function (e) { result("&#9888; Synchronisation impossible : " + escapeHtml(e && e.message || ""), true); });
  }

  function confirmEvac() {
    var prof = window.CAEKProfil ? CAEKProfil.require("Profil opérateur requis pour confirmer une évacuation.") : { nom: "" };
    if (!prof) { return; }
    var qte = intOr0($("dechets-evac-qte") ? $("dechets-evac-qte").value : 0);
    if (qte <= 0) { result("&#9888; Indiquez la quantité évacuée.", true); return; }
    getParams().then(function (p) {
      if (qte > p.stock) { result("&#9888; Quantité supérieure au stock (" + p.stock + ").", true); return; }
      var entry = { requestId: newId(), laboId: p.laboId || currentLabo() || "", date: todayStr(), heure: nowTime(),
        quantite: qte, observation: ($("dechets-evac-obs") && $("dechets-evac-obs").value.trim()) || "",
        operateur: prof.nom || "", qualification: prof.qualification || "", at: new Date().toISOString() };
      return Promise.all([CAEKDB.getMeta(PENDING_KEY), CAEKDB.getMeta("dechetsEvacuations")]).then(function (o) {
        var q = Array.isArray(o[0]) ? o[0] : []; q.push(entry);
        var history = Array.isArray(o[1]) ? o[1] : [];
        return Promise.all([CAEKDB.setMeta(PENDING_KEY, q), CAEKDB.setMeta("dechetsStock", p.stock - qte),
          CAEKDB.setMeta("dechetsEvacuations", history)]);
      }).then(processPending).then(function (s) {
        if ($("dechets-evac-qte")) { $("dechets-evac-qte").value = ""; }
        if ($("dechets-evac-obs")) { $("dechets-evac-obs").value = ""; }
        result(s && s.sent ? "&#10004; Évacuation synchronisée avec le serveur."
          : "&#8987; Évacuation enregistrée hors ligne et en attente de synchronisation.", false);
        refresh(); if (window.CAEKBadges) { CAEKBadges.refresh(); }
      });
    });
  }

  function init() {
    var sp = $("dechets-params-save"); if (sp) { sp.addEventListener("click", saveParams); }
    var ev = $("dechets-evac-valider"); if (ev) { ev.addEventListener("click", confirmEvac); }
    window.addEventListener("online", function () { processPending().then(refresh); });
  }
  return { init: init, refresh: refresh, addCasse: addCasse, getParams: getParams, processPending: processPending };
})();

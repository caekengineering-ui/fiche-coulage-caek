/* ============================================================
   Module Béton - CAEK
   notiflocale.js - Notifications LOCALES (sans serveur/SQL).

   L'appareil possède déjà, dans IndexedDB, l'état exact des fiches
   et des lots (récupération, répartition, échéances, déchets). Ce
   module émet une vraie notification système via le Service Worker
   (registration.showNotification) pour chaque catégorie d'action en
   retard, à l'ouverture de l'app et au retour au premier plan.

   Réutilise CAEKBadges.computeStats (aucune logique métier dupliquée) :
   c'est CAEKBadges.refresh() qui appelle emit(stats) après calcul.

   Portée : opérateur uniquement (actions physiques de labo). Les
   administrateurs pilotent la validation, pas la manutention.

   Limite : une notification locale n'apparaît que si l'app est
   ouverte ou au moment où l'opérateur l'ouvre / y revient. Un
   téléphone complètement fermé nécessite le push serveur (optionnel,
   cf. supabase_notifications_operateur.sql).

   Anti-spam : pour chaque catégorie, on ne re-notifie que si le
   nombre a AUGMENTÉ, ou une fois par nouveau jour tant qu'il reste > 0.
   ============================================================ */
var CAEKNotifLocale = (function () {
  "use strict";

  var STATE_KEY = "caek_notif_local_state";
  var OPT_IN_KEY = "caek_notifications_enabled";

  function supported() {
    return ("serviceWorker" in navigator) && ("Notification" in window);
  }
  function granted() {
    return supported() && Notification.permission === "granted";
  }
  function enabled() {
    try { return granted() && localStorage.getItem(OPT_IN_KEY) === "1"; }
    catch (e) { return false; }
  }
  function isOperateur() {
    return window.CAEKOperateurs && CAEKOperateurs.isLogged() &&
      CAEKOperateurs.role() === "operateur";
  }

  function todayStr() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function saveState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // Le bouton du profil pilote a la fois le push serveur et les alertes locales.
  function setEnabled(on) {
    try {
      if (on) { localStorage.setItem(OPT_IN_KEY, "1"); }
      else {
        localStorage.removeItem(OPT_IN_KEY);
        localStorage.removeItem(STATE_KEY);
      }
    } catch (e) {}
  }

  // Catégories notifiables, dans l'ordre d'urgence. `n` extrait le compteur
  // de la synthèse CAEKBadges. Les libellés restent en français (officiel).
  function categories(s) {
    return [
      { key: "recup", n: s.retardRecup,
        titre: "Éprouvettes à récupérer",
        corps: "prélèvement(s) en retard de récupération (délai dépassé).",
        url: "/#screen-repertoire" },
      { key: "repartir", n: s.aRepartir,
        titre: "Éprouvettes à répartir",
        corps: "fiche(s) prête(s) à répartir au bassin.",
        url: "/#screen-bassin" },
      { key: "sortir_j1", n: s.j1,
        titre: "Lots à sortir aujourd'hui",
        corps: "lot(s) à sortir du bassin aujourd'hui (J-1).",
        url: "/#screen-bassin-virtuel" },
      { key: "sortir_retard", n: s.retard,
        titre: "Lots en retard",
        corps: "lot(s) EN RETARD à sortir du bassin.",
        url: "/#screen-bassin-virtuel" },
      { key: "ecraser", n: s.aTester,
        titre: "Lots à écraser",
        corps: "lot(s) à écraser (saisir les résultats d'essai).",
        url: "/#screen-compression" },
      { key: "dechets", n: (s.dechetsAlerte ? s.dechetsStock : 0),
        titre: "Évacuation des déchets",
        corps: "éprouvettes écrasées — appeler le camion d'évacuation.",
        url: "/#screen-dechets" }
    ];
  }

  function showRaw(key, title, body, url) {
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.showNotification(title, {
        body: body,
        icon: "./assets/icons/icon-192.png",
        badge: "./assets/icons/icon-192.png",
        tag: "caek-local-" + key,   // collapse : remplace l'ancienne
        renotify: true,
        data: { url: url }
      });
    }).catch(function () {});
  }

  function show(cat) {
    return showRaw(cat.key, cat.titre, cat.n + " " + cat.corps, cat.url);
  }

  // Émet les notifications pertinentes à partir d'une synthèse CAEKBadges.
  function emit(stats) {
    if (!stats || !enabled() || !isOperateur()) { return; }
    var today = todayStr();
    var state = loadState();
    categories(stats).forEach(function (cat) {
      var prev = state[cat.key] || { count: 0, date: "" };
      var n = parseInt(cat.n, 10) || 0;
      if (n <= 0) {
        // Condition levée : on oublie l'état (une remontée future re-notifiera).
        if (state[cat.key]) { delete state[cat.key]; }
        return;
      }
      // Re-notifier si le nombre a augmenté, ou une fois par nouveau jour.
      if (n > prev.count || prev.date !== today) {
        show(cat);
      }
      state[cat.key] = { count: n, date: today };
    });
    saveState(state);
  }

  // Alerte evenementielle lors d'un retour admin detecte par la synchro.
  // La signature ref+motif evite tout doublon lors des pulls suivants.
  function notifyRenvoi(c) {
    if (!c || !c.ref || !c.retourAdmin || !enabled() || !isOperateur()) { return; }
    var state = loadState();
    var key = "renvoi:" + c.ref;
    var signature = String(c.retourAdmin);
    if (state[key] === signature) { return; }
    state[key] = signature;
    saveState(state);
    var motif = signature.length > 300 ? signature.slice(0, 297) + "..." : signature;
    showRaw("renvoi-" + c.ref, "Fiche a corriger",
      "Coulage " + c.ref + " renvoye par l'administrateur : " + motif,
      "/#screen-repertoire");
  }

  // Recalcule + émet quand l'app revient au premier plan.
  function onVisible() {
    if (document.visibilityState === "visible" && window.CAEKBadges) {
      CAEKBadges.refresh();   // -> rappellera emit(stats)
    }
  }

  function init() {
    if (!supported()) { return; }
    document.addEventListener("visibilitychange", onVisible);
  }

  return {
    init: init,
    emit: emit,
    notifyRenvoi: notifyRenvoi,
    setEnabled: setEnabled,
    enabled: enabled
  };
})();

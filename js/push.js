/* ============================================================
   Module Béton - CAEK
   push.js - V3 (P6) : notifications push (Web Push VAPID).

   - Abonnement de l'appareil via le Service Worker (pushManager),
     enregistré sur le serveur (op_save_push_subscription) et lié à
     l'opérateur connecté.
   - Bouton d'activation sur l'écran Profil : demande la permission
     puis s'abonne. Statut affiché (activées / à activer / non
     supportées).
   - iPhone : les notifications n'arrivent que si l'app est
     installée sur l'écran d'accueil (iOS 16.4+). Message dédié.
   - Clé publique VAPID dans js/config.js (CAEK_CONFIG.VAPID_PUBLIC).

   L'ENVOI est fait côté serveur (Edge Function send-push) ; ce
   module ne fait que gérer l'abonnement de l'appareil.
   ============================================================ */
var CAEKPush = (function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function supported() {
    return ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window);
  }
  function configured() {
    return !!(window.CAEK_CONFIG && CAEK_CONFIG.VAPID_PUBLIC &&
      CAEK_CONFIG.VAPID_PUBLIC.indexOf("VOTRE_CLE") < 0);
  }
  function isStandalone() {
    return window.matchMedia && window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
  }
  function isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent);
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(base64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) { arr[i] = raw.charCodeAt(i); }
    return arr;
  }

  function deviceLabel() {
    var ua = navigator.userAgent;
    if (/Android/.test(ua)) { return "Android"; }
    if (isIOS()) { return "iPhone/iPad"; }
    if (/Windows/.test(ua)) { return "Windows"; }
    return "Appareil";
  }

  // Abonne l'appareil et enregistre l'abonnement sur le serveur.
  function subscribe() {
    if (!supported()) { return Promise.resolve({ ok: false, error: "non_supporte" }); }
    if (!configured()) { return Promise.resolve({ ok: false, error: "non_configure" }); }
    if (!window.CAEKOperateurs || !CAEKOperateurs.isLogged()) {
      return Promise.resolve({ ok: false, error: "non_connecte" });
    }
    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") { return { ok: false, error: "refuse" }; }
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (existing) {
          if (existing) { return existing; }
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(CAEK_CONFIG.VAPID_PUBLIC)
          });
        });
      }).then(function (sub) {
        var json = sub.toJSON();
        return CAEKServer.savePushSubscription(CAEKOperateurs.token(), {
          endpoint: sub.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          appareil: deviceLabel()
        }).then(function (r) {
          return (r && r.ok === true) ? { ok: true } : { ok: false, error: "serveur" };
        });
      });
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || "erreur" };
    });
  }

  function unsubscribe() {
    if (!supported()) { return Promise.resolve(); }
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) { return; }
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function () {
          if (window.CAEKOperateurs && CAEKOperateurs.isLogged()) {
            return CAEKServer.deletePushSubscription(CAEKOperateurs.token(), endpoint);
          }
        });
      });
    }).catch(function () {});
  }

  /* ---------- UI (écran Profil) ---------- */
  function setStatus(html, cls) {
    var box = $("push-status");
    if (!box) { return; }
    box.hidden = false;
    box.className = "result-card " + (cls || "");
    box.innerHTML = html;
  }

  function currentState() {
    if (!supported()) { return Promise.resolve("non_supporte"); }
    if (isIOS() && !isStandalone()) { return Promise.resolve("ios_installer"); }
    if (Notification.permission === "denied") { return Promise.resolve("bloque"); }
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        return sub ? "actives" : "a_activer";
      });
    }).catch(function () { return "a_activer"; });
  }

  function renderState() {
    var btn = $("push-toggle");
    currentState().then(function (st) {
      if (st === "non_supporte") {
        setStatus("&#9888; Cet appareil / navigateur ne gère pas les notifications.", "is-error");
        if (btn) { btn.hidden = true; }
      } else if (st === "ios_installer") {
        setStatus("&#128241; Sur iPhone : ajoutez d'abord l'app à l'écran d'accueil (Partager &#8594; « Sur l'écran d'accueil »), puis rouvrez-la pour activer les notifications.", "is-warn");
        if (btn) { btn.hidden = true; }
      } else if (st === "bloque") {
        setStatus("&#128683; Notifications bloquées dans les réglages du navigateur. Autorisez-les puis réessayez.", "is-error");
        if (btn) { btn.hidden = true; }
      } else if (st === "actives") {
        setStatus("&#128276; Notifications <strong>activées</strong> sur cet appareil.", "is-ok");
        if (btn) { btn.hidden = false; btn.textContent = "🔕 Désactiver sur cet appareil"; btn.dataset.on = "1"; }
      } else {
        setStatus("&#128276; Activez les notifications pour être alerté (coulages à valider, éprouvettes à écraser…).", "");
        if (btn) { btn.hidden = false; btn.textContent = "🔔 Activer les notifications"; btn.dataset.on = "0"; }
      }
    });
  }

  function onToggle() {
    var btn = $("push-toggle");
    if (!btn) { return; }
    btn.disabled = true;
    var turningOn = btn.dataset.on !== "1";
    var op = turningOn ? subscribe() : unsubscribe().then(function () { return { ok: true }; });
    op.then(function (r) {
      btn.disabled = false;
      if (turningOn && r && !r.ok) {
        var msgs = {
          refuse: "Permission refusée.", non_supporte: "Non supporté sur cet appareil.",
          non_configure: "Notifications non configurées (clé VAPID manquante).",
          non_connecte: "Connectez-vous d'abord.", serveur: "Enregistrement serveur impossible."
        };
        setStatus("&#9888; " + (msgs[r.error] || ("Échec : " + r.error)), "is-error");
        return;
      }
      renderState();
    });
  }

  // Ré-abonnement silencieux à la connexion (si déjà autorisé).
  function refreshSilently() {
    if (!supported() || !configured()) { return; }
    if (Notification.permission !== "granted") { return; }
    if (isIOS() && !isStandalone()) { return; }
    subscribe();
  }

  function init() {
    var btn = $("push-toggle");
    if (btn) { btn.addEventListener("click", onToggle); }
    renderState();
    setTimeout(refreshSilently, 2500);
  }

  return { init: init, renderState: renderState, subscribe: subscribe, unsubscribe: unsubscribe };
})();

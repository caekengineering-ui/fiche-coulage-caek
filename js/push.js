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
  // Navigateurs "in-app" (WebView Facebook, Instagram, Messenger, TikTok…)
  // qui NE supportent PAS le Web Push : on redirige l'operateur vers Chrome.
  function isInApp() {
    var ua = navigator.userAgent || "";
    return /(FBAN|FBAV|FB_IAB|Instagram|Messenger|MicroMessenger|Line\/|TikTok|Twitter|Snapchat|Pinterest)/i.test(ua);
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

  // Compare la cle de l'abonnement existant a la cle VAPID courante.
  // Si une ANCIENNE cle est encore enregistree, l'abonnement echoue
  // (InvalidStateError) : il faut alors se desabonner puis se reabonner.
  function sameKey(existing) {
    try {
      var cur = urlBase64ToUint8Array(CAEK_CONFIG.VAPID_PUBLIC);
      var old = existing && existing.options && existing.options.applicationServerKey;
      if (!old) { return true; }
      var ob = new Uint8Array(old);
      if (ob.length !== cur.length) { return false; }
      for (var i = 0; i < ob.length; i++) { if (ob[i] !== cur[i]) { return false; } }
      return true;
    } catch (e) { return true; }
  }

  // Abonnement robuste : reabonnement propre si l'ancienne cle differe, et
  // 1 nouvel essai en cas d'erreur transitoire du service push (FCM).
  function doSubscribe(reg, attempt) {
    return reg.pushManager.getSubscription().then(function (existing) {
      if (existing && sameKey(existing)) { return existing; }
      var pre = existing ? existing.unsubscribe() : Promise.resolve();
      return pre.then(function () {
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(CAEK_CONFIG.VAPID_PUBLIC)
        });
      });
    }).catch(function (e) {
      var msg = (e && e.message) || "";
      if (attempt < 1 && /push service|Registration failed|AbortError|network/i.test(msg)) {
        return new Promise(function (res) { setTimeout(res, 1500); })
          .then(function () { return doSubscribe(reg, attempt + 1); });
      }
      throw e;
    });
  }

  // Abonne l'appareil et enregistre l'abonnement sur le serveur.
  function subscribe() {
    if (!supported()) { return Promise.resolve({ ok: false, error: "non_supporte" }); }
    if (!configured()) { return Promise.resolve({ ok: false, error: "non_configure" }); }
    if (isInApp()) { return Promise.resolve({ ok: false, error: "inapp" }); }
    if (!window.CAEKOperateurs || !CAEKOperateurs.isLogged()) {
      return Promise.resolve({ ok: false, error: "non_connecte" });
    }
    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") { return { ok: false, error: "refuse" }; }
      return navigator.serviceWorker.ready.then(function (reg) {
        return doSubscribe(reg, 0);
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
      var msg = (e && e.message) || "";
      if (/push service|Registration failed|AbortError|network/i.test(msg)) {
        return { ok: false, error: "push_service" };
      }
      return { ok: false, error: msg || "erreur" };
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
    if (!configured()) { return Promise.resolve("non_configure"); }
    if (isInApp()) { return Promise.resolve("inapp"); }
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
      } else if (st === "non_configure") {
        // Message clair pour l'opérateur (pas d'erreur technique VAPID brute).
        setStatus("&#128276; Notifications non configurées sur le serveur. Contactez l'administrateur.", "is-warn");
        if (btn) { btn.hidden = true; }
      } else if (st === "inapp") {
        setStatus("&#128241; Les notifications ne fonctionnent pas dans le navigateur de Facebook. Ouvrez l'application dans <strong>Chrome</strong> (menu &#8942; &#8594; « Ouvrir dans le navigateur / Chrome »), puis installez-la sur l'écran d'accueil et réessayez.", "is-warn");
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
          refuse: "Permission refusée. Autorisez les notifications dans les réglages du navigateur puis réessayez.",
          non_supporte: "Cet appareil / navigateur ne gère pas les notifications.",
          non_configure: "Notifications non configurées sur le serveur. Contactez l'administrateur.",
          non_connecte: "Connectez-vous d'abord.",
          serveur: "Enregistrement serveur impossible. Vérifiez votre connexion puis réessayez.",
          inapp: "Ouvrez l'application dans Chrome (menu ⋮ → « Ouvrir dans le navigateur »), pas dans Facebook, puis réessayez.",
          push_service: "Impossible de joindre le service de notifications. Ouvrez l'app dans Chrome (pas dans Facebook), vérifiez votre connexion, puis réessayez."
        };
        var cls = (r.error === "inapp") ? "is-warn" : "is-error";
        setStatus("&#9888; " + (msgs[r.error] || "Activation impossible pour le moment. Réessayez dans un instant."), cls);
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

/* ============================================================
   Fiche de coulage terrain - CAEK
   service-worker.js - T1 : mise en cache hors-ligne du socle
   Strategie : "cache d'abord" pour les fichiers de l'app.
   Pour publier une mise a jour : incrementer CACHE_VERSION.
   ============================================================ */

var CACHE_VERSION = "caek-beton-v95";

var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons_manifest.json",
  "./css/styles.css",
  "./js/i18n.js",
  "./assets/fonts/cairo-arabic-400.woff2",
  "./assets/fonts/cairo-arabic-600.woff2",
  "./assets/fonts/cairo-arabic-700.woff2",
  "./js/config.js",
  "./js/server.js",
  "./js/app.js",
  "./js/db.js",
  "./js/model.js",
  "./js/profil.js",
  "./js/operateurs.js",
  "./js/update.js",
  "./js/sync.js",
  "./js/medias.js",
  "./js/coulages.js",
  "./js/lots_sync.js",
  "./js/labofilter.js",
  "./js/push.js",
  "./js/notiflocale.js",
  "./js/formulations.js",
  "./js/centrales.js",
  "./js/validation.js",
  "./js/nouveau.js",
  "./js/fiche.js",
  "./js/photos.js",
  "./js/zip.js",
  "./js/export.js",
  "./js/repertoire.js",
  "./js/bassin.js",
  "./js/dechets.js",
  "./js/compression.js",
  "./js/badges.js",
  "./js/alertes.js",
  "./js/demo.js",
  "./vendor/xlsx.full.min.js",
  "./assets/logo-caek.png",
  "./assets/icons/favicon.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/menu/coulage-beton.png",
  "./assets/icons/menu/bassin-conservation.png",
  "./assets/icons/menu/test-compression.png",
  "./assets/icons/menu/profil.png",
  "./assets/icons/menu/mise-a-jour.png",
  "./assets/icons/ouvrages/fondation.png",
  "./assets/icons/ouvrages/superstructure.png",
  "./assets/icons/ouvrages/semelle.png",
  "./assets/icons/ouvrages/semelle_filante.png",
  "./assets/icons/ouvrages/radier.png",
  "./assets/icons/ouvrages/longrine.png",
  "./assets/icons/ouvrages/pieu.png",
  "./assets/icons/ouvrages/plot.png",
  "./assets/icons/ouvrages/mur_soutenement.png",
  "./assets/icons/ouvrages/ouvrage_enterre.png",
  "./assets/icons/ouvrages/regard.png",
  "./assets/icons/ouvrages/piscine.png",
  "./assets/icons/ouvrages/poteau.png",
  "./assets/icons/ouvrages/voile.png",
  "./assets/icons/ouvrages/dalle.png",
  "./assets/icons/ouvrages/poutre.png",
  "./assets/icons/ouvrages/escalier.png",
  "./assets/icons/ouvrages/console_balcon.png",
  "./assets/icons/ouvrages/parapet_acrotere.png",
  "./assets/icons/ouvrages/cuve_bache_eau.png",
  "./assets/icons/ouvrages/prelevement_beton.png",
  "./assets/icons/ouvrages/echantillon_frais.png",
  "./assets/icons/ouvrages/moule_cubique.png",
  "./assets/icons/ouvrages/moule_cylindrique.png"
];

// Installation : pre-cache du socle.
// On force un fetch reseau frais (cache: "reload") pour ne jamais
// re-cacher une version perimee servie par le cache HTTP du navigateur.
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return Promise.all(APP_SHELL.map(function (url) {
        return fetch(new Request(url, { cache: "reload" }))
          .then(function (resp) { if (resp && resp.ok) { return cache.put(url, resp); } })
          .catch(function () { /* ressource indispo : on ignore */ });
      }));
    })
  );
  self.skipWaiting();
});

// Activation : suppression des anciens caches
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_VERSION) { return caches.delete(key); }
        })
      );
    })
  );
  self.clients.claim();
});

/* ---- Version reellement servie ----
   La page demande « version » et affiche la reponse en pied d'ecran. On
   renvoie la version du service worker ACTIF, pas une constante ecrite dans
   la page : si le telephone tourne encore sur un ancien cache, c'est cet
   ancien numero qui s'affiche. L'utilisateur voit donc tout de suite s'il
   n'a pas recu la mise a jour, au lieu de lire un numero toujours juste
   en apparence. */
self.addEventListener("message", function (event) {
  if (!event.data || event.data.type !== "version") { return; }
  var reponse = { type: "version", version: CACHE_VERSION };
  if (event.ports && event.ports[0]) { event.ports[0].postMessage(reponse); return; }
  if (event.source && event.source.postMessage) { event.source.postMessage(reponse); }
});

// ---- Notifications push (Web Push) ----
self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  var title = data.title || "Module Béton CAEK";
  var options = {
    body: data.body || "",
    icon: "./assets/icons/icon-192.png",
    badge: "./assets/icons/icon-192.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "./" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clic sur une notification : ouvre/focus l'app sur l'écran ciblé.
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ("focus" in list[i]) {
          if (target && target.indexOf("#") >= 0 && "navigate" in list[i]) {
            try { list[i].navigate(target); } catch (e) {}
          }
          return list[i].focus();
        }
      }
      if (self.clients.openWindow) { return self.clients.openWindow(target); }
    })
  );
});

// Requetes : cache d'abord, repli reseau (GET uniquement)
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") { return; }
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) { return cached; }
      return fetch(event.request).then(function (response) {
        return response;
      }).catch(function () {
        // Hors-ligne et non mis en cache : repli vers l'accueil pour la navigation
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
    })
  );
});

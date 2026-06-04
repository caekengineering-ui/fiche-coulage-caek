/* ============================================================
   Fiche de coulage terrain - CAEK
   service-worker.js - T1 : mise en cache hors-ligne du socle
   Strategie : "cache d'abord" pour les fichiers de l'app.
   Pour publier une mise a jour : incrementer CACHE_VERSION.
   ============================================================ */

var CACHE_VERSION = "caek-coulage-v8";

var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/app.js",
  "./js/db.js",
  "./js/update.js",
  "./js/nouveau.js",
  "./js/fiche.js",
  "./js/photos.js",
  "./js/export.js",
  "./js/repertoire.js",
  "./vendor/xlsx.full.min.js",
  "./assets/logo-caek.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

// Installation : pre-cache du socle
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(APP_SHELL);
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

"use strict";
/* ============================================================
   Module Béton - CAEK
   config.js - Configuration du serveur Supabase.

   Remplacer les 2 valeurs ci-dessous par celles de TON projet
   Supabase (Project Settings -> API Keys). Voir GUIDE_SERVEUR_SUPABASE.md.
     - SUPABASE_URL  : Project URL (ex. https://xxxx.supabase.co)
     - SUPABASE_ANON : clé publique "publishable" (OK dans l'app)
   NE JAMAIS mettre ici la clé secrète service_role (réservée au
   bureau / Python).
   ============================================================ */
var CAEK_CONFIG = {
  SUPABASE_URL: "https://lraxccgckyuxvotliify.supabase.co",
  SUPABASE_ANON: "sb_publishable_iHgKDbThut5dkpkDJz4GlQ_zBhEOUfJ",
  // Clé PUBLIQUE VAPID des notifications push (paire générée le 06/07/2026,
  // clé privée = secret de l'Edge Function send-push — voir
  // GUIDE_NOTIFICATIONS.md et vapid_keys.json hors dépôt).
  VAPID_PUBLIC: "BJM--_1Z6-rFzlMj6hu8r8GoovAO5IAv9lABm1CVyBvv-zJeBWhBq9tUvmKjKcd8ZElr3SKMe6Q1jJdxCUw1q8I",
  APP_VERSION: "3.0"
};

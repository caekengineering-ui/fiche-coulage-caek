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
  // Clé publique VAPID des notifications push (générée avec
  // « npx web-push generate-vapid-keys » — voir GUIDE_NOTIFICATIONS.md).
  // Laisser le placeholder tant que les notifications ne sont pas déployées.
  VAPID_PUBLIC: "VOTRE_CLE_VAPID_PUBLIQUE",
  APP_VERSION: "3.0"
};

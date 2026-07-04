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
  SUPABASE_URL: "https://VOTRE-PROJET.supabase.co",
  SUPABASE_ANON: "sb_publishable_VOTRE_CLE",
  APP_VERSION: "3.0"
};

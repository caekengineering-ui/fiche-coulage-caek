# Module Béton CAEK — Mise en service du serveur Supabase

Guide pas à pas pour créer le **nouveau projet Supabase dédié au béton**
(séparé de celui de l'essai in situ) et le relier à l'application.
Durée : ~10 minutes. Tout est gratuit.

## 1. Créer le projet

1. Ouvrir <https://supabase.com/dashboard> et se connecter (même compte que
   pour l'in situ, c'est autorisé : le plan gratuit permet 2 projets).
2. **New project** :
   - *Name* : `module-beton-caek`
   - *Database Password* : choisir un mot de passe fort et **le noter**
     (le conserver comme pour l'in situ dans un fichier local, jamais dans git).
   - *Region* : `West EU` (ou la plus proche).
3. Attendre ~2 minutes que le projet soit prêt.

## 2. Installer le schéma

1. Menu gauche → **SQL Editor** → **New query**.
2. Ouvrir le fichier `supabase_schema.sql` (à la racine de ce dossier),
   **tout copier**, coller dans l'éditeur, puis **Run**.
3. Résultat attendu : `Success. No rows returned` (ou similaire).
   Le schéma crée : labos, opérateurs, clients, projets, formulations,
   coulages, lots, évacuations, abonnements push + toutes les fonctions
   sécurisées, **un labo « Laboratoire central »** et **l'admin par défaut**.

## 3. Récupérer les clés et configurer l'app

1. Menu gauche → **Project Settings** → **API Keys**.
2. Copier :
   - **Project URL** (ex. `https://xxxx.supabase.co`) ;
   - la clé **publishable** (`sb_publishable_…`) — c'est la clé publique.
3. Ouvrir `js/config.js` dans ce dossier et remplacer les deux valeurs
   `SUPABASE_URL` et `SUPABASE_ANON`.
4. ⚠️ La clé **secret** (`sb_secret_…`) ne va JAMAIS dans l'app : elle sera
   utilisée plus tard côté bureau (Python, Phase 8) dans un
   `server_config.json` non versionné.

## 4. Première connexion et sécurisation

1. Lancer l'app et se connecter : identifiant `admin`, PIN `1234`.
2. **Changer immédiatement le PIN admin** (écran Profil/Admin).
3. Écran Admin → **Laboratoires** : créer les labos réels
   (ex. « Laboratoire central », « Annexe Béchar »).
4. Écran Admin → **Opérateurs** : créer chaque opérateur avec son
   identifiant, son PIN et son **labo d'affectation** — il ne verra que les
   éprouvettes, le bassin et les écrasements de ce labo.

## Rappels de sécurité

- Clé `anon`/`publishable` dans l'app : ne donne accès qu'aux fonctions
  `op_*`/`admin_*` (RLS strict, aucun accès direct aux tables).
- PIN jamais stocké en clair (empreinte sha256 côté serveur).
- Les médias (photos/audio) sont supprimés du serveur à la validation d'un
  coulage : le quota gratuit (1 Go) ne sert que de zone de transit.

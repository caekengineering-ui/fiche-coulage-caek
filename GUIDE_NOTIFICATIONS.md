# Module Béton CAEK — Notifications push (mise en service)

Les notifications arrivent sur le téléphone **même application fermée** :
- **Administrateur** : « Coulage ABA012 à valider », « Résultats à valider ».
- **Opérateurs d'un labo** : éprouvettes à sortir/écraser (échéances),
  « appeler le camion d'évacuation » (seuil déchets atteint).

Tout est gratuit. **Tout se fait dans le navigateur** (dashboard Supabase),
aucune ligne de commande. Étapes à faire une seule fois (~10 min).

## État actuel

- ✅ Côté application : prêt (abonnement, bouton Profil, clé publique VAPID
  branchée dans `js/config.js`).
- ✅ Clés VAPID : générées le 06/07/2026 — la paire est dans
  **`../vapid_keys.json`** (dossier parent, hors dépôt git). La clé PRIVÉE est
  secrète.
- ⬜ Étapes serveur ci-dessous (SQL + Edge Function + secrets + cron).

## 1. Exécuter la migration SQL

SQL Editor du projet **module-beton-caek** → coller le contenu de
`supabase_notifications.sql` → **Run**.
(Crée la table `notifications`, les déclencheurs « coulage soumis » /
« résultats testés » → admins, et la fonction de rappels quotidiens.)

## 2. Créer l'Edge Function « send-push » (via le dashboard)

1. Dashboard → **Edge Functions** (menu gauche) → **Deploy a new function**
   → **Via Editor** (éditeur dans le navigateur).
2. Nom de la fonction : `send-push`.
3. Effacer le code d'exemple et coller **tout** le contenu de
   `supabase/functions/send-push/index.ts` (dans ce dossier).
4. **Deploy function**.
5. Ouvrir la fonction → **Details** : désactiver « Verify JWT » (l'appel
   viendra du cron avec la clé secrète en en-tête).

## 3. Renseigner les secrets de la fonction

Dashboard → **Edge Functions** → **Secrets** → ajouter :

| Nom | Valeur |
|---|---|
| `SB_URL` | `https://lraxccgckyuxvotliify.supabase.co` |
| `SB_SERVICE_ROLE` | la clé **secret** `sb_secret_…` (Project Settings → API Keys) |
| `VAPID_PUBLIC` | valeur `vapid_public` de `../vapid_keys.json` |
| `VAPID_PRIVATE` | valeur `vapid_private` de `../vapid_keys.json` |
| `VAPID_SUBJECT` | `mailto:caek.engineering@gmail.com` |

## 4. Planifier l'envoi (pg_cron)

SQL Editor → coller et exécuter (remplacer `sb_secret_XXXX` par la clé secret) :

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Envoi des notifications en attente toutes les 2 minutes.
select cron.schedule('caek-send-push', '*/2 * * * *', $$
  select net.http_post(
    url := 'https://lraxccgckyuxvotliify.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Authorization', 'Bearer sb_secret_XXXX')
  );
$$);

-- Rappels quotidiens (échéances éprouvettes + déchets) à 7 h 00.
select cron.schedule('caek-reminders', '0 7 * * *', $$
  select public.enqueue_reminders();
$$);
```

## 5. Activer côté téléphone

1. Ouvrir l'app, se connecter.
2. **iPhone uniquement** : d'abord *Partager → « Sur l'écran d'accueil »*,
   puis rouvrir l'app depuis l'icône (obligatoire, iOS 16.4+).
3. Écran **Profil → 🔔 Activer les notifications** → accepter la permission.

Chaque opérateur/admin fait ça une fois sur son téléphone. Ensuite, un coulage
soumis ou une échéance déclenche une notification dans les ~2 minutes.

## Vérifier / dépanner

- Table `notifications` (Table Editor) : les lignes passent de `pending` à
  `sent` après le passage du cron.
- Logs de la fonction : Dashboard → Edge Functions → send-push → **Logs**.
- Test immédiat sans attendre le cron : Edge Functions → send-push →
  **Invoke** (ou soumettre un coulage de test puis attendre 2 min).
- Android/Chrome : fonctionne partout ; iPhone : uniquement app installée sur
  l'écran d'accueil (limite d'Apple).

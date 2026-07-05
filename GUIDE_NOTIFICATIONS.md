# Module Béton CAEK — Notifications push (mise en service)

Les notifications arrivent sur le téléphone **même application fermée** :
- **Administrateur** : « Coulage ABA012 à valider », « Résultats à valider ».
- **Opérateurs d'un labo** : éprouvettes à sortir/écraser (échéances),
  « appeler le camion d'évacuation » (seuil déchets atteint).

Tout est gratuit (Supabase Edge Functions + Web Push). Étapes à faire **une
seule fois**. Prévoir ~15 minutes. Il faut avoir installé le
[CLI Supabase](https://supabase.com/docs/guides/cli) et
[Node.js](https://nodejs.org).

## 1. Exécuter les migrations SQL

Dans le SQL Editor du projet **module-beton-caek**, exécuter (dans l'ordre) :
1. `supabase_notifications.sql` (table `notifications`, déclencheurs, rappels).

## 2. Générer les clés VAPID

Dans un terminal :

```bash
npx web-push generate-vapid-keys
```

Cela affiche une **Public Key** et une **Private Key**. Garder les deux.

- Coller la **Public Key** dans `js/config.js` → `VAPID_PUBLIC`.
- La **Private Key** reste secrète (étape 4).

## 3. Déployer l'Edge Function

Depuis le dossier `module_beton_caek/` :

```bash
supabase login
supabase link --project-ref lraxccgckyuxvotliify
supabase functions deploy send-push --no-verify-jwt
```

## 4. Renseigner les secrets de la fonction

```bash
supabase secrets set ^
  SB_URL=https://lraxccgckyuxvotliify.supabase.co ^
  SB_SERVICE_ROLE=sb_secret_XXXXXXXX ^
  VAPID_PUBLIC=LA_CLE_PUBLIQUE ^
  VAPID_PRIVATE=LA_CLE_PRIVEE ^
  VAPID_SUBJECT=mailto:caek.engineering@gmail.com
```

> `SB_SERVICE_ROLE` = clé **secret** (`sb_secret_…`) du projet
> (Project Settings → API Keys). Ne jamais la mettre dans l'app.
> (Sous Linux/Mac, remplacer les `^` par des `\` pour les retours à la ligne.)

## 5. Planifier l'envoi (pg_cron)

Dans le SQL Editor, activer les extensions puis programmer :

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Envoi des notifications en attente toutes les 2 minutes.
select cron.schedule('caek-send-push', '*/2 * * * *', $$
  select net.http_post(
    url := 'https://lraxccgckyuxvotliify.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Authorization', 'Bearer sb_secret_XXXXXXXX')
  );
$$);

-- Rappels quotidiens (échéances éprouvettes + déchets) à 7 h 00.
select cron.schedule('caek-reminders', '0 7 * * *', $$
  select public.enqueue_reminders();
$$);
```

*(Remplacer `sb_secret_XXXXXXXX` par la clé secret.)*

## 6. Activer côté téléphone

1. Ouvrir l'app, se connecter.
2. **iPhone uniquement** : d'abord *Partager → « Sur l'écran d'accueil »*,
   puis rouvrir l'app depuis l'icône (obligatoire, iOS 16.4+).
3. Écran **Profil → 🔔 Activer les notifications** → accepter la permission.

Chaque opérateur fait ça sur son téléphone. Ensuite, un coulage soumis ou une
échéance déclenche une notification dans les 2 minutes.

## Vérifier / dépanner

- Test manuel de l'envoi : appeler l'URL de la fonction (via le cron ou
  `curl -X POST .../functions/v1/send-push -H "Authorization: Bearer sb_secret_…"`).
- Voir les logs : `supabase functions logs send-push`.
- Table `notifications` : les lignes passent de `pending` à `sent`.
- Android/Chrome fonctionne toujours ; iPhone nécessite l'installation écran
  d'accueil (limite d'Apple, pas de l'app).

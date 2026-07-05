-- ============================================================================
--  CAEK — Module Béton (V3) : migration NOTIFICATIONS PUSH
--  À COLLER dans Supabase (projet module-beton-caek) :
--  SQL Editor -> New query -> Run.
--
--  File d'attente de notifications + déclencheurs. L'ENVOI réel (Web Push
--  VAPID) est fait par l'Edge Function « send-push » (voir
--  supabase/functions/send-push/ + GUIDE_NOTIFICATIONS.md), invoquée
--  périodiquement par pg_cron.
--
--  Cibles :
--    'admins'      -> tous les administrateurs (coulage soumis, résultats testés)
--    'labo:<uuid>' -> opérateurs d'un laboratoire (rappels éprouvettes, déchets)
-- ============================================================================

-- ------- File d'attente -------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  cible      text not null,                 -- 'admins' | 'labo:<uuid>'
  titre      text not null,
  corps      text not null,
  url        text default '/',
  tag        text default '',               -- regroupe/écrase les doublons
  statut     text not null default 'pending', -- pending | sent | error
  erreur     text default '',
  created_at timestamptz default now(),
  sent_at    timestamptz
);
create index if not exists idx_notif_pending on public.notifications(statut, created_at);

alter table public.notifications enable row level security;   -- service_role only

-- Évite d'empiler deux fois le même rappel (même cible + tag encore pending).
create or replace function public._enqueue_notif(p_cible text, p_titre text, p_corps text, p_url text, p_tag text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_tag <> '' and exists (
    select 1 from public.notifications
     where cible = p_cible and tag = p_tag and statut = 'pending') then
    return;
  end if;
  insert into public.notifications(cible, titre, corps, url, tag)
    values (p_cible, p_titre, p_corps, coalesce(p_url,'/'), coalesce(p_tag,''));
end; $$;

-- ------- Déclencheur : coulage soumis -> admins -------
create or replace function public._notif_coulage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'soumis' and (tg_op = 'INSERT' or old.statut is distinct from 'soumis') then
    perform public._enqueue_notif(
      'admins',
      'Coulage à valider',
      'Coulage ' || new.ref || ' enregistré par ' || coalesce(new.operateur, 'un opérateur') || ' — à vérifier.',
      '/#screen-validation',
      'coulage-' || new.ref);
  end if;
  return new;
end; $$;

drop trigger if exists trg_notif_coulage on public.coulages;
create trigger trg_notif_coulage after insert or update on public.coulages
  for each row execute function public._notif_coulage();

-- ------- Déclencheur : résultats d'écrasement saisis -> admins -------
create or replace function public._notif_lot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'teste' and (tg_op = 'INSERT' or old.statut is distinct from 'teste') then
    perform public._enqueue_notif(
      'admins',
      'Résultats à valider',
      'Écrasement saisi pour ' || new.coulage_ref || ' (' || coalesce(new.age_jours::text,'?') || ' j) — à valider.',
      '/#screen-validation',
      'lot-' || coalesce(new.lot_key, new.id::text));
  end if;
  return new;
end; $$;

drop trigger if exists trg_notif_lot on public.lots;
create trigger trg_notif_lot after insert or update on public.lots
  for each row execute function public._notif_lot();

-- ------- Rappels quotidiens (échéances éprouvettes + déchets) -------
-- À appeler une fois par jour par pg_cron. Scanne les lots encore au bassin :
--   * date_echeance = aujourd'hui      -> « à sortir / écraser aujourd'hui »
--   * date_echeance < aujourd'hui      -> « en retard »
-- et le cumul d'éprouvettes écrasées par labo vs seuil_dechets -> camion.
create or replace function public.enqueue_reminders()
returns json language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  -- Échéances du jour / en retard, groupées par labo.
  for r in
    select l.labo_id,
           count(*) filter (where l.date_echeance = current_date) as aujourdhui,
           count(*) filter (where l.date_echeance < current_date) as retard
    from public.lots l
    where l.statut in ('en_bassin','sorti')
      and l.date_echeance is not null
      and l.date_echeance <= current_date
    group by l.labo_id
  loop
    if coalesce(r.aujourdhui,0) + coalesce(r.retard,0) > 0 then
      perform public._enqueue_notif(
        'labo:' || r.labo_id,
        'Éprouvettes à écraser',
        case when r.retard > 0
             then r.retard || ' lot(s) en retard' ||
                  case when r.aujourdhui > 0 then ' et ' || r.aujourdhui || ' pour aujourd''hui.' else '.' end
             else r.aujourdhui || ' lot(s) à sortir / écraser aujourd''hui.' end,
        '/#screen-bassin-virtuel',
        'echeance-' || r.labo_id || '-' || current_date);
      n := n + 1;
    end if;
  end loop;

  -- Alerte camion déchets : cumul d'éprouvettes des lots testés/validés par
  -- labo >= seuil_dechets du labo.
  for r in
    select b.id as labo_id, b.nom, b.seuil_dechets,
           coalesce(sum(l.nombre) filter (where l.statut in ('teste','valide')), 0) as ecrasees
    from public.labos b
    left join public.lots l on l.labo_id = b.id
    where b.actif = true
    group by b.id, b.nom, b.seuil_dechets
  loop
    if r.ecrasees >= coalesce(r.seuil_dechets, 100) then
      perform public._enqueue_notif(
        'labo:' || r.labo_id,
        'Évacuation des déchets',
        r.ecrasees || ' éprouvettes écrasées à ' || r.nom || ' — appeler le camion d''évacuation.',
        '/#screen-dechets',
        'dechets-' || r.labo_id || '-' || current_date);
      n := n + 1;
    end if;
  end loop;

  return json_build_object('ok', true, 'enqueued', n);
end; $$;

-- FIN ------------------------------------------------------------------------
-- Suite : déployer l'Edge Function send-push puis planifier pg_cron
-- (voir GUIDE_NOTIFICATIONS.md).

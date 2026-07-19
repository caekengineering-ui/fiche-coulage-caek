-- ============================================================================
--  CAEK — Module Béton (V3) : NOTIFICATIONS OPÉRATEUR (extension)
--  À COLLER dans Supabase (projet module-beton-caek) :
--  SQL Editor -> New query -> Run.
--
--  Étend les notifications reçues par les OPÉRATEURS d'un laboratoire.
--  Dépend de supabase_notifications.sql (table notifications + _enqueue_notif)
--  et de supabase_schema.sql (lots, coulages).
--
--  Couvre (numérotation de la demande) :
--    3) lot à sortir « J-1 » (rouge, à sortir aujourd'hui)
--    4) lot en retard (aurait dû être sorti)
--    5) lot à écraser (sorti, en attente de saisie ; reste tant que non écrasé)
--    6) évacuation déchets (inchangé, conservé)
--    7) fiche renvoyée par l'administrateur -> opérateurs du labo
--
--  NB : 1) « à récupérer » et 2) « à répartir » nécessitent que l'app
--       synchronise l'état de récupération/répartition au serveur — voir la
--       migration séparée + le câblage client (non inclus ici).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (A) RAPPELS QUOTIDIENS — refonte de enqueue_reminders()
--     Appelée une fois/jour par le cron 'caek-reminders' (7 h). Chaque rappel
--     porte un tag daté : il se ré-empile chaque matin TANT QUE la condition
--     tient (donc « reste » visible jusqu'à ce que l'opérateur agisse), sans
--     doublonner dans la même journée.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_reminders()
returns json language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  -- (3+4) Lots à SORTIR du bassin. datePrevue = date d'essai ; la sortie est
  --       requise la VEILLE (J-1). Donc :
  --         * date_echeance = demain      -> J-1, « à sortir aujourd'hui » (rouge)
  --         * date_echeance <= aujourd'hui -> EN RETARD.
  for r in
    select l.labo_id,
           count(*) filter (where l.date_echeance = current_date + 1) as j1,
           count(*) filter (where l.date_echeance <= current_date)    as retard
    from public.lots l
    where l.statut = 'en_bassin' and l.date_echeance is not null
    group by l.labo_id
  loop
    if coalesce(r.j1,0) + coalesce(r.retard,0) > 0 then
      perform public._enqueue_notif(
        'labo:' || r.labo_id,
        'Lots à sortir du bassin',
        case when r.retard > 0
             then r.retard || ' lot(s) EN RETARD à sortir du bassin' ||
                  case when r.j1 > 0 then ' + ' || r.j1 || ' à sortir aujourd''hui.' else '.' end
             else r.j1 || ' lot(s) à sortir du bassin aujourd''hui.' end,
        '/#screen-bassin-virtuel',
        'sortir-' || r.labo_id || '-' || current_date);
      n := n + 1;
    end if;
  end loop;

  -- (5) Lots à ÉCRASER : déjà sortis du bassin, en attente de saisie des
  --     résultats d'essai. Reste tant que le lot n'est pas passé à 'teste'.
  for r in
    select l.labo_id, count(*) as a_ecraser
    from public.lots l
    where l.statut = 'sorti'
    group by l.labo_id
  loop
    if coalesce(r.a_ecraser,0) > 0 then
      perform public._enqueue_notif(
        'labo:' || r.labo_id,
        'Lots à écraser',
        r.a_ecraser || ' lot(s) sorti(s) du bassin à écraser (saisir les résultats).',
        '/#screen-compression',
        'ecraser-' || r.labo_id || '-' || current_date);
      n := n + 1;
    end if;
  end loop;

  -- (6) Alerte camion déchets : stock NET des éprouvettes testées/validées,
  --     diminué des évacuations synchronisées, >= seuil_dechets du labo.
  for r in
    select b.id as labo_id, b.nom, b.seuil_dechets,
           greatest(0,
             coalesce((select sum(l.nombre) from public.lots l
                       where l.labo_id = b.id and l.statut in ('teste','valide')), 0)
             - coalesce((select sum(e.nombre) from public.evacuations e
                         where e.labo_id = b.id), 0)) as ecrasees
    from public.labos b
    where b.actif = true
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

-- ---------------------------------------------------------------------------
-- (B) ÉVÉNEMENT IMMÉDIAT — fiche renvoyée par l'admin -> opérateurs du labo (7)
--     On étend le déclencheur existant _notif_coulage (coulage soumis ->
--     admins) pour aussi notifier l'opérateur quand l'admin renvoie la fiche
--     en correction (statut -> brouillon avec un motif). Tag daté à la minute
--     => chaque renvoi distinct passe (pas écrasé par un renvoi précédent).
-- ---------------------------------------------------------------------------
create or replace function public._notif_coulage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Coulage soumis -> administrateurs.
  if new.statut = 'soumis' and (tg_op = 'INSERT' or old.statut is distinct from 'soumis') then
    perform public._enqueue_notif(
      'admins',
      'Coulage à valider',
      'Coulage ' || new.ref || ' enregistré par ' || coalesce(new.operateur, 'un opérateur') || ' — à vérifier.',
      '/#screen-validation',
      'coulage-' || new.ref);
  end if;

  -- Fiche renvoyée pour correction -> opérateurs du laboratoire concerné.
  if tg_op = 'UPDATE' and new.statut = 'brouillon' and coalesce(new.retour_admin,'') <> ''
     and (old.statut is distinct from 'brouillon'
          or old.retour_admin is distinct from new.retour_admin) then
    perform public._enqueue_notif(
      'labo:' || new.labo_id,
      'Fiche à corriger',
      'Coulage ' || new.ref || ' renvoyé par l''administrateur : ' || new.retour_admin,
      '/#screen-repertoire',
      'renvoi-' || new.ref || '-' || to_char(now(), 'YYYYMMDDHH24MI'));
  end if;

  return new;
end; $$;

-- Le trigger trg_notif_coulage existe déjà (supabase_notifications.sql) et
-- pointe sur cette fonction : rien d'autre à faire.

-- FIN ------------------------------------------------------------------------

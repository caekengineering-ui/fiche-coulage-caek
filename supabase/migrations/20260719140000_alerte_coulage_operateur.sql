-- ============================================================================
-- Alerte coulage (BF-001) — suite : autonomie de l'opérateur en charge
-- et retour d'information au responsable.
--
-- Complète 20260719120000_alerte_coulage.sql. Trois apports :
--   (A) l'opérateur qui a pris en charge peut clore lui-même l'alerte
--       (Terminé / Annulé) ou la reporter à une nouvelle date, conformément
--       au parcours d'origine ; il n'a pas besoin du responsable pour cela ;
--   (B) le responsable créateur est notifié de CHAQUE événement : prise en
--       charge, report, annulation, fin ;
--   (C) la liste indique au client si l'alerte a été prise par LUI-MÊME,
--       afin que l'interface n'offre les actions de clôture qu'à l'opérateur
--       réellement en charge.
--
-- Le dépannage par un administrateur reste possible (il pouvait déjà prendre
-- en charge) : c'est volontaire, pour couvrir l'absence d'un opérateur.
--
-- INDÉPENDANCE : aucune écriture ni lecture dans coulages / lots /
-- prelevements.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper : prévenir le responsable créateur d'un événement sur son alerte.
-- Tag horodaté à la minute => deux événements distincts ne s'écrasent pas,
-- mais un double-clic dans la même minute reste absorbé.
-- ---------------------------------------------------------------------------
create or replace function public._notif_createur_alerte(
  a public.alertes_coulage, p_titre text, p_corps text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if a.cree_par is null then return; end if;
  perform public._enqueue_notif(
    'operateur:' || a.cree_par,
    p_titre,
    p_corps,
    '/#screen-alertes-coulage',
    'alerte-evt-' || a.id || '-' || to_char(now(), 'YYYYMMDDHH24MI'));
end; $$;

-- ---------------------------------------------------------------------------
-- (A+B) Prise en charge : inchangée dans sa mécanique atomique, elle prévient
--       désormais le responsable que quelqu'un a accusé réception.
-- ---------------------------------------------------------------------------
create or replace function public.op_prendre_en_charge_alerte(p_token text, p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; a public.alertes_coulage; v_labo uuid; v_nom text;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  select labo_id into v_labo from public.alertes_coulage where id = p_id;
  if v_labo is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;

  if r.is_admin then
    if not public._admin_can(p_token, v_labo) then
      return json_build_object('ok', false, 'error', 'autre_labo');
    end if;
  elsif r.labo_id is distinct from v_labo then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;

  update public.alertes_coulage set
    statut = 'prise_en_charge', prise_par = r.id, prise_par_nom = r.nom,
    prise_at = now(), updated_at = now()
  where id = p_id and prise_par is null
    and statut in ('a_prendre_en_charge', 'reportee')
  returning * into a;

  if a.id is null then
    select prise_par_nom into v_nom from public.alertes_coulage where id = p_id;
    return json_build_object('ok', false, 'error', 'deja_prise', 'priseParNom', coalesce(v_nom, ''));
  end if;

  perform public._notif_createur_alerte(a,
    'Coulage pris en charge',
    r.nom || ' a pris en charge le coulage ' || a.code_projet || ' du ' ||
      to_char(a.prevu_at, 'DD/MM') || '.');

  return json_build_object('ok', true, 'alerte', public._alerte_json(a));
end; $$;

-- ---------------------------------------------------------------------------
-- (A+B) Clôture / report par l'OPÉRATEUR EN CHARGE.
--       Statuts autorisés : terminee | annulee | reportee.
--       « reportee » exige une nouvelle date et CONSERVE l'affectation :
--       l'opérateur qui suivait le coulage continue de le suivre (décision de
--       cadrage). L'alerte reste donc active, avec sa nouvelle échéance.
-- ---------------------------------------------------------------------------
create or replace function public.op_statut_alerte_coulage(
  p_token text, p_id uuid, p_statut text, p_prevu_at timestamptz default null)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; a public.alertes_coulage; v_titre text; v_corps text;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  if p_statut not in ('terminee', 'annulee', 'reportee') then
    return json_build_object('ok', false, 'error', 'statut');
  end if;

  select * into a from public.alertes_coulage where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if a.statut in ('annulee', 'terminee') then
    return json_build_object('ok', false, 'error', 'alerte_close');
  end if;

  -- Seul l'opérateur EN CHARGE agit ici. Un responsable / admin habilité peut
  -- aussi intervenir (dépannage), mais passe normalement par resp_update.
  if a.prise_par is distinct from r.id and not public._peut_planifier(p_token) then
    return json_build_object('ok', false, 'error', 'pas_en_charge');
  end if;
  if public._peut_planifier(p_token) and r.is_admin
     and not public._admin_can(p_token, a.labo_id) then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;

  if p_statut = 'reportee' then
    if p_prevu_at is null then
      return json_build_object('ok', false, 'error', 'date_requise');
    end if;
    update public.alertes_coulage set
      statut = 'reportee', prevu_at = p_prevu_at,
      -- Nouvelle échéance : la relance redevient possible si l'alerte
      -- venait à perdre son affectation.
      alerte_envoyee_at = null, updated_at = now()
    where id = p_id returning * into a;
    v_titre := 'Coulage reporté';
    v_corps := r.nom || ' a reporté le coulage ' || a.code_projet || ' au ' ||
      to_char(a.prevu_at, 'DD/MM à HH24:MI') || '.';
  else
    update public.alertes_coulage set
      statut = p_statut, updated_at = now()
    where id = p_id returning * into a;
    v_titre := case when p_statut = 'annulee' then 'Coulage annulé' else 'Coulage terminé' end;
    v_corps := r.nom ||
      case when p_statut = 'annulee' then ' a annulé le coulage ' else ' a terminé le coulage ' end ||
      a.code_projet || ' du ' || to_char(a.prevu_at, 'DD/MM') || '.';
  end if;

  perform public._notif_createur_alerte(a, v_titre, v_corps);

  return json_build_object('ok', true, 'alerte', public._alerte_json(a));
end; $$;

-- ---------------------------------------------------------------------------
-- (B) Les changements faits par le RESPONSABLE préviennent aussi le créateur
--     quand ce n'est pas lui (cas d'un binôme responsable / ingénieur), en
--     plus de la notification déjà envoyée au laboratoire.
-- ---------------------------------------------------------------------------
create or replace function public.resp_update_alerte_coulage(
  p_token text, p_id uuid, p_alerte jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; a public.alertes_coulage; v_statut text;
        v_prevu timestamptz; v_qte numeric; v_date_changee boolean := false;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if not public._peut_planifier(p_token) then
    return json_build_object('ok', false, 'error', 'role');
  end if;

  select * into a from public.alertes_coulage where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;

  if r.is_admin then
    if not public._admin_can(p_token, a.labo_id) then
      return json_build_object('ok', false, 'error', 'autre_labo');
    end if;
  elsif r.labo_id is distinct from a.labo_id then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;

  if a.statut in ('annulee', 'terminee') then
    return json_build_object('ok', false, 'error', 'alerte_close');
  end if;

  v_statut := nullif(trim(coalesce(p_alerte->>'statut', '')), '');
  if v_statut is not null and v_statut not in
     ('a_prendre_en_charge', 'prise_en_charge', 'reportee', 'annulee', 'terminee') then
    return json_build_object('ok', false, 'error', 'statut');
  end if;

  v_prevu := (p_alerte->>'prevuAt')::timestamptz;
  if v_prevu is not null and v_prevu is distinct from a.prevu_at then
    v_date_changee := true;
  end if;

  v_qte := (p_alerte->>'quantiteM3')::numeric;
  if v_qte is not null and v_qte <= 0 then
    return json_build_object('ok', false, 'error', 'quantite');
  end if;

  update public.alertes_coulage set
    code_projet        = coalesce(p_alerte->>'codeProjet', code_projet),
    client_id          = coalesce(p_alerte->>'clientId', client_id),
    ouvrage_key        = coalesce(p_alerte->>'ouvrageKey', ouvrage_key),
    ouvrage_autre      = coalesce(p_alerte->>'ouvrageAutre', ouvrage_autre),
    bloc               = coalesce(p_alerte->>'bloc', bloc),
    etage              = coalesce(p_alerte->>'etage', etage),
    prevu_at           = coalesce(v_prevu, prevu_at),
    quantite_m3        = coalesce(v_qte, quantite_m3),
    moules_calcules    = case when v_qte is not null
                              then public._moules_pour(labo_id, v_qte)
                              else moules_calcules end,
    urgent             = coalesce((p_alerte->>'urgent')::boolean, urgent),
    demandeur_nom      = coalesce(p_alerte->>'demandeurNom', demandeur_nom),
    demandeur_fonction = coalesce(p_alerte->>'demandeurFonction', demandeur_fonction),
    observations       = coalesce(p_alerte->>'observations', observations),
    statut             = case
                           when v_statut is not null then v_statut
                           when v_date_changee and prise_par is null then 'reportee'
                           else statut end,
    alerte_envoyee_at  = case when v_date_changee then null else alerte_envoyee_at end,
    updated_at         = now()
  where id = p_id
  returning * into a;

  if v_date_changee or a.statut in ('reportee', 'annulee') then
    perform public._enqueue_notif(
      'labo:' || a.labo_id,
      case when a.statut = 'annulee' then 'Coulage annulé' else 'Coulage reporté' end,
      'Projet ' || a.code_projet || ' — ' ||
        case when a.statut = 'annulee' then 'annulé.'
             else 'reporté au ' || to_char(a.prevu_at, 'DD/MM à HH24:MI') || '.' end,
      '/#screen-alertes-coulage',
      'alerte-maj-' || a.id || '-' || to_char(now(), 'YYYYMMDDHH24MI'));

    -- Le créateur est prévenu séparément si ce n'est pas lui qui agit.
    if a.cree_par is distinct from r.id then
      perform public._notif_createur_alerte(a,
        case when a.statut = 'annulee' then 'Coulage annulé' else 'Coulage reporté' end,
        r.nom || ' a modifié le coulage ' || a.code_projet || '.');
    end if;
  end if;

  return json_build_object('ok', true, 'alerte', public._alerte_json(a));
end; $$;

-- ---------------------------------------------------------------------------
-- (C) La liste indique si l'alerte a été prise en charge par le demandeur
--     lui-même : l'interface n'offre alors les actions de clôture qu'à lui.
-- ---------------------------------------------------------------------------
create or replace function public.op_list_alertes_coulage(
  p_token text, p_labo uuid default null, p_historique boolean default false)
returns json language plpgsql stable security definer set search_path = public as $$
declare r public.operators; v_statuts text[];
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  v_statuts := case when coalesce(p_historique, false)
                    then array['annulee','terminee']
                    else array['a_prendre_en_charge','prise_en_charge','reportee'] end;

  if r.is_admin then
    return json_build_object('ok', true, 'alertes', coalesce((
      select json_agg((public._alerte_json(a)::jsonb
               || jsonb_build_object('prisParMoi', a.prise_par is not distinct from r.id))::json
             order by a.urgent desc, a.prevu_at)
      from public.alertes_coulage a
      where a.statut = any(v_statuts)
        and (r.admin_labos is null or cardinality(r.admin_labos) = 0
             or a.labo_id = any(r.admin_labos))
        and (p_labo is null or a.labo_id = p_labo)), '[]'::json));
  end if;

  if r.labo_id is null then
    return json_build_object('ok', true, 'alertes', '[]'::json);
  end if;
  return json_build_object('ok', true, 'alertes', coalesce((
    select json_agg((public._alerte_json(a)::jsonb
             || jsonb_build_object('prisParMoi', a.prise_par is not distinct from r.id))::json
           order by a.urgent desc, a.prevu_at)
    from public.alertes_coulage a
    where a.labo_id = r.labo_id and a.statut = any(v_statuts)), '[]'::json));
end; $$;

-- ---------------------------------------------------------------------------
-- DROITS D'EXÉCUTION
-- ---------------------------------------------------------------------------
revoke all on function public.op_statut_alerte_coulage(text,uuid,text,timestamptz) from public;
grant execute on function public.op_statut_alerte_coulage(text,uuid,text,timestamptz) to anon, authenticated;

-- FIN ------------------------------------------------------------------------

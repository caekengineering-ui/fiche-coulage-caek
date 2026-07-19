-- ============================================================================
-- Phase 5 : sécurisation métier ciblée
-- - correction de date avec replanification atomique des lots encore au bassin ;
-- - paramètres déchets / échantillonnage par laboratoire ;
-- - stock déchets et évacuations synchronisés et idempotents ;
-- - traçabilité des demandes de confirmation client.
-- Dépendances : schéma V3, lots_sync, phases 2 et 3 (audit_events/coulage_events).
-- ============================================================================

alter table public.labos add column if not exists dechets_poids_moyen numeric not null default 8;
alter table public.labos add column if not exists echant_premiere_tranche_m3 numeric not null default 50;
alter table public.labos add column if not exists echant_premiere_tranche_nb int not null default 9;
alter table public.labos add column if not exists echant_tranche_suivante_m3 numeric not null default 50;
alter table public.labos add column if not exists echant_tranche_suivante_nb int not null default 3;

alter table public.evacuations add column if not exists request_id text;
create unique index if not exists idx_evacuations_request
  on public.evacuations(request_id) where request_id is not null and request_id <> '';

-- La liste administrative transporte aussi les réglages utilisés hors ligne.
create or replace function public.admin_list_labos(p_token text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  return json_build_object('ok', true, 'labos', coalesce((
    select json_agg(json_build_object(
      'id', id, 'nom', nom, 'localisation', localisation,
      'seuilDechets', seuil_dechets, 'poidsMoyenDechets', dechets_poids_moyen,
      'echantPremiereTrancheM3', echant_premiere_tranche_m3,
      'echantPremiereTrancheNb', echant_premiere_tranche_nb,
      'echantTrancheSuivanteM3', echant_tranche_suivante_m3,
      'echantTrancheSuivanteNb', echant_tranche_suivante_nb,
      'actif', actif) order by nom)
    from public.labos), '[]'::json));
end; $$;

-- Même signature historique, mais renvoie désormais l'id créé afin que le
-- client puisse enregistrer les réglages dans la même séquence utilisateur.
create or replace function public.admin_upsert_labo(
  p_token text, p_id uuid, p_nom text, p_localisation text, p_seuil int, p_actif boolean)
returns json language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public._is_principal(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  if coalesce(trim(p_nom),'') = '' then return json_build_object('ok', false, 'error', 'nom'); end if;
  if p_id is null then
    if exists (select 1 from public.labos where lower(nom) = lower(trim(p_nom))) then
      return json_build_object('ok', false, 'error', 'nom_existe');
    end if;
    insert into public.labos(nom, localisation, seuil_dechets, actif)
      values (trim(p_nom), coalesce(p_localisation,''), coalesce(p_seuil, 100), coalesce(p_actif, true))
      returning id into v_id;
  else
    update public.labos set
      nom = trim(p_nom), localisation = coalesce(p_localisation,''),
      seuil_dechets = coalesce(p_seuil, seuil_dechets), actif = coalesce(p_actif, actif)
      where id = p_id returning id into v_id;
  end if;
  if v_id is null then return json_build_object('ok', false, 'error', 'labo_introuvable'); end if;
  return json_build_object('ok', true, 'id', v_id);
end; $$;

create or replace function public.op_get_labo_settings(p_token text, p_labo uuid default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare r public.operators; b public.labos; v_labo uuid;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if r.is_admin then
    v_labo := p_labo;
    if v_labo is null and r.labo_id is not null then v_labo := r.labo_id; end if;
    if v_labo is null and r.admin_labos is not null and cardinality(r.admin_labos) = 1 then
      v_labo := r.admin_labos[1];
    end if;
    if v_labo is null then return json_build_object('ok', false, 'error', 'labo_requis'); end if;
    if not public._admin_can(p_token, v_labo) then return json_build_object('ok', false, 'error', 'autre_labo'); end if;
  else
    v_labo := r.labo_id;
  end if;
  select * into b from public.labos where id = v_labo and actif = true;
  if not found then return json_build_object('ok', false, 'error', 'labo_introuvable'); end if;
  return json_build_object(
    'ok', true, 'laboId', b.id,
    'seuilDechets', b.seuil_dechets, 'poidsMoyenDechets', b.dechets_poids_moyen,
    'echantPremiereTrancheM3', b.echant_premiere_tranche_m3,
    'echantPremiereTrancheNb', b.echant_premiere_tranche_nb,
    'echantTrancheSuivanteM3', b.echant_tranche_suivante_m3,
    'echantTrancheSuivanteNb', b.echant_tranche_suivante_nb);
end; $$;

create or replace function public.admin_set_labo_settings(
  p_token text, p_labo uuid, p_settings jsonb, p_request_id text default null)
returns json language plpgsql security definer set search_path = public as $$
declare b public.labos; ancien jsonb; nouveau jsonb; r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if not public._admin_can(p_token, p_labo) then return json_build_object('ok', false, 'error', 'admin'); end if;
  select * into b from public.labos where id = p_labo for update;
  if not found then return json_build_object('ok', false, 'error', 'labo_introuvable'); end if;
  if coalesce((p_settings->>'seuilDechets')::numeric, b.seuil_dechets) <= 0
     or coalesce((p_settings->>'poidsMoyenDechets')::numeric, b.dechets_poids_moyen) <= 0
     or coalesce((p_settings->>'echantPremiereTrancheM3')::numeric, b.echant_premiere_tranche_m3) <= 0
     or coalesce((p_settings->>'echantPremiereTrancheNb')::int, b.echant_premiere_tranche_nb) <= 0
     or coalesce((p_settings->>'echantTrancheSuivanteM3')::numeric, b.echant_tranche_suivante_m3) <= 0
     or coalesce((p_settings->>'echantTrancheSuivanteNb')::int, b.echant_tranche_suivante_nb) <= 0 then
    return json_build_object('ok', false, 'error', 'parametres');
  end if;
  ancien := jsonb_build_object(
    'seuilDechets', b.seuil_dechets, 'poidsMoyenDechets', b.dechets_poids_moyen,
    'echantPremiereTrancheM3', b.echant_premiere_tranche_m3,
    'echantPremiereTrancheNb', b.echant_premiere_tranche_nb,
    'echantTrancheSuivanteM3', b.echant_tranche_suivante_m3,
    'echantTrancheSuivanteNb', b.echant_tranche_suivante_nb);
  update public.labos set
    seuil_dechets = coalesce((p_settings->>'seuilDechets')::int, seuil_dechets),
    dechets_poids_moyen = coalesce((p_settings->>'poidsMoyenDechets')::numeric, dechets_poids_moyen),
    echant_premiere_tranche_m3 = coalesce((p_settings->>'echantPremiereTrancheM3')::numeric, echant_premiere_tranche_m3),
    echant_premiere_tranche_nb = coalesce((p_settings->>'echantPremiereTrancheNb')::int, echant_premiere_tranche_nb),
    echant_tranche_suivante_m3 = coalesce((p_settings->>'echantTrancheSuivanteM3')::numeric, echant_tranche_suivante_m3),
    echant_tranche_suivante_nb = coalesce((p_settings->>'echantTrancheSuivanteNb')::int, echant_tranche_suivante_nb)
    where id = p_labo;
  select jsonb_build_object(
    'seuilDechets', seuil_dechets, 'poidsMoyenDechets', dechets_poids_moyen,
    'echantPremiereTrancheM3', echant_premiere_tranche_m3,
    'echantPremiereTrancheNb', echant_premiere_tranche_nb,
    'echantTrancheSuivanteM3', echant_tranche_suivante_m3,
    'echantTrancheSuivanteNb', echant_tranche_suivante_nb)
    into nouveau from public.labos where id = p_labo;
  insert into public.audit_events(entity, entity_id, action, ancien, nouveau, auteur, role, request_id)
    values ('labo', p_labo::text, 'parametres_metier', ancien, nouveau, r.nom, public._op_role(r), nullif(p_request_id,''))
    on conflict do nothing;
  return json_build_object('ok', true, 'settings', nouveau);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return json_build_object('ok', false, 'error', 'parametres');
end; $$;

create or replace function public.op_get_dechets_state(p_token text, p_labo uuid default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare r public.operators; b public.labos; v_labo uuid; brut int; evac int;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if r.is_admin then
    v_labo := p_labo;
    if v_labo is null and r.labo_id is not null then v_labo := r.labo_id; end if;
    if v_labo is null and r.admin_labos is not null and cardinality(r.admin_labos) = 1 then v_labo := r.admin_labos[1]; end if;
    if v_labo is null then return json_build_object('ok', false, 'error', 'labo_requis'); end if;
    if not public._admin_can(p_token, v_labo) then return json_build_object('ok', false, 'error', 'autre_labo'); end if;
  else
    v_labo := r.labo_id;
  end if;
  select * into b from public.labos where id = v_labo;
  if not found then return json_build_object('ok', false, 'error', 'labo_introuvable'); end if;
  select coalesce(sum(nombre),0)::int into brut from public.lots
    where labo_id = v_labo and statut in ('teste','valide');
  select coalesce(sum(nombre),0)::int into evac from public.evacuations where labo_id = v_labo;
  return json_build_object('ok', true, 'laboId', v_labo,
    'stockBrut', brut, 'evacue', evac, 'stock', greatest(0, brut - evac),
    'seuilDechets', b.seuil_dechets, 'poidsMoyenDechets', b.dechets_poids_moyen);
end; $$;

create or replace function public.op_add_evacuation_v2(
  p_token text, p_labo uuid, p_nombre int, p_note text, p_request_id text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; v_labo uuid; brut int; evac int; stock int;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if coalesce(p_nombre,0) <= 0 or coalesce(nullif(p_request_id,''),'') = '' then
    return json_build_object('ok', false, 'error', 'parametres');
  end if;
  if r.is_admin then
    v_labo := p_labo;
    if v_labo is null and r.labo_id is not null then v_labo := r.labo_id; end if;
    if v_labo is null then return json_build_object('ok', false, 'error', 'labo_requis'); end if;
    if not public._admin_can(p_token, v_labo) then return json_build_object('ok', false, 'error', 'autre_labo'); end if;
  else
    v_labo := r.labo_id;
  end if;
  if v_labo is null then return json_build_object('ok', false, 'error', 'labo_requis'); end if;
  -- Le verrou du laboratoire sérialise le calcul du stock et rend le rejeu
  -- réellement idempotent, y compris lors de deux requêtes concurrentes.
  perform 1 from public.labos where id = v_labo for update;
  if not found then return json_build_object('ok', false, 'error', 'labo_introuvable'); end if;
  if exists (select 1 from public.evacuations where request_id = p_request_id) then
    return json_build_object('ok', true, 'rejoue', true);
  end if;
  select coalesce(sum(nombre),0)::int into brut from public.lots
    where labo_id = v_labo and statut in ('teste','valide');
  select coalesce(sum(nombre),0)::int into evac from public.evacuations where labo_id = v_labo;
  stock := greatest(0, brut - evac);
  if p_nombre > stock then
    return json_build_object('ok', false, 'error', 'stock_insuffisant', 'stock', stock);
  end if;
  insert into public.evacuations(labo_id, nombre, operateur, note, request_id)
    values (v_labo, p_nombre, r.nom, coalesce(p_note,''), p_request_id);
  return json_build_object('ok', true, 'stock', stock - p_nombre);
end; $$;

-- Compatibilité des anciens clients : ils passent désormais par les mêmes
-- contrôles de stock et le même verrou, sans créer une voie non sécurisée.
create or replace function public.op_add_evacuation(p_token text, p_nombre int, p_note text)
returns json language plpgsql security definer set search_path = public as $$
begin
  return public.op_add_evacuation_v2(
    p_token, null, p_nombre, p_note, gen_random_uuid()::text);
end; $$;

-- Validation + correction de date dans UNE transaction. Si un lot est déjà
-- engagé, la validation est refusée : aucun historique n'est réécrit en silence.
create or replace function public.admin_valider_coulage(p_token text, p_ref text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare ex public.coulages; r public.operators; pl jsonb; v text;
  ancienne_date date; nouvelle_date date; motif_date text; req text;
  n_lots int := 0; n_engages int := 0; force_engages boolean := false;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into ex from public.coulages where ref = p_ref for update;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if not public._admin_can(p_token, ex.labo_id) then return json_build_object('ok', false, 'error', 'admin'); end if;
  if ex.statut = 'valide' then return json_build_object('ok', false, 'error', 'deja_valide'); end if;
  ancienne_date := nullif(ex.payload->>'dateCoulage','')::date;
  nouvelle_date := nullif(coalesce(p_payload, ex.payload)->>'dateCoulage','')::date;
  motif_date := nullif(coalesce(p_payload->>'_dateCorrectionMotif',''),'');
  req := nullif(coalesce(p_payload->>'_dateCorrectionRequestId',''),'');
  force_engages := coalesce((p_payload->>'_forceDateLotsEngages')::boolean, false);
  pl := coalesce(p_payload, ex.payload, '{}'::jsonb) - '_dateCorrectionMotif' - '_dateCorrectionRequestId'
        - '_correctionAppareil' - '_forceDateLotsEngages';
  if nouvelle_date is distinct from ancienne_date then
    if nouvelle_date is null then return json_build_object('ok', false, 'error', 'date_invalide'); end if;
    if motif_date is null then return json_build_object('ok', false, 'error', 'motif_date_requis'); end if;
    if exists (select 1 from public.lots where coulage_ref = p_ref and statut <> 'en_bassin')
       and not force_engages then
      return json_build_object('ok', false, 'error', 'date_lots_engages');
    end if;
    update public.lots set
      date_coulage = nouvelle_date,
      date_echeance = nouvelle_date + age_jours,
      payload = jsonb_set(
        jsonb_set(coalesce(payload, '{}'::jsonb), '{dateCoulage}', to_jsonb(nouvelle_date::text), true),
        '{datePrevue}', to_jsonb((nouvelle_date + age_jours)::text), true),
      updated_at = now()
      where coulage_ref = p_ref and statut = 'en_bassin';
    get diagnostics n_lots = row_count;
    -- Les lots déjà engagés gardent leur échéance historique. Leur date de
    -- coulage corrigée est toutefois portée explicitement, avec un drapeau qui
    -- impose la relecture des âges/résultats par l'ingénieur.
    update public.lots set
      date_coulage = nouvelle_date,
      payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{dateCoulage}', to_jsonb(nouvelle_date::text), true)
        || jsonb_build_object(
          'dateCoulageOriginale', coalesce(payload->>'dateCoulageOriginale', payload->>'dateCoulage', ancienne_date::text),
          'datePrevueOriginale', coalesce(payload->>'datePrevueOriginale', payload->>'datePrevue', date_echeance::text),
          'dateCorrectionApresEngagement', true,
          'revisionAgeRequise', true),
      updated_at = now()
      where coulage_ref = p_ref and statut <> 'en_bassin';
    get diagnostics n_engages = row_count;
    insert into public.audit_events(entity, entity_id, action, ancien, nouveau,
                                    auteur, role, motif, appareil, request_id)
      values ('coulage', p_ref, 'correction_date_coulage',
              jsonb_build_object('dateCoulage', ancienne_date),
              jsonb_build_object('dateCoulage', nouvelle_date, 'lotsReplanifies', n_lots,
                                 'lotsEngagesSignales', n_engages),
              r.nom, public._op_role(r), motif_date,
              coalesce(p_payload->>'_correctionAppareil',''), req)
      on conflict do nothing;
  end if;
  v := to_char(now(), 'DD/MM/YYYY');
  pl := pl || jsonb_build_object('statut','valide', 'validePar', r.nom, 'dateValidation', v);
  update public.coulages set
    statut = 'valide', payload = pl,
    code_projet = coalesce(pl->>'codeProjet', code_projet),
    valide_par = r.nom, valide_at = now(), retour_admin = '', updated_at = now()
    where ref = p_ref;
  return json_build_object('ok', true, 'valide_par', r.nom,
    'date_validation', v, 'lots_replanifies', n_lots, 'lots_engages_signales', n_engages);
exception
  when invalid_datetime_format or datetime_field_overflow then
    return json_build_object('ok', false, 'error', 'date_invalide');
end; $$;

-- Étend le journal d'événements existant aux échanges de confirmation client.
create or replace function public.op_coulage_event(p_token text, p_event jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; c public.coulages; v_key text; v_type text; v_ref text; v_req text; eff jsonb; v_status text;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  v_key := nullif(p_event->>'eventKey',''); v_ref := nullif(p_event->>'ref','');
  v_type := nullif(p_event->>'type',''); v_req := nullif(p_event->>'requestId','');
  if v_key is null or v_ref is null or v_type not in
    ('recuperation','bassin_reparti','client_confirmation_partagee','client_confirmation_statut') then
    return json_build_object('ok', false, 'error', 'parametres');
  end if;
  if exists (select 1 from public.coulage_events where event_key = v_key
      or (v_req is not null and request_id = v_req)) then
    return json_build_object('ok', true, 'rejoue', true);
  end if;
  select * into c from public.coulages where ref = v_ref for update;
  if not found then return json_build_object('ok', false, 'error', 'coulage_introuvable'); end if;
  if not ((r.is_admin is true and (r.admin_labos is null or cardinality(r.admin_labos) = 0
          or c.labo_id = any(r.admin_labos)))
       or (r.is_admin is not true and r.labo_id is not null and c.labo_id = r.labo_id)) then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;
  if v_type = 'client_confirmation_statut' then
    v_status := p_event->'payload'->>'statut';
    if v_status not in ('confirme','correction_demandee') then
      return json_build_object('ok', false, 'error', 'statut');
    end if;
  end if;
  insert into public.coulage_events(event_key, coulage_ref, type, payload,
                                    auteur, role, appareil, request_id)
    values (v_key, v_ref, v_type, coalesce(p_event->'payload','{}'::jsonb),
            r.nom, public._op_role(r), coalesce(p_event->>'appareil',''), coalesce(v_req,''));
  if v_type = 'recuperation' then
    eff := jsonb_build_object('eprRecuperees', true, 'codificationConfirmee', true,
      'dateRecuperation', coalesce(p_event->'payload'->>'date', to_char(now(),'YYYY-MM-DD')),
      'operateurRecuperation', coalesce(p_event->'payload'->>'operateur', r.nom));
  elsif v_type = 'bassin_reparti' then
    eff := jsonb_build_object('bassinReparti', true,
      'dateRepartition', coalesce(p_event->'payload'->>'date', to_char(now(),'YYYY-MM-DD')));
  elsif v_type = 'client_confirmation_partagee' then
    eff := jsonb_build_object('clientConfirmation', coalesce(c.payload->'clientConfirmation','{}'::jsonb)
      || jsonb_build_object('statut','partagee', 'canal', p_event->'payload'->>'canal',
           'partageePar', r.nom, 'partageeAt', now(), 'snapshot', p_event->'payload'->'snapshot'));
  else
    eff := jsonb_build_object('clientConfirmation', coalesce(c.payload->'clientConfirmation','{}'::jsonb)
      || jsonb_build_object('statut', v_status, 'statutPar', r.nom, 'statutAt', now(),
           'note', coalesce(p_event->'payload'->>'note','')));
  end if;
  update public.coulages set payload = coalesce(payload, '{}'::jsonb) || eff, updated_at = now() where ref = v_ref;
  return json_build_object('ok', true);
end; $$;

revoke all on function public.op_get_labo_settings(text,uuid) from public;
revoke all on function public.admin_set_labo_settings(text,uuid,jsonb,text) from public;
revoke all on function public.op_get_dechets_state(text,uuid) from public;
revoke all on function public.op_add_evacuation_v2(text,uuid,int,text,text) from public;
grant execute on function public.op_get_labo_settings(text,uuid) to anon, authenticated;
grant execute on function public.admin_set_labo_settings(text,uuid,jsonb,text) to anon, authenticated;
grant execute on function public.op_get_dechets_state(text,uuid) to anon, authenticated;
grant execute on function public.op_add_evacuation_v2(text,uuid,int,text,text) to anon, authenticated;

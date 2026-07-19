-- ============================================================================
--  Migration 20260717150000 — Phase 3 : prélèvements, bassin, résultats.
--
--   1. Identité UUID des PRÉLÈVEMENTS (E1, E2…) et des ÉPROUVETTES ;
--      allocation ATOMIQUE du numéro E par coulage (op_alloc_prels) et
--      dérivation serveur des codes lisibles REF-Ei-NN.
--   2. Événements serveur IDEMPOTENTS pour la récupération des éprouvettes
--      et la répartition au bassin (op_coulage_event) — ces informations
--      étaient jusqu'ici purement locales (LOCAL_FIELDS jamais poussés).
--   3. Révision PAR ÉPROUVETTE (op_reviser_eprouvette) : corriger,
--      recalculer, signaler une incohérence, note interne, retourner,
--      valider (ingénieur), approuver (responsable).
--   4. audit_events : chaque changement tracé avec ancien, nouveau, auteur,
--      rôle, date, motif, appareil et request_id.
--
--  Dépendances : Phase 2 (_op_role), supabase_lots_sync.sql (lot_key).
--  Idempotente, additive, réversible (…_rollback.sql).
--  ⚠ NE PAS APPLIQUER EN PRODUCTION sans validation pilote.
-- ============================================================================

-- ------------------------------------------------ 1. prélèvements / éprouvettes
create table if not exists public.prelevements (
  uuid        uuid primary key,
  coulage_ref text not null references public.coulages(ref) on delete cascade,
  e_num       int  not null,
  malaxeur    int,
  type        text default 'cube',
  nombre      int  default 0,
  created_at  timestamptz default now(),
  unique (coulage_ref, e_num)
);
alter table public.prelevements enable row level security;

create table if not exists public.eprouvettes (
  uuid       uuid primary key,
  prel_uuid  uuid not null references public.prelevements(uuid) on delete cascade,
  num        int  not null,
  code       text,
  created_at timestamptz default now(),
  unique (prel_uuid, num)
);
alter table public.eprouvettes enable row level security;
create index if not exists idx_eprouvettes_code on public.eprouvettes(code);

-- Allocation ATOMIQUE des numéros E d'un coulage.
-- p_prels = [{uuid, malaxeur, type, nombre, eprUuids:[uuid,…]}, …]
-- Idempotent : un prélèvement déjà connu (uuid) garde son numéro E.
-- Verrou : la ligne coulage est verrouillée (FOR UPDATE) -> deux appareils
-- concurrents obtiennent des numéros E distincts, sans trou ni doublon.
create or replace function public.op_alloc_prels(p_token text, p_ref text, p_prels jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  r public.operators; c public.coulages; item jsonb; v_uuid uuid; v_e int;
  next_e int; out_arr jsonb := '[]'::jsonb; codes jsonb; i int; ep uuid; v_code text;
  v_prel_ref text; v_ep_prel uuid;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into c from public.coulages where ref = p_ref for update;
  if not found then return json_build_object('ok', false, 'error', 'coulage_introuvable'); end if;
  if not (
       (r.is_admin is true and (r.admin_labos is null or cardinality(r.admin_labos) = 0
                                or c.labo_id = any(r.admin_labos)))
    or (r.is_admin is not true and r.labo_id is not null and c.labo_id = r.labo_id)
  ) then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;

  -- A6 : pré-validation anti-réutilisation. AVANT toute écriture, on refuse
  -- qu'un UUID de prélèvement ou d'éprouvette déjà rattaché à un AUTRE
  -- coulage / prélèvement soit silencieusement réaffecté. Aucune donnée n'est
  -- mutée tant qu'une collision existe (réponse JSON explicite, pas de commit
  -- partiel).
  for item in select * from jsonb_array_elements(coalesce(p_prels, '[]'::jsonb)) loop
    v_uuid := nullif(item->>'uuid','')::uuid;
    if v_uuid is null then continue; end if;
    select coulage_ref into v_prel_ref from public.prelevements where uuid = v_uuid;
    if found and v_prel_ref is distinct from p_ref then
      return json_build_object('ok', false, 'error', 'uuid_prelevement_reutilise',
                               'uuid', v_uuid, 'coulage', v_prel_ref);
    end if;
    for ep in select nullif(value #>> '{}','')::uuid
              from jsonb_array_elements(coalesce(item->'eprUuids','[]'::jsonb)) loop
      if ep is null then continue; end if;
      select prel_uuid into v_ep_prel from public.eprouvettes where uuid = ep;
      if found and v_ep_prel is distinct from v_uuid then
        return json_build_object('ok', false, 'error', 'uuid_eprouvette_reutilise',
                                 'uuid', ep, 'prelevement', v_ep_prel);
      end if;
    end loop;
  end loop;

  select coalesce(max(e_num), 0) + 1 into next_e
    from public.prelevements where coulage_ref = p_ref;
  for item in select * from jsonb_array_elements(coalesce(p_prels, '[]'::jsonb)) loop
    v_uuid := nullif(item->>'uuid','')::uuid;
    if v_uuid is null then continue; end if;
    select e_num into v_e from public.prelevements where uuid = v_uuid;
    if not found then
      insert into public.prelevements(uuid, coulage_ref, e_num, malaxeur, type, nombre)
        values (v_uuid, p_ref, next_e,
                nullif(item->>'malaxeur','')::int,
                coalesce(item->>'type','cube'),
                coalesce((item->>'nombre')::int, 0));
      v_e := next_e;
      next_e := next_e + 1;
    end if;
    -- Éprouvettes : codes lisibles DÉRIVÉS de la référence + numéro E.
    -- Le conflit (uuid) ne met à jour QUE si l'éprouvette appartient au même
    -- prélèvement (la pré-validation ci-dessus a déjà écarté toute
    -- réaffectation) : jamais de changement silencieux de prel_uuid.
    codes := '[]'::jsonb;
    i := 0;
    for ep in select nullif(value #>> '{}','')::uuid
              from jsonb_array_elements(coalesce(item->'eprUuids','[]'::jsonb)) loop
      i := i + 1;
      if ep is null then continue; end if;
      v_code := p_ref || '-E' || v_e || '-' || lpad(i::text, 2, '0');
      insert into public.eprouvettes(uuid, prel_uuid, num, code)
        values (ep, v_uuid, i, v_code)
      on conflict (uuid) do update set code = excluded.code
        where public.eprouvettes.prel_uuid = v_uuid;
      codes := codes || jsonb_build_object('uuid', ep, 'num', i, 'code', v_code);
    end loop;
    out_arr := out_arr || jsonb_build_object('uuid', v_uuid, 'e', v_e, 'codes', codes);
  end loop;
  return json_build_object('ok', true, 'prels', out_arr);
end; $$;

-- ------------------------------------------------ 2. événements idempotents
create table if not exists public.coulage_events (
  id          uuid primary key default gen_random_uuid(),
  event_key   text unique not null,
  coulage_ref text not null references public.coulages(ref) on delete cascade,
  type        text not null,          -- recuperation | bassin_reparti
  payload     jsonb default '{}'::jsonb,
  auteur      text default '',
  role        text default '',
  appareil    text default '',
  request_id  text default '',
  created_at  timestamptz default now()
);
alter table public.coulage_events enable row level security;
create index if not exists idx_coulage_events_ref on public.coulage_events(coulage_ref, type);
-- A4 : idempotence par requestId (identité d'occurrence stable entre retries),
-- pas par la clé trop générale ref:type — sinon une 2ᵉ récupération / une
-- re-répartition légitime serait silencieusement rejetée.
create unique index if not exists idx_coulage_events_request
  on public.coulage_events(request_id) where request_id is not null and request_id <> '';

-- p_event = { eventKey, ref, type, payload, appareil, requestId }
--   eventKey  = ref:type:requestId  (UNIQUE par occurrence, plus par ref:type) ;
--   requestId = UUID d'occurrence, réutilisé tel quel entre deux tentatives.
-- Idempotent sur le REJEU d'une même occurrence (eventKey OU requestId déjà
-- vus) ; DEUX occurrences distinctes (requestId différents) du même
-- ref:type sont acceptées — récupérations/répartitions multiples possibles.
create or replace function public.op_coulage_event(p_token text, p_event jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; c public.coulages; v_key text; v_type text; v_ref text; v_req text; eff jsonb;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  v_key := nullif(p_event->>'eventKey','');
  v_ref := nullif(p_event->>'ref','');
  v_type := nullif(p_event->>'type','');
  v_req := nullif(p_event->>'requestId','');
  if v_key is null or v_ref is null
     or v_type not in ('recuperation','bassin_reparti') then
    return json_build_object('ok', false, 'error', 'parametres');
  end if;
  if exists (select 1 from public.coulage_events
             where event_key = v_key
                or (v_req is not null and request_id = v_req)) then
    return json_build_object('ok', true, 'rejoue', true);
  end if;
  select * into c from public.coulages where ref = v_ref for update;
  if not found then return json_build_object('ok', false, 'error', 'coulage_introuvable'); end if;
  if not (
       (r.is_admin is true and (r.admin_labos is null or cardinality(r.admin_labos) = 0
                                or c.labo_id = any(r.admin_labos)))
    or (r.is_admin is not true and r.labo_id is not null and c.labo_id = r.labo_id)
  ) then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;
  insert into public.coulage_events(event_key, coulage_ref, type, payload,
                                    auteur, role, appareil, request_id)
    values (v_key, v_ref, v_type, coalesce(p_event->'payload','{}'::jsonb),
            r.nom, public._op_role(r),
            coalesce(p_event->>'appareil',''), coalesce(p_event->>'requestId',''));
  -- Effet serveur : le coulage porte désormais ces informations (elles
  -- n'étaient jusque-là que locales à l'appareil).
  if v_type = 'recuperation' then
    eff := jsonb_build_object(
      'eprRecuperees', true, 'codificationConfirmee', true,
      'dateRecuperation', coalesce(p_event->'payload'->>'date', to_char(now(),'YYYY-MM-DD')),
      'operateurRecuperation', coalesce(p_event->'payload'->>'operateur', r.nom));
  else
    eff := jsonb_build_object(
      'bassinReparti', true,
      'dateRepartition', coalesce(p_event->'payload'->>'date', to_char(now(),'YYYY-MM-DD')));
  end if;
  update public.coulages set payload = payload || eff, updated_at = now() where ref = v_ref;
  return json_build_object('ok', true);
end; $$;

-- ------------------------------------------------ 3/4. révision + audit
create table if not exists public.audit_events (
  id         uuid primary key default gen_random_uuid(),
  entity     text not null,             -- 'eprouvette' | 'lot' | 'coulage'
  entity_id  text not null,             -- code éprouvette / lot_key / ref
  action     text not null,
  ancien     jsonb,
  nouveau    jsonb,
  auteur     text default '',
  role       text default '',
  motif      text default '',
  appareil   text default '',
  request_id text,
  created_at timestamptz default now()
);
alter table public.audit_events enable row level security;
create index if not exists idx_audit_entity on public.audit_events(entity, entity_id);
create unique index if not exists idx_audit_request on public.audit_events(request_id)
  where request_id is not null and request_id <> '';

-- Révision par éprouvette.
-- p_rev = { requestId, lotKey, code, action, valeurs:{masse,force,dim1,dim2,rc},
--           motif, note, appareil }
-- Actions et rôles minimaux :
--   corriger / recalculer / signaler_incoherence / note_interne : tout
--     opérateur du labo (l'ingénieur+ aussi) tant que le lot n'est pas approuvé ;
--   retourner / valider_ingenieur : engineer, responsable, principal_admin ;
--   approuver_responsable        : responsable, principal_admin.
create or replace function public.op_reviser_eprouvette(p_token text, p_rev jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  r public.operators; l public.lots; v_role text; v_action text; v_code text;
  v_req text; arr jsonb; entry jsonb; new_entry jsonb; idx int := -1; i int;
  vals jsonb; surf numeric; forme text; d1 numeric; d2 numeric; f numeric; rc numeric;
  v_submitted boolean; v_returned boolean; v_all_appr boolean; v_all_ing boolean; e2 jsonb;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  v_role := public._op_role(r);
  v_action := nullif(p_rev->>'action','');
  v_code := nullif(p_rev->>'code','');
  v_req := nullif(p_rev->>'requestId','');
  if v_action is null or v_code is null then
    return json_build_object('ok', false, 'error', 'parametres');
  end if;
  -- Idempotence par requestId.
  if v_req is not null and exists (select 1 from public.audit_events where request_id = v_req) then
    return json_build_object('ok', true, 'rejoue', true);
  end if;
  if v_action in ('retourner','valider_ingenieur')
     and v_role not in ('engineer','responsable','principal_admin') then
    return json_build_object('ok', false, 'error', 'role');
  end if;
  if v_action = 'approuver_responsable'
     and v_role not in ('responsable','principal_admin') then
    return json_build_object('ok', false, 'error', 'role');
  end if;
  select * into l from public.lots where lot_key = nullif(p_rev->>'lotKey','') for update;
  if not found then return json_build_object('ok', false, 'error', 'lot_introuvable'); end if;
  if not public._lot_scope_ok(r, l) then return json_build_object('ok', false, 'error', 'autre_labo'); end if;

  arr := coalesce(l.resultats, l.payload->'essais', '[]'::jsonb);
  i := 0;
  for entry in select * from jsonb_array_elements(arr) loop
    if entry->>'code' = v_code then idx := i; exit; end if;
    i := i + 1;
  end loop;
  if idx < 0 then return json_build_object('ok', false, 'error', 'eprouvette_introuvable'); end if;
  entry := arr->idx;
  new_entry := entry;
  vals := coalesce(p_rev->'valeurs', '{}'::jsonb);

  -- ---- Verrous d'état (A1/A2/A3), évalués APRÈS localisation de l'éprouvette.
  -- Un essai est « soumis » dès que le lot dépasse le stade opérateur
  -- (statut teste ou valide). Un essai « retourné » a un retour EXPLICITE
  -- adressé à l'opérateur (revision.etat = 'retournee', non encore consommé).
  v_submitted := l.statut in ('teste','valide');
  v_returned  := coalesce(entry->'revision'->>'etat','') = 'retournee';

  -- A1 : approbation responsable = verrou RÉEL, au niveau du lot (toutes les
  -- éprouvettes approuvées) ET au niveau de l'éprouvette concernée. Immuable
  -- sauf note interne.
  if v_action not in ('note_interne') and (
       coalesce(l.payload->>'approuveResponsable','') <> ''
    or (entry ? 'approuveeResponsable')
  ) then
    return json_build_object('ok', false, 'error', 'approuve_verrouille');
  end if;

  -- A2/A3 : après soumission, corrections/recalculs/incohérences/notes de
  -- révision appartiennent à l'ingénieur+. L'opérateur ne peut RÉINTERVENIR
  -- que si un retour explicite lui a été adressé, et seulement pour corriger
  -- ou recalculer l'essai retourné.
  if v_role = 'operator' and v_submitted then
    if v_action in ('corriger','recalculer') then
      if not v_returned then
        return json_build_object('ok', false, 'error', 'retour_requis');
      end if;
    else
      return json_build_object('ok', false, 'error', 'reserve_ingenieur');
    end if;
  end if;

  if v_action = 'corriger' then
    new_entry := new_entry || vals;
  end if;
  if v_action in ('corriger','recalculer') then
    forme := coalesce(new_entry->>'forme','cube');
    d1 := coalesce(nullif(new_entry->>'dim1','')::numeric, nullif(new_entry->>'d1','')::numeric, 0);
    d2 := coalesce(nullif(new_entry->>'dim2','')::numeric, nullif(new_entry->>'d2','')::numeric, 0);
    f  := coalesce(nullif(new_entry->>'force','')::numeric, 0);
    if forme = 'cylindre' then surf := pi() * (d1/2) * (d1/2); else surf := d1 * d2; end if;
    if f > 0 and surf > 0 then
      rc := round((f * 1000 / surf)::numeric, 2);
      new_entry := new_entry || jsonb_build_object('rc', rc);
    end if;
  end if;
  -- Transition « corrigé » : un essai RETOURNÉ que l'opérateur (ou un
  -- ingénieur+) corrige/recalcule voit son retour CONSOMMÉ (etat 'corrigee'),
  -- de sorte que l'opérateur ne puisse plus réintervenir librement ensuite.
  if v_action in ('corriger','recalculer') and v_returned then
    new_entry := new_entry || jsonb_build_object('revision',
      coalesce(new_entry->'revision','{}'::jsonb) || jsonb_build_object(
        'etat', 'corrigee', 'corrigeePar', r.nom, 'corrigeeLe', to_char(now(),'YYYY-MM-DD')));
  end if;
  if v_action = 'signaler_incoherence' then
    new_entry := new_entry || jsonb_build_object('incoherence',
      coalesce(nullif(p_rev->>'motif',''), 'incohérence signalée'));
  end if;
  if v_action = 'note_interne' then
    new_entry := new_entry || jsonb_build_object('noteInterne', coalesce(p_rev->>'note',''));
  end if;
  if v_action = 'retourner' then
    new_entry := new_entry || jsonb_build_object('revision', jsonb_build_object(
      'etat', 'retournee', 'par', r.nom, 'motif', coalesce(p_rev->>'motif',''),
      'date', to_char(now(),'YYYY-MM-DD')));
  end if;
  if v_action = 'valider_ingenieur' then
    new_entry := new_entry || jsonb_build_object('valideeIngenieur', jsonb_build_object(
      'par', r.nom, 'date', to_char(now(),'YYYY-MM-DD')));
  end if;
  if v_action = 'approuver_responsable' then
    new_entry := new_entry || jsonb_build_object('approuveeResponsable', jsonb_build_object(
      'par', r.nom, 'date', to_char(now(),'YYYY-MM-DD')));
  end if;

  arr := jsonb_set(arr, array[idx::text], new_entry);

  -- A1 : propagation au NIVEAU LOT. Une approbation/validation ne verrouille
  -- réellement les résultats que lorsque TOUTES les éprouvettes du lot sont
  -- concernées. `approuveResponsable` au niveau lot est la clé lue par le
  -- verrou ci-dessus ET par la génération d'un PV définitif (Phase 4).
  v_all_appr := jsonb_array_length(arr) > 0;
  v_all_ing  := jsonb_array_length(arr) > 0;
  for e2 in select * from jsonb_array_elements(arr) loop
    if not (e2 ? 'approuveeResponsable') then v_all_appr := false; end if;
    if not (e2 ? 'valideeIngenieur') and not (e2 ? 'approuveeResponsable') then v_all_ing := false; end if;
  end loop;

  update public.lots set
    resultats = arr,
    payload = coalesce(payload,'{}'::jsonb)
              || jsonb_build_object('essais', arr)
              || case when v_all_ing
                   then jsonb_build_object('valideIngenieur', true,
                          'valideIngenieurLe', to_char(now(),'YYYY-MM-DD'))
                   else '{}'::jsonb end
              || case when v_all_appr
                   then jsonb_build_object('approuveResponsable', true,
                          'approuveResponsablePar', r.nom,
                          'approuveResponsableLe', to_char(now(),'YYYY-MM-DD'))
                   else '{}'::jsonb end,
    updated_at = now()
    where lot_key = l.lot_key;

  insert into public.audit_events(entity, entity_id, action, ancien, nouveau,
                                  auteur, role, motif, appareil, request_id)
    values ('eprouvette', v_code, v_action, entry, new_entry,
            r.nom, v_role, coalesce(p_rev->>'motif',''),
            coalesce(p_rev->>'appareil',''), v_req);
  return json_build_object('ok', true, 'essai', new_entry);
end; $$;

-- Historique d'audit d'une entité (ingénieur et plus).
create or replace function public.op_list_audit(p_token text, p_entity text, p_id text)
returns setof public.audit_events language plpgsql stable security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  if public._op_role(r) = 'operator' then return; end if;
  return query select * from public.audit_events
    where entity = p_entity and entity_id = p_id
    order by created_at desc limit 200;
end; $$;

grant execute on function
  public.op_alloc_prels(text,text,jsonb),
  public.op_coulage_event(text,jsonb),
  public.op_reviser_eprouvette(text,jsonb),
  public.op_list_audit(text,text,text)
to anon, authenticated;

-- FIN ------------------------------------------------------------------------

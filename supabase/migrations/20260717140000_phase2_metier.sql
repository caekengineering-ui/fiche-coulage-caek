-- ============================================================================
--  Migration 20260717140000 — Phase 2 : évolutions métier.
--
--   1. Table centrales (fournisseurs de béton) + RPC liste/upsert.
--   2. coulages : centrale, formulation_id, designation_terrain,
--      designation_officielle (colonnes additives, dual-write depuis payload).
--   3. operators.role : operator | engineer | responsable | principal_admin
--      (dual-read : dérivé de is_admin/admin_labos si NULL — aucun compte
--      existant ne change de droits).
--
--  Idempotente, additive, réversible (…_rollback.sql).
--  ⚠ NE PAS APPLIQUER EN PRODUCTION sans validation pilote.
-- ============================================================================

-- ------------------------------------------------ 1. centrales
create table if not exists public.centrales (
  id           uuid primary key default gen_random_uuid(),
  nom          text unique not null,
  localisation text default '',
  actif        boolean default true,
  created_at   timestamptz default now()
);
alter table public.centrales enable row level security;

-- Amorçage depuis les fournisseurs déjà présents dans le catalogue des
-- formulations (aucune saisie perdue).
insert into public.centrales(nom)
  select distinct fournisseur from public.formulations
  where coalesce(trim(fournisseur),'') <> ''
on conflict (nom) do nothing;

create or replace function public.op_list_centrales(p_token text)
returns setof public.centrales language plpgsql stable security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  return query select * from public.centrales where actif = true order by nom;
end; $$;

create or replace function public.admin_upsert_centrale(
  p_token text, p_id uuid, p_nom text, p_localisation text, p_actif boolean)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  if coalesce(trim(p_nom),'') = '' then return json_build_object('ok', false, 'error', 'nom'); end if;
  if p_id is null then
    insert into public.centrales(nom, localisation, actif)
      values (trim(p_nom), coalesce(p_localisation,''), coalesce(p_actif, true))
    on conflict (nom) do update set
      localisation = excluded.localisation, actif = excluded.actif;
  else
    update public.centrales set nom = trim(p_nom),
      localisation = coalesce(p_localisation, localisation),
      actif = coalesce(p_actif, actif)
      where id = p_id;
  end if;
  return json_build_object('ok', true);
end; $$;

-- ------------------------------------------------ 2. colonnes coulage
alter table public.coulages add column if not exists centrale text;
alter table public.coulages add column if not exists formulation_id uuid references public.formulations(id);
alter table public.coulages add column if not exists designation_terrain text;
alter table public.coulages add column if not exists designation_officielle text;

-- Dual-write serveur : recopie des champs payload vers les colonnes lors de
-- toute écriture (trigger léger, ne modifie jamais le payload lui-même).
create or replace function public._coulage_columns_from_payload()
returns trigger language plpgsql as $$
begin
  new.centrale := coalesce(nullif(new.payload->>'centrale',''), new.centrale);
  new.formulation_id := coalesce(nullif(new.payload->>'formulationId','')::uuid, new.formulation_id);
  new.designation_terrain := coalesce(
    nullif(new.payload->>'designationTerrain',''),
    nullif(new.payload->>'ouvrageCoule',''),
    new.designation_terrain);
  new.designation_officielle := coalesce(
    nullif(new.payload->>'designationOfficielle',''), new.designation_officielle);
  return new;
end; $$;

drop trigger if exists trg_coulage_columns on public.coulages;
create trigger trg_coulage_columns
  before insert or update of payload on public.coulages
  for each row execute function public._coulage_columns_from_payload();

-- ------------------------------------------------ 3. rôles
alter table public.operators add column if not exists role text;

-- Rôle effectif (dual-read) : colonne si renseignée, sinon dérivation depuis
-- les indicateurs historiques. Valeurs : operator | engineer | responsable |
-- principal_admin.
create or replace function public._op_role(r public.operators)
returns text language sql immutable as $$
  select case
    when r.role in ('operator','engineer','responsable','principal_admin') then r.role
    when r.is_admin is true and (r.admin_labos is null or cardinality(r.admin_labos) = 0)
      then 'principal_admin'
    when r.is_admin is true then 'responsable'
    else 'operator'
  end;
$$;

-- op_login / op_verify renvoient désormais aussi 'role' (clé JSON additive,
-- ignorée par les anciens clients).
create or replace function public.op_login(p_identifiant text, p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; t text;
begin
  select * into r from public.operators where lower(identifiant) = lower(p_identifiant);
  if not found then return json_build_object('ok', false, 'error', 'identifiant'); end if;
  if r.actif is not true then return json_build_object('ok', false, 'error', 'inactif'); end if;
  if r.pin_hash <> public._pin_hash(p_identifiant, p_pin) then
    return json_build_object('ok', false, 'error', 'pin');
  end if;
  t := coalesce(r.token, gen_random_uuid()::text);
  update public.operators set token = t, token_at = now() where id = r.id;
  return json_build_object('ok', true, 'token', t, 'nom', r.nom,
    'identifiant', r.identifiant, 'fonction', r.fonction, 'is_admin', r.is_admin,
    'labo_id', r.labo_id, 'admin_labos', r.admin_labos,
    'role', public._op_role(r),
    'labo_nom', (select nom from public.labos where id = r.labo_id));
end; $$;

create or replace function public.op_verify(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false); end if;
  return json_build_object('ok', true, 'nom', r.nom,
    'identifiant', r.identifiant, 'is_admin', r.is_admin,
    'labo_id', r.labo_id, 'admin_labos', r.admin_labos,
    'role', public._op_role(r),
    'labo_nom', (select nom from public.labos where id = r.labo_id));
end; $$;

-- admin_upsert_operator : + p_role (défaut null = comportement historique).
-- L'ancienne signature est supprimée pour éviter l'ambiguïté PostgREST ;
-- les anciens clients appellent la nouvelle avec p_role par défaut.
drop function if exists public.admin_upsert_operator(text, uuid, text, text, text, text, boolean, boolean, uuid, uuid[]);
create or replace function public.admin_upsert_operator(
  p_token text, p_id uuid, p_identifiant text, p_pin text,
  p_nom text, p_fonction text, p_is_admin boolean, p_actif boolean, p_labo uuid,
  p_admin_labos uuid[] default null, p_role text default null)
returns json language plpgsql security definer set search_path = public as $$
declare existing public.operators; v_admin_labos uuid[]; v_role text;
begin
  if not public._is_principal(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  if coalesce(p_is_admin, false) is not true and p_labo is null then
    return json_build_object('ok', false, 'error', 'labo_requis');
  end if;
  if p_role is not null and p_role not in ('operator','engineer','responsable','principal_admin') then
    return json_build_object('ok', false, 'error', 'role');
  end if;
  v_admin_labos := case when coalesce(p_is_admin, false) then p_admin_labos else null end;
  v_role := p_role;
  if p_id is null then
    if exists (select 1 from public.operators where lower(identifiant) = lower(p_identifiant)) then
      return json_build_object('ok', false, 'error', 'identifiant_existe');
    end if;
    if coalesce(p_pin,'') = '' then return json_build_object('ok', false, 'error', 'pin_requis'); end if;
    insert into public.operators(identifiant, pin_hash, nom, fonction, is_admin, labo_id, admin_labos, actif, role)
      values (p_identifiant, public._pin_hash(p_identifiant, p_pin),
              p_nom, coalesce(p_fonction,''), coalesce(p_is_admin,false), p_labo,
              v_admin_labos, coalesce(p_actif,true), v_role);
  else
    select * into existing from public.operators where id = p_id;
    if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
    update public.operators set
      identifiant = p_identifiant, nom = p_nom, fonction = coalesce(p_fonction,''),
      is_admin = coalesce(p_is_admin, existing.is_admin), labo_id = p_labo,
      admin_labos = v_admin_labos,
      actif = coalesce(p_actif, existing.actif),
      role = coalesce(v_role, existing.role),
      pin_hash = case when coalesce(p_pin,'') <> '' then public._pin_hash(p_identifiant, p_pin)
                      else existing.pin_hash end
      where id = p_id;
  end if;
  return json_build_object('ok', true);
end; $$;

-- admin_list_operators : + role dans la réponse (clé additive).
create or replace function public.admin_list_operators(p_token text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_principal(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  return json_build_object('ok', true, 'operators', coalesce((
    select json_agg(json_build_object('id', o.id, 'identifiant', o.identifiant, 'nom', o.nom,
             'fonction', o.fonction, 'is_admin', o.is_admin, 'actif', o.actif,
             'labo_id', o.labo_id, 'labo_nom', b.nom,
             'admin_labos', o.admin_labos,
             'role', public._op_role(o),
             'admin_labos_noms', coalesce((
                select json_agg(x.nom order by x.nom)
                from public.labos x where x.id = any(o.admin_labos)), '[]'::json)) order by o.nom)
    from public.operators o left join public.labos b on b.id = o.labo_id), '[]'::json));
end; $$;

-- ------------------------------------------------ droits d'exécution
grant execute on function
  public.op_list_centrales(text),
  public.admin_upsert_centrale(text,uuid,text,text,boolean),
  public.admin_upsert_operator(text,uuid,text,text,text,text,boolean,boolean,uuid,uuid[],text)
to anon, authenticated;

-- FIN ------------------------------------------------------------------------

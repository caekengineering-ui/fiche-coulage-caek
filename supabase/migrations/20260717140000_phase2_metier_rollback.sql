-- ============================================================================
--  ROLLBACK de 20260717140000_phase2_metier.sql
--  ⚠ Restaure admin_upsert_operator / op_login / op_verify /
--    admin_list_operators dans leur version historique (schéma V3).
--  ⚠ Les colonnes supprimées perdent leurs données (payload intact).
-- ============================================================================

drop trigger if exists trg_coulage_columns on public.coulages;
drop function if exists public._coulage_columns_from_payload();

drop function if exists public.op_list_centrales(text);
drop function if exists public.admin_upsert_centrale(text,uuid,text,text,boolean);
drop table if exists public.centrales;

alter table public.coulages drop column if exists designation_officielle;
alter table public.coulages drop column if exists designation_terrain;
alter table public.coulages drop column if exists formulation_id;
alter table public.coulages drop column if exists centrale;

drop function if exists public.admin_upsert_operator(text,uuid,text,text,text,text,boolean,boolean,uuid,uuid[],text);
drop function if exists public._op_role(public.operators);
alter table public.operators drop column if exists role;

-- Recréation des versions HISTORIQUES (extraites de supabase_schema.sql) :
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
    'labo_nom', (select nom from public.labos where id = r.labo_id));
end; $$;

create or replace function public.admin_upsert_operator(
  p_token text, p_id uuid, p_identifiant text, p_pin text,
  p_nom text, p_fonction text, p_is_admin boolean, p_actif boolean, p_labo uuid,
  p_admin_labos uuid[] default null)
returns json language plpgsql security definer set search_path = public as $$
declare existing public.operators; v_admin_labos uuid[];
begin
  if not public._is_principal(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  if coalesce(p_is_admin, false) is not true and p_labo is null then
    return json_build_object('ok', false, 'error', 'labo_requis');
  end if;
  v_admin_labos := case when coalesce(p_is_admin, false) then p_admin_labos else null end;
  if p_id is null then
    if exists (select 1 from public.operators where lower(identifiant) = lower(p_identifiant)) then
      return json_build_object('ok', false, 'error', 'identifiant_existe');
    end if;
    if coalesce(p_pin,'') = '' then return json_build_object('ok', false, 'error', 'pin_requis'); end if;
    insert into public.operators(identifiant, pin_hash, nom, fonction, is_admin, labo_id, admin_labos, actif)
      values (p_identifiant, public._pin_hash(p_identifiant, p_pin),
              p_nom, coalesce(p_fonction,''), coalesce(p_is_admin,false), p_labo,
              v_admin_labos, coalesce(p_actif,true));
  else
    select * into existing from public.operators where id = p_id;
    if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
    update public.operators set
      identifiant = p_identifiant, nom = p_nom, fonction = coalesce(p_fonction,''),
      is_admin = coalesce(p_is_admin, existing.is_admin), labo_id = p_labo,
      admin_labos = v_admin_labos,
      actif = coalesce(p_actif, existing.actif),
      pin_hash = case when coalesce(p_pin,'') <> '' then public._pin_hash(p_identifiant, p_pin)
                      else existing.pin_hash end
      where id = p_id;
  end if;
  return json_build_object('ok', true);
end; $$;

create or replace function public.admin_list_operators(p_token text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_principal(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  return json_build_object('ok', true, 'operators', coalesce((
    select json_agg(json_build_object('id', o.id, 'identifiant', o.identifiant, 'nom', o.nom,
             'fonction', o.fonction, 'is_admin', o.is_admin, 'actif', o.actif,
             'labo_id', o.labo_id, 'labo_nom', b.nom,
             'admin_labos', o.admin_labos,
             'admin_labos_noms', coalesce((
                select json_agg(x.nom order by x.nom)
                from public.labos x where x.id = any(o.admin_labos)), '[]'::json)) order by o.nom)
    from public.operators o left join public.labos b on b.id = o.labo_id), '[]'::json));
end; $$;

grant execute on function
  public.op_login(text,text),
  public.op_verify(text),
  public.admin_upsert_operator(text,uuid,text,text,text,text,boolean,boolean,uuid,uuid[]),
  public.admin_list_operators(text)
to anon, authenticated;

-- FIN ------------------------------------------------------------------------

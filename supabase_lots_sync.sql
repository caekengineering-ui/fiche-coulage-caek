-- ============================================================================
--  CAEK — Module Béton (V3) : migration LOTS (bassin & écrasement en ligne)
--  À COLLER dans Supabase (projet module-beton-caek) :
--  SQL Editor -> New query -> Run.
--
--  Synchronise les lots d'éprouvettes du bassin avec le serveur :
--  - lot_key  : clé de synchronisation générée par l'app (unique) ;
--  - payload  : objet lot complet de l'app (source de vérité du merge) ;
--  - statuts  : en_bassin -> sorti -> teste (opérateur) -> valide (ADMIN,
--    validation des résultats d'écrasement, immuable ensuite).
--  Le scope par laboratoire vient du coulage parent.
-- ============================================================================

alter table public.lots add column if not exists lot_key text unique;
alter table public.lots add column if not exists payload jsonb;

-- Upsert générique d'un lot par sa clé. Refusé si les résultats du lot ont
-- déjà été validés par un admin (statut 'valide' = verrouillé).
create or replace function public.op_upsert_lot(p_token text, p_key text, p_lot jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; c public.coulages; ex public.lots; v_ref text;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if coalesce(p_key,'') = '' then return json_build_object('ok', false, 'error', 'cle'); end if;
  v_ref := p_lot->>'ref';
  select * into c from public.coulages where ref = v_ref;
  if not found then return json_build_object('ok', false, 'error', 'coulage_introuvable'); end if;
  if r.is_admin is not true and (r.labo_id is null or c.labo_id <> r.labo_id) then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;
  select * into ex from public.lots where lot_key = p_key;
  if found and ex.statut = 'valide' then
    return json_build_object('ok', false, 'error', 'verrouille');
  end if;
  insert into public.lots(lot_key, coulage_ref, labo_id, prel, type, age_jours, nombre,
                          codes, date_coulage, date_echeance, statut, resultats,
                          ecrase_par, payload, updated_at)
    values (p_key, v_ref, c.labo_id,
            coalesce((p_lot->>'prel')::int, 1),
            coalesce(p_lot->>'type', 'cube'),
            coalesce((p_lot->>'ageJours')::int, 28),
            coalesce((p_lot->>'nombre')::int, 0),
            coalesce(p_lot->'codes', '[]'::jsonb),
            nullif(p_lot->>'dateCoulage','')::date,
            nullif(p_lot->>'datePrevue','')::date,
            coalesce(p_lot->>'statut', 'en_bassin'),
            p_lot->'essais',
            coalesce(p_lot->>'operateurEssai',''),
            p_lot, now())
  on conflict (lot_key) do update set
    coulage_ref = excluded.coulage_ref, labo_id = excluded.labo_id,
    prel = excluded.prel, type = excluded.type, age_jours = excluded.age_jours,
    nombre = excluded.nombre, codes = excluded.codes,
    date_coulage = excluded.date_coulage, date_echeance = excluded.date_echeance,
    statut = excluded.statut, resultats = excluded.resultats,
    ecrase_par = excluded.ecrase_par, payload = excluded.payload, updated_at = now();
  return json_build_object('ok', true);
end; $$;

-- Suppression d'un lot par sa clé (ex. répartition refaite avant sortie).
create or replace function public.op_delete_lot(p_token text, p_key text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; ex public.lots;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into ex from public.lots where lot_key = p_key;
  if not found then return json_build_object('ok', true); end if;
  if ex.statut = 'valide' then return json_build_object('ok', false, 'error', 'verrouille'); end if;
  if r.is_admin is not true and (r.labo_id is null or ex.labo_id <> r.labo_id) then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;
  delete from public.lots where lot_key = p_key;
  return json_build_object('ok', true);
end; $$;

-- Validation des RÉSULTATS D'ÉCRASEMENT par un ADMIN (teste -> valide).
create or replace function public.admin_valider_resultats_key(p_token text, p_key text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; l public.lots; v text;
begin
  r := public._op_by_token(p_token);
  if r.id is null or r.is_admin is not true then
    return json_build_object('ok', false, 'error', 'admin');
  end if;
  select * into l from public.lots where lot_key = p_key;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if l.statut = 'valide' then return json_build_object('ok', false, 'error', 'deja_valide'); end if;
  if l.statut <> 'teste' then return json_build_object('ok', false, 'error', 'statut'); end if;
  v := to_char(now(), 'DD/MM/YYYY');
  update public.lots set
    statut = 'valide',
    resultats_valides_par = r.nom, resultats_valides_at = now(),
    payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
      'resultatsValides', true, 'resultatsValidesPar', r.nom, 'resultatsValidesLe', v),
    updated_at = now()
    where lot_key = p_key;
  return json_build_object('ok', true, 'valide_par', r.nom, 'date', v);
end; $$;

grant execute on function
  public.op_upsert_lot(text,text,jsonb),
  public.op_delete_lot(text,text),
  public.admin_valider_resultats_key(text,text)
to anon, authenticated;

-- FIN ------------------------------------------------------------------------

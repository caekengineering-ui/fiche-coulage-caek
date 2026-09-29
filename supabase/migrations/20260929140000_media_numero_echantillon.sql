-- Liaison traçable entre une photo d'éprouvette et son code métier.
-- Migration additive : aucune donnée existante n'est modifiée ou supprimée.

alter table public.media_assets
  add column if not exists numero_echantillon text default '';

comment on column public.media_assets.numero_echantillon is
  'Code individuel de l éprouvette, par exemple REF-E1-02';

create or replace function public.media_register(p_token text, p_media jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  r public.operators;
  c public.coulages;
  v_uuid uuid;
  v_ref text;
  v_numero text;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  v_uuid := nullif(p_media->>'uuid','')::uuid;
  v_ref := nullif(p_media->>'coulageRef','');
  v_numero := trim(coalesce(p_media->>'numeroEchantillon',
                            p_media->>'numero_echantillon', ''));
  if v_uuid is null or v_ref is null then
    return json_build_object('ok', false, 'error', 'parametres');
  end if;
  if length(v_numero) > 120 then
    return json_build_object('ok', false, 'error', 'numero_echantillon_invalide');
  end if;
  select * into c from public.coulages where ref = v_ref;
  if not found then
    return json_build_object('ok', false, 'error', 'coulage_introuvable');
  end if;
  if not (
       (r.is_admin is true and (r.admin_labos is null or cardinality(r.admin_labos) = 0
                                or c.labo_id = any(r.admin_labos)))
    or (r.is_admin is not true and r.labo_id is not null and c.labo_id = r.labo_id)
  ) then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;
  insert into public.media_assets(
    uuid, coulage_ref, storage_path, mime, taille, sha256,
    numero_echantillon, upload_state)
  values (
    v_uuid, v_ref, coalesce(p_media->>'storagePath',''),
    coalesce(p_media->>'mime',''), nullif(p_media->>'taille','')::bigint,
    nullif(p_media->>'sha256',''), v_numero, 'uploaded')
  on conflict (uuid) do update set
    storage_path = excluded.storage_path,
    mime = excluded.mime,
    taille = coalesce(excluded.taille, public.media_assets.taille),
    sha256 = coalesce(excluded.sha256, public.media_assets.sha256),
    numero_echantillon = coalesce(nullif(excluded.numero_echantillon, ''),
                                  public.media_assets.numero_echantillon);
  return json_build_object('ok', true);
end; $$;

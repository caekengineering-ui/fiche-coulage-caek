-- ============================================================================
--  Migration 20260717160000 — Phase 4 : bureau, documents et médias.
--
--   B1. document_corrections : SOURCE DE VÉRITÉ SERVEUR des corrections
--       bureau (jusqu'ici purement locales dans corrections/<REF>.json).
--       Identité UUID, coulage, entité, version de base, avant/après, auteur,
--       rôle, motif, request_id idempotent, statut. RPC charger / enregistrer
--       (détection de conflit de version) / historique / appliquer / annuler.
--   B2. document_get_ready_bundle : bundle documentaire COHÉRENT (une seule
--       lecture, version estampillée) pour éviter un assemblage à partir de
--       versions différentes ; état de disponibilité PROVISOIRE / DÉFINITIF.
--   B3. media_assets + media_archive_receipts : archivage SÉCURISÉ. Aucune
--       suppression Storage tant qu'un accusé bureau vérifié (hash + manifeste)
--       n'existe pas. Fermeture progressive de la policy Storage `select anon`
--       (accès signé via Edge Function, cf. supabase/functions/media-access).
--
--  Idempotente, additive, réversible (…_rollback.sql). Aucun DROP destructif.
--  ⚠ NE PAS APPLIQUER EN PRODUCTION sans validation pilote.
--  Dépendances : Phase 1 (coulages.version), Phase 2 (_op_role), Phase 3.
-- ============================================================================

-- ================================================== B1. corrections bureau
create table if not exists public.document_corrections (
  id           uuid primary key default gen_random_uuid(),
  coulage_ref  text not null references public.coulages(ref) on delete cascade,
  entity       text not null,             -- coulage | lot | projet | client | eprouvette
  entity_id    text not null default '',  -- ref / lot_key / code_projet / client_id / code
  base_version int  not null default 1,   -- version du coulage sur laquelle la correction s'appuie
  valeur_avant jsonb,
  valeur_apres jsonb,
  auteur       text default '',
  role         text default '',
  motif        text default '',
  request_id   text,                       -- idempotence (unique si non vide)
  statut       text not null default 'active',  -- active | appliquee | annulee
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
alter table public.document_corrections enable row level security;
create index if not exists idx_doc_corr_ref on public.document_corrections(coulage_ref, statut);
create index if not exists idx_doc_corr_entity on public.document_corrections(coulage_ref, entity, entity_id);
create unique index if not exists idx_doc_corr_request
  on public.document_corrections(request_id) where request_id is not null and request_id <> '';

-- Enregistre une correction bureau. DÉTECTION DE CONFLIT : si la correction
-- s'appuie sur une version du coulage antérieure à la version serveur, elle
-- est refusée (le bureau doit rebaser sur la version courante). Idempotent
-- par request_id. Réservé au bureau (service_role) : le rôle/auteur sont
-- portés par le payload (le responsable EST le bureau).
create or replace function public.bureau_save_correction(p_corr jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare c public.coulages; v_ref text; v_base int; v_req text; v_id uuid;
begin
  v_ref := nullif(p_corr->>'coulageRef','');
  if v_ref is null then return json_build_object('ok', false, 'error', 'parametres'); end if;
  select * into c from public.coulages where ref = v_ref for update;
  if not found then return json_build_object('ok', false, 'error', 'coulage_introuvable'); end if;

  v_req := nullif(p_corr->>'requestId','');
  if v_req is not null then
    select id into v_id from public.document_corrections where request_id = v_req;
    if found then
      return json_build_object('ok', true, 'rejoue', true, 'id', v_id,
                               'server_version', c.version);
    end if;
  end if;

  v_base := coalesce((p_corr->>'baseVersion')::int, c.version);
  if v_base < c.version then
    -- Conflit : la correction est basée sur une version périmée.
    return json_build_object('ok', false, 'error', 'conflit_version',
                             'server_version', c.version, 'base_version', v_base);
  end if;

  insert into public.document_corrections(
      coulage_ref, entity, entity_id, base_version,
      valeur_avant, valeur_apres, auteur, role, motif, request_id, statut)
    values (v_ref,
            coalesce(p_corr->>'entity','coulage'),
            coalesce(p_corr->>'entityId',''),
            v_base,
            p_corr->'avant', p_corr->'apres',
            coalesce(p_corr->>'auteur',''), coalesce(p_corr->>'role',''),
            coalesce(p_corr->>'motif',''), v_req, 'active')
    returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'server_version', c.version);
end; $$;

-- Corrections ACTIVES d'un coulage.
create or replace function public.bureau_load_corrections(p_ref text)
returns setof public.document_corrections language sql stable security definer
set search_path = public as $$
  select * from public.document_corrections
   where coulage_ref = p_ref and statut = 'active'
   order by created_at asc;
$$;

-- Historique complet (avant/après, tous statuts) d'une entité corrigée.
create or replace function public.bureau_correction_history(p_ref text, p_entity text, p_id text)
returns setof public.document_corrections language sql stable security definer
set search_path = public as $$
  select * from public.document_corrections
   where coulage_ref = p_ref
     and (p_entity is null or entity = p_entity)
     and (p_id is null or entity_id = p_id)
   order by created_at desc;
$$;

-- Applique / annule une correction (audité par changement de statut).
create or replace function public.bureau_set_correction_statut(p_id uuid, p_statut text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if p_statut not in ('active','appliquee','annulee') then
    return json_build_object('ok', false, 'error', 'statut');
  end if;
  update public.document_corrections
     set statut = p_statut, updated_at = now()
   where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  return json_build_object('ok', true);
end; $$;

-- ================================================== B2. bundle documentaire
-- Bundle COHÉRENT : une seule lecture, version du coulage estampillée, pour
-- que le bureau n'assemble jamais un document définitif à partir de données
-- de versions différentes. Inclut l'état de disponibilité documentaire.
--   provisoire : toujours possible (fiche non complètement approuvée) ;
--   definitif  : exige désignation officielle + coulage validé + AU MOINS un
--                lot dont TOUTES les éprouvettes sont approuvées responsable.
create or replace function public.document_get_ready_bundle(p_ref text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  c public.coulages; pr public.projets; cl public.clients;
  v_lots jsonb; v_medias jsonb; v_corr jsonb; v_desig text;
  v_has_appr boolean; v_coulage_valide boolean; v_reasons text[] := '{}';
  v_definitif_ok boolean;
begin
  select * into c from public.coulages where ref = p_ref;
  if not found then return json_build_object('ok', false, 'error', 'coulage_introuvable'); end if;
  select * into pr from public.projets where code_projet = c.code_projet;
  select * into cl from public.clients where client_id = coalesce(pr.client_id,'');

  select coalesce(jsonb_agg(to_jsonb(l) order by l.age_jours), '[]'::jsonb)
    into v_lots from public.lots l where l.coulage_ref = p_ref;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb)
    into v_medias from public.media_assets m where m.coulage_ref = p_ref;
  select coalesce(jsonb_agg(to_jsonb(dc) order by dc.created_at), '[]'::jsonb)
    into v_corr from public.document_corrections dc
    where dc.coulage_ref = p_ref and dc.statut = 'active';

  v_desig := coalesce(nullif(c.designation_officielle,''),
                      nullif(c.payload->>'designationOfficielle',''));
  v_coulage_valide := (c.statut = 'valide');
  -- Au moins un lot approuvé responsable (clé lot posée par Phase 3 A1).
  select exists(
    select 1 from public.lots l
     where l.coulage_ref = p_ref
       and coalesce(l.payload->>'approuveResponsable','') = 'true'
  ) into v_has_appr;

  if v_desig is null then v_reasons := v_reasons || 'designation_officielle_absente'; end if;
  if not v_coulage_valide then v_reasons := v_reasons || 'coulage_non_valide'; end if;
  if not v_has_appr then v_reasons := v_reasons || 'aucun_lot_approuve_responsable'; end if;
  v_definitif_ok := (cardinality(v_reasons) = 0);

  return json_build_object(
    'ok', true,
    'server_version', c.version,
    'coulage', to_jsonb(c),
    'projet', to_jsonb(pr),
    'client', to_jsonb(cl),
    'lots', v_lots,
    'medias', v_medias,
    'corrections', v_corr,
    'designation_officielle', v_desig,
    'etat_documentaire', case when v_definitif_ok then 'pret_definitif' else 'provisoire' end,
    'definitif_ok', v_definitif_ok,
    'definitif_bloque_par', to_jsonb(v_reasons));
end; $$;

-- ================================================== B3. médias
create table if not exists public.media_assets (
  uuid                     uuid primary key,
  coulage_ref              text not null references public.coulages(ref) on delete cascade,
  storage_path             text not null,
  mime                     text default '',
  taille                   bigint,
  sha256                   text,
  upload_state             text not null default 'uploaded', -- uploaded|archived|deletable|deleted|error
  archived_by              text default '',
  archived_at              timestamptz,
  local_archive_path       text default '',
  hash_verifie             boolean default false,
  verifie_at               timestamptz,
  suppression_autorisee_at timestamptz,     -- posée UNIQUEMENT après accusé vérifié
  suppression_effective_at timestamptz,
  erreur                   text default '',
  created_at               timestamptz default now(),
  unique (coulage_ref, storage_path)
);
alter table public.media_assets enable row level security;
create index if not exists idx_media_assets_ref on public.media_assets(coulage_ref, upload_state);

create table if not exists public.media_archive_receipts (
  id          uuid primary key default gen_random_uuid(),
  media_uuid  uuid not null references public.media_assets(uuid) on delete cascade,
  coulage_ref text not null,
  sha256      text not null,
  taille      bigint,
  manifeste   jsonb default '{}'::jsonb,
  auteur      text default '',
  request_id  text,
  created_at  timestamptz default now()
);
alter table public.media_archive_receipts enable row level security;
create unique index if not exists idx_media_receipt_request
  on public.media_archive_receipts(request_id) where request_id is not null and request_id <> '';

-- PWA : enregistre un média uploadé (scope labo vérifié par token).
create or replace function public.media_register(p_token text, p_media jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; c public.coulages; v_uuid uuid; v_ref text;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  v_uuid := nullif(p_media->>'uuid','')::uuid;
  v_ref  := nullif(p_media->>'coulageRef','');
  if v_uuid is null or v_ref is null then return json_build_object('ok', false, 'error', 'parametres'); end if;
  select * into c from public.coulages where ref = v_ref;
  if not found then return json_build_object('ok', false, 'error', 'coulage_introuvable'); end if;
  if not (
       (r.is_admin is true and (r.admin_labos is null or cardinality(r.admin_labos) = 0
                                or c.labo_id = any(r.admin_labos)))
    or (r.is_admin is not true and r.labo_id is not null and c.labo_id = r.labo_id)
  ) then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;
  insert into public.media_assets(uuid, coulage_ref, storage_path, mime, taille, sha256, upload_state)
    values (v_uuid, v_ref, coalesce(p_media->>'storagePath',''),
            coalesce(p_media->>'mime',''),
            nullif(p_media->>'taille','')::bigint,
            nullif(p_media->>'sha256',''), 'uploaded')
  on conflict (uuid) do update set
    storage_path = excluded.storage_path, mime = excluded.mime,
    taille = coalesce(excluded.taille, public.media_assets.taille),
    sha256 = coalesce(excluded.sha256, public.media_assets.sha256);
  return json_build_object('ok', true);
end; $$;

-- Liste des médias d'un coulage (scope labo vérifié).
create or replace function public.media_list(p_token text, p_ref text)
returns setof public.media_assets language plpgsql stable security definer
set search_path = public as $$
declare r public.operators; c public.coulages;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  select * into c from public.coulages where ref = p_ref;
  if not found then return; end if;
  if not (
       (r.is_admin is true and (r.admin_labos is null or cardinality(r.admin_labos) = 0
                                or c.labo_id = any(r.admin_labos)))
    or (r.is_admin is not true and r.labo_id is not null and c.labo_id = r.labo_id)
  ) then return; end if;
  return query select * from public.media_assets where coulage_ref = p_ref order by created_at;
end; $$;

-- Bureau (service_role) : ACCUSÉ D'ARCHIVAGE VÉRIFIÉ. Idempotent par request_id
-- (double accusé sans effet). Enregistre le hash + le manifeste, marque le
-- média archivé/hash vérifié et AUTORISE la suppression (suppression_autorisee_at).
-- C'est le SEUL chemin qui autorise une suppression ultérieure.
create or replace function public.media_archive_receipt(p_receipt jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare m public.media_assets; v_uuid uuid; v_req text; v_sha text; v_id uuid;
begin
  v_uuid := nullif(p_receipt->>'mediaUuid','')::uuid;
  v_sha  := nullif(p_receipt->>'sha256','');
  if v_uuid is null or v_sha is null then return json_build_object('ok', false, 'error', 'parametres'); end if;
  v_req := nullif(p_receipt->>'requestId','');
  if v_req is not null and exists (select 1 from public.media_archive_receipts where request_id = v_req) then
    return json_build_object('ok', true, 'rejoue', true);
  end if;
  select * into m from public.media_assets where uuid = v_uuid for update;
  if not found then return json_build_object('ok', false, 'error', 'media_introuvable'); end if;
  -- Cohérence hash : si le média porte déjà un sha256 connu, l'accusé doit
  -- correspondre (sinon corruption -> refus, le média reste en ligne).
  if coalesce(m.sha256,'') <> '' and m.sha256 <> v_sha then
    return json_build_object('ok', false, 'error', 'hash_incoherent',
                             'attendu', m.sha256, 'recu', v_sha);
  end if;
  insert into public.media_archive_receipts(media_uuid, coulage_ref, sha256, taille, manifeste, auteur, request_id)
    values (v_uuid, m.coulage_ref, v_sha, nullif(p_receipt->>'taille','')::bigint,
            coalesce(p_receipt->'manifeste','{}'::jsonb),
            coalesce(p_receipt->>'auteur',''), v_req)
    returning id into v_id;
  update public.media_assets set
    upload_state = 'archived', hash_verifie = true, verifie_at = now(),
    archived_by = coalesce(p_receipt->>'auteur',''), archived_at = now(),
    local_archive_path = coalesce(p_receipt->>'localArchivePath', local_archive_path),
    sha256 = v_sha,
    suppression_autorisee_at = now(), erreur = ''
    where uuid = v_uuid;
  return json_build_object('ok', true, 'receipt_id', v_id);
end; $$;

-- Bureau : marque un média SUPPRIMABLE. REFUSÉ tant qu'aucun accusé vérifié
-- n'existe (suppression_autorisee_at NULL) — garantit qu'aucune suppression
-- n'est possible sans archivage bureau confirmé.
create or replace function public.media_mark_deletable(p_uuid uuid)
returns json language plpgsql security definer set search_path = public as $$
declare m public.media_assets;
begin
  select * into m from public.media_assets where uuid = p_uuid for update;
  if not found then return json_build_object('ok', false, 'error', 'media_introuvable'); end if;
  if m.suppression_autorisee_at is null or m.hash_verifie is not true then
    return json_build_object('ok', false, 'error', 'accuse_requis');
  end if;
  update public.media_assets set upload_state = 'deletable' where uuid = p_uuid;
  return json_build_object('ok', true);
end; $$;

-- Bureau : consigne une erreur d'archivage (le média RESTE en ligne).
create or replace function public.media_signaler_erreur(p_uuid uuid, p_erreur text)
returns json language plpgsql security definer set search_path = public as $$
begin
  update public.media_assets set upload_state = 'error', erreur = coalesce(p_erreur,'')
    where uuid = p_uuid;
  if not found then return json_build_object('ok', false, 'error', 'media_introuvable'); end if;
  return json_build_object('ok', true);
end; $$;

-- ================================================== droits d'exécution
-- PWA (anon token, scope vérifié) : enregistrement / liste des médias.
grant execute on function
  public.media_register(text,jsonb),
  public.media_list(text,text)
to anon, authenticated;

-- Bureau (service_role UNIQUEMENT) : bundle, corrections, accusés. On RÉVOQUE
-- explicitement anon/authenticated pour que la clé publique ne puisse pas
-- lire le bundle complet ni écrire d'accusé.
revoke execute on function public.document_get_ready_bundle(text) from public, anon, authenticated;
revoke execute on function public.bureau_save_correction(jsonb) from public, anon, authenticated;
revoke execute on function public.bureau_load_corrections(text) from public, anon, authenticated;
revoke execute on function public.bureau_correction_history(text,text,text) from public, anon, authenticated;
revoke execute on function public.bureau_set_correction_statut(uuid,text) from public, anon, authenticated;
revoke execute on function public.media_archive_receipt(jsonb) from public, anon, authenticated;
revoke execute on function public.media_mark_deletable(uuid) from public, anon, authenticated;
revoke execute on function public.media_signaler_erreur(uuid,text) from public, anon, authenticated;
grant execute on function
  public.document_get_ready_bundle(text),
  public.bureau_save_correction(jsonb),
  public.bureau_load_corrections(text),
  public.bureau_correction_history(text,text,text),
  public.bureau_set_correction_statut(uuid,text),
  public.media_archive_receipt(jsonb),
  public.media_mark_deletable(uuid),
  public.media_signaler_erreur(uuid,text)
to service_role;

-- ================================================== Storage : fermeture anon
-- Phase 0 conservait `medias_select_app` (select anon+authenticated) le temps
-- de passer aux URLs signées. On FERME l'accès anon : la lecture n'est plus
-- ouverte à la clé publique. L'accès PWA passe désormais par l'Edge Function
-- `media-access` (jeton opérateur validé, laboratoire + droit coulage vérifiés,
-- service_role côté serveur uniquement, URL signée à durée limitée). Le bureau
-- garde son pont privilégié (service_role, qui contourne RLS) pendant la
-- transition. Réversible : le rollback restaure la policy anon d'origine.
drop policy if exists "medias_select_app" on storage.objects;
create policy "medias_select_app" on storage.objects
  for select to authenticated
  using (bucket_id = 'medias');
-- NB : `anon` n'est plus dans la liste des rôles -> plus de select anonyme.
-- service_role continue de contourner RLS (bureau + Edge Function).

-- FIN ------------------------------------------------------------------------

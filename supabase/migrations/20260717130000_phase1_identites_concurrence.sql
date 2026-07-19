-- ============================================================================
--  Migration 20260717130000 — Phase 1 : identités et concurrence.
--
--  Objectifs :
--   1. Identité PERMANENTE des coulages : colonne id uuid (serveur) +
--      client_uuid (généré par l'appareil, stable hors-ligne).
--   2. official_ref NULLABLE : la référence officielle <CODE>NNN devient une
--      donnée allouée par le serveur, plus une invention du client.
--   3. project_counters : allocation ATOMIQUE de la référence officielle dans
--      la MÊME transaction que la création/synchronisation (op_sync_coulage).
--   4. version + idempotency_key + journal sync_requests : rejouage idempotent,
--      conflits VISIBLES (fin du last-write-wins silencieux).
--
--  Compatibilité : les RPC historiques op_save_coulage / op_soumettre_coulage
--  restent inchangées (anciens clients PWA en cache). La PK de coulages reste
--  ref (texte) — dual-write : official_ref = ref pour toutes les lignes.
--
--  Idempotente (add column if not exists / create or replace) ; additive ;
--  réversible : 20260717130000_phase1_identites_concurrence_rollback.sql.
--  ⚠ NE PAS APPLIQUER EN PRODUCTION sans validation pilote.
-- ============================================================================

-- ------------------------------------------------ 1. colonnes additives
alter table public.coulages add column if not exists id uuid not null default gen_random_uuid();
alter table public.coulages add column if not exists client_uuid uuid;
alter table public.coulages add column if not exists official_ref text;
alter table public.coulages add column if not exists idempotency_key text;

create unique index if not exists idx_coulages_id on public.coulages(id);
create unique index if not exists idx_coulages_client_uuid on public.coulages(client_uuid)
  where client_uuid is not null;

-- Dual-write : toute ligne existante a sa référence officielle = ref.
update public.coulages set official_ref = ref where official_ref is null;

-- ------------------------------------------------ 2. compteurs par projet
create table if not exists public.project_counters (
  code_projet text primary key,
  last_n      int not null default 0,
  updated_at  timestamptz default now()
);
alter table public.project_counters enable row level security;

-- ------------------------------------------------ 3. journal d'idempotence
-- Une requête de synchronisation rejouée (réseau instable, retry outbox)
-- renvoie la MÊME réponse sans ré-exécuter l'écriture.
create table if not exists public.sync_requests (
  idempotency_key text primary key,
  ref             text,
  response        jsonb,
  created_at      timestamptz default now()
);
alter table public.sync_requests enable row level security;
create index if not exists idx_sync_requests_created on public.sync_requests(created_at);

-- ------------------------------------------------ 4. allocation atomique
-- Alloue la PROCHAINE référence officielle d'un code projet. Amorce le
-- compteur depuis les coulages existants (numérotation historique), puis
-- incrémente atomiquement (l'UPDATE sous conflit sérialise les concurrents).
-- Boucle de garde : saute les références déjà prises hors compteur.
create or replace function public._alloc_official_ref(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare pat text; n int; seed int; candidate text; guard int := 0;
begin
  pat := upper(coalesce(p_code, ''));
  if pat = '' then return null; end if;
  loop
    guard := guard + 1;
    if guard > 1000 then raise exception 'alloc_ref: boucle'; end if;
    select coalesce(max(num), 0) into seed from (
      select nullif(regexp_replace(substring(ref from char_length(pat) + 1), '[^0-9].*$', ''), '')::int as num
      from public.coulages where ref like pat || '%'
    ) t where num is not null;
    insert into public.project_counters(code_projet, last_n)
      values (pat, seed + 1)
    on conflict (code_projet) do update
      set last_n = greatest(public.project_counters.last_n, excluded.last_n - 1) + 1,
          updated_at = now()
    returning last_n into n;
    candidate := pat || lpad(n::text, 3, '0');
    exit when not exists (select 1 from public.coulages where ref = candidate);
  end loop;
  return candidate;
end; $$;

-- ------------------------------------------------ 5. synchronisation versionnée
-- Point d'entrée UNIQUE du nouveau client (dual-write avec l'existant).
-- p_op = {
--   clientUuid      : uuid généré par l'appareil (identité stable),
--   idempotencyKey  : clé unique de CETTE opération (rejouable),
--   action          : 'save' | 'soumettre',
--   baseVersion     : version serveur connue du client (0 si création),
--   ref             : référence connue du client (provisoire 'XXX-P…' ou officielle),
--   refProvisoire   : true si le client n'a PAS de référence officielle,
--   codeProjet      : code projet (allocation),
--   payload         : fiche complète (format historique inchangé)
-- }
-- Retours :
--   { ok:true, ref, version, statut }                    -> écrit
--   { ok:false, error:'conflit', server:{...} }          -> conflit VISIBLE
--   { ok:false, error:'verrouille'|'deja_valide'|... }   -> règles historiques
create or replace function public.op_sync_coulage(p_token text, p_op jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  r public.operators; ex public.coulages; v_labo uuid;
  v_key text; v_uuid uuid; v_ref text; v_action text; v_base int;
  v_payload jsonb; v_code text; v_new_version int; resp json; prev jsonb;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  v_key     := nullif(p_op->>'idempotencyKey','');
  v_uuid    := nullif(p_op->>'clientUuid','')::uuid;
  v_ref     := nullif(p_op->>'ref','');
  v_action  := coalesce(p_op->>'action','save');
  v_base    := coalesce((p_op->>'baseVersion')::int, 0);
  v_payload := coalesce(p_op->'payload', '{}'::jsonb);
  v_code    := upper(coalesce(nullif(p_op->>'codeProjet',''), v_payload->>'codeProjet', ''));

  if v_key is null or v_uuid is null then
    return json_build_object('ok', false, 'error', 'parametres');
  end if;

  -- Rejouage idempotent : même clé -> même réponse, aucune ré-écriture.
  select response into prev from public.sync_requests where idempotency_key = v_key;
  if found then return prev::json; end if;

  v_labo := coalesce(r.labo_id, nullif(v_payload->>'laboId','')::uuid);
  if v_labo is null then return json_build_object('ok', false, 'error', 'labo_requis'); end if;

  -- Localisation : identité client d'abord, référence ensuite (compat).
  select * into ex from public.coulages where client_uuid = v_uuid;
  if not found and v_ref is not null then
    select * into ex from public.coulages where ref = v_ref;
    -- Adoption : ligne historique jamais rattachée à un appareil.
    if found and ex.client_uuid is not null and ex.client_uuid <> v_uuid then
      resp := json_build_object('ok', false, 'error', 'ref_prise',
        'server', json_build_object('ref', ex.ref, 'version', ex.version));
      insert into public.sync_requests(idempotency_key, ref, response)
        values (v_key, v_ref, resp::jsonb) on conflict do nothing;
      return resp;
    end if;
  end if;

  if ex.ref is not null then
    -- ---------------- mise à jour d'une ligne existante
    if ex.labo_id <> v_labo and r.is_admin is not true then
      return json_build_object('ok', false, 'error', 'autre_labo');
    end if;
    if ex.statut = 'valide' then
      resp := json_build_object('ok', false, 'error', 'deja_valide');
      insert into public.sync_requests(idempotency_key, ref, response)
        values (v_key, ex.ref, resp::jsonb) on conflict do nothing;
      return resp;
    end if;
    if v_action = 'save' and ex.statut <> 'brouillon' then
      resp := json_build_object('ok', false, 'error', 'verrouille');
      insert into public.sync_requests(idempotency_key, ref, response)
        values (v_key, ex.ref, resp::jsonb) on conflict do nothing;
      return resp;
    end if;
    -- Conflit VISIBLE : le serveur a une version plus récente que la base
    -- du client -> aucune écriture, la fiche serveur est renvoyée.
    if v_base > 0 and ex.version > v_base then
      resp := json_build_object('ok', false, 'error', 'conflit',
        'server', json_build_object(
          'ref', ex.ref, 'version', ex.version, 'statut', ex.statut,
          'operateur', ex.operateur, 'updated_at', ex.updated_at,
          'payload', ex.payload));
      insert into public.sync_requests(idempotency_key, ref, response)
        values (v_key, ex.ref, resp::jsonb) on conflict do nothing;
      return resp;
    end if;
    v_new_version := coalesce(ex.version, 1) + 1;
    update public.coulages set
      client_uuid = coalesce(client_uuid, v_uuid),
      official_ref = coalesce(official_ref, ref),
      code_projet = coalesce(nullif(v_code,''), code_projet),
      statut = case when v_action = 'soumettre' then 'soumis' else ex.statut end,
      payload = v_payload || jsonb_build_object(
        'statut', case when v_action = 'soumettre' then 'soumis' else ex.statut end,
        'ref', ex.ref),
      operateur = r.nom,
      soumis_at = case when v_action = 'soumettre' then now() else soumis_at end,
      retour_admin = case when v_action = 'soumettre' then '' else retour_admin end,
      version = v_new_version,
      idempotency_key = v_key,
      updated_at = now()
      where ref = ex.ref;
    v_ref := ex.ref;
  else
    -- ---------------- création : allocation atomique de la référence
    -- officielle DANS CETTE transaction. Une référence provisoire n'est
    -- JAMAIS enregistrée comme référence serveur.
    if coalesce((p_op->>'refProvisoire')::boolean, false)
       or v_ref is null
       or exists (select 1 from public.coulages where ref = v_ref) then
      if v_code = '' then return json_build_object('ok', false, 'error', 'code'); end if;
      v_ref := public._alloc_official_ref(v_code);
    else
      -- Référence proposée par un client EN LIGNE (compat) : on la garde si
      -- libre, et on aligne le compteur pour préserver la monotonie.
      insert into public.project_counters(code_projet, last_n)
        values (v_code, coalesce(nullif(regexp_replace(substring(v_ref from char_length(v_code) + 1), '[^0-9].*$', ''), '')::int, 0))
      on conflict (code_projet) do update
        set last_n = greatest(public.project_counters.last_n, excluded.last_n), updated_at = now();
    end if;
    v_new_version := 1;
    insert into public.coulages(ref, official_ref, client_uuid, labo_id, code_projet,
                                statut, payload, operateur, soumis_at, retour_admin,
                                version, ref_base, idempotency_key, updated_at)
      values (v_ref, v_ref, v_uuid, v_labo, v_code,
              case when v_action = 'soumettre' then 'soumis' else 'brouillon' end,
              v_payload || jsonb_build_object(
                'statut', case when v_action = 'soumettre' then 'soumis' else 'brouillon' end,
                'ref', v_ref),
              r.nom,
              case when v_action = 'soumettre' then now() else null end,
              '', 1, v_ref, v_key, now());
  end if;

  resp := json_build_object('ok', true, 'ref', v_ref, 'version', v_new_version,
    'statut', case when v_action = 'soumettre' then 'soumis' else coalesce(ex.statut,'brouillon') end);
  insert into public.sync_requests(idempotency_key, ref, response)
    values (v_key, v_ref, resp::jsonb) on conflict do nothing;
  return resp;
end; $$;

grant execute on function public.op_sync_coulage(text, jsonb) to anon, authenticated;

-- Nettoyage périodique conseillé (cron) : delete from sync_requests
-- where created_at < now() - interval '30 days';

-- FIN ------------------------------------------------------------------------

-- ============================================================================
--  CAEK — Module Béton (V3)
--  Schéma Supabase : tables + fonctions RPC (sécurité par fonctions SECURITY DEFINER)
--
--  À COLLER tel quel dans Supabase :  SQL Editor  ->  New query  ->  Run.
--  La clé "anon" (publique, dans l'app) ne peut appeler QUE les fonctions op_* / admin_* ;
--  elle n'a aucun accès direct aux tables (RLS activé sans policy = tout refusé).
--  La clé "service_role" (secrète, côté bureau Python) contourne RLS pour lire les données.
--
--  Multi-labos : chaque opérateur est affecté à un labo (bassin + machine
--  d'écrasement). Il ne voit que les données de SON labo. Un admin voit tout
--  et peut filtrer par labo (paramètre p_labo des fonctions de liste).
--
--  Workflow coulage : brouillon (op) -> soumis (op) -> valide (admin).
--  Lots d'éprouvettes : en_bassin -> sorti -> teste (op) -> valide (admin).
--
--  Opérateur admin par défaut créé en bas :  identifiant = admin   PIN = 1234
--  >>> Changez ce PIN dès la première connexion (écran Admin de l'app). <<<
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ============================== TABLES ======================================

-- Laboratoires : un labo = un bassin de conservation + une machine d'écrasement
-- (ex. « Laboratoire central », « Annexe Béchar »).
create table if not exists public.labos (
  id             uuid primary key default gen_random_uuid(),
  nom            text unique not null,
  localisation   text default '',
  seuil_dechets  int  default 100,          -- nb d'éprouvettes écrasées avant alerte camion
  actif          boolean default true,
  created_at     timestamptz default now()
);

create table if not exists public.operators (
  id           uuid primary key default gen_random_uuid(),
  identifiant  text unique not null,
  pin_hash     text not null,
  nom          text not null,
  fonction     text default '',
  is_admin     boolean default false,
  labo_id      uuid references public.labos(id),   -- affectation (null autorisé pour un admin)
  actif        boolean default true,
  token        text,
  token_at     timestamptz,
  created_at   timestamptz default now()
);

-- Clients (feuille CLIENTS de client.xlsx du logiciel bureau).
create table if not exists public.clients (
  client_id    text primary key,
  nom          text not null,
  adresse      text default '',
  ville        text default '',
  contact_nom  text default '',
  contact_tel  text default '',
  email        text default '',
  notes        text default '',
  actif        boolean default true,
  updated_at   timestamptz default now()
);

-- Projets (feuille PROJETS de client.xlsx). ages_essai = âges d'écrasement
-- exigés par le client (défaut {7,28}) -> pré-remplit la répartition des lots.
create table if not exists public.projets (
  code_projet        text primary key,
  client_id          text default '',
  nom_projet         text default '',
  localisation       text default '',
  resistance_mpa     text default '',
  conversion_defaut  text default '',
  facteur_conversion text default '',
  reference_commande text default '',
  reference_dossier  text default '',
  ages_essai         int[] default '{7,28}',
  notes              text default '',
  actif              boolean default true,
  updated_at         timestamptz default now()
);

-- Formulations : catalogue GLOBAL (tous labos), groupé par fournisseur
-- (ex. « BTPH HASNAOUI » -> N°01, N°02...). Un opérateur PROPOSE, un admin
-- VALIDE : seules les formulations statut='validee' et actives sont
-- réutilisables comme modèles dans un coulage.
create table if not exists public.formulations (
  id          uuid primary key default gen_random_uuid(),
  fournisseur text not null,
  nom         text not null,                -- ex. « N°01 »
  payload     jsonb not null,               -- classe, ciment, dosage, dmax, adjuvant...
  statut      text not null default 'proposee',  -- proposee | validee
  actif       boolean default true,
  cree_par    text default '',
  validee_par text default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (fournisseur, nom)
);

-- Coulages. payload = fiche complète (malaxeurs, prélèvements, codification,
-- références des médias uploadés...). Les médias (photos/audio) vivent dans
-- Storage et sont SUPPRIMÉS par l'app admin après validation (quota gratuit).
create table if not exists public.coulages (
  ref            text primary key,          -- ex. ABA012
  labo_id        uuid not null references public.labos(id),
  code_projet    text default '',
  statut         text not null default 'brouillon',  -- brouillon | soumis | valide
  payload        jsonb not null,
  operateur      text default '',
  soumis_at      timestamptz,
  valide_par     text default '',
  valide_at      timestamptz,
  retour_admin   text default '',           -- motif si l'admin renvoie en brouillon
  version        int default 1,
  ref_base       text default '',
  ref_precedente text default '',
  remplacee_par  text default '',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- Lots d'écrasement : jamais deux prélèvements dans un même lot (garanti côté
-- app) ; défaut 3@7j + reste@28j, âges client possibles (3j, 14j...).
create table if not exists public.lots (
  id                    uuid primary key default gen_random_uuid(),
  coulage_ref           text not null references public.coulages(ref) on delete cascade,
  labo_id               uuid not null references public.labos(id),
  prel                  int  default 1,     -- n° du prélèvement (E1, E2...)
  type                  text default 'cube',-- cube | cylindre
  age_jours             int  default 28,
  nombre                int  default 0,
  codes                 jsonb default '[]'::jsonb,  -- ["ABA012-E1-01", ...]
  date_coulage          date,
  date_echeance         date,
  statut                text not null default 'en_bassin', -- en_bassin | sorti | teste | valide
  resultats             jsonb,              -- éprouvette par éprouvette : dims, masse, force, Rc
  sorti_at              timestamptz,
  ecrase_par            text default '',
  ecrase_at             timestamptz,
  resultats_valides_par text default '',
  resultats_valides_at  timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- Évacuations des déchets (éprouvettes écrasées) par labo.
create table if not exists public.evacuations (
  id         uuid primary key default gen_random_uuid(),
  labo_id    uuid not null references public.labos(id),
  date_evac  date default current_date,
  nombre     int  default 0,
  operateur  text default '',
  note       text default '',
  created_at timestamptz default now()
);

-- Abonnements aux notifications push (un par appareil). L'envoi (Edge
-- Function + VAPID + cron) est mis en place en Phase 6.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  endpoint    text unique not null,
  p256dh      text not null,
  auth        text not null,
  appareil    text default '',
  created_at  timestamptz default now()
);

create index if not exists idx_coulages_labo    on public.coulages(labo_id, statut);
create index if not exists idx_lots_labo        on public.lots(labo_id, statut);
create index if not exists idx_lots_coulage     on public.lots(coulage_ref);
create index if not exists idx_lots_echeance    on public.lots(date_echeance);
create index if not exists idx_evacuations_labo on public.evacuations(labo_id);

-- RLS : activé, aucune policy => accès direct refusé pour anon/authenticated.
-- (service_role contourne RLS ; les fonctions ci-dessous sont SECURITY DEFINER.)
alter table public.labos              enable row level security;
alter table public.operators          enable row level security;
alter table public.clients            enable row level security;
alter table public.projets            enable row level security;
alter table public.formulations       enable row level security;
alter table public.coulages           enable row level security;
alter table public.lots               enable row level security;
alter table public.evacuations        enable row level security;
alter table public.push_subscriptions enable row level security;

-- ============================== HELPERS =====================================

-- Hash du PIN : sha256( identifiant_minuscule + ':' + pin )
create or replace function public._pin_hash(p_identifiant text, p_pin text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(lower(p_identifiant) || ':' || coalesce(p_pin,''), 'sha256'), 'hex');
$$;

-- Opérateur actif à partir d'un token de session
create or replace function public._op_by_token(p_token text)
returns public.operators language sql stable security definer set search_path = public as $$
  select * from public.operators
   where token = p_token and p_token is not null and actif = true
   limit 1;
$$;

create or replace function public._is_admin(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public._op_by_token(p_token)), false);
$$;

-- ============================== AUTH ========================================

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
  -- Token de session STABLE : réutilisé pour ne pas invalider les autres appareils.
  t := coalesce(r.token, gen_random_uuid()::text);
  update public.operators set token = t, token_at = now() where id = r.id;
  return json_build_object('ok', true, 'token', t, 'nom', r.nom,
    'identifiant', r.identifiant, 'fonction', r.fonction, 'is_admin', r.is_admin,
    'labo_id', r.labo_id,
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
    'labo_id', r.labo_id,
    'labo_nom', (select nom from public.labos where id = r.labo_id));
end; $$;

create or replace function public.op_change_pin(p_token text, p_old_pin text, p_new_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if r.pin_hash <> public._pin_hash(r.identifiant, p_old_pin) then
    return json_build_object('ok', false, 'error', 'pin');
  end if;
  update public.operators set pin_hash = public._pin_hash(r.identifiant, p_new_pin) where id = r.id;
  return json_build_object('ok', true);
end; $$;

-- ============================== COULAGES ====================================

-- Référence suivante pour un code projet : <CODE>NNN (NNN sur 3 chiffres),
-- calculée depuis les coulages réels du serveur (compteur global partagé).
create or replace function public.op_next_ref(p_token text, p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; pat text; maxn int;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  pat := upper(coalesce(p_code, ''));
  if pat = '' then return json_build_object('ok', false, 'error', 'code'); end if;
  select coalesce(max(num), 0) into maxn from (
    select nullif(regexp_replace(substring(ref from char_length(pat) + 1), '[^0-9].*$', ''), '')::int as num
    from public.coulages
    where ref like pat || '%'
  ) t where num is not null;
  return json_build_object('ok', true, 'n', maxn + 1,
    'ref', pat || lpad((maxn + 1)::text, 3, '0'));
end; $$;

-- Enregistrement (brouillon). labo = labo de l'opérateur ; un admin sans labo
-- doit fournir laboId dans le payload. Refusé si le coulage n'est plus brouillon.
create or replace function public.op_save_coulage(p_token text, p_ref text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; ex public.coulages; v_labo uuid;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  v_labo := coalesce(r.labo_id, nullif(p_payload->>'laboId','')::uuid);
  if v_labo is null then return json_build_object('ok', false, 'error', 'labo_requis'); end if;
  select * into ex from public.coulages where ref = p_ref;
  if found then
    if ex.statut <> 'brouillon' then return json_build_object('ok', false, 'error', 'verrouille'); end if;
    if ex.labo_id <> v_labo and r.is_admin is not true then
      return json_build_object('ok', false, 'error', 'autre_labo');
    end if;
  end if;
  insert into public.coulages(ref, labo_id, code_projet, statut, payload, operateur,
                              version, ref_base, updated_at)
    values (p_ref, v_labo, coalesce(p_payload->>'codeProjet',''), 'brouillon',
            p_payload || jsonb_build_object('statut','brouillon'), r.nom,
            coalesce((p_payload->>'version')::int, 1), p_ref, now())
  on conflict (ref) do update set
    code_projet = excluded.code_projet, payload = excluded.payload,
    operateur = excluded.operateur, updated_at = now();
  return json_build_object('ok', true);
end; $$;

-- Soumission par l'opérateur : verrouille la fiche pour lui, en attente de
-- validation admin. La répartition au bassin reste possible dès ce statut.
create or replace function public.op_soumettre_coulage(p_token text, p_ref text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; ex public.coulages; v_labo uuid; pl jsonb;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  v_labo := coalesce(r.labo_id, nullif(p_payload->>'laboId','')::uuid);
  if v_labo is null then return json_build_object('ok', false, 'error', 'labo_requis'); end if;
  select * into ex from public.coulages where ref = p_ref;
  if found and ex.statut = 'valide' then
    return json_build_object('ok', false, 'error', 'deja_valide');
  end if;
  pl := p_payload || jsonb_build_object('statut','soumis', 'retourAdmin','');
  insert into public.coulages(ref, labo_id, code_projet, statut, payload, operateur,
                              soumis_at, retour_admin, version, ref_base, updated_at)
    values (p_ref, v_labo, coalesce(p_payload->>'codeProjet',''), 'soumis', pl, r.nom,
            now(), '', coalesce((p_payload->>'version')::int, 1), p_ref, now())
  on conflict (ref) do update set
    code_projet = excluded.code_projet, statut = 'soumis', payload = excluded.payload,
    operateur = excluded.operateur, soumis_at = now(), retour_admin = '', updated_at = now();
  return json_build_object('ok', true);
end; $$;

-- Liste scopée : opérateur -> son labo uniquement ; admin -> tout, ou filtre p_labo.
create or replace function public.op_list_coulages(p_token text, p_labo uuid default null)
returns setof public.coulages language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  if r.is_admin then
    return query select * from public.coulages
      where (p_labo is null or labo_id = p_labo) order by updated_at desc;
  else
    if r.labo_id is null then return; end if;
    return query select * from public.coulages
      where labo_id = r.labo_id order by updated_at desc;
  end if;
end; $$;

-- Suppression par l'opérateur : brouillons de son labo uniquement.
create or replace function public.op_delete_coulage(p_token text, p_ref text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; ex public.coulages;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into ex from public.coulages where ref = p_ref;
  if not found then return json_build_object('ok', true); end if;
  if ex.statut <> 'brouillon' then return json_build_object('ok', false, 'error', 'verrouille'); end if;
  if r.is_admin is not true and (r.labo_id is null or ex.labo_id <> r.labo_id) then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;
  delete from public.coulages where ref = p_ref;
  return json_build_object('ok', true);
end; $$;

-- Validation par un ADMIN : confirme désignation ouvrage + formulation
-- (p_payload = version éventuellement corrigée par l'admin). Après le OK,
-- l'app admin supprime les médias du coulage dans Storage (quota gratuit).
create or replace function public.admin_valider_coulage(p_token text, p_ref text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare ex public.coulages; r public.operators; pl jsonb; v text;
begin
  r := public._op_by_token(p_token);
  if r.id is null or r.is_admin is not true then
    return json_build_object('ok', false, 'error', 'admin');
  end if;
  select * into ex from public.coulages where ref = p_ref;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if ex.statut = 'valide' then return json_build_object('ok', false, 'error', 'deja_valide'); end if;
  v  := to_char(now(), 'DD/MM/YYYY');
  pl := coalesce(p_payload, ex.payload)
        || jsonb_build_object('statut','valide', 'validePar', r.nom, 'dateValidation', v);
  update public.coulages set
    statut = 'valide', payload = pl,
    code_projet = coalesce(pl->>'codeProjet', code_projet),
    valide_par = r.nom, valide_at = now(), retour_admin = '', updated_at = now()
    where ref = p_ref;
  return json_build_object('ok', true, 'valide_par', r.nom, 'date_validation', v);
end; $$;

-- Nettoyage des références médias APRES suppression Storage réussie.
-- Séparé de la validation pour éviter de supprimer des fichiers avant que la
-- fiche soit effectivement figée côté serveur.
create or replace function public.admin_marquer_medias_purges(p_token text, p_ref text)
returns json language plpgsql security definer set search_path = public as $$
declare ex public.coulages; pl jsonb;
begin
  if not public._is_admin(p_token) then
    return json_build_object('ok', false, 'error', 'admin');
  end if;
  select * into ex from public.coulages where ref = p_ref;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if ex.statut <> 'valide' then return json_build_object('ok', false, 'error', 'non_valide'); end if;
  pl := ex.payload || jsonb_build_object(
    'medias', '[]'::jsonb,
    'mediasIncomplets', false,
    'mediasPurgePending', false
  );
  update public.coulages set payload = pl, updated_at = now() where ref = p_ref;
  return json_build_object('ok', true);
end; $$;

-- Renvoi en brouillon par un ADMIN (correction demandée à l'opérateur).
create or replace function public.admin_renvoyer_coulage(p_token text, p_ref text, p_motif text)
returns json language plpgsql security definer set search_path = public as $$
declare ex public.coulages;
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  select * into ex from public.coulages where ref = p_ref;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if ex.statut = 'valide' then return json_build_object('ok', false, 'error', 'deja_valide'); end if;
  update public.coulages set
    statut = 'brouillon', retour_admin = coalesce(p_motif,''),
    payload = payload || jsonb_build_object('statut','brouillon', 'retourAdmin', coalesce(p_motif,'')),
    updated_at = now()
    where ref = p_ref;
  return json_build_object('ok', true);
end; $$;

-- Suppression par un ADMIN (tout statut ; lots supprimés en cascade).
create or replace function public.admin_delete_coulage(p_token text, p_ref text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  update public.coulages set remplacee_par = '' where remplacee_par = p_ref;
  delete from public.coulages where ref = p_ref;
  return json_build_object('ok', true);
end; $$;

-- ============================== LOTS (BASSIN / ÉCRASEMENT) ==================

-- Enregistre la répartition des lots d'un coulage (remplace les lots encore
-- au bassin). Refusé si un lot est déjà sorti/testé (répartition engagée).
-- p_lots = [{prel, type, ageJours, nombre, codes, dateCoulage, dateEcheance}, ...]
create or replace function public.op_save_repartition(p_token text, p_ref text, p_lots jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; c public.coulages; l record;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into c from public.coulages where ref = p_ref;
  if not found then return json_build_object('ok', false, 'error', 'coulage_introuvable'); end if;
  if r.is_admin is not true and (r.labo_id is null or c.labo_id <> r.labo_id) then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;
  if exists (select 1 from public.lots where coulage_ref = p_ref and statut <> 'en_bassin') then
    return json_build_object('ok', false, 'error', 'lots_engages');
  end if;
  delete from public.lots where coulage_ref = p_ref;
  for l in select value as v from jsonb_array_elements(coalesce(p_lots, '[]'::jsonb)) loop
    insert into public.lots(coulage_ref, labo_id, prel, type, age_jours, nombre, codes,
                            date_coulage, date_echeance)
      values (p_ref, c.labo_id,
              coalesce((l.v->>'prel')::int, 1),
              coalesce(l.v->>'type', 'cube'),
              coalesce((l.v->>'ageJours')::int, 28),
              coalesce((l.v->>'nombre')::int, 0),
              coalesce(l.v->'codes', '[]'::jsonb),
              nullif(l.v->>'dateCoulage','')::date,
              nullif(l.v->>'dateEcheance','')::date);
  end loop;
  return json_build_object('ok', true);
end; $$;

create or replace function public.op_list_lots(p_token text, p_labo uuid default null)
returns setof public.lots language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  if r.is_admin then
    return query select * from public.lots
      where (p_labo is null or labo_id = p_labo) order by date_echeance nulls last, created_at;
  else
    if r.labo_id is null then return; end if;
    return query select * from public.lots
      where labo_id = r.labo_id order by date_echeance nulls last, created_at;
  end if;
end; $$;

-- Contrôle d'accès commun aux actions sur un lot.
create or replace function public._lot_scope_ok(r public.operators, l public.lots)
returns boolean language sql immutable as $$
  select r.is_admin is true or (r.labo_id is not null and l.labo_id = r.labo_id);
$$;

-- Sortie du bassin (en_bassin -> sorti).
create or replace function public.op_sortir_lot(p_token text, p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; l public.lots;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into l from public.lots where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if not public._lot_scope_ok(r, l) then return json_build_object('ok', false, 'error', 'autre_labo'); end if;
  if l.statut <> 'en_bassin' then return json_build_object('ok', false, 'error', 'statut'); end if;
  update public.lots set statut = 'sorti', sorti_at = now(), updated_at = now() where id = p_id;
  return json_build_object('ok', true);
end; $$;

-- Retour au bassin (sorti -> en_bassin, correction d'une erreur).
create or replace function public.op_retour_bassin(p_token text, p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; l public.lots;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into l from public.lots where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if not public._lot_scope_ok(r, l) then return json_build_object('ok', false, 'error', 'autre_labo'); end if;
  if l.statut <> 'sorti' then return json_build_object('ok', false, 'error', 'statut'); end if;
  update public.lots set statut = 'en_bassin', sorti_at = null, updated_at = now() where id = p_id;
  return json_build_object('ok', true);
end; $$;

-- Saisie de l'essai d'écrasement (sorti ou en_bassin -> teste).
-- p_resultats = résultats éprouvette par éprouvette (dims, masse, force, Rc).
create or replace function public.op_tester_lot(p_token text, p_id uuid, p_resultats jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; l public.lots;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into l from public.lots where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if not public._lot_scope_ok(r, l) then return json_build_object('ok', false, 'error', 'autre_labo'); end if;
  if l.statut = 'valide' then return json_build_object('ok', false, 'error', 'verrouille'); end if;
  update public.lots set
    statut = 'teste', resultats = p_resultats,
    ecrase_par = r.nom, ecrase_at = coalesce(ecrase_at, now()), updated_at = now()
    where id = p_id;
  return json_build_object('ok', true);
end; $$;

-- Validation des résultats par un ADMIN (teste -> valide, immuable ensuite).
create or replace function public.admin_valider_resultats(p_token text, p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; l public.lots;
begin
  r := public._op_by_token(p_token);
  if r.id is null or r.is_admin is not true then
    return json_build_object('ok', false, 'error', 'admin');
  end if;
  select * into l from public.lots where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if l.statut <> 'teste' then return json_build_object('ok', false, 'error', 'statut'); end if;
  update public.lots set
    statut = 'valide', resultats_valides_par = r.nom, resultats_valides_at = now(),
    updated_at = now()
    where id = p_id;
  return json_build_object('ok', true);
end; $$;

-- ============================== FORMULATIONS ================================

-- Modèles utilisables par les opérateurs : validées + actives uniquement.
create or replace function public.op_list_formulations(p_token text)
returns setof public.formulations language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  return query select * from public.formulations
    where statut = 'validee' and actif = true order by fournisseur, nom;
end; $$;

-- Proposition d'un modèle par un opérateur (en attente de validation admin).
create or replace function public.op_proposer_formulation(
  p_token text, p_fournisseur text, p_nom text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if coalesce(trim(p_fournisseur),'') = '' or coalesce(trim(p_nom),'') = '' then
    return json_build_object('ok', false, 'error', 'champs');
  end if;
  if exists (select 1 from public.formulations
             where lower(fournisseur) = lower(trim(p_fournisseur)) and lower(nom) = lower(trim(p_nom))) then
    return json_build_object('ok', false, 'error', 'existe');
  end if;
  insert into public.formulations(fournisseur, nom, payload, statut, cree_par)
    values (trim(p_fournisseur), trim(p_nom), p_payload, 'proposee', r.nom);
  return json_build_object('ok', true);
end; $$;

-- Liste complète pour l'admin (y compris propositions en attente).
create or replace function public.admin_list_formulations(p_token text)
returns setof public.formulations language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return; end if;
  return query select * from public.formulations order by statut desc, fournisseur, nom;
end; $$;

-- Création/édition directe par un admin (statut validee).
create or replace function public.admin_upsert_formulation(p_token text, p_form jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null or r.is_admin is not true then
    return json_build_object('ok', false, 'error', 'admin');
  end if;
  insert into public.formulations(fournisseur, nom, payload, statut, actif, cree_par, validee_par, updated_at)
    values (trim(p_form->>'fournisseur'), trim(p_form->>'nom'),
            coalesce(p_form->'payload', '{}'::jsonb), 'validee',
            coalesce((p_form->>'actif')::boolean, true), r.nom, r.nom, now())
  on conflict (fournisseur, nom) do update set
    payload = excluded.payload, statut = 'validee', actif = excluded.actif,
    validee_par = excluded.validee_par, updated_at = now();
  return json_build_object('ok', true);
end; $$;

-- Validation d'une proposition (proposee -> validee).
create or replace function public.admin_valider_formulation(p_token text, p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null or r.is_admin is not true then
    return json_build_object('ok', false, 'error', 'admin');
  end if;
  update public.formulations set statut = 'validee', validee_par = r.nom, updated_at = now()
    where id = p_id;
  return json_build_object('ok', true);
end; $$;

create or replace function public.admin_delete_formulation(p_token text, p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  delete from public.formulations where id = p_id;
  return json_build_object('ok', true);
end; $$;

-- ============================== CLIENTS / PROJETS ===========================

create or replace function public.op_list_clients(p_token text)
returns setof public.clients language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  return query select * from public.clients where actif = true order by nom;
end; $$;

create or replace function public.op_list_projets(p_token text)
returns setof public.projets language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  return query select * from public.projets where actif = true order by code_projet;
end; $$;

create or replace function public.admin_upsert_client(p_token text, p_client jsonb)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  insert into public.clients(client_id, nom, adresse, ville, contact_nom, contact_tel,
                             email, notes, actif, updated_at)
    values (p_client->>'clientId', coalesce(p_client->>'nom',''),
            coalesce(p_client->>'adresse',''), coalesce(p_client->>'ville',''),
            coalesce(p_client->>'contactNom',''), coalesce(p_client->>'contactTel',''),
            coalesce(p_client->>'email',''), coalesce(p_client->>'notes',''),
            coalesce((p_client->>'actif')::boolean, true), now())
  on conflict (client_id) do update set
    nom = excluded.nom, adresse = excluded.adresse, ville = excluded.ville,
    contact_nom = excluded.contact_nom, contact_tel = excluded.contact_tel,
    email = excluded.email, notes = excluded.notes, actif = excluded.actif, updated_at = now();
  return json_build_object('ok', true);
end; $$;

create or replace function public.admin_save_projet(p_token text, p_projet jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_ages int[];
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  select array_agg(x::int) into v_ages
    from jsonb_array_elements_text(coalesce(p_projet->'agesEssai', '[7,28]'::jsonb)) x;
  insert into public.projets(code_projet, client_id, nom_projet, localisation, resistance_mpa,
                             conversion_defaut, facteur_conversion, reference_commande,
                             reference_dossier, ages_essai, notes, actif, updated_at)
    values (upper(p_projet->>'codeProjet'), coalesce(p_projet->>'clientId',''),
            coalesce(p_projet->>'nomProjet',''), coalesce(p_projet->>'localisation',''),
            coalesce(p_projet->>'resistanceMpa',''), coalesce(p_projet->>'conversionDefaut',''),
            coalesce(p_projet->>'facteurConversion',''), coalesce(p_projet->>'referenceCommande',''),
            coalesce(p_projet->>'referenceDossier',''), coalesce(v_ages, '{7,28}'::int[]),
            coalesce(p_projet->>'notes',''), coalesce((p_projet->>'actif')::boolean, true), now())
  on conflict (code_projet) do update set
    client_id = excluded.client_id, nom_projet = excluded.nom_projet,
    localisation = excluded.localisation, resistance_mpa = excluded.resistance_mpa,
    conversion_defaut = excluded.conversion_defaut, facteur_conversion = excluded.facteur_conversion,
    reference_commande = excluded.reference_commande, reference_dossier = excluded.reference_dossier,
    ages_essai = excluded.ages_essai, notes = excluded.notes, actif = excluded.actif,
    updated_at = now();
  return json_build_object('ok', true);
end; $$;

create or replace function public.admin_delete_projet(p_token text, p_code text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  delete from public.projets where code_projet = upper(p_code);
  return json_build_object('ok', true);
end; $$;

-- ============================== LABOS =======================================

create or replace function public.admin_list_labos(p_token text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  return json_build_object('ok', true, 'labos', coalesce((
    select json_agg(json_build_object('id', id, 'nom', nom, 'localisation', localisation,
             'seuilDechets', seuil_dechets, 'actif', actif) order by nom)
    from public.labos), '[]'::json));
end; $$;

create or replace function public.admin_upsert_labo(
  p_token text, p_id uuid, p_nom text, p_localisation text, p_seuil int, p_actif boolean)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  if coalesce(trim(p_nom),'') = '' then return json_build_object('ok', false, 'error', 'nom'); end if;
  if p_id is null then
    if exists (select 1 from public.labos where lower(nom) = lower(trim(p_nom))) then
      return json_build_object('ok', false, 'error', 'nom_existe');
    end if;
    insert into public.labos(nom, localisation, seuil_dechets, actif)
      values (trim(p_nom), coalesce(p_localisation,''), coalesce(p_seuil, 100), coalesce(p_actif, true));
  else
    update public.labos set
      nom = trim(p_nom), localisation = coalesce(p_localisation,''),
      seuil_dechets = coalesce(p_seuil, seuil_dechets), actif = coalesce(p_actif, actif)
      where id = p_id;
  end if;
  return json_build_object('ok', true);
end; $$;

-- ============================== OPÉRATEURS (ADMIN) ==========================

create or replace function public.admin_list_operators(p_token text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  return json_build_object('ok', true, 'operators', coalesce((
    select json_agg(json_build_object('id', o.id, 'identifiant', o.identifiant, 'nom', o.nom,
             'fonction', o.fonction, 'is_admin', o.is_admin, 'actif', o.actif,
             'labo_id', o.labo_id, 'labo_nom', b.nom) order by o.nom)
    from public.operators o left join public.labos b on b.id = o.labo_id), '[]'::json));
end; $$;

-- Crée (sans id) ou met à jour (avec id) un opérateur. PIN seulement si fourni.
-- p_labo = labo d'affectation (obligatoire pour un non-admin).
create or replace function public.admin_upsert_operator(
  p_token text, p_id uuid, p_identifiant text, p_pin text,
  p_nom text, p_fonction text, p_is_admin boolean, p_actif boolean, p_labo uuid)
returns json language plpgsql security definer set search_path = public as $$
declare existing public.operators;
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  if coalesce(p_is_admin, false) is not true and p_labo is null then
    return json_build_object('ok', false, 'error', 'labo_requis');
  end if;
  if p_id is null then
    if exists (select 1 from public.operators where lower(identifiant) = lower(p_identifiant)) then
      return json_build_object('ok', false, 'error', 'identifiant_existe');
    end if;
    if coalesce(p_pin,'') = '' then return json_build_object('ok', false, 'error', 'pin_requis'); end if;
    insert into public.operators(identifiant, pin_hash, nom, fonction, is_admin, labo_id, actif)
      values (p_identifiant, public._pin_hash(p_identifiant, p_pin),
              p_nom, coalesce(p_fonction,''), coalesce(p_is_admin,false), p_labo, coalesce(p_actif,true));
  else
    select * into existing from public.operators where id = p_id;
    if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
    update public.operators set
      identifiant = p_identifiant, nom = p_nom, fonction = coalesce(p_fonction,''),
      is_admin = coalesce(p_is_admin, existing.is_admin), labo_id = p_labo,
      actif = coalesce(p_actif, existing.actif),
      pin_hash = case when coalesce(p_pin,'') <> '' then public._pin_hash(p_identifiant, p_pin)
                      else existing.pin_hash end
      where id = p_id;
  end if;
  return json_build_object('ok', true);
end; $$;

create or replace function public.admin_set_operator_active(p_token text, p_id uuid, p_actif boolean)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  update public.operators set actif = p_actif, token = case when p_actif then token else null end
    where id = p_id;
  return json_build_object('ok', true);
end; $$;

-- ============================== ÉVACUATIONS (DÉCHETS) =======================

create or replace function public.op_list_evacuations(p_token text, p_labo uuid default null)
returns setof public.evacuations language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  if r.is_admin then
    return query select * from public.evacuations
      where (p_labo is null or labo_id = p_labo) order by date_evac desc, created_at desc;
  else
    if r.labo_id is null then return; end if;
    return query select * from public.evacuations
      where labo_id = r.labo_id order by date_evac desc, created_at desc;
  end if;
end; $$;

create or replace function public.op_add_evacuation(p_token text, p_nombre int, p_note text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if r.labo_id is null then return json_build_object('ok', false, 'error', 'labo_requis'); end if;
  insert into public.evacuations(labo_id, nombre, operateur, note)
    values (r.labo_id, coalesce(p_nombre, 0), r.nom, coalesce(p_note,''));
  return json_build_object('ok', true);
end; $$;

-- ============================== NOTIFICATIONS (ABONNEMENTS) =================
-- L'ENVOI des notifications (Edge Function + VAPID + cron) est fait en Phase 6.

create or replace function public.op_save_push_subscription(p_token text, p_sub jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  insert into public.push_subscriptions(operator_id, endpoint, p256dh, auth, appareil)
    values (r.id, p_sub->>'endpoint', p_sub->'keys'->>'p256dh', p_sub->'keys'->>'auth',
            coalesce(p_sub->>'appareil',''))
  on conflict (endpoint) do update set
    operator_id = excluded.operator_id, p256dh = excluded.p256dh, auth = excluded.auth,
    appareil = excluded.appareil;
  return json_build_object('ok', true);
end; $$;

create or replace function public.op_delete_push_subscription(p_token text, p_endpoint text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and operator_id = r.id;
  return json_build_object('ok', true);
end; $$;

-- ============================== DROITS D'EXÉCUTION ==========================
-- La clé anon (et authenticated) ne peut appeler QUE ces fonctions.

grant execute on function
  public.op_login(text,text),
  public.op_verify(text),
  public.op_change_pin(text,text,text),
  public.op_next_ref(text,text),
  public.op_save_coulage(text,text,jsonb),
  public.op_soumettre_coulage(text,text,jsonb),
  public.op_list_coulages(text,uuid),
  public.op_delete_coulage(text,text),
  public.op_save_repartition(text,text,jsonb),
  public.op_list_lots(text,uuid),
  public.op_sortir_lot(text,uuid),
  public.op_retour_bassin(text,uuid),
  public.op_tester_lot(text,uuid,jsonb),
  public.op_list_formulations(text),
  public.op_proposer_formulation(text,text,text,jsonb),
  public.op_list_clients(text),
  public.op_list_projets(text),
  public.op_list_evacuations(text,uuid),
  public.op_add_evacuation(text,int,text),
  public.op_save_push_subscription(text,jsonb),
  public.op_delete_push_subscription(text,text),
  public.admin_valider_coulage(text,text,jsonb),
  public.admin_marquer_medias_purges(text,text),
  public.admin_renvoyer_coulage(text,text,text),
  public.admin_delete_coulage(text,text),
  public.admin_valider_resultats(text,uuid),
  public.admin_list_formulations(text),
  public.admin_upsert_formulation(text,jsonb),
  public.admin_valider_formulation(text,uuid),
  public.admin_delete_formulation(text,uuid),
  public.admin_upsert_client(text,jsonb),
  public.admin_save_projet(text,jsonb),
  public.admin_delete_projet(text,text),
  public.admin_list_labos(text),
  public.admin_upsert_labo(text,uuid,text,text,int,boolean),
  public.admin_list_operators(text),
  public.admin_upsert_operator(text,uuid,text,text,text,text,boolean,boolean,uuid),
  public.admin_set_operator_active(text,uuid,boolean)
to anon, authenticated;

-- ============================== AMORÇAGE ====================================
-- Labo par défaut + opérateur admin : identifiant = admin  /  PIN = 1234
-- (à changer immédiatement depuis l'écran Admin de l'application).

insert into public.labos(nom, localisation)
values ('Laboratoire central', '')
on conflict (nom) do nothing;

insert into public.operators(identifiant, pin_hash, nom, fonction, is_admin, actif)
values ('admin', public._pin_hash('admin', '1234'), 'Administrateur', 'Responsable labo', true, true)
on conflict (identifiant) do nothing;

-- FIN ------------------------------------------------------------------------

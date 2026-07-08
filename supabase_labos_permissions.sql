-- ============================================================================
--  Migration : LABOS & DROITS ADMIN PAR LABO   (Module Béton CAEK)
--  A RELIRE puis exécuter dans Supabase (SQL Editor). Idempotent, sans perte
--  de données. Faire une SAUVEGARDE (export) avant.
--
--  Objectifs (validés) :
--   1. Un PROJET est rattaché à un labo réel (labos.id) -> un coulage hérite du
--      labo de son projet. Corrige : coulage admin « sans labo » (invisible sous
--      un labo précis + erreur « labo_requis »).
--   2. Un ADMIN vérificateur ne valide QUE son/ses labo(s) (operators.admin_labos).
--      admin_labos vide/NULL = ADMIN PRINCIPAL (tous les labos) = compte « admin ».
--   3. Isolation forte : coulages, lots (bassin/répertoire), résultats de
--      compression restent cloisonnés par labo (déjà le cas pour les opérateurs ;
--      on l'étend aux admins scopés). Les FORMULATIONS restent globales.
-- ============================================================================

-- ------------------------------------------------------------------ SCHÉMA ---
-- Labo réel (uuid) porté par le projet (en plus de l'étiquette texte `labo`).
alter table public.projets   add column if not exists labo_id uuid references public.labos(id);
-- Ensemble de labos qu'un admin peut vérifier/valider. NULL/{} = TOUS (principal).
alter table public.operators add column if not exists admin_labos uuid[] default null;

create index if not exists idx_projets_labo on public.projets(labo_id);

-- --------------------------------------------------------- AMORCE (à vérifier)
-- Relie les projets existants au labo réel en rapprochant le texte `labo`
-- (« Oran » / « Béchar ») du nom du labo (« Laboratoire oran » / « Annexe
-- Béchar »). >>> VÉRIFIER LE RÉSULTAT À LA MAIN ensuite (accents, libellés). <<<
update public.projets p
   set labo_id = l.id
  from public.labos l
 where p.labo_id is null
   and coalesce(p.labo,'') <> ''
   and lower(l.nom) like '%' || lower(p.labo) || '%';

-- Le compte « admin » reste ADMIN PRINCIPAL : admin_labos NULL = tous les labos.
-- (Aucune action requise : NULL par défaut. Ligne explicite pour la traçabilité.)
update public.operators set admin_labos = null where identifiant = 'admin';

-- ------------------------------------------------------------------ HELPERS ---
-- Cet admin (par token) a-t-il le droit d'agir sur ce labo ?
--   principal (admin_labos NULL/{}) -> true pour tout labo ; sinon appartenance.
create or replace function public._admin_can(p_token text, p_labo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.is_admin is true
       and (r.admin_labos is null or cardinality(r.admin_labos) = 0
            or p_labo = any(r.admin_labos))
    from public._op_by_token(p_token) r), false);
$$;

-- Scope admin sous forme d'ensemble : NULL = tous (principal), sinon la liste.
create or replace function public._admin_labo_set(p_token text)
returns uuid[] language sql stable security definer set search_path = public as $$
  select nullif(r.admin_labos, '{}'::uuid[])
  from public._op_by_token(p_token) r
  where r.is_admin is true;
$$;

-- ============================ COULAGES ======================================
-- Labo du coulage = labo opérateur, sinon payload.laboId, sinon LABO DU PROJET.
create or replace function public.op_save_coulage(p_token text, p_ref text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; ex public.coulages; v_labo uuid;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  v_labo := coalesce(
              r.labo_id,
              nullif(p_payload->>'laboId','')::uuid,
              (select labo_id from public.projets
                 where code_projet = upper(coalesce(p_payload->>'codeProjet',''))));
  if v_labo is null then return json_build_object('ok', false, 'error', 'labo_requis'); end if;
  select * into ex from public.coulages where ref = p_ref;
  if found then
    if ex.statut <> 'brouillon' then return json_build_object('ok', false, 'error', 'verrouille'); end if;
    -- édition d'un coulage d'un autre labo : refusée sauf droit admin sur ce labo
    if ex.labo_id <> v_labo and not public._admin_can(p_token, ex.labo_id) then
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

create or replace function public.op_soumettre_coulage(p_token text, p_ref text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; ex public.coulages; v_labo uuid; pl jsonb;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  v_labo := coalesce(
              r.labo_id,
              nullif(p_payload->>'laboId','')::uuid,
              (select labo_id from public.projets
                 where code_projet = upper(coalesce(p_payload->>'codeProjet',''))));
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

-- Liste : opérateur -> son labo ; admin -> ses labos (admin_labos), NULL = tous.
create or replace function public.op_list_coulages(p_token text, p_labo uuid default null)
returns setof public.coulages language plpgsql security definer set search_path = public as $$
declare r public.operators; s uuid[];
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  if r.is_admin then
    s := nullif(r.admin_labos, '{}'::uuid[]);          -- NULL => tous
    return query select * from public.coulages
      where (s is null or labo_id = any(s))
        and (p_labo is null or labo_id = p_labo)
      order by updated_at desc;
  else
    if r.labo_id is null then return; end if;
    return query select * from public.coulages
      where labo_id = r.labo_id order by updated_at desc;
  end if;
end; $$;

-- Validation / renvoi / suppression : autorisés seulement sur un labo permis.
create or replace function public.admin_valider_coulage(p_token text, p_ref text, p_payload jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare ex public.coulages; r public.operators; pl jsonb; v text;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into ex from public.coulages where ref = p_ref;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if not public._admin_can(p_token, ex.labo_id) then
    return json_build_object('ok', false, 'error', 'admin');
  end if;
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

create or replace function public.admin_renvoyer_coulage(p_token text, p_ref text, p_motif text)
returns json language plpgsql security definer set search_path = public as $$
declare ex public.coulages;
begin
  select * into ex from public.coulages where ref = p_ref;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if not public._admin_can(p_token, ex.labo_id) then return json_build_object('ok', false, 'error', 'admin'); end if;
  if ex.statut = 'valide' then return json_build_object('ok', false, 'error', 'deja_valide'); end if;
  update public.coulages set
    statut = 'brouillon', retour_admin = coalesce(p_motif,''),
    payload = payload || jsonb_build_object('statut','brouillon', 'retourAdmin', coalesce(p_motif,'')),
    updated_at = now()
    where ref = p_ref;
  return json_build_object('ok', true);
end; $$;

create or replace function public.admin_delete_coulage(p_token text, p_ref text)
returns json language plpgsql security definer set search_path = public as $$
declare ex public.coulages;
begin
  select * into ex from public.coulages where ref = p_ref;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if not public._admin_can(p_token, ex.labo_id) then return json_build_object('ok', false, 'error', 'admin'); end if;
  update public.coulages set remplacee_par = '' where remplacee_par = p_ref;
  delete from public.coulages where ref = p_ref;
  return json_build_object('ok', true);
end; $$;

-- ============================ LOTS / BASSIN =================================
-- Scope commun (admins scopés inclus). Callers (op_sortir_lot, etc.) inchangés.
create or replace function public._lot_scope_ok(r public.operators, l public.lots)
returns boolean language sql immutable as $$
  select (r.is_admin is true
          and (r.admin_labos is null or cardinality(r.admin_labos) = 0
               or l.labo_id = any(r.admin_labos)))
      or (r.labo_id is not null and l.labo_id = r.labo_id);
$$;

create or replace function public.op_list_lots(p_token text, p_labo uuid default null)
returns setof public.lots language plpgsql security definer set search_path = public as $$
declare r public.operators; s uuid[];
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  if r.is_admin then
    s := nullif(r.admin_labos, '{}'::uuid[]);
    return query select * from public.lots
      where (s is null or labo_id = any(s))
        and (p_labo is null or labo_id = p_labo)
      order by date_echeance nulls last, created_at;
  else
    if r.labo_id is null then return; end if;
    return query select * from public.lots
      where labo_id = r.labo_id order by date_echeance nulls last, created_at;
  end if;
end; $$;

-- Validation des résultats de compression : seulement sur un labo permis.
create or replace function public.admin_valider_resultats(p_token text, p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; l public.lots;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into l from public.lots where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if not public._admin_can(p_token, l.labo_id) then return json_build_object('ok', false, 'error', 'admin'); end if;
  if l.statut <> 'teste' then return json_build_object('ok', false, 'error', 'statut'); end if;
  update public.lots set
    statut = 'valide', resultats_valides_par = r.nom, resultats_valides_at = now(),
    updated_at = now()
    where id = p_id;
  return json_build_object('ok', true);
end; $$;

-- ============================ PROFIL / LOGIN ================================
-- Renvoyer admin_labos (le front en a besoin pour scoper l'UI admin).
create or replace function public.op_verify(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false); end if;
  return json_build_object('ok', true, 'nom', r.nom,
    'identifiant', r.identifiant, 'is_admin', r.is_admin,
    'labo_id', r.labo_id,
    'labo_nom', (select nom from public.labos where id = r.labo_id),
    'admin_labos', r.admin_labos);
end; $$;

-- op_login : idem (ajout de admin_labos dans la réponse).
-- NB : recopier le corps EXACT de votre op_login puis ajouter la clé
--      'admin_labos', r.admin_labos  dans le json_build_object final.

-- ============================ PROJET (bureau) ==============================
-- admin_save_projet : accepter aussi laboId (uuid) en plus de l'étiquette labo.
-- (Version étendue de la fonction de supabase_labo_clients.sql.)
create or replace function public.admin_save_projet(p_token text, p_projet jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; v_ages int[];
begin
  r := public._op_by_token(p_token);
  if r.id is null or r.is_admin is not true then
    return json_build_object('ok', false, 'error', 'admin');
  end if;
  select array_agg(x::int) into v_ages
    from jsonb_array_elements_text(coalesce(p_projet->'agesEssai', '[7,28]'::jsonb)) x;
  insert into public.projets(code_projet, client_id, nom_projet, localisation, resistance_mpa,
                             conversion_defaut, facteur_conversion, reference_commande,
                             reference_dossier, ages_essai, notes, labo, labo_id, actif, updated_at)
    values (upper(p_projet->>'codeProjet'), coalesce(p_projet->>'clientId',''),
            coalesce(p_projet->>'nomProjet',''), coalesce(p_projet->>'localisation',''),
            coalesce(p_projet->>'resistanceMpa',''), coalesce(p_projet->>'conversionDefaut',''),
            coalesce(p_projet->>'facteurConversion',''), coalesce(p_projet->>'referenceCommande',''),
            coalesce(p_projet->>'referenceDossier',''), coalesce(v_ages, '{7,28}'::int[]),
            coalesce(p_projet->>'notes',''), coalesce(p_projet->>'labo',''),
            nullif(p_projet->>'laboId','')::uuid,
            coalesce((p_projet->>'actif')::boolean, true), now())
  on conflict (code_projet) do update set
    client_id = excluded.client_id, nom_projet = excluded.nom_projet,
    localisation = excluded.localisation, resistance_mpa = excluded.resistance_mpa,
    conversion_defaut = excluded.conversion_defaut, facteur_conversion = excluded.facteur_conversion,
    reference_commande = excluded.reference_commande, reference_dossier = excluded.reference_dossier,
    ages_essai = excluded.ages_essai, notes = excluded.notes,
    labo = case when p_projet ? 'labo'   then excluded.labo    else public.projets.labo    end,
    labo_id = case when p_projet ? 'laboId' then excluded.labo_id else public.projets.labo_id end,
    actif = coalesce((p_projet->>'actif')::boolean, true), updated_at = now();
  return json_build_object('ok', true);
end; $$;

-- op_login complet : renvoie aussi admin_labos.
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
    'labo_id', r.labo_id,
    'labo_nom', (select nom from public.labos where id = r.labo_id),
    'admin_labos', r.admin_labos);
end; $$;

-- ============================ ÉVACUATIONS (DÉCHETS) =========================
-- Un admin scopé ne voit que les évacuations de ses labos.
create or replace function public.op_list_evacuations(p_token text, p_labo uuid default null)
returns setof public.evacuations language plpgsql security definer set search_path = public as $$
declare r public.operators; s uuid[];
begin
  r := public._op_by_token(p_token);
  if r.id is null then return; end if;
  if r.is_admin then
    s := nullif(r.admin_labos, '{}'::uuid[]);
    return query select * from public.evacuations
      where (s is null or labo_id = any(s))
        and (p_labo is null or labo_id = p_labo)
      order by date_evac desc, created_at desc;
  else
    if r.labo_id is null then return; end if;
    return query select * from public.evacuations
      where labo_id = r.labo_id order by date_evac desc, created_at desc;
  end if;
end; $$;

-- ============================ DROITS (ADMIN PRINCIPAL) ======================
-- Admin PRINCIPAL = admin sans restriction de labos (admin_labos NULL/{}).
create or replace function public._is_principal(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.is_admin is true and (r.admin_labos is null or cardinality(r.admin_labos) = 0)
    from public._op_by_token(p_token) r), false);
$$;

-- Liste des opérateurs : réservée au PRINCIPAL ; renvoie admin_labos + noms.
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

-- Crée/édite un opérateur — réservé au PRINCIPAL. Nouveau param p_admin_labos :
-- ensemble de labos qu'un admin peut vérifier (NULL/{} = tous = principal).
-- Pour un non-admin, admin_labos est ignoré (forcé NULL).
-- Signature modifiée -> on supprime d'abord l'ancienne (9 arguments).
drop function if exists public.admin_upsert_operator(text, uuid, text, text, text, text, boolean, boolean, uuid);
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

-- Activation/désactivation — réservé au PRINCIPAL.
create or replace function public.admin_set_operator_active(p_token text, p_id uuid, p_actif boolean)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_principal(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  update public.operators set actif = p_actif, token = case when p_actif then token else null end
    where id = p_id;
  return json_build_object('ok', true);
end; $$;

-- FIN DE LA MIGRATION.
-- Après exécution : vérifier `select code_projet, labo, labo_id from public.projets;`
-- et corriger à la main les projets dont l'amorce n'a pas trouvé le bon labo.

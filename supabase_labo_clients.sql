-- ============================================================
-- Migration : laboratoire lié (Béchar / Oran) sur clients et projets.
-- Module Béton CAEK — à exécuter dans Supabase (SQL Editor) APRÈS
-- supabase_schema.sql. Idempotente (add column if not exists +
-- create or replace function).
--
-- « labo » est un libellé libre (liste déroulante Béchar / Oran côté
-- bureau et import Excel) — indépendant de la table labos (affectation
-- des opérateurs), pour rester compatible avec les données existantes :
-- les lignes actuelles gardent labo = '' tant qu'elles ne sont pas
-- réimportées / modifiées.
-- ============================================================

alter table public.clients add column if not exists labo text default '';
alter table public.projets add column if not exists labo text default '';

-- Upsert client : ajoute la clé facultative « labo » du payload.
create or replace function public.admin_upsert_client(p_token text, p_client jsonb)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  insert into public.clients(client_id, nom, adresse, ville, contact_nom, contact_tel,
                             email, notes, labo, actif, updated_at)
    values (p_client->>'clientId', coalesce(p_client->>'nom',''),
            coalesce(p_client->>'adresse',''), coalesce(p_client->>'ville',''),
            coalesce(p_client->>'contactNom',''), coalesce(p_client->>'contactTel',''),
            coalesce(p_client->>'email',''), coalesce(p_client->>'notes',''),
            coalesce(p_client->>'labo',''),
            coalesce((p_client->>'actif')::boolean, true), now())
  on conflict (client_id) do update set
    nom = excluded.nom, adresse = excluded.adresse, ville = excluded.ville,
    contact_nom = excluded.contact_nom, contact_tel = excluded.contact_tel,
    email = excluded.email, notes = excluded.notes,
    -- labo absent du payload -> on conserve la valeur existante.
    labo = case when p_client ? 'labo' then excluded.labo else public.clients.labo end,
    actif = excluded.actif, updated_at = now();
  return json_build_object('ok', true);
end; $$;

-- Sauvegarde projet : ajoute la clé facultative « labo » du payload.
create or replace function public.admin_save_projet(p_token text, p_projet jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_ages int[];
begin
  if not public._is_admin(p_token) then return json_build_object('ok', false, 'error', 'admin'); end if;
  select array_agg(x::int) into v_ages
    from jsonb_array_elements_text(coalesce(p_projet->'agesEssai', '[7,28]'::jsonb)) x;
  insert into public.projets(code_projet, client_id, nom_projet, localisation, resistance_mpa,
                             conversion_defaut, facteur_conversion, reference_commande,
                             reference_dossier, ages_essai, notes, labo, actif, updated_at)
    values (upper(p_projet->>'codeProjet'), coalesce(p_projet->>'clientId',''),
            coalesce(p_projet->>'nomProjet',''), coalesce(p_projet->>'localisation',''),
            coalesce(p_projet->>'resistanceMpa',''), coalesce(p_projet->>'conversionDefaut',''),
            coalesce(p_projet->>'facteurConversion',''), coalesce(p_projet->>'referenceCommande',''),
            coalesce(p_projet->>'referenceDossier',''), coalesce(v_ages, '{7,28}'::int[]),
            coalesce(p_projet->>'notes',''), coalesce(p_projet->>'labo',''),
            coalesce((p_projet->>'actif')::boolean, true), now())
  on conflict (code_projet) do update set
    client_id = excluded.client_id, nom_projet = excluded.nom_projet,
    localisation = excluded.localisation, resistance_mpa = excluded.resistance_mpa,
    conversion_defaut = excluded.conversion_defaut, facteur_conversion = excluded.facteur_conversion,
    reference_commande = excluded.reference_commande, reference_dossier = excluded.reference_dossier,
    ages_essai = excluded.ages_essai, notes = excluded.notes,
    labo = case when p_projet ? 'labo' then excluded.labo else public.projets.labo end,
    actif = excluded.actif, updated_at = now();
  return json_build_object('ok', true);
end; $$;

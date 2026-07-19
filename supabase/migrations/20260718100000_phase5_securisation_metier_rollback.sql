-- Rollback Phase 5. Les événements/audits métier déjà produits sont conservés.
drop function if exists public.op_add_evacuation_v2(text,uuid,int,text,text);
drop function if exists public.op_get_dechets_state(text,uuid);
drop function if exists public.admin_set_labo_settings(text,uuid,jsonb,text);
drop function if exists public.op_get_labo_settings(text,uuid);

-- Restaure la voie historique d'évacuation des anciens clients.
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

drop index if exists public.idx_evacuations_request;
alter table public.evacuations drop column if exists request_id;
alter table public.labos drop column if exists echant_tranche_suivante_nb;
alter table public.labos drop column if exists echant_tranche_suivante_m3;
alter table public.labos drop column if exists echant_premiere_tranche_nb;
alter table public.labos drop column if exists echant_premiere_tranche_m3;
alter table public.labos drop column if exists dechets_poids_moyen;

-- Les fonctions admin_valider_coulage, op_coulage_event, admin_list_labos et
-- admin_upsert_labo doivent être restaurées par réapplication des migrations
-- de leur phase d'origine après ce rollback.

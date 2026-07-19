-- ============================================================================
-- Alerte coulage (BF-001) — planification et accusé de réception
--
-- Un responsable / ingénieur annonce un coulage à venir ; les opérateurs du
-- laboratoire déduit du projet sont notifiés et l'un d'eux « prend en charge »
-- (accusé de réception). Si personne n'a pris en charge 1 h avant l'heure
-- prévue, le créateur reçoit UNE alerte, qui reste ensuite visible dans son
-- application tant que l'alerte n'est pas prise en charge.
--
-- INDÉPENDANCE ABSOLUE : cette migration n'écrit JAMAIS dans coulages, lots
-- ou prelevements, et ne les lit pas. Une alerte ne préremplit aucune fiche.
--
-- Dépendances : supabase_schema.sql (_op_by_token, _is_admin, _admin_can,
-- labos, projets, operators), phase 2 (_op_role), phase 5 (colonnes
-- d'échantillonnage par labo), supabase_notifications.sql (_enqueue_notif).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (A) TABLE
--     prevu_at est un timestamptz : instant non ambigu, converti par le client
--     depuis la date + l'heure locales saisies.
--     ouvrage_key stocke la CLÉ du référentiel (semelle, radier, poteau…) et
--     jamais le libellé : l'affichage suit ainsi la langue FR/AR du lecteur.
-- ---------------------------------------------------------------------------
create table if not exists public.alertes_coulage (
  id                 uuid primary key default gen_random_uuid(),
  labo_id            uuid not null references public.labos(id),
  code_projet        text references public.projets(code_projet),
  client_id          text default '',
  ouvrage_key        text default '',        -- clé du référentiel ouvrages
  ouvrage_autre      text default '',        -- si « Autres (ouvrage non listé) »
  bloc               text default '',
  etage              text default '',        -- clé de la déroulante étages
  prevu_at           timestamptz not null,
  quantite_m3        numeric not null check (quantite_m3 > 0),
  moules_calcules    int not null default 0, -- figé côté serveur, jamais saisi
  urgent             boolean not null default false,
  demandeur_nom      text default '',
  demandeur_fonction text default '',
  observations       text default '',
  statut             text not null default 'a_prendre_en_charge'
                     check (statut in ('a_prendre_en_charge','prise_en_charge',
                                       'reportee','annulee','terminee')),
  cree_par           uuid references public.operators(id),
  cree_par_nom       text default '',
  prise_par          uuid references public.operators(id),
  prise_par_nom      text default '',
  prise_at           timestamptz,
  alerte_envoyee_at  timestamptz,            -- garde anti-répétition (1 seule)
  alerte_vue_at      timestamptz,            -- acquittement du responsable
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create index if not exists idx_alertes_labo on public.alertes_coulage(labo_id, statut);
create index if not exists idx_alertes_relance on public.alertes_coulage(prevu_at)
  where alerte_envoyee_at is null and prise_par is null;

-- Service_role uniquement : tout passe par les RPC security definer.
alter table public.alertes_coulage enable row level security;

-- ---------------------------------------------------------------------------
-- (B) CALCUL DES MOULES
--     Réplique exacte de CAEKModel.recommendationEprouvettes (js/model.js) :
--     nb de la première tranche, puis nb par tranche suivante entamée.
--     La règle appartient au laboratoire (colonnes ajoutées en phase 5).
-- ---------------------------------------------------------------------------
create or replace function public._moules_pour(p_labo uuid, p_quantite numeric)
returns int language plpgsql stable security definer set search_path = public as $$
declare b public.labos; total numeric;
begin
  if p_quantite is null or p_quantite <= 0 then return 0; end if;
  select * into b from public.labos where id = p_labo;
  if not found then return 0; end if;
  total := b.echant_premiere_tranche_nb;
  if p_quantite > b.echant_premiere_tranche_m3 then
    total := total + ceil((p_quantite - b.echant_premiere_tranche_m3)
                          / b.echant_tranche_suivante_m3) * b.echant_tranche_suivante_nb;
  end if;
  return greatest(0, round(total)::int);
end; $$;

-- Qui peut créer / modifier une alerte : responsable, ingénieur ou admin.
create or replace function public._peut_planifier(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.is_admin is true
        or public._op_role(r) in ('engineer','responsable','principal_admin')
    from public._op_by_token(p_token) r), false);
$$;

-- Sérialisation commune (clés camelCase, comme le reste des RPC).
create or replace function public._alerte_json(a public.alertes_coulage)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', a.id, 'laboId', a.labo_id,
    'laboNom', (select nom from public.labos where id = a.labo_id),
    'codeProjet', a.code_projet, 'clientId', a.client_id,
    'clientNom', (select nom from public.clients where client_id = a.client_id),
    'ouvrageKey', a.ouvrage_key, 'ouvrageAutre', a.ouvrage_autre,
    'bloc', a.bloc, 'etage', a.etage,
    'prevuAt', a.prevu_at, 'quantiteM3', a.quantite_m3,
    'moulesCalcules', a.moules_calcules, 'urgent', a.urgent,
    'demandeurNom', a.demandeur_nom, 'demandeurFonction', a.demandeur_fonction,
    'observations', a.observations, 'statut', a.statut,
    'creePar', a.cree_par, 'creeParNom', a.cree_par_nom,
    'prisePar', a.prise_par, 'priseParNom', a.prise_par_nom, 'priseAt', a.prise_at,
    'alerteEnvoyeeAt', a.alerte_envoyee_at, 'alerteVueAt', a.alerte_vue_at,
    'createdAt', a.created_at, 'updatedAt', a.updated_at);
$$;

-- ---------------------------------------------------------------------------
-- (C) LISTE — scoping serveur strict, calqué sur op_list_lots.
--     Un opérateur ne voit que SON labo ; un admin voit ses labos autorisés.
-- ---------------------------------------------------------------------------
create or replace function public.op_list_alertes_coulage(
  p_token text, p_labo uuid default null, p_historique boolean default false)
returns json language plpgsql stable security definer set search_path = public as $$
declare r public.operators; v_statuts text[];
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  v_statuts := case when coalesce(p_historique, false)
                    then array['annulee','terminee']
                    else array['a_prendre_en_charge','prise_en_charge','reportee'] end;

  if r.is_admin then
    return json_build_object('ok', true, 'alertes', coalesce((
      select json_agg(public._alerte_json(a) order by a.urgent desc, a.prevu_at)
      from public.alertes_coulage a
      where a.statut = any(v_statuts)
        and (r.admin_labos is null or cardinality(r.admin_labos) = 0
             or a.labo_id = any(r.admin_labos))
        and (p_labo is null or a.labo_id = p_labo)), '[]'::json));
  end if;

  if r.labo_id is null then
    return json_build_object('ok', true, 'alertes', '[]'::json);
  end if;
  return json_build_object('ok', true, 'alertes', coalesce((
    select json_agg(public._alerte_json(a) order by a.urgent desc, a.prevu_at)
    from public.alertes_coulage a
    where a.labo_id = r.labo_id and a.statut = any(v_statuts)), '[]'::json));
end; $$;

-- ---------------------------------------------------------------------------
-- (D) CRÉATION — le laboratoire est TOUJOURS déduit du projet, jamais reçu
--     du client. La quantité de moules est calculée et figée ici.
-- ---------------------------------------------------------------------------
create or replace function public.resp_create_alerte_coulage(p_token text, p_alerte jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; v_labo uuid; v_code text; v_prevu timestamptz;
        v_qte numeric; a public.alertes_coulage;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if not public._peut_planifier(p_token) then
    return json_build_object('ok', false, 'error', 'role');
  end if;

  v_code := upper(trim(coalesce(p_alerte->>'codeProjet', '')));
  if v_code = '' then return json_build_object('ok', false, 'error', 'projet_requis'); end if;
  select labo_id into v_labo from public.projets where code_projet = v_code;
  if v_labo is null then return json_build_object('ok', false, 'error', 'projet_sans_labo'); end if;

  -- Droit d'agir sur CE laboratoire.
  if r.is_admin then
    if not public._admin_can(p_token, v_labo) then
      return json_build_object('ok', false, 'error', 'autre_labo');
    end if;
  elsif r.labo_id is distinct from v_labo then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;

  v_prevu := (p_alerte->>'prevuAt')::timestamptz;
  if v_prevu is null then return json_build_object('ok', false, 'error', 'date_requise'); end if;
  v_qte := (p_alerte->>'quantiteM3')::numeric;
  if v_qte is null or v_qte <= 0 then return json_build_object('ok', false, 'error', 'quantite'); end if;

  insert into public.alertes_coulage(
    labo_id, code_projet, client_id, ouvrage_key, ouvrage_autre, bloc, etage,
    prevu_at, quantite_m3, moules_calcules, urgent,
    demandeur_nom, demandeur_fonction, observations, cree_par, cree_par_nom)
  values (
    v_labo, v_code,
    coalesce(p_alerte->>'clientId',''),
    coalesce(p_alerte->>'ouvrageKey',''),
    coalesce(p_alerte->>'ouvrageAutre',''),
    coalesce(p_alerte->>'bloc',''),
    coalesce(p_alerte->>'etage',''),
    v_prevu, v_qte, public._moules_pour(v_labo, v_qte),
    coalesce((p_alerte->>'urgent')::boolean, false),
    coalesce(p_alerte->>'demandeurNom',''),
    coalesce(p_alerte->>'demandeurFonction',''),
    coalesce(p_alerte->>'observations',''),
    r.id, r.nom)
  returning * into a;

  -- Notification immédiate aux opérateurs du laboratoire concerné.
  perform public._enqueue_notif(
    'labo:' || a.labo_id,
    case when a.urgent then 'URGENT — coulage annoncé' else 'Coulage annoncé' end,
    'Projet ' || a.code_projet || ' — ' || to_char(a.prevu_at, 'DD/MM à HH24:MI') ||
      ' — ' || a.quantite_m3 || ' m³, ' || a.moules_calcules || ' moules à préparer.',
    '/#screen-alertes-coulage',
    'alerte-new-' || a.id);

  return json_build_object('ok', true, 'alerte', public._alerte_json(a));
end; $$;

-- ---------------------------------------------------------------------------
-- (E) MODIFICATION / REPORT / ANNULATION / FIN
--     Report d'une alerte DÉJÀ prise en charge : l'opérateur reste affecté
--     (nom et heure conservés, statut inchangé), conformément au cadrage.
--     Tout changement de date remet alerte_envoyee_at à NULL afin que la
--     relance « 1 h avant » puisse se déclencher sur la nouvelle échéance.
-- ---------------------------------------------------------------------------
create or replace function public.resp_update_alerte_coulage(
  p_token text, p_id uuid, p_alerte jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; a public.alertes_coulage; v_statut text;
        v_prevu timestamptz; v_qte numeric; v_date_changee boolean := false;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  if not public._peut_planifier(p_token) then
    return json_build_object('ok', false, 'error', 'role');
  end if;

  select * into a from public.alertes_coulage where id = p_id for update;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;

  if r.is_admin then
    if not public._admin_can(p_token, a.labo_id) then
      return json_build_object('ok', false, 'error', 'autre_labo');
    end if;
  elsif r.labo_id is distinct from a.labo_id then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;

  if a.statut in ('annulee','terminee') then
    return json_build_object('ok', false, 'error', 'alerte_close');
  end if;

  v_statut := nullif(trim(coalesce(p_alerte->>'statut','')), '');
  if v_statut is not null and v_statut not in
     ('a_prendre_en_charge','prise_en_charge','reportee','annulee','terminee') then
    return json_build_object('ok', false, 'error', 'statut');
  end if;

  v_prevu := (p_alerte->>'prevuAt')::timestamptz;
  if v_prevu is not null and v_prevu is distinct from a.prevu_at then
    v_date_changee := true;
  end if;

  v_qte := (p_alerte->>'quantiteM3')::numeric;
  if v_qte is not null and v_qte <= 0 then
    return json_build_object('ok', false, 'error', 'quantite');
  end if;

  update public.alertes_coulage set
    code_projet        = coalesce(p_alerte->>'codeProjet', code_projet),
    client_id          = coalesce(p_alerte->>'clientId', client_id),
    ouvrage_key        = coalesce(p_alerte->>'ouvrageKey', ouvrage_key),
    ouvrage_autre      = coalesce(p_alerte->>'ouvrageAutre', ouvrage_autre),
    bloc               = coalesce(p_alerte->>'bloc', bloc),
    etage              = coalesce(p_alerte->>'etage', etage),
    prevu_at           = coalesce(v_prevu, prevu_at),
    quantite_m3        = coalesce(v_qte, quantite_m3),
    -- Recalcul serveur dès que la quantité bouge.
    moules_calcules    = case when v_qte is not null
                              then public._moules_pour(labo_id, v_qte)
                              else moules_calcules end,
    urgent             = coalesce((p_alerte->>'urgent')::boolean, urgent),
    demandeur_nom      = coalesce(p_alerte->>'demandeurNom', demandeur_nom),
    demandeur_fonction = coalesce(p_alerte->>'demandeurFonction', demandeur_fonction),
    observations       = coalesce(p_alerte->>'observations', observations),
    -- Report : si déjà prise en charge, l'affectation et le statut sont
    -- conservés ; sinon l'alerte passe à 'reportee' et reste active.
    statut             = case
                           when v_statut is not null then v_statut
                           when v_date_changee and prise_par is null then 'reportee'
                           else statut end,
    -- Nouvelle échéance => la relance redevient possible une fois.
    alerte_envoyee_at  = case when v_date_changee then null else alerte_envoyee_at end,
    updated_at         = now()
  where id = p_id
  returning * into a;

  -- L'équipe est avertie du report comme de l'annulation.
  if v_date_changee or a.statut in ('reportee','annulee') then
    perform public._enqueue_notif(
      'labo:' || a.labo_id,
      case when a.statut = 'annulee' then 'Coulage annulé' else 'Coulage reporté' end,
      'Projet ' || a.code_projet || ' — ' ||
        case when a.statut = 'annulee' then 'annulé.'
             else 'reporté au ' || to_char(a.prevu_at, 'DD/MM à HH24:MI') || '.' end,
      '/#screen-alertes-coulage',
      'alerte-maj-' || a.id || '-' || to_char(now(), 'YYYYMMDDHH24MI'));
  end if;

  return json_build_object('ok', true, 'alerte', public._alerte_json(a));
end; $$;

-- ---------------------------------------------------------------------------
-- (F) PRISE EN CHARGE — transition ATOMIQUE.
--     Le « where prise_par is null » garantit qu'un seul opérateur gagne ;
--     le perdant reçoit un résultat explicite avec le nom du gagnant.
-- ---------------------------------------------------------------------------
create or replace function public.op_prendre_en_charge_alerte(p_token text, p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; a public.alertes_coulage; v_labo uuid; v_nom text;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;

  select labo_id into v_labo from public.alertes_coulage where id = p_id;
  if v_labo is null then return json_build_object('ok', false, 'error', 'introuvable'); end if;

  -- Cloisonnement : seuls les opérateurs du labo (ou un admin habilité).
  if r.is_admin then
    if not public._admin_can(p_token, v_labo) then
      return json_build_object('ok', false, 'error', 'autre_labo');
    end if;
  elsif r.labo_id is distinct from v_labo then
    return json_build_object('ok', false, 'error', 'autre_labo');
  end if;

  update public.alertes_coulage set
    statut = 'prise_en_charge', prise_par = r.id, prise_par_nom = r.nom,
    prise_at = now(), updated_at = now()
  where id = p_id and prise_par is null
    and statut in ('a_prendre_en_charge','reportee')
  returning * into a;

  if a.id is null then
    select prise_par_nom into v_nom from public.alertes_coulage where id = p_id;
    return json_build_object('ok', false, 'error', 'deja_prise', 'priseParNom', coalesce(v_nom,''));
  end if;

  return json_build_object('ok', true, 'alerte', public._alerte_json(a));
end; $$;

-- ---------------------------------------------------------------------------
-- (G) ACQUITTEMENT de l'alerte de non-prise-en-charge par le responsable.
-- ---------------------------------------------------------------------------
create or replace function public.resp_ack_alerte_coulage(p_token text, p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare r public.operators; a public.alertes_coulage;
begin
  r := public._op_by_token(p_token);
  if r.id is null then return json_build_object('ok', false, 'error', 'auth'); end if;
  select * into a from public.alertes_coulage where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'introuvable'); end if;
  if a.cree_par is distinct from r.id and not public._admin_can(p_token, a.labo_id) then
    return json_build_object('ok', false, 'error', 'droit');
  end if;
  update public.alertes_coulage set alerte_vue_at = now(), updated_at = now()
    where id = p_id returning * into a;
  return json_build_object('ok', true, 'alerte', public._alerte_json(a));
end; $$;

-- ---------------------------------------------------------------------------
-- (H) RELANCE — appelée par le cron 'caek-send-push' (toutes les 2 min).
--     UNE seule notification par alerte, 1 h avant l'heure prévue.
--     alerte_envoyee_at sert de garde : pas de répétition. La fenêtre basse
--     (-12 h) permet de rattraper une alerte si le cron a été interrompu,
--     sans réveiller d'anciennes échéances.
--     L'alerte reste ensuite visible dans l'application du responsable tant
--     que prise_par est NULL : c'est le second filet, indépendant du réseau
--     du téléphone.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_alertes_coulage()
returns json language plpgsql security definer set search_path = public as $$
declare a record; n int := 0;
begin
  for a in
    select * from public.alertes_coulage
     where statut in ('a_prendre_en_charge','reportee')
       and prise_par is null
       and alerte_envoyee_at is null
       and cree_par is not null
       and prevu_at <= now() + interval '1 hour'
       and prevu_at >= now() - interval '12 hours'
  loop
    perform public._enqueue_notif(
      'operateur:' || a.cree_par,
      'Aucun opérateur n''a pris en charge',
      'Coulage ' || a.code_projet || ' prévu ' || to_char(a.prevu_at, 'DD/MM à HH24:MI') ||
        ' : personne n''a accusé réception.',
      '/#screen-alertes-coulage',
      'alerte-nonprise-' || a.id);
    update public.alertes_coulage set alerte_envoyee_at = now() where id = a.id;
    n := n + 1;
  end loop;
  return json_build_object('ok', true, 'enqueued', n);
end; $$;

-- ---------------------------------------------------------------------------
-- (I) DROITS D'EXÉCUTION (même patron que les phases précédentes).
-- ---------------------------------------------------------------------------
revoke all on function public.op_list_alertes_coulage(text,uuid,boolean) from public;
revoke all on function public.resp_create_alerte_coulage(text,jsonb) from public;
revoke all on function public.resp_update_alerte_coulage(text,uuid,jsonb) from public;
revoke all on function public.op_prendre_en_charge_alerte(text,uuid) from public;
revoke all on function public.resp_ack_alerte_coulage(text,uuid) from public;
revoke all on function public.enqueue_alertes_coulage() from public;

grant execute on function public.op_list_alertes_coulage(text,uuid,boolean) to anon, authenticated;
grant execute on function public.resp_create_alerte_coulage(text,jsonb) to anon, authenticated;
grant execute on function public.resp_update_alerte_coulage(text,uuid,jsonb) to anon, authenticated;
grant execute on function public.op_prendre_en_charge_alerte(text,uuid) to anon, authenticated;
grant execute on function public.resp_ack_alerte_coulage(text,uuid) to anon, authenticated;

-- FIN ------------------------------------------------------------------------
-- Suite à faire en mise en service :
--   1. Redéployer l'Edge Function send-push (nouvelle cible 'operateur:<uuid>').
--   2. Planifier la relance à la même cadence que l'envoi :
--      select cron.schedule('caek-alertes-coulage', '*/2 * * * *',
--        $$ select public.enqueue_alertes_coulage(); $$);

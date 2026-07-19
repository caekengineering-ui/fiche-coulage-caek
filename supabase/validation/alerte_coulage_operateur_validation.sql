-- ============================================================================
--  Script de VALIDATION FONCTIONNELLE — Alerte coulage, autonomie opérateur.
--
--  Objet : exercer les RPC de 20260719140000_alerte_coulage_operateur.sql :
--    C1  un opérateur qui n'est PAS en charge ne peut pas clore l'alerte ;
--    C2  l'opérateur EN CHARGE peut la terminer ;
--    C3  un report sans nouvelle date est refusé ;
--    C4  un report valide change la date, garde l'affectation (l'opérateur
--        reste responsable du suivi) et rouvre la relance ;
--    C5  le responsable créateur est notifié de la prise en charge ET de
--        chaque changement de statut, nominativement ;
--    C6  la liste expose prisParMoi, vrai pour l'opérateur en charge et faux
--        pour ses collègues ;
--    C7  une alerte close ne peut plus être modifiée.
--
--  Sécurité d'exécution : TOUT tourne dans UNE transaction terminée par
--  ROLLBACK — aucune donnée n'est persistée, aucune donnée réelle touchée.
--  Peut donc être lancé sur la base réelle sans risque.
-- ============================================================================

begin;

do $$
declare
  v_labo  uuid;
  v_code  text := '__VALID_ACO__P1';
  v_res   json;
  v_id    uuid;
  v_resp  uuid;
  v_notif int;
  v_a     public.alertes_coulage;
begin
  -- ---- Fixtures (sentinelles, préfixe __VALID_ACO__) ---------------------
  insert into public.labos(nom) values ('__VALID_ACO__labo') returning id into v_labo;

  insert into public.operators(identifiant, pin_hash, nom, is_admin, labo_id, role, token, actif)
  values ('__vaco_resp', 'x', 'Responsable ACO', false, v_labo, 'responsable', 'tok_aco_resp', true),
         ('__vaco_op1',  'x', 'Karim ACO',       false, v_labo, 'operator',    'tok_aco_op1',  true),
         ('__vaco_op2',  'x', 'Collegue ACO',    false, v_labo, 'operator',    'tok_aco_op2',  true);
  select id into v_resp from public.operators where identifiant = '__vaco_resp';

  insert into public.projets(code_projet, nom_projet, labo_id)
  values (v_code, '__VALID_ACO__ Projet', v_labo);

  v_res := public.resp_create_alerte_coulage('tok_aco_resp', jsonb_build_object(
    'codeProjet', v_code, 'prevuAt', now() + interval '6 hours', 'quantiteM3', 60,
    'ouvrageKey', 'dalle'));
  assert (v_res->>'ok')::boolean, 'fixture : création alerte';
  v_id := (v_res->'alerte'->>'id')::uuid;

  -- ======================================================================
  -- C1 : un opérateur NON en charge ne peut pas clore
  -- ======================================================================
  v_res := public.op_statut_alerte_coulage('tok_aco_op1', v_id, 'terminee');
  assert (v_res->>'error') = 'pas_en_charge',
    'C1 attendu pas_en_charge, obtenu: '||coalesce(v_res::text,'null');
  raise notice 'C1 OK : opérateur non en charge refusé (%).', v_res->>'error';

  -- ======================================================================
  -- C5a : la prise en charge notifie le responsable créateur, nominativement
  -- ======================================================================
  v_res := public.op_prendre_en_charge_alerte('tok_aco_op1', v_id);
  assert (v_res->>'ok')::boolean, 'C5a prise en charge doit réussir';

  select count(*) into v_notif from public.notifications
   where cible = 'operateur:'||v_resp and corps like 'Karim ACO a pris en charge%';
  assert v_notif = 1, 'C5a le créateur doit être notifié nominativement de la prise en charge';
  raise notice 'C5a OK : responsable notifié de la prise en charge.';

  -- ======================================================================
  -- C6 : prisParMoi vrai pour celui qui a pris, faux pour le collègue
  -- ======================================================================
  v_res := public.op_list_alertes_coulage('tok_aco_op1');
  assert (v_res->'alertes'->0->>'prisParMoi')::boolean,
    'C6 prisParMoi doit être vrai pour l''opérateur en charge';
  v_res := public.op_list_alertes_coulage('tok_aco_op2');
  assert not (v_res->'alertes'->0->>'prisParMoi')::boolean,
    'C6 prisParMoi doit être faux pour le collègue';
  raise notice 'C6 OK : prisParMoi distingue bien l''opérateur en charge.';

  -- ======================================================================
  -- C3 : report sans date -> refusé
  -- ======================================================================
  v_res := public.op_statut_alerte_coulage('tok_aco_op1', v_id, 'reportee', null);
  assert (v_res->>'error') = 'date_requise',
    'C3 attendu date_requise, obtenu: '||coalesce(v_res::text,'null');
  raise notice 'C3 OK : report sans date refusé.';

  -- ======================================================================
  -- C4 : report valide -> nouvelle date, affectation CONSERVÉE, relance rouverte
  -- ======================================================================
  v_res := public.op_statut_alerte_coulage(
    'tok_aco_op1', v_id, 'reportee', now() + interval '3 days');
  assert (v_res->>'ok')::boolean, 'C4 report doit réussir: '||coalesce(v_res::text,'null');
  assert (v_res->'alerte'->>'statut') = 'reportee', 'C4 statut doit passer à reportee';
  assert (v_res->'alerte'->>'prisePar') is not null,
    'C4 l''opérateur doit rester affecté après un report';

  select * into v_a from public.alertes_coulage where id = v_id;
  assert v_a.alerte_envoyee_at is null, 'C4 la relance doit être rouverte sur la nouvelle échéance';
  assert v_a.prevu_at > now() + interval '2 days', 'C4 la date doit avoir été repoussée';
  raise notice 'C4 OK : report conserve l''affectation et repousse l''échéance.';

  -- ======================================================================
  -- C5b : le report notifie aussi le responsable
  -- ======================================================================
  select count(*) into v_notif from public.notifications
   where cible = 'operateur:'||v_resp and corps like 'Karim ACO a reporté%';
  assert v_notif = 1, 'C5b le créateur doit être notifié du report';
  raise notice 'C5b OK : responsable notifié du report.';

  -- ======================================================================
  -- C2 : l'opérateur en charge termine son intervention
  -- ======================================================================
  v_res := public.op_statut_alerte_coulage('tok_aco_op1', v_id, 'terminee');
  assert (v_res->>'ok')::boolean, 'C2 clôture doit réussir: '||coalesce(v_res::text,'null');
  assert (v_res->'alerte'->>'statut') = 'terminee', 'C2 statut doit passer à terminee';
  raise notice 'C2 OK : opérateur en charge peut terminer.';

  -- L'alerte terminée quitte la liste active et rejoint l'historique.
  v_res := public.op_list_alertes_coulage('tok_aco_op1');
  assert json_array_length(v_res->'alertes') = 0, 'C2 une alerte terminée quitte la liste active';
  v_res := public.op_list_alertes_coulage('tok_aco_op1', null, true);
  assert json_array_length(v_res->'alertes') = 1, 'C2 elle doit apparaître dans l''historique';
  raise notice 'C2 OK : terminée -> hors liste active, présente en historique.';

  -- ======================================================================
  -- C7 : une alerte close n'est plus modifiable
  -- ======================================================================
  v_res := public.op_statut_alerte_coulage('tok_aco_op1', v_id, 'annulee');
  assert (v_res->>'error') = 'alerte_close',
    'C7 attendu alerte_close, obtenu: '||coalesce(v_res::text,'null');
  v_res := public.resp_update_alerte_coulage('tok_aco_resp', v_id,
    jsonb_build_object('quantiteM3', 99));
  assert (v_res->>'error') = 'alerte_close', 'C7 le responsable non plus ne peut rouvrir';
  raise notice 'C7 OK : alerte close verrouillée pour tous.';

  raise notice '===== AUTONOMIE OPÉRATEUR : TOUTES LES VALIDATIONS OK =====';
end $$;

rollback;
-- Fin : ROLLBACK ci-dessus => aucune donnée persistée.

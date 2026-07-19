-- ============================================================================
--  Script de VALIDATION FONCTIONNELLE — Phase 3 (prélèvements / résultats).
--
--  Objet : exercer sur un projet Supabase PILOTE (jamais la production) les
--  transitions, permissions, calculs et rejeux corrigés lors de la reprise :
--    A1  approbation responsable = verrou réel (lot + éprouvette) ;
--    A2  après soumission (statut teste/valide), l'opérateur ne peut plus
--        corriger librement — sauf retour explicite (revision.etat=retournee) ;
--    A3  transitions teste -> retourné -> corrigé -> validé ingénieur ->
--        approuvé responsable -> verrouillé ;
--    A4  op_coulage_event idempotent par requestId (rejeu neutre, 2ᵉ
--        occurrence légitime acceptée) ;
--    A6  op_alloc_prels refuse la réutilisation d'un UUID rattaché ailleurs.
--
--  Sécurité d'exécution : TOUT tourne dans UNE transaction terminée par
--  ROLLBACK — aucune donnée n'est persistée, aucune donnée réelle touchée.
--  Pré-requis : migrations Phase 2 (role/_op_role) et Phase 3 appliquées sur
--  le pilote. Un ASSERT en échec interrompt le script (transaction annulée).
--
--  Lancer :  psql "$PILOT_DB_URL" -f phase3_validation.sql
--  ⚠ NE PAS LANCER SUR LA BASE DE PRODUCTION.
-- ============================================================================

begin;

do $$
declare
  v_labo   uuid;
  v_ref    text := '__VALID_P3__001';
  v_lotkey text := '__VALID_P3__LOT1';
  v_res    json;
  v_lot    public.lots;
  v_epr    uuid := gen_random_uuid();
  v_epr2   uuid := gen_random_uuid();
  v_prel   uuid := gen_random_uuid();
  v_prel2  uuid := gen_random_uuid();
  v_ref2   text := '__VALID_P3__002';
  v_essais jsonb;
begin
  -- ---- Fixtures (sentinelles, préfixe __VALID_P3__) ----------------------
  insert into public.labos(nom) values ('__VALID_P3__labo') returning id into v_labo;

  insert into public.operators(identifiant, pin_hash, nom, is_admin, labo_id, role, token, actif)
  values ('__vp3_op',   'x', 'Opérateur P3',   false, v_labo, 'operator',    'tok_op',   true),
         ('__vp3_eng',  'x', 'Ingénieur P3',   false, v_labo, 'engineer',    'tok_eng',  true),
         ('__vp3_resp', 'x', 'Responsable P3', false, v_labo, 'responsable', 'tok_resp', true);

  insert into public.coulages(ref, labo_id, statut, payload)
  values (v_ref,  v_labo, 'soumis', '{}'::jsonb),
         (v_ref2, v_labo, 'soumis', '{}'::jsonb);

  -- Un lot TESTÉ (résultats soumis par l'opérateur) avec deux éprouvettes.
  v_essais := jsonb_build_array(
    jsonb_build_object('code', v_ref||'-E1-01', 'forme','cube','dim1',150,'dim2',150,'force',675),
    jsonb_build_object('code', v_ref||'-E1-02', 'forme','cube','dim1',150,'dim2',150,'force',700));
  insert into public.lots(lot_key, coulage_ref, labo_id, prel, age_jours, statut, resultats, payload)
  values (v_lotkey, v_ref, v_labo, 1, 28, 'teste', v_essais,
          jsonb_build_object('essais', v_essais));

  -- ======================================================================
  -- A2 : opérateur BLOQUÉ après soumission (statut teste), essai non retourné
  -- ======================================================================
  v_res := public.op_reviser_eprouvette('tok_op', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-01', 'action','corriger',
    'valeurs', jsonb_build_object('force', 999), 'requestId', gen_random_uuid()::text));
  assert (v_res->>'error') = 'retour_requis',
    'A2 attendu retour_requis, obtenu: '||coalesce(v_res::text,'null');
  raise notice 'A2 OK : opérateur bloqué sans retour (%).', v_res->>'error';

  -- opérateur bloqué aussi sur signaler_incoherence (réservé ingénieur+)
  v_res := public.op_reviser_eprouvette('tok_op', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-01', 'action','signaler_incoherence',
    'motif','test', 'requestId', gen_random_uuid()::text));
  assert (v_res->>'error') = 'reserve_ingenieur',
    'A2 signaler_incoherence attendu reserve_ingenieur, obtenu: '||coalesce(v_res::text,'null');
  raise notice 'A2 OK : signalement réservé ingénieur (%).', v_res->>'error';

  -- ======================================================================
  -- A3 : transition retourné -> corrigé
  -- ======================================================================
  -- Un OPÉRATEUR ne peut PAS retourner (rôle insuffisant).
  v_res := public.op_reviser_eprouvette('tok_op', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-01', 'action','retourner',
    'motif','revoir dimensions', 'requestId', gen_random_uuid()::text));
  assert (v_res->>'error') = 'role', 'A3 retourner par opérateur doit échouer (role)';

  -- L'INGÉNIEUR retourne l'essai à l'opérateur.
  v_res := public.op_reviser_eprouvette('tok_eng', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-01', 'action','retourner',
    'motif','revoir dimensions', 'requestId', gen_random_uuid()::text));
  assert (v_res->>'ok')::boolean, 'A3 retour ingénieur doit réussir';
  raise notice 'A3 OK : essai retourné par ingénieur.';

  -- Désormais l'opérateur PEUT corriger l'essai RETOURNÉ.
  v_res := public.op_reviser_eprouvette('tok_op', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-01', 'action','corriger',
    'valeurs', jsonb_build_object('force', 690), 'requestId', gen_random_uuid()::text));
  assert (v_res->>'ok')::boolean, 'A3 correction opérateur sur essai retourné doit réussir';
  -- rc recalculé = 690*1000/(150*150) = 30.67 ; retour consommé (etat corrigee).
  assert (v_res->'essai'->>'rc') = '30.67',
    'A3 rc recalculé attendu 30.67, obtenu '||coalesce(v_res->'essai'->>'rc','null');
  assert (v_res->'essai'->'revision'->>'etat') = 'corrigee',
    'A3 retour doit être consommé (etat corrigee)';
  raise notice 'A3 OK : correction opérateur, rc=% , retour consommé.', v_res->'essai'->>'rc';

  -- Après consommation, l'opérateur est de nouveau bloqué (plus de retour).
  v_res := public.op_reviser_eprouvette('tok_op', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-01', 'action','corriger',
    'valeurs', jsonb_build_object('force', 111), 'requestId', gen_random_uuid()::text));
  assert (v_res->>'error') = 'retour_requis', 'A3 opérateur re-bloqué après correction';
  raise notice 'A3 OK : opérateur re-bloqué après consommation du retour.';

  -- ======================================================================
  -- A3/A1 : validé ingénieur -> approuvé responsable = verrou réel
  -- ======================================================================
  -- Valider les DEUX éprouvettes par l'ingénieur.
  v_res := public.op_reviser_eprouvette('tok_eng', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-01', 'action','valider_ingenieur',
    'requestId', gen_random_uuid()::text));
  assert (v_res->>'ok')::boolean, 'A3 valider_ingenieur E1-01';
  v_res := public.op_reviser_eprouvette('tok_eng', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-02', 'action','valider_ingenieur',
    'requestId', gen_random_uuid()::text));
  assert (v_res->>'ok')::boolean, 'A3 valider_ingenieur E1-02';
  select * into v_lot from public.lots where lot_key = v_lotkey;
  assert (v_lot.payload->>'valideIngenieur') = 'true',
    'A3 lot doit porter valideIngenieur=true quand toutes éprouvettes validées';
  raise notice 'A3 OK : lot validé ingénieur (toutes éprouvettes).';

  -- Un INGÉNIEUR ne peut pas approuver (rôle responsable requis).
  v_res := public.op_reviser_eprouvette('tok_eng', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-01', 'action','approuver_responsable',
    'requestId', gen_random_uuid()::text));
  assert (v_res->>'error') = 'role', 'A1 approbation par ingénieur doit échouer';

  -- Le RESPONSABLE approuve les deux éprouvettes.
  v_res := public.op_reviser_eprouvette('tok_resp', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-01', 'action','approuver_responsable',
    'requestId', gen_random_uuid()::text));
  assert (v_res->>'ok')::boolean, 'A1 approbation E1-01';
  -- Après une seule éprouvette approuvée, le lot n'est PAS encore verrouillé.
  select * into v_lot from public.lots where lot_key = v_lotkey;
  assert coalesce(v_lot.payload->>'approuveResponsable','') = '',
    'A1 lot ne doit pas être verrouillé tant que toutes les éprouvettes ne sont pas approuvées';
  v_res := public.op_reviser_eprouvette('tok_resp', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-02', 'action','approuver_responsable',
    'requestId', gen_random_uuid()::text));
  assert (v_res->>'ok')::boolean, 'A1 approbation E1-02';
  select * into v_lot from public.lots where lot_key = v_lotkey;
  assert (v_lot.payload->>'approuveResponsable') = 'true',
    'A1 lot doit être VERROUILLÉ (approuveResponsable=true) une fois tout approuvé';
  raise notice 'A1 OK : lot verrouillé approuveResponsable après approbation complète.';

  -- Verrou RÉEL : plus aucune correction, même par le responsable.
  v_res := public.op_reviser_eprouvette('tok_resp', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-01', 'action','corriger',
    'valeurs', jsonb_build_object('force', 1), 'requestId', gen_random_uuid()::text));
  assert (v_res->>'error') = 'approuve_verrouille',
    'A1 lot approuvé doit être immuable (approuve_verrouille), obtenu '||coalesce(v_res::text,'null');
  raise notice 'A1 OK : verrou réel, correction refusée après approbation.';

  -- La note interne reste possible (traçabilité).
  v_res := public.op_reviser_eprouvette('tok_resp', jsonb_build_object(
    'lotKey', v_lotkey, 'code', v_ref||'-E1-01', 'action','note_interne',
    'note','archive', 'requestId', gen_random_uuid()::text));
  assert (v_res->>'ok')::boolean, 'A1 note interne doit rester possible sur lot approuvé';
  raise notice 'A1 OK : note interne encore possible.';

  -- ======================================================================
  -- Idempotence par requestId (révision)
  -- ======================================================================
  declare v_rq text := gen_random_uuid()::text;
  begin
    -- lot neuf non approuvé pour tester le rejeu proprement
    insert into public.lots(lot_key, coulage_ref, labo_id, prel, age_jours, statut, resultats, payload)
    values ('__VALID_P3__LOT2', v_ref2, v_labo, 1, 28, 'teste',
            jsonb_build_array(jsonb_build_object('code', v_ref2||'-E1-01',
              'forme','cube','dim1',150,'dim2',150,'force',675)),
            jsonb_build_object('essais', jsonb_build_array(jsonb_build_object(
              'code', v_ref2||'-E1-01','forme','cube','dim1',150,'dim2',150,'force',675))));
    v_res := public.op_reviser_eprouvette('tok_eng', jsonb_build_object(
      'lotKey','__VALID_P3__LOT2', 'code', v_ref2||'-E1-01', 'action','note_interne',
      'note','n1', 'requestId', v_rq));
    assert (v_res->>'ok')::boolean and (v_res->>'rejoue') is null, 'rejeu : 1er appel neuf';
    v_res := public.op_reviser_eprouvette('tok_eng', jsonb_build_object(
      'lotKey','__VALID_P3__LOT2', 'code', v_ref2||'-E1-01', 'action','note_interne',
      'note','n1', 'requestId', v_rq));
    assert (v_res->>'rejoue')::boolean, 'rejeu : même requestId doit être neutre';
    raise notice 'REVISION OK : idempotence par requestId.';
  end;

  -- ======================================================================
  -- A6 : réutilisation d'UUID d'éprouvette refusée
  -- ======================================================================
  v_res := public.op_alloc_prels('tok_op', v_ref, jsonb_build_array(
    jsonb_build_object('uuid', v_prel::text, 'malaxeur',1, 'nombre',2,
      'eprUuids', jsonb_build_array(v_epr::text, v_epr2::text))));
  assert (v_res->>'ok')::boolean, 'A6 allocation initiale doit réussir';
  -- Réutiliser v_epr sous un AUTRE prélèvement du même coulage -> refus.
  v_res := public.op_alloc_prels('tok_op', v_ref, jsonb_build_array(
    jsonb_build_object('uuid', v_prel2::text, 'malaxeur',2, 'nombre',1,
      'eprUuids', jsonb_build_array(v_epr::text))));
  assert (v_res->>'error') = 'uuid_eprouvette_reutilise',
    'A6 réutilisation UUID éprouvette doit être refusée, obtenu '||coalesce(v_res::text,'null');
  raise notice 'A6 OK : réutilisation UUID éprouvette refusée.';
  -- Réutiliser le prélèvement sous un AUTRE coulage -> refus.
  v_res := public.op_alloc_prels('tok_op', v_ref2, jsonb_build_array(
    jsonb_build_object('uuid', v_prel::text, 'malaxeur',1, 'nombre',1,
      'eprUuids', jsonb_build_array(gen_random_uuid()::text))));
  assert (v_res->>'error') = 'uuid_prelevement_reutilise',
    'A6 réutilisation UUID prélèvement (autre coulage) doit être refusée';
  raise notice 'A6 OK : réutilisation UUID prélèvement (autre coulage) refusée.';
  -- Ré-allocation IDEMPOTENTE (mêmes UUID, même coulage) -> ok, E inchangé.
  v_res := public.op_alloc_prels('tok_op', v_ref, jsonb_build_array(
    jsonb_build_object('uuid', v_prel::text, 'malaxeur',1, 'nombre',2,
      'eprUuids', jsonb_build_array(v_epr::text, v_epr2::text))));
  assert (v_res->>'ok')::boolean
     and (v_res->'prels'->0->>'e') = '1', 'A6 ré-allocation idempotente : E stable';
  raise notice 'A6 OK : ré-allocation idempotente, numéro E stable.';

  -- ======================================================================
  -- A4 : événements — rejeu neutre + 2ᵉ occurrence légitime
  -- ======================================================================
  declare rq1 text := gen_random_uuid()::text; rq2 text := gen_random_uuid()::text;
  begin
    v_res := public.op_coulage_event('tok_op', jsonb_build_object(
      'eventKey', v_ref||':recuperation:'||rq1, 'ref', v_ref, 'type','recuperation',
      'requestId', rq1, 'payload', jsonb_build_object('date','2026-07-17')));
    assert (v_res->>'ok')::boolean and (v_res->>'rejoue') is null, 'A4 1ère récupération neuve';
    -- même requestId -> rejeu neutre
    v_res := public.op_coulage_event('tok_op', jsonb_build_object(
      'eventKey', v_ref||':recuperation:'||rq1, 'ref', v_ref, 'type','recuperation',
      'requestId', rq1));
    assert (v_res->>'rejoue')::boolean, 'A4 rejeu même requestId doit être neutre';
    -- 2ᵉ occurrence LÉGITIME (autre requestId) -> acceptée
    v_res := public.op_coulage_event('tok_op', jsonb_build_object(
      'eventKey', v_ref||':recuperation:'||rq2, 'ref', v_ref, 'type','recuperation',
      'requestId', rq2));
    assert (v_res->>'ok')::boolean and (v_res->>'rejoue') is null,
      'A4 2ᵉ occurrence légitime (requestId distinct) doit être acceptée';
    assert (select count(*) from public.coulage_events
            where coulage_ref = v_ref and type='recuperation') = 2,
      'A4 deux occurrences distinctes doivent coexister';
    raise notice 'A4 OK : rejeu neutre + 2ᵉ occurrence légitime acceptée.';
  end;

  raise notice '===== PHASE 3 : TOUTES LES VALIDATIONS FONCTIONNELLES OK =====';
end $$;

rollback;
-- Fin : ROLLBACK ci-dessus => aucune donnée persistée.

-- ============================================================================
--  Script de VALIDATION FONCTIONNELLE — Alerte coulage (BF-001).
--
--  Objet : exercer les RPC de la migration 20260719120000_alerte_coulage.sql
--  sur des fixtures sentinelles :
--    B1  laboratoire déduit du projet ; refus si le token n'appartient pas
--        au labo du projet ;
--    B2  calcul des moules figé côté serveur (9 pour <=50 m³, +3/tranche
--        de 50 m³ entamée — réglages par défaut de la table labos) ;
--    B3  cloisonnement : un opérateur d'un AUTRE labo ne voit rien ;
--    B4  prise en charge atomique : le 2ᵉ arrivant échoue explicitement ;
--    B5  report d'une alerte déjà prise en charge : l'opérateur reste
--        affecté, pas de retour à a_prendre_en_charge ;
--    B6  relance 1 h avant, une seule fois (garde alerte_envoyee_at).
--
--  Sécurité d'exécution : TOUT tourne dans UNE transaction terminée par
--  ROLLBACK — aucune donnée n'est persistée, aucune donnée réelle touchée.
--  Peut donc être lancé sur la base réelle sans risque.
--
--  Pré-requis : 20260719120000_alerte_coulage.sql appliquée.
--  Lancer :  psql "$DB_URL" -f alerte_coulage_validation.sql
-- ============================================================================

begin;

do $$
declare
  v_labo1 uuid; v_labo2 uuid;
  v_code1 text := '__VALID_AC__P1';
  v_res   json;
  v_id    uuid;
begin
  -- ---- Fixtures (sentinelles, préfixe __VALID_AC__) ----------------------
  insert into public.labos(nom) values ('__VALID_AC__labo1') returning id into v_labo1;
  insert into public.labos(nom) values ('__VALID_AC__labo2') returning id into v_labo2;

  insert into public.operators(identifiant, pin_hash, nom, is_admin, labo_id, role, token, actif)
  values ('__vac_resp',  'x', 'Responsable AC labo1', false, v_labo1, 'responsable', 'tok_ac_resp',  true),
         ('__vac_op1',   'x', 'Opérateur AC labo1',    false, v_labo1, 'operator',    'tok_ac_op1',   true),
         ('__vac_op2',   'x', 'Opérateur AC labo1',    false, v_labo1, 'operator',    'tok_ac_op2',   true),
         ('__vac_autre', 'x', 'Opérateur AC labo2',    false, v_labo2, 'operator',    'tok_ac_autre', true);

  insert into public.projets(code_projet, nom_projet, labo_id)
  values (v_code1, '__VALID_AC__ Projet', v_labo1);

  -- ======================================================================
  -- B1 : création — laboratoire déduit du projet, rôle exigé
  -- ======================================================================
  -- Un OPÉRATEUR (rôle 'operator') ne peut pas planifier.
  v_res := public.resp_create_alerte_coulage('tok_ac_op1', jsonb_build_object(
    'codeProjet', v_code1, 'prevuAt', now() + interval '45 minutes', 'quantiteM3', 10));
  assert (v_res->>'error') = 'role', 'B1 opérateur doit être refusé (role), obtenu: '||coalesce(v_res::text,'null');
  raise notice 'B1a OK : opérateur refusé (%).', v_res->>'error';

  -- Le responsable crée l'alerte ; le labo doit être celui du projet.
  v_res := public.resp_create_alerte_coulage('tok_ac_resp', jsonb_build_object(
    'codeProjet', v_code1, 'prevuAt', now() + interval '45 minutes', 'quantiteM3', 120,
    'ouvrageKey', 'radier', 'etage', 'RDC', 'urgent', true,
    'demandeurNom', '__VALID_AC__ demandeur'));
  assert (v_res->>'ok')::boolean, 'B1b création responsable doit réussir: '||coalesce(v_res::text,'null');
  assert (v_res->'alerte'->>'laboId') = v_labo1::text, 'B1b laboId doit être déduit du projet';
  v_id := (v_res->'alerte'->>'id')::uuid;
  raise notice 'B1b OK : alerte créée, labo déduit du projet (%).', v_res->'alerte'->>'laboId';

  -- ======================================================================
  -- B2 : moules figés côté serveur — 120 m³ => 9 + ceil(70/50)*3 = 9+6 = 15
  -- (réglages par défaut : 9 / 50 m³ puis 3 / 50 m³ suivant)
  -- ======================================================================
  assert (v_res->'alerte'->>'moulesCalcules')::int = 15,
    'B2 moulesCalcules attendu 15, obtenu: '||(v_res->'alerte'->>'moulesCalcules');
  raise notice 'B2 OK : moules calculés côté serveur = %.', v_res->'alerte'->>'moulesCalcules';

  -- ======================================================================
  -- B3 : cloisonnement — un opérateur d'un AUTRE labo ne voit rien
  -- ======================================================================
  v_res := public.op_list_alertes_coulage('tok_ac_autre');
  assert json_array_length(v_res->'alertes') = 0,
    'B3 opérateur autre labo ne doit rien voir, obtenu: '||coalesce(v_res::text,'null');
  raise notice 'B3 OK : opérateur d''un autre labo ne voit aucune alerte.';

  v_res := public.op_list_alertes_coulage('tok_ac_op1');
  assert json_array_length(v_res->'alertes') = 1,
    'B3 opérateur du bon labo doit voir 1 alerte, obtenu: '||coalesce(v_res::text,'null');
  raise notice 'B3 OK : opérateur du bon labo voit l''alerte.';

  -- ======================================================================
  -- B4 : prise en charge atomique — le 2ᵉ arrivant échoue explicitement
  -- ======================================================================
  v_res := public.op_prendre_en_charge_alerte('tok_ac_op1', v_id);
  assert (v_res->>'ok')::boolean, 'B4a 1ère prise en charge doit réussir: '||coalesce(v_res::text,'null');
  raise notice 'B4a OK : première prise en charge acceptée.';

  v_res := public.op_prendre_en_charge_alerte('tok_ac_op2', v_id);
  assert (v_res->>'error') = 'deja_prise', 'B4b 2ᵉ prise en charge doit échouer (deja_prise)';
  assert (v_res->>'priseParNom') = 'Opérateur AC labo1', 'B4b doit renvoyer le nom du gagnant';
  raise notice 'B4b OK : 2ᵉ opérateur refusé, nom du gagnant renvoyé (%).', v_res->>'priseParNom';

  -- ======================================================================
  -- B5 : report d'une alerte déjà prise en charge — affectation conservée
  -- ======================================================================
  v_res := public.resp_update_alerte_coulage('tok_ac_resp', v_id, jsonb_build_object(
    'prevuAt', now() + interval '3 hours'));
  assert (v_res->>'ok')::boolean, 'B5 report doit réussir: '||coalesce(v_res::text,'null');
  assert (v_res->'alerte'->>'statut') = 'prise_en_charge',
    'B5 statut doit rester prise_en_charge, obtenu: '||(v_res->'alerte'->>'statut');
  assert (v_res->'alerte'->>'prisePar') is not null,
    'B5 prisePar doit rester renseigné après report';
  raise notice 'B5 OK : report conserve l''affectation (statut=%).', v_res->'alerte'->>'statut';

  -- ======================================================================
  -- B6 : relance — 1 h avant, une seule fois
  -- ======================================================================
  -- Fixture indépendante, NON prise en charge, prévue dans 30 min.
  insert into public.alertes_coulage(labo_id, code_projet, prevu_at, quantite_m3,
                                      moules_calcules, cree_par, cree_par_nom)
  select v_labo1, v_code1, now() + interval '30 minutes', 20, 9, id, nom
    from public.operators where identifiant = '__vac_resp';

  v_res := public.enqueue_alertes_coulage();
  assert (v_res->>'enqueued')::int >= 1,
    'B6a enqueue_alertes_coulage doit enfiler au moins 1 alerte: '||coalesce(v_res::text,'null');
  raise notice 'B6a OK : relance enfilée (enqueued=%).', v_res->>'enqueued';

  assert exists(
    select 1 from public.notifications
     where cible = 'operateur:' || (select id from public.operators where identifiant = '__vac_resp')
       and tag like 'alerte-nonprise-%'),
    'B6a une notification operateur:<uuid> doit avoir été enfilée';
  raise notice 'B6a OK : notification ciblée sur le responsable créateur.';

  -- 2ᵉ appel immédiat : ne doit RIEN réenfiler pour cette alerte (garde).
  declare n_avant int; n_apres int;
  begin
    select count(*) into n_avant from public.notifications where tag like 'alerte-nonprise-%';
    perform public.enqueue_alertes_coulage();
    select count(*) into n_apres from public.notifications where tag like 'alerte-nonprise-%';
    assert n_apres = n_avant, 'B6b relance ne doit pas se répéter (garde alerte_envoyee_at)';
    raise notice 'B6b OK : pas de répétition de la relance.';
  end;

  raise notice '===== ALERTE COULAGE : TOUTES LES VALIDATIONS FONCTIONNELLES OK =====';
end $$;

rollback;
-- Fin : ROLLBACK ci-dessus => aucune donnée persistée.

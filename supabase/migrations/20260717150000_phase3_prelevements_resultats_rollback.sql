-- ============================================================================
--  ROLLBACK de 20260717150000_phase3_prelevements_resultats.sql
--  ⚠ Supprime les tables prelevements / eprouvettes / coulage_events /
--    audit_events (les payloads coulages/lots restent intacts : les effets
--    déjà appliqués — eprRecuperees, bassinReparti, essais révisés — sont
--    conservés dans les payloads, seule la traçabilité disparaît).
-- ============================================================================

drop function if exists public.op_list_audit(text,text,text);
drop function if exists public.op_reviser_eprouvette(text,jsonb);
drop function if exists public.op_coulage_event(text,jsonb);
drop function if exists public.op_alloc_prels(text,text,jsonb);

drop table if exists public.audit_events;
drop table if exists public.coulage_events;
drop table if exists public.eprouvettes;
drop table if exists public.prelevements;

-- FIN ------------------------------------------------------------------------

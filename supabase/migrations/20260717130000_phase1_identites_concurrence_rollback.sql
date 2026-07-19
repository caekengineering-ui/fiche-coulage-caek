-- ============================================================================
--  ROLLBACK de 20260717130000_phase1_identites_concurrence.sql
--
--  ⚠ Les colonnes supprimées perdent leurs données (client_uuid,
--    official_ref, idempotency_key) — sans impact sur les payloads
--    historiques : ref (PK) et payload restent intacts.
--  ⚠ project_counters / sync_requests sont supprimées : les clients
--    Phase 1 doivent être repassés en mode historique AVANT ce rollback
--    (ils retombent d'eux-mêmes sur op_save_coulage / op_soumettre_coulage
--    quand op_sync_coulage n'existe plus).
-- ============================================================================

drop function if exists public.op_sync_coulage(text, jsonb);
drop function if exists public._alloc_official_ref(text);

drop table if exists public.sync_requests;
drop table if exists public.project_counters;

drop index if exists public.idx_coulages_client_uuid;
drop index if exists public.idx_coulages_id;

alter table public.coulages drop column if exists idempotency_key;
alter table public.coulages drop column if exists official_ref;
alter table public.coulages drop column if exists client_uuid;
alter table public.coulages drop column if exists id;

-- FIN ------------------------------------------------------------------------

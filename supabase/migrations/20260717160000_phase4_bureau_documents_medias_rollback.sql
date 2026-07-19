-- ============================================================================
--  ROLLBACK de 20260717160000_phase4_bureau_documents_medias.sql
--
--  ⚠ Supprime les fonctions et tables Phase 4 (document_corrections,
--    media_assets, media_archive_receipts) et RESTAURE la policy Storage
--    `medias_select_app` d'origine (select anon+authenticated).
--    Les payloads coulages/lots ne sont pas touchés. AUCUN média n'est
--    supprimé (le rollback ne fait que retirer la traçabilité d'archivage).
-- ============================================================================

drop function if exists public.media_signaler_erreur(uuid,text);
drop function if exists public.media_mark_deletable(uuid);
drop function if exists public.media_archive_receipt(jsonb);
drop function if exists public.media_list(text,text);
drop function if exists public.media_register(text,jsonb);
drop function if exists public.document_get_ready_bundle(text);
drop function if exists public.bureau_set_correction_statut(uuid,text);
drop function if exists public.bureau_correction_history(text,text,text);
drop function if exists public.bureau_load_corrections(text);
drop function if exists public.bureau_save_correction(jsonb);

drop table if exists public.media_archive_receipts;
drop table if exists public.media_assets;
drop table if exists public.document_corrections;

-- Restauration de la policy Storage d'origine (Phase 0 : select anon+auth).
drop policy if exists "medias_select_app" on storage.objects;
create policy "medias_select_app" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'medias');

-- FIN ------------------------------------------------------------------------

-- ============================================================================
--  ROLLBACK de 20260717120000_phase0_storage_lockdown.sql
--  Restaure les policies historiques (larges) du bucket « medias »
--  telles que définies par supabase_storage.sql.
-- ============================================================================

drop policy if exists "medias_insert_app" on storage.objects;
drop policy if exists "medias_update_app" on storage.objects;
drop policy if exists "medias_select_app" on storage.objects;
drop policy if exists "medias_delete_app" on storage.objects;

create policy "medias_insert_app" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'medias');

create policy "medias_update_app" on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'medias') with check (bucket_id = 'medias');

create policy "medias_select_app" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'medias');

create policy "medias_delete_app" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'medias');

-- FIN ------------------------------------------------------------------------

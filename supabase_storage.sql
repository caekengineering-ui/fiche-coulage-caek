-- ============================================================================
--  CAEK — Module Béton (V3) : migration STORAGE (médias des coulages)
--  À COLLER dans Supabase (projet module-beton-caek) :
--  SQL Editor -> New query -> Run.
--
--  Bucket privé « medias » : photos (formulation/BL, prélèvement, éprouvettes,
--  anomalies) et notes audio, téléversées à la SOUMISSION d'un coulage pour
--  que l'admin les examine à la validation. L'app admin les SUPPRIME du
--  serveur après validation (le quota gratuit de 1 Go n'est qu'une zone de
--  transit).
--
--  Limites : 5 Mo par fichier, images + audio uniquement.
--  L'accès par la clé publique de l'app est limité à CE bucket.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('medias', 'medias', false, 5242880,
  array['image/jpeg','image/png','image/webp',
        'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav','audio/aac','audio/3gpp'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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

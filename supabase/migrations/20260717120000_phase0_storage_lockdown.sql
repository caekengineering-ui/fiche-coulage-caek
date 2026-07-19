-- ============================================================================
--  Migration 20260717120000 — Phase 0 : fermeture des policies Storage anon
--  trop larges sur le bucket « medias ».
--
--  ÉTAT AVANT (supabase_storage.sql historique) : anon+authenticated ont
--  insert / update / select / delete sur TOUT le bucket -> n'importe quel
--  porteur de la clé publique peut lire, écraser ou supprimer tous les médias.
--
--  ÉTAT APRÈS :
--    - insert  : conservé, mais restreint au préfixe « coulages/ » (chemin
--                réellement utilisé par l'app : coulages/<REF>/<fichier>) ;
--    - select  : conservé TEMPORAIREMENT (dual-read : l'écran Validation lit
--                encore les médias avec la clé anon ; sera remplacé par des
--                URLs signées servies par RPC avant retrait) ;
--    - update  : SUPPRIMÉ (aucun flux applicatif ne réécrit un média) ;
--    - delete  : SUPPRIMÉ (la suppression devient l'exclusivité du bureau via
--                service_role, APRÈS téléchargement, vérification SHA-256 et
--                accusé media_archive_receipts — Phase 4).
--
--  Idempotente : rejouable sans effet de bord (drop if exists + create).
--  Additive    : ne touche ni le bucket ni les objets existants.
--  Réversible  : voir 20260717120000_phase0_storage_lockdown_rollback.sql.
--
--  ⚠ NE PAS APPLIQUER EN PRODUCTION sans avoir vérifié que la PWA déployée
--    n'appelle plus CAEKMedias.deletePaths (corrigé en Phase 0) : les anciens
--    clients PWA en cache tenteraient une suppression -> échec propre (403),
--    médias conservés (comportement voulu).
-- ============================================================================

-- update : plus aucun droit pour la clé publique.
drop policy if exists "medias_update_app" on storage.objects;

-- delete : plus aucun droit pour la clé publique.
drop policy if exists "medias_delete_app" on storage.objects;

-- insert : restreint au préfixe applicatif « coulages/ ».
drop policy if exists "medias_insert_app" on storage.objects;
create policy "medias_insert_app" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'medias' and name like 'coulages/%');

-- select : inchangé pour l'instant (dual-read, retrait planifié avec les
-- URLs signées). Recréé explicitement pour être auto-porteur.
drop policy if exists "medias_select_app" on storage.objects;
create policy "medias_select_app" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'medias');

-- FIN ------------------------------------------------------------------------

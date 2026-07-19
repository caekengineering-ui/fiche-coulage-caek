-- Rollback « Alerte coulage » (BF-001).
-- Aucune donnée de coulage n'est concernée : la fonctionnalité est isolée.
-- Penser à retirer le cron avant :
--   select cron.unschedule('caek-alertes-coulage');

drop function if exists public.enqueue_alertes_coulage();
drop function if exists public.resp_ack_alerte_coulage(text,uuid);
drop function if exists public.op_prendre_en_charge_alerte(text,uuid);
drop function if exists public.resp_update_alerte_coulage(text,uuid,jsonb);
drop function if exists public.resp_create_alerte_coulage(text,jsonb);
drop function if exists public.op_list_alertes_coulage(text,uuid,boolean);
drop function if exists public._alerte_json(public.alertes_coulage);
drop function if exists public._peut_planifier(text);
drop function if exists public._moules_pour(uuid,numeric);

-- ATTENTION : supprime l'historique des alertes de coulage. Exporter la table
-- avant si la traçabilité des prises en charge doit être conservée.
drop index if exists public.idx_alertes_relance;
drop index if exists public.idx_alertes_labo;
drop table if exists public.alertes_coulage;

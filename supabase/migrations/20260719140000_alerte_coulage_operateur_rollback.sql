-- Rollback « Alerte coulage — autonomie de l'opérateur » (BF-001, suite).
-- Réapplique 20260719120000_alerte_coulage.sql APRÈS ce rollback pour
-- restaurer les versions d'origine de op_prendre_en_charge_alerte,
-- resp_update_alerte_coulage et op_list_alertes_coulage.
-- Les données des alertes ne sont pas touchées.

drop function if exists public.op_statut_alerte_coulage(text,uuid,text,timestamptz);
drop function if exists public._notif_createur_alerte(public.alertes_coulage,text,text);

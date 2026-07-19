-- ============================================================================
-- Alerte coulage (BF-001) — correctif : notifications au responsable perdues
--
-- Défaut détecté par alerte_coulage_operateur_validation.sql (assertion C5b).
--
-- _enqueue_notif ignore toute notification dont la (cible, tag) est déjà en
-- attente : c'est voulu pour les RAPPELS répétitifs (« lots à écraser »), qui
-- ne doivent pas s'empiler. Mais _notif_createur_alerte construisait son tag
-- avec now() arrondi à la MINUTE. Deux événements distincts sur la même alerte
-- dans la même minute — typiquement « pris en charge » puis « reporté » —
-- produisaient donc un tag identique, et le second était silencieusement
-- avalé comme un doublon. Le responsable ne recevait rien.
--
-- Aggravant : now() est constant sur toute une transaction, donc le défaut
-- était systématique dès que deux événements partageaient la même transaction.
--
-- Correctif : ces notifications signalent des ÉVÉNEMENTS PONCTUELS, chacun
-- devant être délivré. On les rend uniques via clock_timestamp() (qui avance
-- même à l'intérieur d'une transaction) à la milliseconde. La protection
-- anti-empilement reste entière pour les rappels périodiques, qui utilisent
-- leurs propres tags datés au jour.
-- ============================================================================

create or replace function public._notif_createur_alerte(
  a public.alertes_coulage, p_titre text, p_corps text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if a.cree_par is null then return; end if;
  perform public._enqueue_notif(
    'operateur:' || a.cree_par,
    p_titre,
    p_corps,
    '/#screen-alertes-coulage',
    -- Tag unique par événement : horloge réelle à la milliseconde, et non
    -- now() figé à la minute (cf. en-tête).
    'alerte-evt-' || a.id || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'));
end; $$;

-- FIN ------------------------------------------------------------------------

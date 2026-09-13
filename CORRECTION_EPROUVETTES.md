# Complément d'éprouvettes — version 98

Dans **Test**, ouvrir le lot puis **Corriger / compléter les éprouvettes**.
Le même accès existe dans l'historique, y compris pour un lot validé.

- Vérifier les codes physiques proposés (codes prélevés mais non affectés).
- Saisir les codes supplémentaires et le motif. Les anciens codes et résultats sont conservés.
- Un opérateur peut compléter un lot non validé et saisir les résultats. Le responsable autorise le complément dans **Validation**, puis valide les résultats.
- Un lot déjà validé doit être complété par le responsable. Ce seul lot est rouvert et nécessite une nouvelle validation.
- Si le nombre prélevé était erroné, le responsable peut augmenter le total d'un malaxeur déjà prélevé en indiquant son numéro et le total réel. Les nouvelles éprouvettes sont rattachées à ce prélèvement.

La connexion est nécessaire pour confirmer une répartition ou un complément.
Les essais des lots existants restent saisissables hors ligne. Aucune correction de code n'est acceptée par une simple synchronisation d'un lot.

Une correction est additive : pas de suppression de résultats, pas de transfert d'une éprouvette déjà affectée à un autre lot. Dans ces cas, une révision spécifique du dossier reste nécessaire.

## Déploiement

Appliquer `supabase/migrations/20260913090000_integrite_repartition.sql` avant de publier le client v98.
La migration ne réécrit aucun lot existant. Elle ajoute un historique protégé et des RPC contrôlées, puis bloque les anciennes voies de création/suppression de lots isolés. Les appareils doivent charger v98 avant de confirmer une nouvelle répartition.

Le Bureau reçoit le même complément par `bureau_complements.py` : correction serveur, saisie des nouvelles lignes puis validation serveur explicite. Une révision opérationnelle récente remplace les anciennes copies locales de ce lot. La génération conserve une copie du PV précédent dans `output_documents_beton/versions/`.

## Vérification

Depuis `validation/`, installer les dépendances de test puis lancer `npm test` (Node 22+).
Les tests emploient un PostgreSQL isolé et un DOM simulé, sans accès aux données métier.
Les tests Bureau se lancent avec `python tests/test_integrite_complements.py` depuis le dossier Bureau.

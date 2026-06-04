# Fiche de coulage terrain — CAEK (PWA)

Outil terrain pour smartphone destiné au technicien chantier : il remplace la
fiche papier de suivi de coulage. Application web installable (PWA), autonome,
fonctionnant **hors-ligne**, totalement séparée du logiciel desktop
`mini_logiciel_beton` et du module Analyse béton.

> **État actuel : Version 0 — essai terrain.**
> Toutes les fonctions de base sont en place (jalons T1→T9). Cette v0 est
> destinée à être mise à l'essai avec un opérateur réel pour recueillir son
> retour avant tout enrichissement. Voir « Périmètre Version 0 » plus bas.

## Fonctions disponibles

- **Mise à jour projet** : import du fichier Excel `UPDATE` du bureau
  (feuille `PROJETS`), fusion par `CodeProjet`, stockage local hors-ligne.
- **Nouveau coulage** : choix projet enregistré ou client simple ; référence
  auto `ABA001` (code verrouillé + compteur local), numéro modifiable.
- **Fiche terrain** : en-tête + toupies/camions (1 ligne = 1 toupie), calcul des
  totaux (quantité, éprouvettes).
- **Photos** : catégories BL / formulation / prélèvement / éprouvettes /
  anomalie ; compression et stockage local.
- **Cycle de vie** : brouillon → validée (nom opérateur = signature interne,
  verrouillée) → envoyée. Après validation : « Signaler une correction ».
- **Répertoire** : recherche + filtres par statut.
- **Export / Partage** : génération `.xlsx` + partage WhatsApp / e-mail
  (Web Share API, repli téléchargement) ; la fiche passe en « envoyée ».
- **Compatibilité bureau** : le `.xlsx` contient les feuilles `PROJET`,
  `RAPPORT_COULAGE`, `ESSAIS_7J`, `ESSAIS_28J` aux cellules lues par
  `mini_logiciel_beton_v1.04.py` → réimport sans ressaisie de l'en-tête.

## Arborescence

```
fiche_terrain_caek/
├── index.html              Page unique (tous les écrans)
├── manifest.webmanifest    Métadonnées PWA (nom, icônes, couleurs)
├── service-worker.js       Cache hors-ligne du socle
├── .nojekyll               Désactive le traitement Jekyll sur GitHub Pages
├── css/
│   └── styles.css          Charte CAEK + mise en page mobile
├── js/
│   ├── db.js               Accès IndexedDB (projets, coulages, compteurs, photos, meta)
│   ├── update.js           Import / fusion du fichier UPDATE (SheetJS)
│   ├── nouveau.js          Nouveau coulage + référence ABA001
│   ├── fiche.js            Fiche terrain (en-tête, toupies, validation)
│   ├── photos.js           Capture, compression, stockage des photos
│   ├── export.js           Export .xlsx + partage + compat bureau
│   ├── repertoire.js       Liste, recherche, filtres
│   └── app.js              Navigation + enregistrement Service Worker
├── vendor/
│   └── xlsx.full.min.js    SheetJS (lecture/écriture Excel hors-ligne)
├── assets/
│   ├── logo-caek.png
│   └── icons/{icon-192.png, icon-512.png}
└── README.md
```

## Lancer en local (sur PC, pour test rapide)

Un Service Worker exige un serveur HTTP (il ne fonctionne pas en `file://`).
Depuis le dossier `fiche_terrain_caek/` :

```bash
python -m http.server 8000
```

Puis ouvrir <http://localhost:8000> dans Chrome.
Pour simuler un téléphone : F12 → « Toggle device toolbar » (Ctrl+Shift+M).

## Déployer sur GitHub Pages

1. Créer un dépôt GitHub et y pousser le **contenu** de `fiche_terrain_caek/`
   (le `index.html` doit être à la racine du dépôt, ou dans `/docs`).
2. Dépôt → *Settings* → *Pages* → *Branch* : `main`, dossier `/ (root)` →
   *Save*. Le fichier `.nojekyll` garantit que les dossiers `js/` et `vendor/`
   sont servis tels quels.
3. GitHub fournit une URL `https://<utilisateur>.github.io/<depot>/`.
   Tous les chemins de l'app sont **relatifs** → fonctionne sous ce sous-dossier.

## Installer sur le téléphone

1. Ouvrir l'URL dans **Chrome (Android)** ou **Safari (iPhone)**.
2. Menu → **« Ajouter à l'écran d'accueil »** ; l'app s'ouvre en plein écran.
3. **Hors-ligne** : ouvrir une fois avec réseau, puis activer le mode avion et
   rouvrir — l'app doit se charger et fonctionner sans connexion.

## Publier une mise à jour

Après modification des fichiers, **incrémenter `CACHE_VERSION`** dans
`service-worker.js` puis repousser sur GitHub. Les téléphones récupèrent la
nouvelle version au prochain chargement en ligne.

## Périmètre Version 0 (volontairement limité)

Cette v0 se limite à : remplacement de la fiche papier de coulage · saisie
terrain simple · historique local · photos · export / partage au bureau ·
exploitation par le technicien pour remplir le rapport final.

**Non inclus en v0** (modules envisagés pour la suite) : gestion du bassin de
conservation, suivi et identification des éprouvettes, affectation aux âges
d'essai, suivi 7j / 28j, liaison avec le registre laboratoire, traçabilité
complète coulage ↔ prélèvement ↔ éprouvettes ↔ rapports d'écrasement.

## À tester sur le terrain (retour opérateur)

Simplicité de l'interface · rapidité de saisie · champs manquants · champs
inutiles · facilité de prise de photos · facilité de partage WhatsApp/e-mail ·
compréhension des icônes et boutons · comportement hors-ligne.

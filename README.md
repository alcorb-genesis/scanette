# REPCLICK / Scanette

Application statique de pointage et catalogue magasin. Aucun serveur applicatif n'est nécessaire ; l'authentification et les données partagées utilisent Supabase.

## Fichiers de publication

Publier uniquement `index.html`, `core.js`, `interface.css`, `bellecave.html` et `bellecave.js`. Conserver les deux pages HTML accessibles. Aucune donnée catalogue ni aucun mot de passe ne doit être ajouté au dépôt.

## Comportement

- Le pointage reste local à chaque compte et appareil. Export et restauration JSON disponibles. Les anciennes données locales sont reprises avec confirmation ; les clés historiques restent conservées.
- La synchronisation de l'ancien catalogue traite les pages et conserve les modifications en attente après une erreur. Le jeton de session est relu pour chaque requête.
- Bellecave propose une recherche paginée et une lecture caméra d'un code à la fois. Les fiches importées restent distinctes, même si des références ou des codes sont partagés.
- Les emplacements sont enregistrés par une fonction contrôlant l'appartenance au magasin, le rôle et la version de la fiche, avec journal des changements.
- Le fichier catalogue importé ne contient ni quantités ni emplacements. Le stock reste non renseigné. Le pointage personnel ne calcule pas le stock disponible.
- Le pointage historique utilise encore son catalogue partagé ; le catalogue Bellecave est un espace séparé. Le scan multiple de palette n'est pas implémenté.

## Vérification

`node --test --test-isolation=none core.test.cjs app.test.cjs`

Les migrations SQL documentent le schéma appliqué et ne doivent pas être rejouées sans vérifier l'état de la base. `bellecave-security-test.sql` vérifie les accès et les conflits de modification dans une transaction annulée. Les contrôles ciblés ne constituent pas un audit de sécurité complet.

Avant commercialisation : tester la caméra sur les téléphones utilisés, définir les mouvements ou exports alimentant le stock et traiter la sauvegarde partagée des pointages si nécessaire.

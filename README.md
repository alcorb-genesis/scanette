# REPCLICK / Scanette

Application statique de pointage et catalogue magasin. Aucun serveur applicatif n'est nécessaire ; l'authentification et les données partagées utilisent Supabase.

## Fichiers de publication

Publier uniquement `index.html`, `core.js`, `interface.css`, `bellecave.html` `bellecave.js` et `warehouse.js`. Conserver les deux pages HTML accessibles. Aucune donnée catalogue ni aucun mot de passe ne doit être ajouté au dépôt.

## Comportement

- Le pointage reste local à chaque compte et appareil. Export et restauration JSON disponibles. Les anciennes données locales sont reprises avec confirmation ; les clés historiques restent conservées.
- La synchronisation de l'ancien catalogue traite les pages et conserve les modifications en attente après une erreur. Le jeton de session est relu pour chaque requête.
- Bellecave propose une recherche paginée et une lecture caméra d'un code à la fois. Les fiches importées restent distinctes, même si des références ou des codes sont partagés.
- Les emplacements sont enregistrés par une fonction contrôlant l'appartenance au magasin, le rôle et la version de la fiche, avec journal des changements.
- Le fichier catalogue importé ne contient ni quantités ni emplacements. Le stock reste non renseigné. Le pointage personnel ne calcule pas le stock disponible.
- Le pointage consulte directement Bellecave à chaque code, puis son catalogue historique en absence de correspondance. Les ambiguïtés demandent un choix. Une panne réseau ne crée pas de référence supposée. Les fiches Bellecave conservent leur identité et leur désignation dans les sauvegardes et exports.
- Le mode palette bêta analyse une photo sur l'appareil avec ZXing WASM 3.1.4. Les codes sont surlignés (vert reconnu, orange à vérifier, gris lot enregistré). Une vérification explicite des quantités précède l'ajout atomique du lot. La quantité par code distinct est 1 par défaut ; ce n'est pas un comptage automatique des boîtes. Les codes inconnus sont exclus. Le suivi entre plusieurs photos ou en vidéo n'est pas implémenté. Le moteur est chargé depuis un CDN ; aucune image n'est transmise au moteur distant.

## Vérification

`node --test --test-isolation=none core.test.cjs warehouse.test.cjs`

Les migrations SQL documentent le schéma appliqué et ne doivent pas être rejouées sans vérifier l'état de la base. `bellecave-security-test.sql` vérifie les accès et les conflits de modification dans une transaction annulée. Les contrôles ciblés ne constituent pas un audit de sécurité complet.

Avant commercialisation : tester la caméra sur les téléphones utilisés, définir les mouvements ou exports alimentant le stock et traiter la sauvegarde partagée des pointages si nécessaire.

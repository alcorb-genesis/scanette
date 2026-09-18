# REPCLICK / Scanette

Application statique de pointage et catalogue magasin. Aucun serveur applicatif n'est nécessaire ; l'authentification et les données partagées utilisent Supabase.

## Fichiers de publication

Publier uniquement `index.html`, `core.js`, `interface.css`, `bellecave.html` `bellecave.js`, `warehouse.js`, `palette-worker.js`, `sweep-tracker.js` et `sweep.js`. Conserver les deux pages HTML accessibles. Aucune donnée catalogue ni aucun mot de passe ne doit être ajouté au dépôt.

## Comportement

- Le pointage reste local à chaque compte et appareil. Export et restauration JSON disponibles. Les anciennes données locales sont reprises avec confirmation ; les clés historiques restent conservées.
- La synchronisation de l'ancien catalogue traite les pages et conserve les modifications en attente après une erreur. Le jeton de session est relu pour chaque requête.
- Bellecave propose une recherche paginée et une lecture caméra d'un code à la fois. Les fiches importées restent distinctes, même si des références ou des codes sont partagés.
- Les emplacements sont enregistrés par une fonction contrôlant l'appartenance au magasin, le rôle et la version de la fiche, avec journal des changements.
- Le fichier catalogue importé ne contient ni quantités ni emplacements. Le stock reste non renseigné. Le pointage personnel ne calcule pas le stock disponible.
- Le pointage consulte directement Bellecave à chaque code, puis son catalogue historique en absence de correspondance. Les ambiguïtés demandent un choix. Une panne réseau ne crée pas de référence supposée. Les fiches Bellecave conservent leur identité et leur désignation dans les sauvegardes et exports.
- Le mode palette bêta analyse une photo sur l'appareil avec ZXing WASM 3.1.4. Les codes sont surlignés (vert reconnu, orange à vérifier, gris lot enregistré). Une vérification explicite des quantités précède l'ajout atomique du lot. La quantité par code distinct est 1 par défaut ; ce n'est pas un comptage automatique des boîtes. Les codes inconnus sont exclus. Le suivi entre plusieurs photos ou en vidéo n'est pas implémenté. Le moteur est chargé depuis un CDN ; aucune image n'est transmise au moteur distant.

## Vérification

`node --test --test-isolation=none core.test.cjs warehouse.test.cjs sweep.test.cjs`

Les migrations SQL documentent le schéma appliqué et ne doivent pas être rejouées sans vérifier l'état de la base. `bellecave-security-test.sql` vérifie les accès et les conflits de modification dans une transaction annulée. Les contrôles ciblés ne constituent pas un audit de sécurité complet.

Avant commercialisation : tester la caméra sur les téléphones utilisés, définir les mouvements ou exports alimentant le stock et traiter la sauvegarde partagée des pointages si nécessaire.

Mode mémoire réduite : caméra intégrée limitée à 1600 pixels par côté, capture conseillée 1280 × 720, import redimensionné dès le décodage. Moteur dans un worker jetable (palette-worker.js), transféré sans duplication du tampon, libéré après analyse ou annulation. 18 tests passent ; lecture multiple vérifiée dans le navigateur. Validation matérielle Motorola G34 encore nécessaire.


## Balayage vidéo bêta

Dans Pointage, ouvrir « Balayage vidéo · bêta », puis Démarrer. Chaque étiquette reconnue sur deux images et retrouvée dans le catalogue ajoute une pièce. Les positions distinguent les étiquettes identiques simultanément visibles. Une absence prolongée autorise un nouveau passage identique : un retour ou une perte de suivi peut donc recompter une boîte. Ce suivi géométrique n'est pas une réidentification physique garantie.

Pause arrête caméra et moteur ; les pistes sont conservées pendant cette pause. Les quatre derniers ajouts sont sauvegardés avec le pointage, même après rechargement. Après rechargement, les pistes visuelles sont perdues : reprendre depuis la bonne position. Annuler le dernier ajout est disponible pendant la session si le pointage n'a pas été modifié ailleurs entre-temps. Les codes inconnus ou ambigus interrompent le balayage pour éviter une affectation silencieuse.

Validation : 24 tests automatisés (y compris simulation du contrôleur vidéo, pause, historique, annulation et répétitions de codes). Le balayage matériel et sa vitesse restent à éprouver sur téléphone en conditions réelles. Le navigateur ne peut pas garantir qu'une perte de lecture due à un reflet sera distinguée d'une sortie de l'image.

Photo : une seconde passe agrandit des zones chevauchantes dans un tampon réutilisé (1600 pixels maximum par côté). Les coordonnées reviennent sur la photo et les détections superposées sont fusionnées. Le balayage vidéo conserve sa passe unique. Vérification du correctif : échec reproduit sur une capture réelle puis lecture d'un EAN après correction ; les trois produits ne sont pas tous détectés. 24 tests existants et un test de zones/mémoire/coordonnées passent. Test : node --test --test-isolation=none palette-worker.test.cjs. Les captures utilisateur restent hors du dépôt.
Import photo : les dimensions PNG/JPEG et l'orientation EXIF sont lues avant décodage pour éviter un agrandissement suivi d'une réduction. Test navigateur complet réussi sur la capture reproduisant le défaut : un code lu et signalé absent du catalogue. 26 tests ciblés passent au total.

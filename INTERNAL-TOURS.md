# Tournées internes dans « Départs » — 9 octobre 2026

But : dans Départs, un garage se trouve sous sa tournée ou son livreur.

## Modèle

- Une tournée interne est rattachée à une fiche garage par `details.tours`, une liste d’identifiants (`damian`, `maxime`, `charlie`, `cedric`). Une fiche peut en porter plusieurs.
- Les transporteurs déjà saisis (Serge, Paketo, ACE…) restent des départs de la fiche (`departures`) et ne sont jamais remplacés.
- Damian, Maxime et Cédric n’ont aucune heure : l’écran affiche « Tournée interne — horaire selon BL ».
- Charlie a deux départs fixes, 10:00 et 15:00 du lundi au vendredi, enregistrés comme des départs ordinaires de la fiche.
- Ludovic est le renfort des autres tournées : aucune fiche ne lui est attribuée ; son filtre montre les garages des quatre tournées.
- Les variantes de nom vont dans `details.aliases` (« a ; b »), modifiables dans la fiche. La recherche tolère en plus les lettres doublées (« carosserie », « Scannia »). Elle ne fusionne jamais deux fiches.

## Donnée source

`internal-tours-data.json` : la liste saisie par Alexis, sans coordonnée, horaire ni fiche venant d’Internet. `existing` nomme une fiche déjà présente à compléter ; `open` marque une ambiguïté laissée sans décision (ni créée ni rattachée).

## Base réelle

`node scripts/build-internal-tours-sql.cjs` régénère quatre fichiers, à exécuter à la main dans Supabase ; l’application ne les applique pas. Chaque fichier est **une seule instruction** : elle s’exécute en entier ou pas du tout, sans `BEGIN`/`COMMIT`, et n’utilise que des délimiteurs nommés (`$repclick_run$`, `$repclick_data$`).

1. `internal-tours.check.sql` — rapport en lecture seule, une requête et un résultat : tournées, fiches existantes complétées, garages **en attente** ;
2. `internal-tours.dry-run.sql` — essai à blanc : fait tout ce que fait la mutation puis s’arrête sur l’erreur « DRY RUN OK — nothing written… », qui annule tout. Cette erreur est le résultat attendu ;
3. `internal-tours.sql` — rattachement, idempotent ; s’arrête sans rien changer si une fiche attendue manque, existe en double, ou si une fiche « nouvelle » existe déjà sous le même nom ;
4. `internal-tours.check.sql` à nouveau ;
5. `internal-tours.rollback.sql` — en cas de besoin : retire exactement ce qui a été ajouté ; une fiche créée puis modifiée depuis est conservée et seulement détachée.

Tant que `internal-tours.sql` n’est pas exécuté, l’écran propose les tournées mais aucun garage n’y est rattaché.

## En attente de décision

Ces lignes de la liste ne sont ni créées ni rattachées : une fiche existante pourrait être le même garage, sans certitude. Elles figurent dans le rapport et dans le message de l’essai à blanc.

| Tournée | Ligne d’Alexis | Fiche existante candidate |
|---|---|---|
| Damian | Irribarren | IRIBARREN PATRICK |
| Cédric | Roady | AUGARAY (ROADY) |

Une fois la décision prise : écrire `existing` (même garage) ou retirer `open` (garage distinct) dans `internal-tours-data.json`, régénérer, rejouer la mutation — elle ne touche que ce qui change.

## Correspondances confirmées par Alexis (9 octobre 2026)

Charlie est le livreur ; ces trois lignes de sa tournée désignent des fiches déjà présentes, complétées sans être remplacées :

| Ligne d’Alexis | Fiche existante |
|---|---|
| First Stop | First Stop Laboudigue Saint-Jean-de-Luz |
| Leclerc Auto | LECLERC ST JEAN DE LUZ (variante « Leclerc Auto » ajoutée) |
| Dallard | DALLARD ST JEAN DE LUZ |

## Pourquoi une seule instruction et des délimiteurs nommés

La première version était du PostgreSQL valide mais utilisait `$$` et un `BEGIN`/`COMMIT` externe. Sur son trajet vers le serveur, `$$` est devenu `$` (comme le fait une chaîne de remplacement JavaScript) : « syntax error at or near "$" · do $ ». Le générateur refuse désormais tout fichier contenant `$$`, un `$` suivi d’un chiffre, un mot-clé de transaction ou plus d’une instruction.

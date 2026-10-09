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

Plus aucune ligne n’est en attente. Le mécanisme reste en place : une ligne marquée `open` dans `internal-tours-data.json` n’est ni créée ni rattachée, et figure dans le rapport et dans le message de l’essai à blanc.

## Décisions d’Alexis déjà appliquées à la main en base (9 octobre 2026)

| Ligne d’origine | Décision | Comment la fiche est retrouvée |
|---|---|---|
| Irribarren (Damian) | **Jo Iribarren**, fiche nouvelle et distincte de « IRIBARREN PATRICK » : ne jamais les fusionner. Adresse, deux téléphones, activités, horaires d’ouverture ; variantes « Irribarren », « Garage Jo Iribarren » ; aucun départ interne fixe | par sa clé `tour-jo-iribarren-20261009`, jamais par son nom |
| Roady (Cédric) | **Roady Bayonne** est la fiche existante « AUGARAY (ROADY) » (un seul R, nom lu en base ; c’est la seule fiche dont le nom contient ROADY). Tournée de Cédric, variantes « Roady Bayonne » et « Centre auto Roady Bayonne », adresse, téléphone, horaires d’ouverture ; ses départs externes sont conservés tels quels | par son nom exact ; le script s’arrête s’il n’y a pas exactement une fiche contenant ROADY |

Rejouer `internal-tours.sql` sur la base réelle ne change donc rien ; sur une base neuve, il recrée ces deux décisions. Les détails confirmés d’une fiche existante sont ajoutés quand la fiche n’en a pas et ne remplacent jamais une valeur présente. Les horaires d’ouverture ne créent aucun départ.

Le rapport (`internal-tours.check.sql`) liste en section 4 tout écart entre la base et ce que la mutation applique, et en section 5 les fiches à ne jamais fusionner.

## Correspondances de la tournée de Charlie confirmées par Alexis (9 octobre 2026)

Charlie est le livreur ; ces trois lignes de sa tournée désignent des fiches déjà présentes, complétées sans être remplacées :

| Ligne d’Alexis | Fiche existante |
|---|---|
| First Stop | First Stop Laboudigue Saint-Jean-de-Luz |
| Leclerc Auto | LECLERC ST JEAN DE LUZ (variante « Leclerc Auto » ajoutée) |
| Dallard | DALLARD ST JEAN DE LUZ |

## Pourquoi une seule instruction et des délimiteurs nommés

La première version était du PostgreSQL valide mais utilisait `$$` et un `BEGIN`/`COMMIT` externe. Sur son trajet vers le serveur, `$$` est devenu `$` (comme le fait une chaîne de remplacement JavaScript) : « syntax error at or near "$" · do $ ». Le générateur refuse désormais tout fichier contenant `$$`, un `$` suivi d’un chiffre, un mot-clé de transaction ou plus d’une instruction.

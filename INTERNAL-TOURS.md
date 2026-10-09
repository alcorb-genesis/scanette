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

`node scripts/build-internal-tours-sql.cjs` régénère trois fichiers, à exécuter à la main dans Supabase ; l’application ne les applique pas :

1. `internal-tours.check.sql` — état en lecture seule, avant et après ;
2. `internal-tours.sql` — rattachement, idempotent ; s’arrête sans rien changer si une fiche attendue manque, existe en double, ou si une fiche « nouvelle » existe déjà sous le même nom ;
3. `internal-tours.rollback.sql` — retire exactement ce qui a été ajouté ; une fiche créée puis modifiée depuis est conservée et seulement détachée.

Tant que `internal-tours.sql` n’est pas exécuté, l’écran propose les tournées mais aucun garage n’y est rattaché.

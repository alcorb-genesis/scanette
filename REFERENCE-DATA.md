# Référentiel public — collecte du 20 septembre 2026

## Contenu livré

- `partners-data.json` : 10 057 établissements Sirene diffusibles et actifs à la collecte. Réparation automobile (45.20A) en Nouvelle-Aquitaine ; commerce de gros d'équipements automobiles (45.31Z) en France.
- `partners-osm-data.json` : 2 171 commerces automobiles OpenStreetMap de Nouvelle-Aquitaine. 1 731 communes manquantes complétées par inclusion du point dans les contours communaux officiels. Aucune rue ni aucun code postal inventé.
- `suppliers-official-data.json` : quatre contacts vérifiés ponctuellement sur les sites des entreprises : Bilstein France, SIDAT France, SIDAT Italie, Purflux aftermarket.
- `products-open-data.json` : 27 produits automobiles sélectionnés parmi 46 002 fiches Open Products Facts examinées. Clés GTIN contrôlées. Un article de chaussures sous marque Goodyear exclu manuellement.

Affichage combiné : **11 836 fiches**, soit **6 783 garages** et **5 053 fournisseurs / vendeurs de pièces**, dont **1 020 avec téléphone**, **275 avec courriel** et **1 442 dans les départements 64 et 40**. Rapprochement sur SIRET exact uniquement : des doublons restent possibles lorsque le SIRET manque. Ces chiffres décrivent des fiches, pas autant de clients ni de partenaires commerciaux acquis.

## Sources et licences

- Sirene via https://recherche-entreprises.api.gouv.fr/ : Licence Ouverte 2.0. URL de collecte conservée sur chaque établissement et paramètres dans `queries`.
- © OpenStreetMap contributors : https://www.openstreetmap.org/copyright ; extrait et enrichissement redistribués sous ODbL 1.0. Source de chaque objet conservée.
- API découpage administratif : https://geo.api.gouv.fr/decoupage-administratif/communes ; Licence Ouverte 2.0. Source et méthode de localisation ajoutées à chaque fiche concernée.
- © Open Products Facts contributors : https://www.data.gouv.fr/datasets/open-products-facts ; extrait redistribué sous ODbL 1.0, https://opendatacommons.org/licenses/odbl/1-0/. Aucun visuel recopié.
- Les quatre contacts ponctuels sont des faits publiés par les fournisseurs, avec URL et date de consultation. Ils ne constituent pas une licence de réutilisation des catalogues de ces entreprises.

Les extraits ouverts sont téléchargeables dans la section « Sources, qualité et téléchargements ». Ils sont séparés des relations et opérations locales du magasin. Aucun catalogue fourni par l'employeur, dirigeant, bilan financier ou donnée de compte Supabase n'est inclus.

## Limites

La collecte Sirene n'est pas exhaustive : filtre d'activité de l'unité légale puis contrôle de l'activité des établissements, entreprises individuelles exclues de cet import, limite de 100 établissements connexes par résultat. Le classement OSM est collaboratif et son statut administratif n'est pas certifié. Les contacts peuvent être anciens ; aucune adresse électronique n'a été testée par un envoi.

Une clé GTIN valide ne certifie ni l'existence commerciale, ni le fabricant, ni la compatibilité véhicule. Les fiches produits n'indiquent pas de stock ou de prix inventé et ne sont pas injectées dans le stock fictif. Les données publiques ne suffisent pas à créer les conditions commerciales d'un magasin.

Piste suivante identifiée : EPREL pneumatiques, https://eprel.ec.europa.eu/screen/requestpublicapikey. L'API nécessite une demande de clé avec déclaration signée. Aucune demande, acceptation contractuelle ou inscription n'a été effectuée.

## Parcours livré

Entrée unique `gestion-demo.html`, accès direct `gestion-demo.html?section=directory`. L'ancienne page partenaires redirige vers ce parcours. Recherche par nom, ville, adresse, code postal ou SIRET ; filtres garage / fournisseur / produit, territoire, contacts disponibles, sélection du magasin. Zone garage initiale : 64 et 40.

Ajouter un garage crée une fiche client locale propre au magasin de démonstration. Elle est utilisable au comptoir et au portail client. Ajouter un fournisseur conserve sa fiche de contact dans « Fournisseurs » ; ses tarifs, compte et modalités d'achat restent à paramétrer. Les quatre fournisseurs de simulation historiques conservent leurs conditions fictives ; ils ne constituent pas les contrats des fournisseurs importés.

Les deux magasins de démo conservent partenaires, brouillons et opérations après rechargement dans `localStorage` (`alcorb-demo-stores-v1`). Ce n'est pas une base multitenant authentifiée ni une synchronisation entre appareils. Les réceptions réelles, les règles Supabase, le catalogue Bellecave et le moteur Scanette ne sont pas modifiés.

## Reproduction de la collecte

Scripts Python standard, sans dépendance tierce ni clé :

1. `python scripts/import-reference.py` — cache minimal sous `private-import/reference-cache` (exclu de Git et du build).
2. `python scripts/import-osm.py`
3. `python scripts/enrich-osm-communes.py`
4. `python scripts/import-open-products.py`

Ne pas publier automatiquement les résultats : vérifier changements de schéma, qualité, droits, effectifs et faux positifs. Les contacts officiels doivent être revérifiés séparément.

## Vérification

- `node reference.test.cjs` : provenance, IDs, GTIN, coordonnées, géographie locale, fusion SIRET, absence des champs dirigeants/finances, protection HTML, index portail, ajout idempotent, magasins indépendants et restauration des fiches/documents.
- `node gestion-demo.test.cjs` : régressions métier, facturation sans double sortie, retours, remboursements et réapprovisionnement.
- `node scenario.test.cjs` : trois palettes, manquants non bloquants pour la comptabilité, stock et journaux.
- Navigateur local : garage Bayonne → client → BL simulé ; séparation du magasin Landes ; rechargement ; ajout SIDAT → fiche fournisseur. Affichage testé à 390 × 844, menu de sections visible au défilement.

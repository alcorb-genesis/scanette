# Comptoir, achats et réceptions partagés — 21 septembre 2026

## Fonctionnement livré

- Brouillon privé au vendeur ; BL validé partagé au magasin, numéroté et figé avec client, vendeur, prix/remises, départ habituel et date.
- Validation du BL : sortie atomique une fois, stock négatif autorisé. Stock initial inconnu refusé, sans conversion implicite à zéro.
- Préparation et remise au départ : aucune seconde sortie de stock. Annulation avant départ : écriture inverse tracée ; aucune annulation automatique des commandes fournisseur.
- Commande fournisseur : crée les lignes attendues, sans mouvement de stock. Réception partielle ou complète : seules les quantités acceptées entrent en stock.
- Besoins : déficit informatique moins quantités déjà attendues. Ce calcul ne remplace pas encore une prévision saisonnière des ventes.
- Régulation signée : motif obligatoire, auteur et heure serveur ; refus si le stock a changé depuis sa lecture.
- APO : proposition indicative de 13 h 30 avant 11 h selon l'heure de l'appareil. Délai à confirmer avec le fournisseur.

## Preuves

- gestion-sales.test.sql : exécuté dans Supabase avec transaction annulée. Vente 0 -> -2, prix/remise, répétition sans double sortie, préparation sans mouvement, annulation unique, refus de mutation directe et lecture hors magasin.
- gestion-purchases.test.sql : exécuté dans Supabase avec transaction annulée. Vente -> besoin -> commande -> réception partielle/complète -> régulation ; répétitions et correction périmée vérifiées. Une erreur de concaténation SQL trouvée par ce test a été corrigée, puis le scénario a passé.
- 31 tests Node passent sur les modules vente, impression, navigation et régressions existantes.
- Navigateur local authentifié : chargement serveur des nouveaux modules, clients du magasin, formulaire de vente et liste des attendus vérifiés.

## Limites explicites

Les achats ne sont ni transmis aux fournisseurs ni valorisés. Un BL n'est pas une facture ; comptabilité et GPS partagé restent à construire. Aucune impression papier ni essai avec plusieurs utilisateurs simultanés n'est revendiqué. Les tests SQL annulent leurs données : aucun faux stock ni faux document ne doit subsister.

Migration : appliquer gestion-sales.sql puis gestion-purchases.sql après les migrations magasin/partenaires/réceptions existantes. Migrations déjà appliquées sur le projet courant ; ne pas les rejouer telles quelles. Déploiement web via build.cjs.

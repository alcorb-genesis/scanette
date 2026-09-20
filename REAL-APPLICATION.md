# Application réelle : décisions et critères de livraison

L'espace doit offrir tous les pôles à chaque membre du magasin. Le métier personnalise les raccourcis ; il ne cloisonne pas la navigation. Les habilitations concernent des actions, pas la possibilité de retrouver une section. Un inventaire pourra être confié à un vendeur sans lui attribuer la modification des droits ou l'annulation de factures.

## Disponible et vérifié
- Connexion privée, appartenance serveur au magasin, scan et catalogue réels.
- Réceptions et registre des mouvements existants ; stock initial à renseigner et sorties externes encore absentes.
- Paramétrage partagé du magasin : identité et coordonnées persistées, écriture réservée aux administrateurs actuels, version et auteur serveur, conflits d'édition refusés.
- Accès direct aux pôles depuis l'accueil, avec statut de démonstration explicite pour les fonctions simulées.

## Prochain parcours réel à livrer
Une livraison regroupe fournisseur, bon, lignes scannées, anomalies et validation. La validation doit créer la réception et les entrées de stock dans une transaction, avec identifiant de reprise stable. Un double clic ou une réponse réseau perdue ne doit pas compter deux fois. Le transfert à une autre personne devient une option. Une pièce manquante ne bloque pas les pièces reçues ni tout le dossier comptable.

## Comptoir réel : condition préalable aux essais de BL
- Clients et fournisseurs privés du magasin, identifiants stables ; sélection depuis l'annuaire public sans exposer les conditions commerciales du magasin.
- Brouillon sans sortie de stock. Validation : numéro unique, lignes et conditions tarifaires figées, auteur, date serveur, sortie de stock exactement une fois.
- Statistiques calculées à partir des mêmes documents validés. Transformation BL vers facture sans seconde sortie ni double chiffre d'affaires.
- Aperçu et réimpression du document émis depuis son instantané, pas depuis les prix ou coordonnées actuels.
- Avoir et retour physique distincts. Correction tracée, sans effacement d'un document émis.
- Tests de quantité insuffisante, concurrence entre vendeurs, reprise réseau, annulation, retour partiel et séparation entre magasins.

## Paramétrage employé et autres pôles
Compte individuel, préférences serveur propres au compte, fonctions sensibles autorisées par le responsable. Les profils locaux de démonstration ne deviennent jamais des identités métier. Les inventaires, départs, réapprovisionnements et écritures comptables doivent utiliser le registre commun, avec leurs propres événements datés et reprises idempotentes.

## Limites actuelles
Les ventes, BL, clients privés, achats et statistiques commerciales de la démonstration ne sont pas encore des modules réels. Ne pas utiliser la démonstration pour enregistrer les dossiers réels. La fiche magasin est prête pour les données réelles mais n'est pas encore injectée dans un BL de production. Le magasin réel reste Bellecave ; créer un autre magasin nécessite encore son provisionnement. Sauvegarde/restauration et tests complets d'un magasin pilote restent des critères de mise en service, pas des acquis de cette livraison.

## Vérification de cette étape
23 tests de régression passent. Test SQL transactionnel exécuté sur Supabase puis annulé : écriture administrateur, attribution serveur de l'auteur/version, rejet d'une version obsolète, refus d'écriture directe et refus de lecture/écriture pour un non-membre. Aucune donnée de test conservée par cette transaction.

Vérification navigateur : connexion, formulaire partagé, sauvegarde du seul nom connu Bellecave et relecture de la version 1 depuis la base. Les coordonnées inconnues sont laissées vides (pays France). Ouverture directe du comptoir de démonstration depuis l’accueil vérifiée.

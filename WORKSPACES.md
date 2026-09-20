# Espaces de travail de démonstration

L’entrée `gestion-demo.html` affiche un accueil par métier : Vendeur, Comptabilité, Logistique, Achats ou Direction. Le menu latéral, les tuiles d’accueil et le sélecteur mobile utilisent la même sélection de modules. Le lien direct vers le référentiel reste utilisable, même si ce module n’est pas épinglé.

« ＋ / − Mes menus » ajoute ou retire des raccourcis. « Mon espace » reste toujours accessible et tous les modules peuvent être réajoutés depuis cette personnalisation. Le bouton de réinitialisation remet uniquement les raccourcis du métier courant à leur valeur proposée ; aucun document ou mouvement n’est supprimé.

Les préférences sont maintenant enregistrées dans `alcorb-workspace-v2-<magasin>`. Chaque profil possède son identité locale, ses menus par métier et ses liens HTTPS. Les anciennes préférences v1 migrent vers le profil Alexis de démonstration, sans effacement du stockage v1. « Profils de l’équipe » crée des profils individuels ; le sélecteur « Mon profil » permet d’en changer. Les liens de catalogues s’ouvrent dans un onglet externe avec `noopener noreferrer`, sans iframe, transmission de credentials ou contournement des restrictions des fournisseurs. La présentation officielle TecDoc ne constitue pas un accès catalogue sous licence.

Ce mécanisme ne représente ni un compte employé authentifié, ni des habilitations, ni une synchronisation entre appareils. Une version multiutilisateur devra associer ces préférences à l’identité authentifiée et appliquer les permissions côté serveur indépendamment du menu. Les brouillons, clients, stocks et documents restent ceux du magasin partagé ; seules les préférences sont individuelles.

Le métier Commercial prépare l’étape suivante. Un client peut être rattaché à un profil commercial via `clientCommercials`, conservé avec les opérations du magasin, par identifiant partenaire ou code client. Aucun commercial n’est attribué automatiquement. Les visites et tournées ne sont pas implémentées.

Les nouvelles ventes au comptoir et les avoirs prennent le code du profil actif ; les avoirs conservent le vendeur d’origine. Le tableau `storestats` agrège les ventes originales sans recompter leurs factures liées, les avoirs, les retours physiques et les BL actuellement signalés à vérifier. Il ne fournit pas de taux d’erreur ni de ventilation par période : les anciennes pièces de démonstration n’ont pas de dates complètes et les incidents ne sont pas historisés. Les statistiques personnelles suivent le code du profil actif.

Tests automatisés : `node --test workspaces.test.cjs`. Tests navigateur : ajout de Réceptions et retrait de Portail clients pour Vendeur ; rechargement ; passage à Logistique puis Comptabilité ; indépendance du magasin Landes ; menu et ouverture du comptoir à 390 × 844 sans débordement horizontal. Les suites métier et de saisie ont également été exécutées (15 tests au total).

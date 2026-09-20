# Espaces de travail de démonstration

L’entrée `gestion-demo.html` affiche un accueil par métier : Vendeur, Comptabilité, Logistique, Achats ou Direction. Le menu latéral, les tuiles d’accueil et le sélecteur mobile utilisent la même sélection de modules. Le lien direct vers le référentiel reste utilisable, même si ce module n’est pas épinglé.

« ＋ / − Mes menus » ajoute ou retire des raccourcis. « Mon espace » reste toujours accessible et tous les modules peuvent être réajoutés depuis cette personnalisation. Le bouton de réinitialisation remet uniquement les raccourcis du métier courant à leur valeur proposée ; aucun document ou mouvement n’est supprimé.

Les préférences sont enregistrées dans `alcorb-workspace-v1-<magasin>` sur cet appareil. Chaque métier conserve sa liste au sein de chaque magasin. Ce mécanisme ne représente ni un compte employé authentifié, ni des habilitations, ni une synchronisation entre appareils. Une version multiutilisateur devra associer ces préférences à l’identité authentifiée et appliquer les permissions côté serveur indépendamment du menu.

Tests automatisés : `node --test workspaces.test.cjs`. Tests navigateur : ajout de Réceptions et retrait de Portail clients pour Vendeur ; rechargement ; passage à Logistique puis Comptabilité ; indépendance du magasin Landes ; menu et ouverture du comptoir à 390 × 844 sans débordement horizontal. Les suites métier et de saisie ont également été exécutées (15 tests au total).

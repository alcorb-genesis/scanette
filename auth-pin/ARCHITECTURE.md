# Connexion logistique par nom et PIN — contrat de sécurité

Demande confirmée : choisir son nom, puis saisir son PIN personnel.

La connexion e-mail/mot de passe existante reste le moyen d'activation et de récupération, pas le parcours quotidien.

## Conditions avant activation

- Un nom affiché doit correspondre à un compte Auth actif et à une appartenance au magasin. Une fiche gestion_team ne crée aucun droit.
- Une première association du navigateur au magasin est réalisée par un administrateur réauthentifié. Le jeton d'association est aléatoire, révocable et expire. La liste des noms n'est pas publiée sur Internet.
- Chaque personne définit elle-même son PIN après réauthentification. Aucun code par défaut, aucun PIN demandé dans la conversation, aucun mot de passe remplacé silencieusement.
- Le PIN est vérifié côté serveur. Le navigateur ne contient ni table de PIN ni clé d'administration.
- Un compteur atomique persistant limite les essais par personne et par navigateur, y compris les essais parallèles. Le compteur ne dépend pas du navigateur et ne disparaît pas au rechargement.
- Le succès ouvre une session Auth individuelle, conservant les politiques d'accès existantes. Aucun compte partagé derrière un choix de nom.
- Un PIN oublié se réinitialise par une authentification forte ou un processus de récupération défini, sans pouvoir afficher l'ancien PIN.
- Retrait du magasin, désactivation de compte, révocation du navigateur et changement de PIN doivent être vérifiés au serveur avant émission de session.

## Parcours

Appareil associé : choix du nom -> PIN -> espace personnel.
Appareil inconnu : association initiale par le responsable ; pas de liste nominative publique.
Première utilisation personnelle : connexion existante -> définir/confirmer le PIN -> retour au choix du nom.
Récupération : lien discret vers la connexion existante.

## Tests bloquants

PIN incorrect ; cinq tentatives concurrentes ; compteur conservé après rechargement ; accès avec jeton appareil expiré/révoqué ; appartenance supprimée pendant connexion ; changement de PIN concurrent ; nom identique appartenant à deux personnes ; absence de fuite des emails/notes/empreintes ; session créée avec le bon identifiant ; retour de session tardif après changement de personne ; parcours mobile et déconnexion.

## État

Code préparé : service.mjs, index.ts, pin-ui.js et migrations SQL. Le secret de hachage est généré dans Supabase Vault, sans affichage ni présence dans Git. La migration SQL est appliquée et le service logistics-pin est déployé. Dans l'éditeur Supabase, service.mjs est copié sous file2.ts, avec l'import correspondant dans index.ts.

Le contrôle JWT legacy de la fonction reste ACTIVÉ : la validation automatique a refusé sa désactivation sans autorisation explicite. Le changement non enregistré a été annulé dans l'interface. Aucun contournement effectué. La connexion PIN n'est donc pas activée dans le site public ; pin-ui.js est exclu de build.cjs. Une page locale public/pin-preview.html permet la revue visuelle et n'est ni versionnée ni publiée.

8 tests du service + 6 tests de navigation passent. Tests SQL transactionnels annulés : compteurs, liste privée, révocation, changement de code et permissions réservées au serveur. Pas encore de preuve de connexion réelle par PIN ni d'essai concurrent avec plusieurs clients.

Limites : cinq essais par compte / quinze minutes (un succès remet ce compteur à zéro), vingt demandes de connexion par navigateur / quinze minutes, association du navigateur valable 90 jours. Les sessions existantes suivent les règles Auth habituelles ; révoquer l'association empêche de nouvelles connexions PIN, sans révoquer les sessions déjà ouvertes. L'activation des fiches employés dépourvues de compte Auth reste un travail distinct.

Après autorisation du réglage JWT pour cette seule fonction : vérifier les refus et les CORS de l'endpoint, puis intégrer pin-ui.js à l'application. La définition du PIN et toute saisie de mot de passe sont faites par l'utilisateur. Vérifier une connexion complète avant d'annoncer le fonctionnement terminé.

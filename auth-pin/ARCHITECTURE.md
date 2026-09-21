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

La désactivation du contrôle JWT legacy de la seule fonction logistics-pin a été explicitement autorisée par Alexis après le refus initial de la validation automatique. Le réglage est enregistré. Les autres fonctions et permissions existantes ne sont pas modifiées.

Endpoint vérifié depuis l'extérieur : 401 sans navigateur associé, aucune fiche pour un jeton inconnu, 403 pour une origine non autorisée. Le formulaire est intégré à l'application, avec accès de secours conservé. Le choix/confirmation du PIN et la saisie du mot de passe sont réservés à l'utilisateur.

8 tests du service + 6 tests de navigation passent. Tests SQL transactionnels annulés : compteurs, liste privée, révocation, changement de code et permissions réservées au serveur. Pas encore de preuve de connexion réelle par PIN ni d'essai concurrent avec plusieurs clients.

Limites : cinq essais par compte / quinze minutes (un succès remet ce compteur à zéro), vingt demandes de connexion par navigateur / quinze minutes, association du navigateur valable 90 jours. Les sessions existantes suivent les règles Auth habituelles ; révoquer l'association empêche de nouvelles connexions PIN, sans révoquer les sessions déjà ouvertes. L'activation des fiches employés dépourvues de compte Auth reste un travail distinct.

Reste à éprouver avec l'utilisateur : réauthentification personnelle, association du navigateur, définition du PIN puis déconnexion/reconnexion complète. Ne pas annoncer ce parcours réel validé avant ce test. Aucun PIN de collègue n'a été créé et aucune fiche employé n'a été transformée en compte.

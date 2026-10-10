# Accès logistique partagé, par mot de passe unique — 8 octobre 2026

Décision d’Alexis : l’accès logistique demande **un seul mot de passe, le même pour toute l’équipe**. Pas d’e-mail, pas de nom, pas de PIN, pas de compte Supabase, pas d’écran personnel. Le portail garage reste entièrement ouvert et n’atteint jamais les opérations logistiques.

## Déploiement en deux étapes, sans coupure

État au 9 octobre 2026 : étapes 1 et 2 faites sur la base réelle (accès ouvert, mot de passe défini, sessions de 480 minutes) ; l’étape 3 est la publication de l’application qui contient ce fichier. Les étapes 5 et 6 ne sont pas faites par cette publication. Les fichiers SQL cités ici ont été appliqués à la main et ne sont pas encore versionnés dans ce dépôt.

L’application publiée avant la bascule se connecte encore par nom + PIN. La base est donc modifiée en deux temps, et le PIN n’est fermé qu’à la fin.

| # | Action | Fichier ou lieu | Effet sur l’application encore publiée |
|---|---|---|---|
| 1 | Appliquer la migration de transition, puis son test | `logistics-shared-access.sql`, `logistics-shared-access.test.sql` | Aucun : le fichier ne fait qu’ajouter. Le PIN fonctionne comme avant. |
| 2 | Définir le mot de passe du magasin, à la main | éditeur SQL (voir ci-dessous) | Aucun. |
| 3 | Publier la nouvelle application | hébergement | La connexion passe au mot de passe du magasin. |
| 4 | Entrer une fois dans la logistique de l’application **publiée** avec le mot de passe, vérifier un écran | navigateur | — |
| 5 | Fermer le PIN, puis lancer son test | `logistics-pin-retirement.sql`, `logistics-pin-retirement.test.sql` | L’ancienne connexion par PIN ne répond plus. |
| 6 | Supprimer l’Edge Function `logistics-pin` | Supabase | — |

Garde-fous de l’étape 5 : le fichier refuse de s’exécuter si l’étape 1 manque, si aucun mot de passe n’est défini, ou si personne n’est encore entré avec le mot de passe. Il ne peut donc pas fermer le PIN tant que c’est la seule porte. Ce contrôle prouve qu’une connexion par mot de passe a réussi, pas qu’elle venait de l’application publiée : l’étape 4 reste à faire par une personne.

Entre les étapes 1 et 5, les deux accès coexistent côté base : l’ancien pour l’application encore en ligne, le nouveau fermé tant que le mot de passe n’est pas défini.

Retour arrière : après l’étape 5, `auth-pin/enable.sql` rend les fonctions PIN au rôle serveur (rien n’est supprimé). Avant l’étape 5, republier l’ancienne application suffit.

Le test de l’étape 1 se relance à tout moment ; sa dernière ligne indique si le PIN est encore disponible ou déjà fermé.

## Où se trouve le mot de passe

**Nulle part dans ce dépôt.** Ni dans le JavaScript, ni dans le HTML, ni dans le SQL, ni dans les tests, ni dans l’historique Git. Le serveur n’en conserve qu’une empreinte bcrypt (`public.shared_access.password_hash`), illisible par les rôles de l’application.

Il se définit à la main, une fois la migration de transition appliquée et avant de publier la nouvelle application, dans l’éditeur SQL de Supabase :

    select public.shared_access_set_password('<MOT_DE_PASSE_LOGISTIQUE_A_SAISIR_A_LA_MAIN>');

- Remplacer le texte entre crochets par le vrai mot de passe (10 caractères au moins). Le texte d’exemple lui-même est refusé par la fonction.
- Ne pas enregistrer cette requête comme extrait, ne pas la coller dans un ticket, un commit ou une conversation.
- Tant que cette étape n’est pas faite, personne n’entre : les fonctions partagées répondent « session requise ».
- Relancer la même commande change le mot de passe et **ferme aussitôt toutes les sessions ouvertes**.

## Comment l’accès fonctionne

1. Sur l’accueil, « Accès logistique » ouvre un formulaire de mot de passe (construit par `shared-access.js`, le même sur chaque page logistique).
2. Le mot de passe est envoyé une fois à `shared_access_open`. Le serveur le compare à l’empreinte et renvoie un **jeton de session aléatoire**, valable 8 heures (`shared_access.session_minutes`, de 5 à 1440).
3. Le navigateur ne garde que ce jeton, dans le stockage de l’onglet : il disparaît à la fermeture de l’onglet. Le mot de passe n’est jamais conservé. Le serveur ne garde que le SHA-256 du jeton.
4. Chaque fonction `shared_*` reçoit le jeton et refuse de répondre sans session valide (`PT401`). Session expirée : le formulaire revient, puis l’opération reprend.
5. « Changer d’accès » ferme la session côté serveur (`shared_access_close`).

Tentatives : au-delà de 10 mots de passe faux en 15 minutes, toute nouvelle tentative est refusée (`PT429`) jusqu’à ce qu’elles sortent de la fenêtre. Les sessions déjà ouvertes continuent de fonctionner. Ce frein est global (il n’y a pas d’identité à qui l’attacher) : quelqu’un qui s’acharne sur le formulaire peut donc retarder une nouvelle connexion, sans jamais toucher aux données.

## Risque accepté (à ne pas perdre de vue)

**Toute personne qui connaît le mot de passe a accès aux opérations logistiques du magasin Bellecave** : elle peut consulter le catalogue et le stock suivi, enregistrer des réceptions et des pointages, modifier des emplacements, créer ou modifier des fiches garage/fournisseur et leurs départs, publier des listes d’inventaire et faire avancer des dossiers retours. Aucune action n’est attribuée à une personne : le journal indique seulement « accès partagé ».

Un mot de passe commun se transmet et ne se retire pas à une seule personne : au départ d’un membre de l’équipe, ou au moindre doute, il faut le changer (commande ci-dessus). Ce modèle est choisi par Alexis ; il ne doit pas être présenté comme un accès nominatif.

## Séparation avec le portail garage

Le portail garage et l’accès logistique utilisent la même clé publique (rôle anonyme). La séparation ne repose plus sur les écrans : elle est faite par le serveur. Le portail n’appelle que `returns_public_garages`, `returns_public_submit` et `returns_public_designation` (un seul texte : la désignation d’une référence exacte, jamais d’emplacement, de stock, de prix ni de fournisseur ; voir `returns-public-designation.sql`), qui ne demandent pas de session ; toutes les fonctions `shared_*` de données en exigent une. Un garage qui choisit « Accès logistique » sur l’accueil s’arrête au formulaire de mot de passe.

## Ce qui est ouvert, avec une session

Uniquement des fonctions `shared_*` (SECURITY DEFINER, `search_path` vide) définies dans `logistics-shared-access.sql`. Elles servent le seul magasin inscrit dans `public.shared_access` (Bellecave), fixé côté serveur : le navigateur n’envoie jamais d’identifiant de magasin. Aucune table n’est accordée au rôle `anon`.

Périmètre : réception, scanette, inventaire, préparation, départs, catalogue, retours.

Les écritures répètent les contrôles des fonctions membres existantes (versions, transitions, appartenance au magasin des fournisseurs/clients/produits). Elles enregistrent `created_by`/`updated_by`/`actor_id` à null et `access_source = 'shared_access'` : aucun utilisateur n’est inventé.

## Ce qui reste fermé (comptes membres uniquement)

- Équipe, paramètres du magasin, appartenances et rôles : écrans retirés de l’application ; `team.html` et `store-settings.html` publiés comme simple redirection vers l’accueil.
- Liens invités d’inventaire (création, liste, fermeture) ; noms de l’équipe (`logistics_employee_names`).
- PIN : l’écran PIN et son service ne sont plus publiés. Côté base, les fonctions `logistics_pin_*` restent en place pendant la transition puis sont révoquées pour tous les rôles par `logistics-pin-retirement.sql` (étape 5) ; les tables sont conservées pour l’historique.

## Opérations ouvertes qui modifient des données de référence

Elles ne touchent ni droits ni configuration, mais méritent d’être connues :

- Départs : créer, modifier, retirer/restaurer une fiche garage ou fournisseur et ses horaires ; ajout depuis l’annuaire public.
- Inventaire : publier ou retirer la liste de comptage commune du magasin.
- Catalogue : modifier un emplacement (journalisé sans auteur).
- Scanette : ajouter une correspondance code-barres → référence dans le catalogue historique partagé ; créer un fournisseur.
- Réception : mettre un dossier à la corbeille ou le restaurer.

## Fermer l’accès

`update public.shared_access set enabled = false;` — toutes les fonctions partagées répondent alors « accès fermé » (42501), y compris pour les sessions ouvertes. Rouvrir avec `enabled = true`.

Fermer seulement les sessions en cours, sans changer le mot de passe : `delete from public.shared_access_sessions;`

## Données locales

Les pointages et préparations conservés sur un appareil sous un ancien compte sont proposés une fois à la reprise ; la copie d’origine n’est jamais effacée.

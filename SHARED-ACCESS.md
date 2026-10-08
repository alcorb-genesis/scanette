# Accès logistique partagé, par mot de passe unique — 8 octobre 2026

Décision d’Alexis : l’accès logistique demande **un seul mot de passe, le même pour toute l’équipe**. Pas d’e-mail, pas de nom, pas de PIN, pas de compte Supabase, pas d’écran personnel. Le portail garage reste entièrement ouvert et n’atteint jamais les opérations logistiques.

## Où se trouve le mot de passe

**Nulle part dans ce dépôt.** Ni dans le JavaScript, ni dans le HTML, ni dans le SQL, ni dans les tests, ni dans l’historique Git. Le serveur n’en conserve qu’une empreinte bcrypt (`public.shared_access.password_hash`), illisible par les rôles de l’application.

Il se définit à la main, une fois la migration appliquée, dans l’éditeur SQL de Supabase :

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

Le portail garage et l’accès logistique utilisent la même clé publique (rôle anonyme). La séparation ne repose plus sur les écrans : elle est faite par le serveur. Le portail n’appelle que `returns_public_garages` et `returns_public_submit`, qui ne demandent pas de session ; toutes les fonctions `shared_*` de données en exigent une. Un garage qui choisit « Accès logistique » sur l’accueil s’arrête au formulaire de mot de passe.

## Ce qui est ouvert, avec une session

Uniquement des fonctions `shared_*` (SECURITY DEFINER, `search_path` vide) définies dans `logistics-shared-access.sql`. Elles servent le seul magasin inscrit dans `public.shared_access` (Bellecave), fixé côté serveur : le navigateur n’envoie jamais d’identifiant de magasin. Aucune table n’est accordée au rôle `anon`.

Périmètre : réception, scanette, inventaire, préparation, départs, catalogue, retours.

Les écritures répètent les contrôles des fonctions membres existantes (versions, transitions, appartenance au magasin des fournisseurs/clients/produits). Elles enregistrent `created_by`/`updated_by`/`actor_id` à null et `access_source = 'shared_access'` : aucun utilisateur n’est inventé.

## Ce qui reste fermé (comptes membres uniquement)

- Équipe, paramètres du magasin, appartenances et rôles : écrans retirés de l’application ; `team.html` et `store-settings.html` publiés comme simple redirection vers l’accueil.
- Liens invités d’inventaire (création, liste, fermeture) ; noms de l’équipe (`logistics_employee_names`).
- PIN : fonctions `logistics_pin_*` révoquées pour tous les rôles, tables conservées pour l’historique. L’écran PIN et son service ne sont plus publiés.

## Opérations ouvertes qui modifient des données de référence

Elles ne touchent ni droits ni configuration, mais méritent d’être connues :

- Départs : créer, modifier, retirer/restaurer une fiche garage ou fournisseur et ses horaires ; ajout depuis l’annuaire public.
- Inventaire : publier ou retirer la liste de comptage commune du magasin.
- Catalogue : modifier un emplacement (journalisé sans auteur).
- Scanette : ajouter une correspondance code-barres → référence dans le catalogue historique partagé ; créer un fournisseur.
- Réception : mettre un dossier à la corbeille ou le restaurer.
- Retours : services de tournée et dénomination des éléments d’un dossier.

## Fermer l’accès

`update public.shared_access set enabled = false;` — toutes les fonctions partagées répondent alors « accès fermé » (42501), y compris pour les sessions ouvertes. Rouvrir avec `enabled = true`.

Fermer seulement les sessions en cours, sans changer le mot de passe : `delete from public.shared_access_sessions;`

## Données locales

Les pointages et préparations conservés sur un appareil sous un ancien compte sont proposés une fois à la reprise ; la copie d’origine n’est jamais effacée.

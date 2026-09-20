# Équipe nominative : état de livraison

Les fiches de gestion_team sont persistées uniquement dans la base privée. La liste nominative n'est pas incluse dans le code public, les fichiers statiques ni le dépôt Git. La migration versionnée ne contient que la structure et les règles d'accès.

Un administrateur peut créer/modifier une fiche (nom, fonctions multiples, e-mail de contact, précisions). Il peut corriger la liste et ajouter les personnes oubliées. Un employé authentifié peut consulter sa propre fiche lorsque celle-ci est liée à son compte. La liste des coordonnées de toute l'équipe reste réservée aux administrateurs.

Le lien user_id référence une appartenance existante au magasin ; le formulaire ne peut pas le modifier. Changer les fonctions ou renseigner une adresse de contact ne crée pas de compte, ne change pas l'adresse de connexion et ne donne pas de permissions. Les homonymes conservent des identifiants distincts.

À activer signifie : aucun compte de connexion lié. Accès existant signifie : fiche liée à un membre déjà authentifiable, et non preuve d'une connexion récente. Il n'y a pas d'invitation envoyée automatiquement ni de mot de passe par défaut.

Limite explicite : l'authentification actuelle exige un e-mail et un mot de passe. Les noms seuls permettent d'enregistrer l'équipe mais pas d'activer ses connexions. Un parcours d'activation sécurisé (ou un véritable mécanisme d'identifiant sans e-mail) reste à développer. L'ajout autonome de l'e-mail par l'employé n'est pas disponible tant que son compte n'est pas activé ; les coordonnées peuvent actuellement être complétées par le responsable.

Validation : tests SQL transactionnels avec annulation complète des essais : création de fiche sans création de membre, refus d'écrasement de version, refus de changement direct d'identité, refus d'accès à un non-membre. Les 23 tests de régression de l'application restent à exécuter avant publication.

La suppression d’une appartenance au magasin détache la fiche de son compte (user_id remis à null) sans supprimer la personne. La fiche ne doit pas empêcher la révocation d’un accès.

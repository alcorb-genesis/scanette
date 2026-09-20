# Accès privé et entrée commune

L’entrée application.html vérifie la session Supabase puis l’appartenance à Bellecave dans scanette_members. Aucun formulaire public d’inscription ni d’attribution de droits n’est ajouté. Les comptes existants conservent leurs permissions. Les comptes employés seront créés/affectés après réception de leur liste.

Les droits actuels sont reader (lecture), operator (opérations), admin (administration). Le métier (vendeur, comptabilité, logistique, commercial) doit être distingué de ces permissions. La prochaine attribution devra préciser pour chaque employé : e-mail individuel, nom affiché, métier, magasin et permissions autorisées. Ne jamais utiliser les profils locaux de démonstration pour accorder des droits serveur.

La navigation affiche un seul module à la fois dans une frame de même origine : pointage, réceptions/stock, catalogue et gestion en démonstration. Le retrait de la frame ferme son contexte, notamment caméra et workers. Les opérations réseau incertaines conservent leurs clés de reprise déjà gérées par les modules. Changer de section recharge le module ; les saisies non enregistrées des formulaires ne sont pas garanties conservées.

Les liens entre modules passent par des messages dont origine et fenêtre émettrice sont vérifiées. Les anciennes adresses réelles ramènent à l’entrée commune ; les modules embarqués conservent leur authentification et leurs contrôles serveur. Cette interface ne remplace pas les RLS.

La démonstration publique reste consultable séparément pour présentation. Ses profils locaux, écritures et ventes sont explicitement simulés, y compris lorsqu’elle est ouverte dans l’espace privé. Elle n’est pas un stockage privé des données clients réelles : ne pas y saisir de dossiers réels. Le catalogue, le stock et les réceptions réels restent dans les modules Supabase.

Validation : tests de refus d’accès sans appartenance, déconnexion, réponse tardive après fermeture de session, suppression du contenu sur échec de revérification, navigation avec un seul module et rejet des messages étrangers. Les requêtes anonymes sur scanette_members, scanette_products, gestion_stock et gestion_receipts retournent HTTP 401 le 20 septembre 2026. Aucun changement de droits ni de données métier n’est effectué par cette livraison.

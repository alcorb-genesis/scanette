# Comptes individuels et parcours logistiques

## Décisions utilisateur
Chaque personne dispose d'un compte nominatif et peut exercer plusieurs fonctions. Les fonctions organisent l'espace de travail ; elles ne créent pas des applications ou des magasins distincts. Tous les membres retrouvent les pôles. Les autorisations portent sur les actions sensibles. Aucun profil local de démonstration ne doit être utilisé comme identité pour une opération réelle.

## Création des accès
Le système actuel authentifie les comptes Supabase et contrôle leur appartenance au magasin dans scanette_members. Les niveaux techniques existants sont reader, operator, admin. Ils ne constituent pas la liste des métiers. La liste nominative et les e-mails restent nécessaires avant toute création de compte ; ne pas inventer d'adresses et ne pas partager un compte par service.

Informations attendues par personne : nom affiché, e-mail individuel, une ou plusieurs fonctions, magasin, et éventuelle responsabilité d'administration. Un employé choisit lui-même son mot de passe par un parcours d'activation. Ne pas demander ou distribuer une liste de mots de passe. L'attribution des fonctions ne doit pas lui permettre de s'accorder des permissions. Ne pas attribuer automatiquement admin aux responsables métier.

Fonctions à prévoir :
- Vente comptoir
- Commercial terrain
- Réception de marchandises
- Garanties et réclamations après-vente
- Retours et consignes
- Préparation de commandes
- Expéditions et transporteurs externes
- Livreur interne
- Achats et réapprovisionnement
- Comptabilité
- Direction

Une affectation ponctuelle à l'inventaire complète ces fonctions. Un utilisateur peut compter et signaler un écart ; la règle d'autorisation de validation d'un ajustement reste explicite. Les livreurs externes ne deviennent pas automatiquement membres du magasin.

## Retour depuis le garage
Le commercial sélectionne le garage puis scanne la pièce. Il enregistre quantité, motif, état déclaré (neuve, garantie ou consigne), origine du document quand elle est connue et prise en charge physique. Un dossier partagé est créé immédiatement. Il distingue une annonce de retour chez le garage d'une pièce réellement récupérée.

L'identifiant du produit ne prouve pas le fournisseur d'achat. Proposer automatiquement le fournisseur quand l'achat ou le lot d'origine le détermine sans ambiguïté. Sinon afficher les achats candidats et marquer « fournisseur à confirmer ». Ne pas confondre marque et fournisseur ; ne pas sélectionner silencieusement le dernier fournisseur connu.

Au magasin, le collègue voit les retours attendus puis confirme les pièces et quantités réellement reçues sans recopier les références. Le regroupement par fournisseur produit une liste de colis/palettes et un bordereau. Seules les lignes éligibles sont expédiées. L'expédition physique et l'avoir fournisseur sont suivis séparément. Un regroupement ne doit pas effacer le garage, le commercial et le document d'origine de chaque ligne.

États métier distincts : annoncé, récupéré chez le garage, reçu et contrôlé au magasin, fournisseur confirmé, regroupé, expédié, réponse/avoir fournisseur rapproché. Garantie, retour neuf et consigne partagent l'identification mais ont des traitements et conditions distincts.

Un scan commercial n'augmente pas immédiatement le stock vendable, ne génère pas automatiquement un nouvel avoir et ne rembourse pas le client. Si un avoir existe déjà, le dossier le référence au lieu d'en créer un deuxième. Un produit en garantie reste isolé du stock vendable jusqu'à décision explicite.

## Préparation mobile
Retrouver un garage ou un numéro de BL. Afficher référence, désignation, quantité à préparer, quantité déjà scannée, emplacement connu, secteur et départ prévu. Le scan incrémente seulement une ligne correspondante. Une ligne est grisée quand toutes ses unités sont préparées : une lecture n'est pas suffisante pour une ligne de plusieurs unités.

Un code inconnu, ambigu ou en trop ne valide pas la ligne. Une pièce introuvable crée une anomalie avec son motif ; ne pas forcer une fausse préparation complète. Les préparations partielles et le report de départ doivent avoir un traitement explicite. Le stock affiché et son emplacement ne sont pas présentés comme garantis lorsqu'ils sont inconnus ou non fiabilisés.

À la dernière unité attendue, le dossier peut passer à « préparé ». Le départ affecté est affiché, par exemple « Serge · 11 h », uniquement quand cette affectation existe. Le document imprimé et le mobile se réfèrent au même BL et à ses lignes figées. Deux préparateurs ne doivent pas compter deux fois les mêmes unités : attribution du dossier ou verrouillage/version serveur et événements de scan idempotents.

La préparation ne décrémente pas le stock une seconde fois si le BL validé l'a déjà décrémenté. L'état physique de préparation est distinct de l'événement commercial de sortie.

## Expéditions et livraisons
L'expédition regroupe les commandes préparées par secteur, transporteur, tournée et heure de départ. Le contrôle associe les bons aux colis/cagettes et à un départ identifié. Conserver quantité de colis, préparateur, expéditeur, date et éventuel suivi transporteur. La validation de chargement ne crée ni nouveau BL ni nouvelle sortie de stock.

Le livreur interne retrouve sa tournée, les garages et les colis. Le produit ne dépend pas d'une validation informatique du garagiste. Départ, livraison signalée par le livreur et incident sont des événements distincts. Ne pas inventer des heures ou transformer une préparation en preuve de livraison.

## Critères avant essais réels
- Connexion, révocation et changement de compte sans fuite entre personnes ou magasins.
- Reprise après interruption sans double scan, double dossier, double avoir ou double mouvement.
- Retour partiel, plusieurs achats/fournisseurs possibles, avoir déjà émis, consigne et garantie.
- Plusieurs unités identiques, mauvais code, pièce introuvable, deux préparateurs, changement de tournée.
- Audit horodaté côté serveur et auteur réel sur chaque transition.
- Les fonctions métier décrites ici restent à implémenter : cette note ne prouve pas leur disponibilité dans la version en ligne.

# Tournées de livraison — état livré le 20 septembre 2026

## Disponible
Section Départs de gestion-demo : création de tournées à partir des BL remis au départ, regroupement par garage, livreur saisi, ordre modifiable avant départ, adresse et durée simulée par arrêt, pause/reprise, livraison complète/partielle/impossible, motif obligatoire pour incident et horodatage local. Les BL déjà affectés ne peuvent être affectés à nouveau. Les confirmations n'écrivent jamais de mouvement de stock, facture ni avoir. Historique conservé dans l'état de démonstration du magasin sur cet appareil.

L'aperçu garage utilise une projection limitée à cet arrêt ; il ne constitue ni un portail authentifié ni une API publique. L'estimation affichée est explicitement une hypothèse additionnant les durées saisies, sans trafic et sans calcul routier. Une tournée terminée avec incidents ne signifie pas que toutes les marchandises sont livrées.

GPS : watchPosition uniquement sur activation par l'utilisateur, pendant une tournée active et la page visible. Stop sur pause, fin, changement de tournée/magasin/section, fermeture et passage en arrière-plan. Reprise volontaire après interruption. Coordonnées uniquement en mémoire, pas dans les états persistés. Le lien carte transmet les coordonnées à OpenStreetMap seulement à l'ouverture volontaire. Aucune confirmation de livraison par proximité GPS. Le guidage est un lien vers Google Maps pour une adresse saisie ; pas un navigateur routier embarqué.

## Validation
Tests de transitions, doublons, refus de livraison hors séquence, pause, incident obligatoire, projection garage et fraîcheur GPS. Régressions BL, impression, stock, droits du shell et recherche. Parcours navigateur local : deux BL -> tournée -> premier livré -> second partiel -> rechargement, état conservé. Le GPS réel sur téléphone et l'impression papier ne sont pas certifiés par ces tests.

## Étape nécessaire pour suivi réel entre appareils
Les BL de cette section sont encore locaux. Avant exploitation : documents commerciaux serveur et identifiants magasin/client stables, tournées/arrêts/BL liés par clés de même magasin, conducteur lié à un compte activé. Verrou/version + identifiant idempotent sur transitions, auteur et horodatage serveur. Snapshot des lignes chargées et quantités réellement remises pour partiels ; redépart lié aux reliquats sans nouvelle sortie commerciale. Les bons restent distincts des événements GPS.

Choisir une source GPS de tournée (Mapotempo Fleet si accès disponible, ou application mobile dédiée). Connexion et secrets côté serveur, pas dans la page. Conserver seulement la position utile et sa précision/date ; durée de conservation définie, accès interne restreint. Clients authentifiés autorisés seulement sur leurs propres arrêts et BL ; endpoint de projection dédiée sans positions historiques ni noms des autres garages. Pas de diffusion publique du GPS ni de jeton magasin dans un lien client. Afficher position ancienne et ETA indisponible en cas de signal périmé.

API Mapotempo : existence publique documentée, aucun accès contractuel ni appel à une flotte réelle testé. Aucune clé demandée ou inventée. Suivi salarié à cadrer avant déploiement réel, information des personnes et arrêt hors tournée. Aucun GPS partagé déployé par ce changement.

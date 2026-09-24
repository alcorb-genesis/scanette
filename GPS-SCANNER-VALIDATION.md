# Vérification du suivi GPS et de la scanette — 23 septembre 2026

- Nouveau scan simple, vidéo et photo regroupés ; lecteur externe et sauvegardes repliables. Association réception conservée hors de la zone repliée.
- 38 tests Node réussis : accès application, stockage par compte, pointage, vidéo, association réception, début/arrêt du GPS, arrêt pendant envoi, autorisation refusée et page masquée.
- Aperçu visuel isolé vérifié à 390 px et sur bureau ; il ne constitue pas un test caméra Motorola.
- Carte Leaflet / OpenStreetMap vérifiée dans le navigateur, changement de secteur et tuiles réelles.
- Migration delivery-position.sql essayée dans une transaction annulée, avec coordonnées fictives (0,0). Tests serveur réussis : lecture d’une position récente, refus du rejeu, remplacement de session, ancien arrêt sans effet sur la nouvelle session, impossibilité de réactiver après arrêt, coordonnées effacées à l’arrêt, refus hors magasin, refus d’un non-membre, absence de lecture directe/accès anonyme et expiration après 90 secondes.
- Migration serveur activée le 23 septembre après accord explicite d’Alexis. Les contrôles transactionnels après activation ont confirmé publication/retrait d’une position fictive, impossibilité de réactiver après arrêt, refus hors magasin et refus des non-membres. Aucune coordonnée de test conservée. L’API publique refuse la lecture anonyme (42501).
- Aucun suivi réel de téléphone ni partage entre deux téléphones validé. Les affectations garage/tournée et les estimations d’arrivée ne sont pas encore connectées au GPS.
- Au 23 septembre, le partage s’arrêtait quand la page était masquée/quittée (comportement modifié le 24 septembre, voir ci-dessous). En cas de coupure, disparition de la vue sous 90 secondes ; la dernière coordonnée persiste en base privée jusqu’à un arrêt confirmé ou une nouvelle activation. Aucun historique des trajets.

- Correction du bouton désactivé ambigu : états explicites GPS non activé, connexion requise et suivi indisponible. Deux tests de régression supplémentaires réussis (service absent et panne réseau), cinq tests GPS client au total.

## 24 septembre — essai Motorola en arrière-plan

- À la demande d’Alexis, masquer la page ne ferme plus la session de partage et ne supprime plus le watch GPS. Les positions fraîches fournies par le navigateur restent acceptées en arrière-plan.
- La consultation de la carte reste suspendue lorsqu’elle est masquée ; elle reprend au retour. Les contrôles de fraîcheur, cadence et séquence ne changent pas.
- Arrêt explicite, sortie du document (pagehide), refus de permission et déconnexion conservent leurs protections. Aucun redémarrage automatique après rechargement.
- Tests automatisés : conservation du watch et transmission lors de visibilité masquée, absence de lectures inutiles, reprise de lecture au retour, arrêt volontaire et sortie du document. Ces tests simulent les événements et ne prouvent pas la continuité GPS du système mobile.
- Validation physique à faire : un observateur distinct contrôle les heures des positions reçues pendant 5 à 10 minutes avec une autre application ouverte, puis écran verrouillé ; contrôler le retour et le bouton Arrêter. Ne pas manipuler le téléphone en conduisant. Une position non renouvelée disparaît toujours après 90 secondes.

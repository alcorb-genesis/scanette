# Vérification du suivi GPS et de la scanette — 23 septembre 2026

- Nouveau scan simple, vidéo et photo regroupés ; lecteur externe et sauvegardes repliables. Association réception conservée hors de la zone repliée.
- 38 tests Node réussis : accès application, stockage par compte, pointage, vidéo, association réception, début/arrêt du GPS, arrêt pendant envoi, autorisation refusée et page masquée.
- Aperçu visuel isolé vérifié à 390 px et sur bureau ; il ne constitue pas un test caméra Motorola.
- Carte Leaflet / OpenStreetMap vérifiée dans le navigateur, changement de secteur et tuiles réelles.
- Migration delivery-position.sql essayée dans une transaction annulée, avec coordonnées fictives (0,0). Tests serveur réussis : lecture d’une position récente, refus du rejeu, remplacement de session, ancien arrêt sans effet sur la nouvelle session, impossibilité de réactiver après arrêt, coordonnées effacées à l’arrêt, refus hors magasin, refus d’un non-membre, absence de lecture directe/accès anonyme et expiration après 90 secondes.
- Migration serveur NON activée : attente de la confirmation demandée à Alexis pour l’accès aux positions privées. Le client teste la disponibilité avant de permettre l’activation.
- Aucun suivi réel de téléphone ni partage entre deux téléphones validé. Les affectations garage/tournée et les estimations d’arrivée ne sont pas encore connectées au GPS.
- Le partage s’arrête quand la page est masquée/quittée. En cas de coupure, disparition de la vue sous 90 secondes ; la dernière coordonnée persiste en base privée jusqu’à un arrêt confirmé ou une nouvelle activation. Aucun historique des trajets.

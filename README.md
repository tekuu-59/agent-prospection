# Agent de prospection — signalétique

Trouve les **nouvelles entreprises** d'une zone (BODACC), retrouve un **e-mail ou un téléphone** public, puis prépare un **mail de prospection signalétique** (enseigne, vitrophanie, marquage de véhicules, panneaux).

Adapté de [Agent-de-propspection](https://github.com/urdirditfurd/Agent-de-propspection) (version expert-comptable).

## Entreprises écartées d'office

Celles qui n'ont ni vitrine ni véhicule à marquer (`needsSignage` dans `server/prospection-agent.js`) :

- **SCI** et autres sociétés civiles (SCPI, SCCV, GFA, GAEC…), location de biens, marchands de biens
- **Holdings**, prises de participation, sièges sociaux
- **Livreurs** (Uber Eats, Deliveroo, coursiers) et **VTC**
- Activités 100 % en ligne : e-commerce, vente à distance, créateurs de contenu, apporteurs d'affaires, trading

Pour en écarter d'autres, ajoutez un mot-clé à `NO_SIGNAGE_ACTIVITY` ou un code NAF à `NO_SIGNAGE_NAF`.

## Ville et type d'adresse

- **Villes** : saisissez une ou plusieurs villes ou codes postaux, séparés par des virgules (`Évreux, Louviers, 27400`). La ville doit être exacte : « Évreux » n'inclut pas « Le Vieil-Évreux ».
- **Lieu** : chaque fiche est classée **Local pro**, **Domicile probable**, **Domiciliation** ou **Adresse non qualifiée**, avec la raison. Aucune source publique ne le dit directement, c'est déduit d'indices :
  - enseigne déclarée à l'INSEE, zone d'activité, centre commercial → local pro ;
  - appartement, résidence, activité « à domicile » ou « sur les marchés », entrepreneur individuel sans enseigne → domicile probable ;
  - « c/o », « chez », « domiciliation » → domiciliation.
- La case **Masquer les adresses de domicile** écarte les deux dernières catégories. Elle est prudente : un entrepreneur individuel avec boutique mais sans enseigne déclarée sera masqué.

## Utilisation

```
npm install
npm start          # http://localhost:3000/prospection
npm test
```

1. Choisissez un secteur (ou « Tous secteurs »), une période et le département (27 pour l'Eure).
2. Lancez l'agent : la liste se remplit, puis les contacts arrivent.
3. Relisez le mail type (variables `{entreprise}`, `{dirigeant}`, `{activite}`, `{adresse}`), sélectionnez et envoyez.

Sources gratuites, sans clé API : BODACC, API Recherche d'entreprises, OpenStreetMap, PagesJaunes, Brave Search, societe.com.

## Déploiement

`render.yaml` est prêt pour [Render](https://render.com) (offre gratuite, Node).

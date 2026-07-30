# IndexLens

Premier jet d’une webapp Next.js pour comparer les expositions réelles des ETF
iShares : holdings, chevauchement, sleeves actives et écarts sectoriels.

## Démarrage

```bash
npm install
npm run dev
```

Puis ouvrir `http://localhost:3000`.

## Ce qui est déjà prévu

- sélection par indice sous-jacent, puis par enveloppe UCITS ou américaine ;
- ingestion serveur des CSV officiels iShares ;
- cache Next.js de 24 heures et repli visible sur des données de démonstration ;
- processeur pur et réutilisable pour l’overlap et les sleeves actives ;
- endpoints versionnés : `/api/v1/catalog`, `/api/v1/holdings/:ticker` et
  `/api/v1/compare?left=IVV&right=SWDA` ;
- schéma Drizzle versionné pour les ETF, les titres, les snapshots de holdings
  et de futures métriques génériques.

## Architecture

```text
src/
  app/                  routes et API Next.js
  components/           panneaux d’interface réutilisables
  data/
    providers/          adaptateurs de sources externes
    services/           orchestration cache + fallback
  domain/
    processors/         calculs purs indépendants de l’interface
  db/                   modèle de persistance futur
```

Le premier jet ne persiste pas encore les téléchargements dans SQLite : le
cache de 24 h est assuré par Next.js. Le schéma de base est prêt pour un
adaptateur de repository durable, sans modifier les processeurs ni les panneaux.

Les données restent indicatives et ne constituent pas un conseil en
investissement.

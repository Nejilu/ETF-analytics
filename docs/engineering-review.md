# Bilan consolidé des revues d’ingénierie

**État observé :** 2026-08-03
**Objet :** conserver les décisions utiles de la boucle d’optimisation sans
maintenir un journal chronologique redondant.

Le détail d’exécution a été condensé. Les prochaines actions sont dirigées par
le [plan final](iterative-agent-work-plan.md) et les contrats courants par
l’[architecture Metrics Overview](metrics-overview-architecture.md).

## Verdict

La branche est matériellement meilleure en fiabilité, couverture mondiale,
temps de redémarrage et transparence. La livraison est structurée en lots
logiques committés et la suite TypeScript complète passe par la commande standard.
Le build Next production est également validé. Le contrat HTTP v1 et son ETag
sont couverts sur la représentation sérialisée complète.

## Décisions à conserver

### Données et analytique

- La série EPS utilise exclusivement quatre estimations historiques et quatre
  estimations futures. Les EPS publiés ou reconstruits sont exclus.
- P/E, P/B et P/S sont agrégés par moyenne harmonique pondérée sur les valeurs
  positives couvertes.
- Rendement, ROE, dette/equity et bêta restent arithmétiques pondérés.
- Les couvertures et valeurs manquantes sont visibles ; aucun résultat partiel
  n’est présenté comme complet.
- Les axes du bubble chart sont dynamiques. Seuls les points sans série complète,
  sans P/E forward positif ou au-delà du top-500 pondéré sont exclus et comptés.

### Provider, mapping et cache

- TradingView est interrogé en lots, jamais titre par titre pour le Screener.
- `missingSymbols` et `failedSymbols` restent distincts. Un échec de transport
  ne doit jamais devenir une absence persistée.
- Les mappings conservent exchange, provenance, description provider, candidats
  et contrôle d’émetteur.
- Une observation Screener ou Estimates n’est utilisable que si son symbole
  correspond au mapping courant.
- Le cache négatif en mémoire et la table `provider_negative_cache` sont
  conservés. Leur bénéfice après redémarrage est mesuré et très supérieur à
  leur coût conceptuel.
- Les entrées expirent, sont prunées au bootstrap et sont supprimées lorsqu’une
  valeur redevient disponible.

### Runtime et produit

- Les statuts `live`, `cached`, `partial` et `stale` ont des sens distincts et
  utiles. `partial` désigne une absence confirmée ; `stale` une erreur avec
  fallback compatible.
- Les warnings typés restent affichés dans le panel.
- L’ETag est calculé sur le JSON complet effectivement envoyé ; le `304`
  conditionnel n’est donc possible que pour une représentation identique.
- Les requêtes UI sont annulées lors d’un changement de sélection.
- Le launcher standalone conserve les chemins SQLite/migrations et copie les
  assets statiques nécessaires.
- Les endpoints iShares vides ou incomplets déclenchent le fallback officiel
  BlackRock product-data sans assouplir les seuils de plausibilité.

### Persistance et performance locale

- Les écritures mapping, Screener, Estimates et métriques dérivées sont groupées
  en transactions et lots de 250.
- Les deux lectures chaudes Metrics Overview utilisent un SQL paramétré direct
  après mesure du coût Drizzle. Cette exception ne doit pas être généralisée.
- La suppression des anciennes définitions métriques est portée par la migration
  `0009`, pas par l’initialisation applicative.
- Les séries EPS invalides ou JSON malformées sont retirées par les migrations
  `0007` et `0008`, puis protégées par le validateur runtime.

## Preuves principales

| Sujet | Résultat observé |
| --- | --- |
| Audit mapping strict | 3 571 résolus, 0 unresolved, 0 mismatch, provenance complète |
| Couverture mapping | ACWI, CHIP, IEMG, IVV et SP20 à 100 % du poids actions |
| Cache négatif inter-processus | IEMG d’environ 5,9 s à environ 309 ms, 0 symbole redemandé |
| Capture de `databasePath()` | `derive-and-write` environ 126,7 → 49–54 ms |
| Mapping plan | environ 138–149 → 40–48 ms |
| Lecture EPS directe | médiane environ 26,7 → 7,3 ms sur 2 981 lignes |
| DTO compact | variante mesurée puis rejetée : elle supprimait des champs v1 |
| Validation HTTP | réponses 200 puis 304 avec ETag stable sur les univers contrôlés |
| Baseline séquentielle | IVV 1,1 s/654 Ko/32,3 %, ACWI 3,8 s/672 Ko/36,4 %, CHIP 35 ms/71 Ko/116,6 %, IEMG 25,6 s/673 Ko/74,4 % ; mapping 100 % |
| Validation standard | `npm test` : 129/129 tests TS plus audits annexes ; `npm run build` : succès |

Les durées provider dépendent du réseau et de l’état des caches. Elles justifient
les décisions prises mais ne constituent pas un SLA.

## Expériences rejetées

Les variantes suivantes n’ont pas fourni de gain end-to-end reproductible ou
augmentaient la complexité :

- latest-only SQLite avec `ROW_NUMBER`, `NOT EXISTS` ou `MAX(captured_at)` ;
- tailles de lots SQLite supérieures à 250 ;
- suppression du tri SQL au profit d’un tri JavaScript ;
- statements préparés partagés entre lots ;
- lecture des mappings hors ORM pour un gain de quelques millisecondes ;
- tailles de lots Estimates 125 ou 500 ;
- concurrence Screener portée à 4 ;
- chevauchement Screener/Estimates ;
- parsing lazy des métadonnées mapping ;
- nouvelle réduction du DTO par dictionnaire de périodes ;
- cache distribué et découpage supplémentaire en micro-modules.

Ces pistes restent fermées sans changement mesuré de volume ou de profil.

## Écarts par rapport au plan initial

### Simplification incomplète

Le pipeline initial comptait environ 370 lignes dans un service. L’état courant
compte 1 437 lignes non vides dans quatre modules, dont 407 dans
l’orchestrateur après la refactorisation finale. Les responsabilités sont plus
nettes, mais l’objectif indicatif de 250–350 lignes pour l’orchestrateur n’est
pas atteint.

Une partie de cette hausse est justifiée par la provenance, les absences
confirmées, la compatibilité des symboles et les transitions de statut. La
refactorisation finale a supprimé les trois frontières provider répétées et
déplacé l’assemblage ETF dans le module Model sans créer de fichier de
production supplémentaire. Un nouveau découpage serait injustifié sans mesure.

### Contrat API restauré

La compaction par `estimatePeriods`/`estimates` retirait `securityId`,
`providerSymbol`, les deux sommes EPS et les objets détaillés déjà publiés par
`/api/v1`. Elle a été rejetée malgré son gain de payload. Les champs v1 sont
maintenant conservés ; les compteurs transparents sont ajoutés séparément et
testés au niveau modèle et au niveau de la réponse HTTP.

### Documentation et livraison

La boucle précédente avait produit plus de 5 000 lignes réparties sur quatre
documents, avec des mesures répétées et des statuts parfois obsolètes. Le
runbook append-only a été retiré ; ce bilan conserve uniquement décisions,
preuves, rejets et risques.

Le worktree reste physiquement large, mais les changements sont désormais
classés pour une livraison séparée :

- **lot Metrics Overview :** contrat, agrégats, diagnostics Estimates, providers
  TradingView, modèle et panel ;
- **lot données/persistance :** iShares, holdings, repositories, schéma et
  migrations ;
- **lot produit transversal :** Portfolio, Compare, ETF Creator, prix, recherche
  et routes de santé ;
- **lot runtime/publication :** launcher standalone, assets, configuration,
  scripts et documentation.

Aucun nouveau correctif hors Metrics n’a été ajouté pendant cette phase. Ces lots
ont été matérialisés en commits distincts ; la séparation est donc vérifiable
dans l’historique et ne repose pas sur un simple classement documentaire.

| Lot | Fichiers effectivement concernés | Décision |
| --- | --- | --- |
| Metrics Overview | `src/app/api/v1/metrics/overview/**`, `src/components/dashboard/metrics-overview.tsx`, `src/data/services/metrics-overview-*`, `src/data/providers/tradingview-*`, `src/domain/metrics*`, agrégats EPS, repository Metrics et audits TradingView | Conserver et livrer ensemble ; P1–P4 s’y appliquent. |
| Données/persistance | iShares, holdings, repositories non-Metrics, `src/db/**`, `drizzle/**`, caches provider transversaux | Conserver si le test associé passe ; livrer séparément, sans nouvelle extension pendant P5. |
| Produit transversal | routes et composants Catalog, Compare, ETF Creator, Portfolio, prix, recherche et santé ; services/domaines correspondants | Ne pas mélanger au lot Metrics ; aucune anomalie nouvelle corrigée. |
| Runtime/publication | `package*.json`, `.env.example`, launcher/assets standalone, scripts de bootstrap/statistiques, README et CSS global | Conserver pour la publication ; smoke et build requis dans P6. |

## Risques ouverts

1. La complexité totale du pipeline reste élevée malgré la réduction nette de
   l’orchestrateur ; tout nouveau découpage exige une mesure préalable.
2. Les payloads ACWI/IEMG restent proches de 670 Ko et la sélection de quatre
   ETF atteint environ 2,06 Mo ; la compatibilité v1 interdit une compaction
   silencieuse, donc une future réduction exigerait une nouvelle version d’API.

La croissance ETF est désormais reconstruite par earnings yields pondérés ; les
tests couvrent P/E positifs, P/E non positifs et couverture partielle.

## Validation au dernier audit

Succès observés :

```text
npm run typecheck
npm run lint
node scripts/test-migrations.mjs
node scripts/audit-tradingview-mappings.test.mjs
node scripts/audit-tradingview-mappings.mjs --strict --breakdown
node --test --experimental-test-isolation=none \
  scripts/audit-tradingview-mappings.test.mjs \
  scripts/start-standalone-assets.test.mjs
git diff --check
```

La suite de 129 tests TypeScript passe via `npm test`, avec l’audit mapping, le
smoke migrations et les tests d’assets standalone enchaînés par le même script.

Smoke HTTP séquentiel réussi sur IVV, ACWI, CHIP, IEMG et leur sélection
combinée : chaque réponse initiale vaut `200`, chaque requête conditionnelle
vaut `304`, et la couverture de mapping vaut 100 %. IEMG et la sélection
combinée restent `stale` après échec Estimates explicite ; les autres réponses
sont `partial` en raison d’absences confirmées.

Après redémarrage du standalone, CHIP répond en 171 ms puis `304`, avec zéro
symbole Screener et zéro série Estimates demandés. Le contrôle navigateur du
build standalone confirme les graphes de trajectoire P/E, comparaison ETF et
bubble chart, la bascule IVV/ACWI et l’absence d’erreur console.

Le blocage environnemental observé pendant l’audit a été levé lors de la
validation finale :

```text
npm test       -> succès
npm run build  -> succès, TypeScript et génération des 12 pages inclus
```

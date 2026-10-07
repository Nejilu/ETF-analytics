# Audit du projet — 5 octobre 2026

## Avis général

Weightings Analytics dispose déjà d'un moteur d'analyse d'expositions intéressant et d'une discipline de données supérieure à celle d'un simple tableau de bord. Sa direction la plus prometteuse : comprendre ce que l'on détient réellement, expliquer pourquoi une exposition existe et simuler comment la modifier.

Le prochain progrès devrait associer fiabilité, continuité des parcours et trois fonctions distinctives : diagnostic des doublons, simulations avant/après et historique de composition. Ajouter davantage de ratios ou un chat plus généraliste apporte moins de différenciation.

## Périmètre et vérifications

Audit du checkout local sur `main`, incluant les modifications non commitées déjà présentes au début de la session, notamment la réutilisation des snapshots IA et le renouvellement des credentials T3. Lecture du code, documentation, schéma, migrations et CI ; contrôles SQLite en lecture seule ; inspection du navigateur local avec Playwright sur ordinateur et à 390 pixels de largeur.

L'analyse IVV et le chargement des métriques IVV/ACWI ont réellement fonctionné. Ces lectures ont déclenché les rafraîchissements et écritures de cache habituels de l'application. Aucun portefeuille ni ETF enregistré n'a été créé, modifié ou supprimé ; aucun correctif applicatif n'a été effectué.

| Contrôle | Résultat |
| --- | --- |
| `npm run typecheck` | Réussi |
| `npm test` | Réussi : 200 tests TAP, plus le smoke test de migrations |
| Tests supplémentaires du renouvellement T3 | 8 tests réussis ; script absent de la commande principale `npm test` |
| `npm run lint` | Échec : 813 erreurs et 77 avertissements, issus des artefacts dans `.data` |
| `npx eslint . --ignore-pattern '.data/**'` | Réussi |
| SQLite `quick_check` / `foreign_key_check` | `ok` / aucune violation |
| Audit métier des mappings en mode strict | Échec : 44 références orphelines |
| Parcours IA réel | Non vérifié : T3 non connecté dans l'instance locale |
| Build de production / serveur déployé | Non vérifiés ; serveur de développement existant conservé |

Les tests qui simulent des erreurs HTTP 403 réussissent : leurs messages de log ne représentent pas des échecs de la suite.

Au premier relevé, la base contient 22 définitions d'ETF, 2 436 titres, 69 snapshots, 38 500 lignes de holdings et 73 323 observations de métriques. Ce relevé précède les rafraîchissements du navigateur. Le nombre de définitions ne représente pas autant de compositions officielles indépendantes.

## Fonctionnalités actuelles

| Module | Capacités implémentées | Limites principales |
| --- | --- | --- |
| Holdings | Concentration, secteurs, pays/continents, cash, recherche dans les lignes, comparaison de deux fonds, chevauchement et poches actives | Catalogue contrôlé, essentiellement iShares/BlackRock ; pas de recherche universelle de tous les ETF |
| Distorsion | Écart entre poids du fonds et poids ACWI renormalisés sur les titres communs, contribution par titre et couverture | Proxy conditionnel à l'univers commun ; ne mesure ni la qualité ni la performance future d'un fonds |
| Portfolio Manager | ETF et actions, quantités ou valeurs, positions short, cash/emprunt en 14 devises, exposition brute ou NAV, regroupement économique | 50 lignes maximum ; moteur de composition et valorisation, sans journal complet de transactions ni calcul complet de performance |
| ETF Creator | Filtres pays/secteurs/overlap, sélection manuelle, création et édition de paniers locaux | Sélection de titres conservée ; poids recalculés depuis la source, règles de sélection non rejouées automatiquement |
| Metrics | Comparaison jusqu'à quatre fonds, valorisation, rentabilité, croissance, revenu/risque, consensus EPS, graphiques et couverture | Dépend de TradingView ; couverture différente selon la métrique, exclusion des ratios non positifs |
| IA | Templates, question libre, modèles/efforts, recherche web, suivi de conversation, arrêt et historique via T3 | Connexion optionnelle ; protocole T3 interne ; contexte plafonné à 200 positions et agrégats complets |

L'expression « ETF local » désigne une définition analytique sauvegardée. Il faut rendre cette distinction visible pour éviter de laisser penser que l'application crée un fonds négociable.

## Ce qui mérite d'être conservé

- Séparation entre providers, orchestration, repositories et calculs de domaine.
- Identité canonique des titres distincte du regroupement économique affiché : les classes d'actions peuvent être regroupées sans détruire leurs identités.
- Provenance des mappings, validation des réponses, absence de chiffres de substitution inventés.
- Distinction entre absence confirmée, panne provider et valeur de secours périmée.
- Cache négatif persistant, requêtes groupées, concurrence bornée et déduplication des rafraîchissements.
- Migrations, tests de contrats, contraintes SQLite, backup natif et lancement standalone documenté.
- Contexte IA préparé côté serveur, sans montants ni quantités, avec dates, poids signés et couverture de la partie omise.

SQLite reste cohérent avec un outil local ou un service de petite taille à instance unique. Aucun résultat de cet audit ne justifie une migration immédiate vers une architecture distribuée.

## Constats et recommandations prioritaires

### 1. Perte des brouillons lors d'un changement de module — priorité élevée

Le Portfolio Manager est démonté lorsque l'on change de module ; ses positions et formulaires sont stockés dans son état React local. Le navigateur confirme qu'un champ saisi à 1 234 revient à 1 000 après un aller-retour. Un second essai ajoute une position au brouillon sans sauvegarde : le compteur passe à une ligne, puis revient à zéro après un passage dans ETF Creator et un retour. La perte des lignes non enregistrées est donc également reproduite.

Préserver les brouillons dans un store de workspace, puis ajouter une restauration locale et un indicateur d'enregistrement. Couvrir explicitement navigation, rechargement et création d'un nouveau portefeuille. Les données sauvegardées doivent rester distinguées du brouillon en cours.

Références : `comparison-workbench.tsx:2162`, `portfolio-analytics.tsx:118`.

### 2. Références orphelines — priorité élevée

L'audit métier détecte 37 prix et 7 observations de métriques associés à des identifiants absents de `securities`. Les contraintes de clés étrangères ne couvrent pas ces liens polymorphes ; leur contrôle ne détecte donc pas ce problème.

Diagnostiquer la provenance avant de nettoyer, sauvegarder la base, puis corriger la réconciliation ou suppression responsable et ajouter un contrôle de non-régression. Ne pas réattribuer un ancien prix à un nouveau titre sans preuve d'identité. Il s'agit d'un constat sur la base locale, pas d'une preuve que la base de production a le même problème.

Références : `scripts/audit-tradingview-mappings.mjs:308`, tables `market_prices` et `metric_observations`.

### 3. Qualité automatisée incomplète — priorité élevée

La CI fournie installe sous Windows, initialise SQLite et lance TypeScript. Elle ne lance ni la suite de tests, ni ESLint, ni le build. ESLint inclut les fichiers générés dans `.data`, ce qui explique l'échec local massif ; avec ce dossier exclu, le lint réussit.

Ajouter `.data/**` aux exclusions, intégrer les tests de renouvellement T3 à la suite principale, puis exécuter tests, lint et build dans la CI. Ajouter un smoke test Linux pour le runtime de déploiement et quelques tests navigateur ciblés : conservation du brouillon, édition/suppression de panier, comparaison avec cash, panne provider et suivi IA.

Références : `eslint.config.mjs:8`, `.github/workflows/ci.yml`, `package.json`.

### 4. Rendre les approximations immédiatement lisibles — priorité élevée

Certaines parts UCITS réutilisent la composition d'un ETF américain tout en utilisant leur propre cotation. Ces variantes sont exclues du catalogue de recherche Holdings et restent disponibles pour les portefeuilles. La distinction est documentée ; elle mérite un badge au niveau de chaque ligne et du résultat agrégé.

La distorsion mesure l'écart aux poids ACWI sur l'intersection des titres, avec renormalisation. Un faible score ne signifie pas « meilleur ETF ». De même, les poids d'un panier dérivé d'un fonds source ne constituent pas forcément des poids de flottant indépendants des règles de cet indice.

Afficher le type de source, la date économique, la date de récupération, la couverture et la méthode à côté du chiffre. Proposer plus tard un benchmark choisi par l'utilisateur.

Références : `src/data/catalog.ts:44`, `src/domain/processors/analyze-holdings.ts`, `docs/architecture.md`.

### 5. Comparabilité des ratios et du consensus — priorité moyenne à élevée

Les multiples agrégés utilisent des ratios positifs sur les titres couverts. C'est explicite dans les définitions, mais un multiple peut donc représenter un sous-ensemble plutôt que tout le fonds.

Le graphique à bulles transforme deux P/E agrégés dont chacun conserve sa propre couverture (`metrics-overview.tsx:434`). Cette méthode est expliquée dans l'interface. Si les sociétés retenues diffèrent entre les deux périodes, la variation mélange croissance des bénéfices et changement d'univers. Exemple illustratif : un titre A conserve un P/E de 10 ; un titre B, de poids égal, n'a pas de P/E initial mais un P/E futur de 100. Les agrégats passent de 10 à environ 18,18 ; le ratio suggère −45 % alors que A n'a pas changé.

Ajouter un mode à univers constant, la part de poids exclue pour pertes et une décomposition des effets de couverture. Distinguer clairement EPS publié, consensus attaché à des trimestres passés et prévision future ; une courbe au prix actuel n'est pas un historique de valorisation.

### 6. Fraîcheur et dépendances externes — priorité moyenne

Le chargement réel IVV/ACWI aboutit avec un statut `stale` et quatre avertissements. La fenêtre affichée de collecte des fondamentaux va du 19 août au 5 octobre 2026. Une couverture de mapping proche de 100 % n'implique donc pas des métriques complètes et récentes.

Remonter les avertissements essentiels, indiquer le poids affecté par les données anciennes et proposer une vue d'état des sources. Séparer « téléchargé récemment » de « composition récente » et « prix temps réel ». Ajouter une tâche de rafraîchissement indépendante des consultations si l'outil doit être suivi quotidiennement.

Les adaptateurs TradingView utilisent le scanner et un protocole WebSocket spécifique. Le fournisseur ne garantit pas la compatibilité arrière et ses conditions restreignent certains usages et l'usage commercial sans accord séparé. Avant une offre publique ou payante, clarifier les droits applicables et préparer un adaptateur pour une source autorisée ; cet audit ne tranche pas la situation contractuelle de l'installation. Source consultée le 5 octobre : [conditions TradingView, sections 2 et 3](https://www.tradingview.com/policies/).

### 7. Frontière entre usage local et service public — condition de déploiement

Cette branche protège les routes IA par vérification de l'hôte et de l'origine. Les mutations de portefeuille et d'ETF local ne présentent pas d'authentification équivalente dans leurs handlers. Le contrôle du nom d'hôte n'est pas une identité utilisateur.

Pour un usage public, vérifier la branche effectivement déployée, puis appliquer une autorisation cohérente à toutes les lectures privées et mutations, un périmètre de données par propriétaire et des limites de requêtes. Ne pas confondre la documentation de la branche de déploiement avec une validation de son fonctionnement : cette branche et le VPS n'ont pas été audités ici.

Références : `src/server/ai-access.ts:5`, `src/app/api/v1/portfolio/route.ts:63`, `src/app/api/v1/local-etfs/[etfId]/route.ts`.

### 8. Lisibilité et maintenance — amélioration progressive

L'interface est cohérente et s'adapte aux vues mobiles inspectées, sans débordement horizontal de page observé. En revanche, les métadonnées, légendes et avertissements sont petits ; beaucoup d'espace précède les résultats.

Augmenter la taille des textes secondaires, condenser les blocs de sélection une fois les données chargées, afficher un résumé interprétable et conserver les préférences. Ajouter des URL par module et une sélection encodée dans l'URL pour l'historique navigateur et les liens reproductibles.

Le workbench approche 2 200 lignes, le Portfolio Manager 1 700 et le CSS global 5 400. Extraire progressivement les cartes, tableaux, contrôles et hooks métier à mesure des nouvelles fonctions. Une refonte complète n'est pas nécessaire.

## Pistes d'évolution

Les exemples ci-dessous sont des fonctionnalités proposées, pas des résultats calculés sur les portefeuilles actuels.

| Idée | Exemple concret / intérêt | Effort relatif |
| --- | --- | --- |
| Radiographie des doublons | Décomposer une exposition à Microsoft entre ETF et ligne directe ; montrer quelles lignes ajoutent de nouvelles sociétés | Faible à moyen |
| Simulateur avant/après | Ajouter 10 % d'un ETF, remplacer un fonds ou plafonner une société et voir l'effet sur secteurs, concentration et chevauchement | Moyen |
| Comparaison de portefeuilles | Comparer une version actuelle à une cible, avec les contributions aux différences | Moyen |
| Historique des compositions | Entrées/sorties, variations des poids, montée de la concentration et changements de secteurs | Moyen ; historique limité aux données réellement archivées |
| Export de recherche | CSV des expositions, JSON portable d'une définition, fiche de synthèse datée et sourcée | Faible à moyen |
| Import de portefeuille | Import CSV avec aperçu, rapprochement des ISIN et signalement des ambiguïtés | Moyen |
| Rééquilibrage assisté | Cibles, écarts, simulation d'apports et proposition de quantités avec arrondis et frais configurables | Moyen à élevé |
| Budget de concentration | Contraintes par société, pays ou secteur ; expliquer quelle position contribue au dépassement | Moyen |
| Carte des relations | Graphe portefeuille → ETF → sociétés ; navigation par contribution et matrice de chevauchement | Moyen |
| Laboratoire d'indices | Pondération égale, plafond par titre, poids hérités de la source, sélection fixe ou règles réévaluées | Moyen |
| Réplication avec peu de fonds | Trouver une combinaison d'ETF proche d'une cible d'expositions avec limites de coûts et complexité | Élevé ; optimisation multiobjectif |
| Simplification du portefeuille | Chercher les lignes redondantes et montrer la perte d'exposition en les retirant | Moyen |
| Carte d'exposition économique | Distinguer pays de classification et régions de chiffre d'affaires des entreprises | Élevé ; nouvelle source de données |
| Thèmes transversaux | Semi-conducteurs, centres de données, énergie, défense ou santé au-delà des catégories sectorielles | Moyen à élevé ; taxonomie sourcée |
| Actualités pondérées | Trier les événements par exposition indirecte du portefeuille et dater les sources | Moyen à élevé |
| Consensus qui change | Suivre les révisions de bénéfices et la part du fonds dont les attentes progressent ou reculent | Moyen ; captures comparables requises |
| Stress tests transparents | Appliquer des chocs configurés par secteur, entreprise ou devise et montrer leurs contributions | Moyen ; scénarios hypothétiques, pas prévisions |
| Performance et attribution | Séparer effets prix, change, apports, dividendes, frais et positions short | Élevé ; transactions, prix historiques et corporate actions nécessaires |
| Backtest sérieux | Rejouer une règle avec univers connu à chaque date, frais et calendrier de rééquilibrage | Très élevé ; pas une simulation rétroactive sur les seules positions actuelles |
| Dossier de recherche IA | Relier chaque affirmation à une exposition, une source et une date ; enregistrer faits, hypothèses et contre-arguments | Moyen à élevé |
| Journal de décision | Garder la raison d'une allocation, les conditions de réexamen et les résultats du suivi | Faible à moyen |
| Mode pédagogique | Expliquer overlap, pondération harmonique et levier avec mini-exemples interactifs | Faible à moyen |
| Mode adversarial | Chercher les hypothèses fragiles d'un portefeuille : doublons, données anciennes, thèmes cachés et arguments opposés | Moyen |
| Mode local hors ligne | Explorer la dernière base, exporter/importer un workspace et afficher clairement les limites de fraîcheur | Moyen |
| API d'expositions | Exposer le moteur à un notebook ou un autre outil avec contrats documentés et provenance | Moyen ; accès et droits de données à définir |

L'exposition économique par revenus est une direction distincte des pays de classification déjà affichés : MSCI décrit aussi cette différence entre allocation par capitalisation et taille économique dans son analyse [Economic Weighting](https://www.msci.com/research-and-insights/blog-post/economic-weighting-an-alternative-approach-to-country-allocation). Ce serait un complément, avec ses propres sources et méthodes.

## Ordre de développement conseillé

1. **Fiabilité et continuité** : brouillons persistants, diagnostic des orphelins, exclusions lint, CI complète, avertissements lisibles et provenance.
2. **Valeur immédiate** : doublons, comparaison avant/après, export/import et URL reproductibles. Critère de réussite : l'utilisateur comprend ce qu'une modification change dans ses expositions.
3. **Suivi dans le temps** : historique de composition, versions de portefeuille et révisions de consensus. Définir dès maintenant quelles observations conserver et leur politique de rétention.
4. **Exploration avancée** : laboratoire d'indices, simplification et recherche IA liée aux résultats calculés.
5. **Selon la direction choisie** : performance/backtests, données économiques par revenus, collaboration publique ou API. Chaque direction ajoute des exigences différentes ; éviter de toutes les engager simultanément.

Trois évolutions possibles : un outil personnel local de recherche, un laboratoire d'expositions pour utilisateurs avancés ou un service pédagogique de radiographie des ETF. Le moteur actuel est particulièrement adapté au laboratoire d'expositions. Une offre de suivi patrimonial complet demanderait davantage de nouveaux systèmes.

## Limites de cet audit

Pas d'audit exhaustif de sécurité, d'accessibilité ou de performance ; pas de vérification de chaque fonds et de chaque mapping contre les documents émetteurs ; pas d'exécution d'une analyse IA réelle ni de contrôle du VPS. Les faits observés, les limites méthodologiques et les idées de produit sont distingués ci-dessus. Les captures et snapshots de la session sont conservés localement dans `.data/audit-projet-2026-10-05/`.

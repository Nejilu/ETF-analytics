import { getEtfByTicker } from "@/data/catalog";
import type { Holding, HoldingsSnapshot } from "@/domain/etf";

type SeedRow = [
  ticker: string,
  name: string,
  sector: string,
  country: string,
  weight: number,
];

const SP500: SeedRow[] = [
  ["AAPL", "Apple", "Technologies de l’information", "États-Unis", 7.2],
  ["NVDA", "NVIDIA", "Technologies de l’information", "États-Unis", 6.7],
  ["MSFT", "Microsoft", "Technologies de l’information", "États-Unis", 6.1],
  ["AMZN", "Amazon", "Consommation discrétionnaire", "États-Unis", 3.8],
  ["META", "Meta Platforms", "Communication", "États-Unis", 2.9],
  ["GOOGL", "Alphabet A", "Communication", "États-Unis", 2.2],
  ["GOOG", "Alphabet C", "Communication", "États-Unis", 1.9],
  ["BRK.B", "Berkshire Hathaway", "Finance", "États-Unis", 1.8],
  ["AVGO", "Broadcom", "Technologies de l’information", "États-Unis", 1.7],
  ["LLY", "Eli Lilly", "Santé", "États-Unis", 1.5],
  ["JPM", "JPMorgan Chase", "Finance", "États-Unis", 1.3],
  ["TSLA", "Tesla", "Consommation discrétionnaire", "États-Unis", 1.2],
];

const WORLD: SeedRow[] = [
  ["AAPL", "Apple", "Technologies de l’information", "États-Unis", 5.1],
  ["NVDA", "NVIDIA", "Technologies de l’information", "États-Unis", 4.7],
  ["MSFT", "Microsoft", "Technologies de l’information", "États-Unis", 4.3],
  ["AMZN", "Amazon", "Consommation discrétionnaire", "États-Unis", 2.7],
  ["META", "Meta Platforms", "Communication", "États-Unis", 2.0],
  ["GOOGL", "Alphabet A", "Communication", "États-Unis", 1.6],
  ["AVGO", "Broadcom", "Technologies de l’information", "États-Unis", 1.3],
  ["NOVN", "Novartis", "Santé", "Suisse", 0.65],
  ["ASML", "ASML Holding", "Technologies de l’information", "Pays-Bas", 0.62],
  ["NESN", "Nestlé", "Consommation de base", "Suisse", 0.58],
  ["7203", "Toyota Motor", "Consommation discrétionnaire", "Japon", 0.54],
  ["ROG", "Roche", "Santé", "Suisse", 0.5],
];

const ACWI: SeedRow[] = [
  ...WORLD.map((row) => [row[0], row[1], row[2], row[3], row[4] * 0.88] as SeedRow),
  ["TSM", "Taiwan Semiconductor", "Technologies de l’information", "Taïwan", 1.25],
  ["TCEHY", "Tencent", "Communication", "Chine", 0.65],
  ["BABA", "Alibaba", "Consommation discrétionnaire", "Chine", 0.38],
];

const EMERGING: SeedRow[] = [
  ["TSM", "Taiwan Semiconductor", "Technologies de l’information", "Taïwan", 9.2],
  ["TCEHY", "Tencent", "Communication", "Chine", 4.1],
  ["BABA", "Alibaba", "Consommation discrétionnaire", "Chine", 2.6],
  ["005930", "Samsung Electronics", "Technologies de l’information", "Corée du Sud", 2.4],
  ["HDFCBANK", "HDFC Bank", "Finance", "Inde", 1.2],
  ["RELIANCE", "Reliance Industries", "Énergie", "Inde", 1.1],
  ["PDD", "PDD Holdings", "Consommation discrétionnaire", "Chine", 0.8],
  ["ICICIBANK", "ICICI Bank", "Finance", "Inde", 0.75],
  ["INFY", "Infosys", "Technologies de l’information", "Inde", 0.65],
  ["MELI", "MercadoLibre", "Consommation discrétionnaire", "Uruguay", 0.62],
];

const SMALL_CAP: SeedRow[] = [
  ["INSM", "Insmed", "Santé", "États-Unis", 0.75],
  ["FN", "Fabrinet", "Technologies de l’information", "États-Unis", 0.62],
  ["CRDO", "Credo Technology", "Technologies de l’information", "États-Unis", 0.58],
  ["KTOS", "Kratos Defense", "Industrie", "États-Unis", 0.52],
  ["IONQ", "IonQ", "Technologies de l’information", "États-Unis", 0.48],
  ["CVNA", "Carvana", "Consommation discrétionnaire", "États-Unis", 0.46],
  ["FTAI", "FTAI Aviation", "Industrie", "États-Unis", 0.42],
  ["SFM", "Sprouts Farmers Market", "Consommation de base", "États-Unis", 0.4],
  ["RKLB", "Rocket Lab", "Industrie", "États-Unis", 0.38],
  ["HIMS", "Hims & Hers Health", "Santé", "États-Unis", 0.34],
];

const BASE_BY_BENCHMARK: Record<string, SeedRow[]> = {
  "sp-500": SP500,
  "msci-world": WORLD,
  "msci-acwi": ACWI,
  "msci-em-imi": EMERGING,
  "russell-2000": SMALL_CAP,
};

function buildHolding(row: SeedRow): Holding {
  return {
    securityId: `TICKER:${row[0]}`,
    ticker: row[0],
    name: row[1],
    sector: row[2],
    assetClass: "Equity",
    country: row[3],
    weight: row[4],
  };
}

export function getSeedSnapshot(ticker: string): HoldingsSnapshot {
  const etf = getEtfByTicker(ticker);
  if (!etf) {
    throw new Error(`ETF inconnu : ${ticker}`);
  }

  const base = BASE_BY_BENCHMARK[etf.benchmarkId] ?? WORLD;
  const variantShift = etf.wrapper === "UCITS" ? 0.04 : 0;
  const detailed = base.map((row, index) =>
    buildHolding([
      row[0],
      row[1],
      row[2],
      row[3],
      Math.max(0, row[4] + (index === 0 ? variantShift : index === 1 ? -variantShift : 0)),
    ]),
  );
  const detailedWeight = detailed.reduce((sum, holding) => sum + holding.weight, 0);
  const holdings = [
    ...detailed,
    {
      securityId: `TAIL:${etf.benchmarkId}`,
      ticker: "AUTRES",
      name: "Autres lignes non détaillées",
      sector: "Autres",
      assetClass: "Equity",
      country: "Divers",
      weight: Math.max(0, 100 - detailedWeight),
    },
  ];

  return {
    etf,
    asOf: "2026-07-29",
    fetchedAt: new Date().toISOString(),
    sourceStatus: "fallback",
    sourceUrl: etf.holdingsUrl,
    cacheTtlHours: 24,
    warning: "Aperçu basé sur le jeu de démonstration local.",
    holdings,
  };
}

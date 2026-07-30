import type { CatalogGroup, EtfShareClass } from "@/domain/etf";

export const ETF_CATALOG: CatalogGroup[] = [
  {
    id: "sp-500",
    name: "S&P 500",
    provider: "S&P Dow Jones Indices",
    region: "United States · large cap",
    description: "500 leading publicly listed US companies.",
    variants: [
      {
        id: "ivv-us",
        ticker: "IVV",
        name: "iShares Core S&P 500 ETF",
        benchmarkId: "sp-500",
        isin: "US4642872000",
        wrapper: "US_1940_ACT",
        domicile: "United States",
        exchange: "NYSE Arca",
        tradingCurrency: "USD",
        distributionPolicy: "Distributing",
        ter: 0.03,
        productUrl: "https://www.ishares.com/us/products/239726/IVV",
        holdingsUrl:
          "https://www.ishares.com/us/products/239726/ishares-core-s-p-500-etf/latest-holdings.csv",
      },
      {
        id: "cspx-ucits",
        ticker: "CSPX",
        name: "iShares Core S&P 500 UCITS ETF",
        benchmarkId: "sp-500",
        isin: "IE00B5BMR087",
        wrapper: "UCITS",
        domicile: "Ireland",
        exchange: "London Stock Exchange",
        tradingCurrency: "USD",
        distributionPolicy: "Accumulating",
        ter: 0.07,
        productUrl:
          "https://www.ishares.com/uk/individual/en/products/253743/ishares-core-s-p-500-ucits-etf",
        holdingsUrl:
          "https://www.ishares.com/uk/individual/en/products/253743/ishares-core-s-p-500-ucits-etf/1506575576011.ajax?fileType=csv&fileName=CSPX_holdings&dataType=fund",
      },
    ],
  },
  {
    id: "msci-world",
    name: "MSCI World",
    provider: "MSCI",
    region: "Developed markets · global",
    description: "Large- and mid-cap equities across 23 developed markets.",
    variants: [
      {
        id: "urth-us",
        ticker: "URTH",
        name: "iShares MSCI World ETF",
        benchmarkId: "msci-world",
        isin: "US4642863926",
        wrapper: "US_1940_ACT",
        domicile: "United States",
        exchange: "NYSE Arca",
        tradingCurrency: "USD",
        distributionPolicy: "Distributing",
        ter: 0.24,
        productUrl: "https://www.ishares.com/us/products/239696/URTH",
        holdingsUrl:
          "https://www.ishares.com/us/products/239696/ishares-msci-world-etf/latest-holdings.csv",
      },
      {
        id: "swda-ucits",
        ticker: "SWDA",
        name: "iShares Core MSCI World UCITS ETF",
        benchmarkId: "msci-world",
        isin: "IE00B4L5Y983",
        wrapper: "UCITS",
        domicile: "Ireland",
        exchange: "London Stock Exchange",
        tradingCurrency: "GBP",
        distributionPolicy: "Accumulating",
        ter: 0.2,
        productUrl:
          "https://www.ishares.com/uk/individual/en/products/251882/ishares-core-msci-world-ucits-etf",
        holdingsUrl:
          "https://www.ishares.com/ch/individual/en/products/251882/ishares-msci-world-ucits-etf-acc-fund/1495092304805.ajax?dataType=fund&fileName=SWDA_holdings&fileType=csv",
      },
    ],
  },
  {
    id: "msci-acwi",
    name: "MSCI ACWI",
    provider: "MSCI",
    region: "Developed + emerging markets",
    description: "All-country global equity exposure in a single allocation.",
    variants: [
      {
        id: "acwi-us",
        ticker: "ACWI",
        name: "iShares MSCI ACWI ETF",
        benchmarkId: "msci-acwi",
        isin: "US4642882579",
        wrapper: "US_1940_ACT",
        domicile: "United States",
        exchange: "NASDAQ",
        tradingCurrency: "USD",
        distributionPolicy: "Distributing",
        ter: 0.32,
        productUrl: "https://www.ishares.com/us/products/239600/ACWI",
        holdingsUrl:
          "https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf/latest-holdings.csv",
      },
      {
        id: "ssac-ucits",
        ticker: "SSAC",
        name: "iShares MSCI ACWI UCITS ETF",
        benchmarkId: "msci-acwi",
        isin: "IE00B6R52259",
        wrapper: "UCITS",
        domicile: "Ireland",
        exchange: "London Stock Exchange",
        tradingCurrency: "GBP",
        distributionPolicy: "Accumulating",
        ter: 0.2,
        productUrl:
          "https://www.ishares.com/uk/individual/en/products/251850/ishares-msci-acwi-ucits-etf",
        holdingsUrl:
          "https://www.ishares.com/uk/individual/en/products/251850/ishares-msci-acwi-ucits-etf/1506575576011.ajax?fileType=csv&fileName=SSAC_holdings&dataType=fund",
      },
    ],
  },
  {
    id: "msci-em-imi",
    name: "MSCI Emerging Markets IMI",
    provider: "MSCI",
    region: "Emerging markets · all cap",
    description: "Large-, mid- and small-cap equities across emerging markets.",
    variants: [
      {
        id: "iemg-us",
        ticker: "IEMG",
        name: "iShares Core MSCI Emerging Markets ETF",
        benchmarkId: "msci-em-imi",
        isin: "US46434G1031",
        wrapper: "US_1940_ACT",
        domicile: "United States",
        exchange: "NYSE Arca",
        tradingCurrency: "USD",
        distributionPolicy: "Distributing",
        ter: 0.09,
        productUrl: "https://www.ishares.com/us/products/244050/IEMG",
        holdingsUrl:
          "https://www.ishares.com/us/products/244050/ishares-core-msci-emerging-markets-etf/latest-holdings.csv",
      },
      {
        id: "eimi-ucits",
        ticker: "EIMI",
        name: "iShares Core MSCI Emerging Markets IMI UCITS ETF",
        benchmarkId: "msci-em-imi",
        isin: "IE00BKM4GZ66",
        wrapper: "UCITS",
        domicile: "Ireland",
        exchange: "London Stock Exchange",
        tradingCurrency: "USD",
        distributionPolicy: "Accumulating",
        ter: 0.18,
        productUrl:
          "https://www.ishares.com/uk/individual/en/products/264659/ishares-core-msci-em-imi-ucits-etf",
        holdingsUrl:
          "https://www.ishares.com/uk/individual/en/products/264659/ishares-core-msci-em-imi-ucits-etf/1506575576011.ajax?fileType=csv&fileName=EIMI_holdings&dataType=fund",
      },
    ],
  },
  {
    id: "nasdaq-100",
    name: "Nasdaq-100",
    provider: "Nasdaq",
    region: "United States · large cap growth",
    description:
      "100 of the largest non-financial companies listed on the Nasdaq.",
    variants: [
      {
        id: "iqq-us",
        ticker: "IQQ",
        name: "iShares Nasdaq 100 ETF",
        benchmarkId: "nasdaq-100",
        isin: "US46438T3095",
        wrapper: "US_1940_ACT",
        domicile: "United States",
        exchange: "NASDAQ",
        tradingCurrency: "USD",
        distributionPolicy: "Distributing",
        ter: 0.12,
        productUrl:
          "https://www.ishares.com/us/products/351653/ishares-nasdaq-100-etf",
        holdingsUrl:
          "https://www.ishares.com/us/products/351653/ishares-nasdaq-100-etf/latest-holdings.csv",
      },
      {
        id: "cndx-ucits",
        ticker: "CNDX",
        name: "iShares Nasdaq 100 UCITS ETF",
        benchmarkId: "nasdaq-100",
        isin: "IE00B53SZB19",
        wrapper: "UCITS",
        domicile: "Ireland",
        exchange: "London Stock Exchange",
        tradingCurrency: "USD",
        distributionPolicy: "Accumulating",
        ter: 0.3,
        productUrl:
          "https://www.ishares.com/uk/individual/en/products/253741/ishares-nasdaq-100-ucits-etf",
        holdingsUrl:
          "https://www.ishares.com/ch/individual/en/products/253741/ishares-nasdaq-100-ucits-etf/1495092304805.ajax?fileType=csv&fileName=CNDX_holdings&dataType=fund",
      },
    ],
  },
  {
    id: "russell-2000",
    name: "Russell 2000",
    provider: "FTSE Russell",
    region: "United States · small cap",
    description: "The small-cap segment of the US equity market.",
    variants: [
      {
        id: "iwm-us",
        ticker: "IWM",
        name: "iShares Russell 2000 ETF",
        benchmarkId: "russell-2000",
        isin: "US4642876555",
        wrapper: "US_1940_ACT",
        domicile: "United States",
        exchange: "NYSE Arca",
        tradingCurrency: "USD",
        distributionPolicy: "Distributing",
        ter: 0.19,
        productUrl: "https://www.ishares.com/us/products/239710/IWM",
        holdingsUrl:
          "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/latest-holdings.csv",
      },
      {
        id: "iusn-ucits",
        ticker: "IUSN",
        name: "iShares MSCI World Small Cap UCITS ETF",
        benchmarkId: "russell-2000",
        isin: "IE00BF4RFH31",
        wrapper: "UCITS",
        domicile: "Ireland",
        exchange: "London Stock Exchange",
        tradingCurrency: "USD",
        distributionPolicy: "Accumulating",
        ter: 0.35,
        productUrl:
          "https://www.ishares.com/uk/individual/en/products/296576/ishares-msci-world-small-cap-ucits-etf",
        holdingsUrl:
          "https://www.ishares.com/uk/individual/en/products/296576/ishares-msci-world-small-cap-ucits-etf/1506575576011.ajax?fileType=csv&fileName=IUSN_holdings&dataType=fund",
      },
    ],
  },
];

export const ETF_BY_TICKER = new Map<string, EtfShareClass>(
  ETF_CATALOG.flatMap((benchmark) => benchmark.variants).map((etf) => [
    etf.ticker,
    etf,
  ]),
);

export function getEtfByTicker(ticker: string): EtfShareClass | undefined {
  return ETF_BY_TICKER.get(ticker.toUpperCase());
}

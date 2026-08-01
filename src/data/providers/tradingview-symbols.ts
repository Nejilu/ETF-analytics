import type { Holding } from "@/domain/etf";

type SymbolInput = Pick<
  Holding,
  "ticker" | "name" | "country" | "exchange"
>;

const EXCHANGE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["nasdaq", "NASDAQ"], ["new york stock exchange", "NYSE"],
  ["nyse", "NYSE"], ["amex", "AMEX"], ["cboe", "CBOE"],
  ["london", "LSE"], ["euronext amsterdam", "EURONEXT"],
  ["amsterdam", "EURONEXT"], ["euronext brussels", "EURONEXT"],
  ["euronext paris", "EURONEXT"], ["paris", "EURONEXT"],
  ["euronext lisbon", "EURONEXT"], ["irish", "EURONEXT"],
  ["swiss", "SIX"], ["six", "SIX"], ["hong kong", "HKEX"],
  ["taiwan", "TWSE"], ["gretai", "TPEX"], ["kosdaq", "KOSDAQ"],
  ["korea", "KRX"], ["tokyo", "TSE"], ["toronto", "TSX"],
  ["xetra", "XETR"], ["deutsche boerse", "XETR"],
  ["frankfurt", "FWB"], ["australian", "ASX"], ["asx", "ASX"],
  ["ital", "MIL"], ["milan", "MIL"], ["copenhagen", "OMXCOP"],
  ["madrid", "BME"], ["singapore", "SGX"], ["shanghai", "SSE"],
  ["shenzhen", "SZSE"], ["johannesburg", "JSE"], ["india", "NSE"],
  ["saudi", "TADAWUL"], ["tel aviv", "TASE"],
  ["brazil", "BMFBOVESPA"], ["xbsp", "BMFBOVESPA"],
  ["warsaw", "GPW"], ["vienna", "VIE"], ["wiener", "VIE"],
  ["istanbul", "BIST"], ["standard-classica-forts", "MOEX"],
  ["bursa malaysia", "MYX"], ["malaysia", "MYX"],
  ["mexic", "BMV"], ["thailand", "SET"], ["indonesia", "IDX"],
  ["philippine", "PSE"], ["qatar", "QSE"], ["abu dhabi", "ADX"],
  ["dubai", "DFM"], ["bse ltd", "BSE"], ["kuwait", "KSE"],
  ["oslo", "OSL"], ["stockholm", "OMXSTO"],
  ["helsinki", "OMXHEX"], ["prague", "PSECZ"], ["egypt", "EGX"],
  ["colombia", "BVC"], ["santiago", "BCS"], ["athens", "ATHEX"],
  ["new zealand", "NZX"], ["budapest", "BET"],
];

const COUNTRY_PREFIXES: Record<string, string[]> = {
  "united states": ["NASDAQ", "NYSE", "AMEX"],
  canada: ["TSX"], "united kingdom": ["LSE"], switzerland: ["SIX"],
  japan: ["TSE"], australia: ["ASX"], "hong kong": ["HKEX"],
  china: ["HKEX", "SSE", "SZSE"], taiwan: ["TWSE", "TPEX"],
  "south korea": ["KRX", "KOSDAQ"], korea: ["KRX", "KOSDAQ"],
  "korea (south)": ["KRX", "KOSDAQ"],
  germany: ["XETR", "FWB"], france: ["EURONEXT"],
  netherlands: ["EURONEXT"], belgium: ["EURONEXT"],
  portugal: ["EURONEXT"], ireland: ["EURONEXT"], italy: ["MIL"],
  spain: ["BME"], denmark: ["OMXCOP"], sweden: ["OMXSTO"],
  finland: ["OMXHEX"], norway: ["OSL"], india: ["NSE", "BSE"],
  singapore: ["SGX"], brazil: ["BMFBOVESPA"], mexico: ["BMV"],
  "south africa": ["JSE"], malaysia: ["MYX"], thailand: ["SET"],
  indonesia: ["IDX"], philippines: ["PSE"], "new zealand": ["NZX"],
  austria: ["VIE"], poland: ["GPW"], turkey: ["BIST"], israel: ["TASE"],
  "saudi arabia": ["TADAWUL"], "united arab emirates": ["ADX", "DFM"],
  qatar: ["QSE"], kuwait: ["KSE"],
  chile: ["BCS"], colombia: ["BVC"], greece: ["ATHEX"],
  "czech republic": ["PSECZ"], hungary: ["BET"], egypt: ["EGX"],
};

const DEPOSITARY_RECEIPT_PREFIXES: Record<string, string> = {
  ASML: "NASDAQ",
};

function prefixes(input: SymbolInput): string[] {
  const exchange = (input.exchange ?? "").toLocaleLowerCase("en-US");
  const country = (input.country ?? "").toLocaleLowerCase("en-US");
  const name = input.name.toLocaleLowerCase("en-US");
  const depositaryPrefix = DEPOSITARY_RECEIPT_PREFIXES[input.ticker.toLocaleUpperCase("en-US")];
  if (depositaryPrefix && (name.includes("adr") || name.includes("depositary"))) {
    return [depositaryPrefix];
  }
  let exact: string | undefined;
  if (exchange.includes("nasdaq omx helsinki")) exact = "OMXHEX";
  else if (exchange.includes("nasdaq omx nordic")) {
    exact = country.includes("denmark")
      ? "OMXCOP"
      : country.includes("sweden")
        ? "OMXSTO"
        : country.includes("finland")
          ? "OMXHEX"
          : country.includes("norway")
            ? "OSL"
            : undefined;
  } else {
    exact = EXCHANGE_PREFIXES.find(([needle]) => exchange.includes(needle))?.[1];
  }
  return exact ? [exact] : (COUNTRY_PREFIXES[country] ?? []);
}

function normalizedTicker(input: SymbolInput, prefix: string): string {
  let ticker = input.ticker.trim().replace(/\s+/g, "_");
  const name = input.name.toLocaleLowerCase("en-US");
  if (ticker === "BRKB" && name.includes("berkshire")) ticker = "BRK.B";
  if (ticker === "GMEXICOB" && name.includes("grupo mexico")) ticker = "GMEXICO/B";
  if (prefix === "BIST") ticker = ticker.replace(/\.E$/i, "");
  if (prefix === "NSE") ticker = ticker.replace(/-/g, "_");
  if (prefix === "NSE" && ticker === "SHFL") ticker = "SHRIRAMFIN";
  if (prefix === "MYX" && ticker === "SWB") ticker = "SUNWAY";
  if (prefix === "PSECZ" && ticker === "BAAKOMB") ticker = "KOMB";
  if (prefix === "NYSE" && ticker === "HEIA" && name.includes("heico")) ticker = "HEI.A";
  if (prefix === "NYSE" && ticker === "BFB" && name.includes("brown forman")) ticker = "BF.B";
  if (prefix === "TSX" && /^\d+D$/.test(ticker) && name.includes("constellation software")) ticker = "CSU";
  return ticker;
}

function aliases(prefix: string, ticker: string): string[] {
  const result: string[] = [];
  if (prefix === "BMV") {
    const mexicanAliases: Record<string, string> = {
      CEMEXCPO: "CEMEX/CPO", FEMSAUBD: "FEMSA/UBD", FUNO11: "FUNO/11",
      GCARSOA1: "GCARSO/A1", GFINBURO: "GFINBUR/O", GFNORTEO: "GFNORTE/O",
      "AC*": "AC", "PE&OLES*": "PENOLES",
    };
    if (mexicanAliases[ticker]) result.push(mexicanAliases[ticker]);
    const classMatch = ticker.match(/^(.+)([AB])$/);
    if (classMatch) result.push(`${classMatch[1]}/${classMatch[2]}`);
  }
  if (prefix === "BCS" && ticker.includes(".")) result.push(ticker.replace(".", "/"));
  return result;
}

export function tradingViewSymbolCandidates(input: SymbolInput): string[] {
  if (!input.ticker || input.ticker === "—" || input.ticker === "-" || input.ticker === "Cash") {
    return [];
  }
  return [...new Set(prefixes(input).flatMap((prefix) => {
    const ticker = normalizedTicker(input, prefix);
    return [ticker, ...aliases(prefix, ticker)].map((value) => `${prefix}:${value}`);
  }))];
}

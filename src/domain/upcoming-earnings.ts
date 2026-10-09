export interface UpcomingEarningsObservation {
  providerSymbol: string;
  reportDate: string | null;
  exchangeTimezone: string | null;
  capturedAt: string;
}

export interface UpcomingEarningsView {
  reportDate: string | null;
  exchangeTimezone: string | null;
  capturedAt: string | null;
  sourceStatus: "live" | "cached" | "stale" | "unavailable";
}

export function dateInTimezone(timestamp: number, timezone: string | null): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(timestamp);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function parseUpcomingEarningsDate(timestamp: unknown, timezone: unknown) {
  let exchangeTimezone: string | null = null;
  if (typeof timezone === "string") {
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); exchangeTimezone = timezone; } catch { /* Use UTC if the provider has no valid timezone. */ }
  }
  // Screener dates are Unix seconds. Reject malformed dates and millisecond timestamps.
  const reportDate = typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0 && timestamp < 4_102_444_800
    ? dateInTimezone(timestamp * 1_000, exchangeTimezone) : null;
  return { reportDate, exchangeTimezone };
}

export function upcomingEarningsAreFresh(
  observation: UpcomingEarningsObservation | undefined,
  providerSymbol: string | undefined,
  ttlSeconds: number,
  now = Date.now(),
): boolean {
  if (!observation || !providerSymbol || observation.providerSymbol !== providerSymbol) return false;
  const capturedAt = Date.parse(observation.capturedAt);
  if (!Number.isFinite(capturedAt) || now - capturedAt >= ttlSeconds * 1_000) return false;
  const today = dateInTimezone(now, observation.exchangeTimezone);
  // Once the reported date has passed, retry on a new day even if the TTL remains fresh.
  return !observation.reportDate || observation.reportDate >= today
    || dateInTimezone(capturedAt, observation.exchangeTimezone) === today;
}

export function upcomingEarningsView(
  observation: UpcomingEarningsObservation | undefined,
  providerSymbol: string | undefined,
  ttlSeconds: number,
  requestStartedAt: number,
  screenerUnavailable: boolean,
  now = Date.now(),
): UpcomingEarningsView {
  if (!observation || !providerSymbol || observation.providerSymbol !== providerSymbol) {
    return { reportDate: null, exchangeTimezone: null, capturedAt: null, sourceStatus: "unavailable" };
  }
  const today = dateInTimezone(now, observation.exchangeTimezone);
  return {
    reportDate: observation.reportDate && observation.reportDate >= today ? observation.reportDate : null,
    exchangeTimezone: observation.exchangeTimezone,
    capturedAt: observation.capturedAt,
    sourceStatus: screenerUnavailable || !upcomingEarningsAreFresh(observation, providerSymbol, ttlSeconds, now)
      ? "stale" : Date.parse(observation.capturedAt) >= requestStartedAt ? "live" : "cached",
  };
}

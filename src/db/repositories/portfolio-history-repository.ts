import { asc, desc, eq } from "drizzle-orm";
import { getDb, getSqlite } from "../client";
import { portfolioHistorySettings, portfolioValueSnapshots, portfolios } from "../schema";
import type { PortfolioHistory, PortfolioValueSnapshot } from "@/domain/portfolio-history";
import { PORTFOLIO_HISTORY_RETRY_MS } from "@/domain/portfolio-history";

export function portfolioHistoryIds(): string[] {
  return getDb().select({ id: portfolios.id }).from(portfolios).all().map((row) => row.id);
}

export function loadPortfolioHistory(id: string): PortfolioHistory {
  const settings = getDb().select().from(portfolioHistorySettings).where(eq(portfolioHistorySettings.portfolioId, id)).get();
  return {
    enabled: settings?.enabled ?? true,
    lastAttemptAt: settings?.lastAttemptAt ?? null,
    lastError: settings?.lastError ?? null,
    snapshots: getDb().select().from(portfolioValueSnapshots).where(eq(portfolioValueSnapshots.portfolioId, id)).orderBy(asc(portfolioValueSnapshots.date)).all(),
  };
}

export function latestPortfolioSnapshot(id: string) {
  return getDb().select().from(portfolioValueSnapshots).where(eq(portfolioValueSnapshots.portfolioId, id)).orderBy(desc(portfolioValueSnapshots.date)).limit(1).get();
}

export function setPortfolioHistoryEnabled(id: string, enabled: boolean) {
  getDb().insert(portfolioHistorySettings).values({ portfolioId: id, enabled }).onConflictDoUpdate({
    target: portfolioHistorySettings.portfolioId, set: { enabled },
  }).run();
}

// Atomic claim also prevents separate Next workers from refreshing the same
// portfolio simultaneously. Failed/interrupted claims expire after five minutes.
export function claimPortfolioSnapshot(id: string, now: Date): boolean {
  const sqlite = getSqlite();
  return sqlite.transaction(() => {
    sqlite.prepare("INSERT INTO portfolio_history_settings (portfolio_id) VALUES (?) ON CONFLICT DO NOTHING").run(id);
    return sqlite.prepare(`UPDATE portfolio_history_settings SET last_attempt_at = ?
      WHERE portfolio_id = ? AND enabled = 1 AND (last_attempt_at IS NULL OR last_attempt_at <= ?)`)
      .run(now.toISOString(), id, new Date(now.getTime() - PORTFOLIO_HISTORY_RETRY_MS).toISOString()).changes === 1;
  })();
}

export function finishPortfolioSnapshot(id: string, snapshot: PortfolioValueSnapshot) {
  const sqlite = getSqlite();
  return sqlite.transaction(() => {
    const settings = getDb().select().from(portfolioHistorySettings).where(eq(portfolioHistorySettings.portfolioId, id)).get();
    if (!settings?.enabled) return false;
    const inserted = getDb().insert(portfolioValueSnapshots).values({ portfolioId: id, ...snapshot }).onConflictDoNothing().run();
    getDb().update(portfolioHistorySettings).set({ lastError: null }).where(eq(portfolioHistorySettings.portfolioId, id)).run();
    return inserted.changes === 1;
  })();
}

export function failPortfolioSnapshot(id: string, error: string) {
  getDb().update(portfolioHistorySettings).set({ lastError: error.slice(0, 500) }).where(eq(portfolioHistorySettings.portfolioId, id)).run();
}

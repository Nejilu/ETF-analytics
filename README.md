# IndexLens

IndexLens is a Next.js application for comparing the underlying exposures of
iShares ETFs: holdings, weighted overlap, active sleeves and sector allocation.

## Development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

`npm run dev` applies the committed SQLite migrations and idempotently seeds
the ETF catalog before starting Next.js. The durable database is stored at
`.data/index-lens.sqlite` by default.

## Local production deployment

```bash
npm ci
npm run build
npm run start
```

The application is served at `http://localhost:3000`. Use `/api/health` to
check that both the application and its database are operational. A future
Docker image can use the same commands, migrations and persistence layer.

## Local persistence

IndexLens uses Drizzle ORM with `better-sqlite3`. Set `DATABASE_PATH` in a
local `.env` file to move the database without changing application code:

```env
DATABASE_PATH=.data/index-lens.sqlite
HOLDINGS_CACHE_TTL_SECONDS=86400
```

Relative paths resolve from the project root. The database and its WAL files
are ignored by Git, so commits, rebuilds and deletion of `.next` do not remove
stored holdings.

Useful commands:

```bash
npm test           # processor tests plus a legacy-database migration smoke test
npm run db:setup   # apply migrations and seed the ETF catalog
npm run db:stats   # show row counts and database size
npm run db:backup  # create a safe SQLite backup
```

After a code update, run:

```bash
git pull
npm ci
npm run db:setup
npm run build
npm run start
```

`db:setup` is safe to run repeatedly and does not delete snapshots. Backups
are written below `.data/backups/`.

## Current scope

- Select an underlying index, then a US or UCITS ETF wrapper.
- Ingest official iShares CSV files on the server.
- Persist normalized securities and holdings snapshots in local SQLite.
- Reuse snapshots for 24 hours and return the latest persisted snapshot as
  stale data when iShares is temporarily unavailable.
- Use a pure, reusable processor for weighted overlap and active sleeves.
- Rank security-level active weights independently for either ETF.
- Build and persist a mixed ETF/direct-stock portfolio, using ACWI holdings as
  the searchable stock universe.
- Expand every ETF sleeve, merge duplicate direct and indirect exposures, and
  rank the resulting synthetic portfolio at security level.
- Save a fully allocated portfolio as a reusable local ETF. Its component
  sleeves remain relational, while its security-level holdings are recalculated
  from the latest persisted source ETF compositions whenever it is selected.
- Select saved portfolio ETFs in the standard holdings and ETF comparison
  workflows under the `Saved portfolios` catalog group.
- Use a persistent light or dark interface theme.
- Expose versioned endpoints: `/api/v1/catalog`,
  `/api/v1/holdings/:ticker` and
  `/api/v1/compare?left=IVV&right=SWDA`, plus `/api/v1/portfolio` and
  `/api/v1/securities/search?q=AAPL`. Portfolio ETFs are created through
  `/api/v1/portfolio/save-as-etf`.
- Provide versioned Drizzle migrations for the local database.

## Architecture

```text
src/
  app/                  Next.js routes and API handlers
  components/           reusable interface panels
  data/
    providers/          external source adapters
    services/           persistence and refresh orchestration
  domain/
    processors/         pure calculations independent of the interface
  db/
    repositories/       isolated persistence queries
    client.ts           SQLite connection and runtime configuration
    schema.ts           versioned relational model
scripts/                migration, seed, stats and backup commands
drizzle/                committed SQL migrations
.data/                  local database and backups, ignored by Git
```

The catalog is seeded from the versioned source manifest. Holdings are fetched
on first access, validated, deduplicated and inserted transactionally. Later
requests read SQLite first; iShares is contacted only after the configured TTL
expires. If refresh fails, the latest persisted snapshot remains available.
HTTP 503 is returned only when no snapshot has ever been stored for the ETF.

No demonstration holdings dataset is included. Each installation builds its
own local history from official iShares source files.

Data is indicative and does not constitute investment advice.

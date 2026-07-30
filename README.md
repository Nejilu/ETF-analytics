# IndexLens

IndexLens is a Next.js application for comparing the underlying exposures of
iShares ETFs: holdings, weighted overlap, active sleeves and sector allocation.

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Local production deployment

```bash
npm ci
npm run build
npm run start
```

The application is served at `http://localhost:3000`. Use `/api/health` to
check that the instance is operational. The Next.js build uses `standalone`
output and can therefore be packaged in Docker later without changing the
application.

## Current scope

- Select an underlying index, then a US or UCITS ETF wrapper.
- Ingest official iShares CSV files on the server.
- Cache source files for 24 hours without synthetic or fallback figures.
- Use a pure, reusable processor for weighted overlap and active sleeves.
- Rank security-level active weights independently for either ETF.
- Use a persistent light or dark interface theme.
- Expose versioned endpoints: `/api/v1/catalog`,
  `/api/v1/holdings/:ticker` and
  `/api/v1/compare?left=IVV&right=SWDA`.
- Provide a versioned Drizzle schema for ETFs, securities, holdings snapshots
  and future generic metrics.

## Architecture

```text
src/
  app/                  Next.js routes and API handlers
  components/           reusable interface panels
  data/
    providers/          external source adapters
    services/           cache orchestration and explicit source errors
  domain/
    processors/         pure calculations independent of the interface
  db/                   future persistence model
```

The first release does not yet persist downloads to SQLite. Next.js provides
the 24-hour source cache. If iShares does not respond, the API returns HTTP 503
and the interface marks the affected data as unavailable. No demonstration
dataset is used. The database schema is ready for a durable repository adapter
without requiring changes to the processors or panels.

Data is indicative and does not constitute investment advice.

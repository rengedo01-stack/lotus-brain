# Lotus BRAIN

Lotus BRAIN is a pnpm workspace managed with Turborepo.

## Requirements

- Node.js 20.19.0 or later
- pnpm 11.15.1

## Getting started

Install dependencies from the repository root:

```bash
pnpm install
```

Start all development tasks:

```bash
pnpm dev
```

The web application is available at [http://localhost:3000](http://localhost:3000). The API health check is available at [http://localhost:3001/api/v1/health](http://localhost:3001/api/v1/health), and Swagger UI is available at [http://localhost:3001/api/v1/docs](http://localhost:3001/api/v1/docs).

### API configuration

The API reads its runtime configuration through `@nestjs/config`. Copy `apps/api/.env.example` to `apps/api/.env` before starting the API, then replace the example PostgreSQL password with a local value. The `.env` file is ignored and must not be committed.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime environment (`development`, `test`, or `production`). |
| `PORT` | `3001` | API listening port. |
| `CORS_ORIGIN` | `http://localhost:3000` | Comma-separated allowed CORS origins. |
| `LOG_LEVEL` | `debug` (development), `info` (production) | Pino log level. |
| `POSTGRES_DB` | `lotus_brain` | Development PostgreSQL database name. |
| `POSTGRES_USER` | `lotus_brain` | Development PostgreSQL role name. |
| `POSTGRES_PASSWORD` | — | Development PostgreSQL password; set a local non-example value. |
| `DATABASE_URL` | — | Required PostgreSQL connection URL. Keep its credentials aligned with the PostgreSQL variables above. |

### Database foundation

The development PostgreSQL service is defined in `compose.yaml`. Start it with the API environment file:

```bash
cp apps/api/.env.example apps/api/.env
docker compose --env-file apps/api/.env up -d postgres
docker compose --env-file apps/api/.env ps
```

The `postgres_data` named volume persists local database data. The service healthcheck uses `pg_isready`; wait for the status to become `healthy` before starting the API. Stop the local service while retaining its volume with:

```bash
docker compose --env-file apps/api/.env down
```

Prisma's schema source of truth is `apps/api/prisma/schema.prisma`, with forward-only migrations in `apps/api/prisma/migrations`. The current data model contains `Product`, `Unit`, `ProductUnitConversion`, `Supplier`, `PriceMaster`, `PriceHistory`, `Inventory`, `InventoryHistory`, `Purchase`, `PurchaseItem`, `PurchaseLog`, `Recipe`, `RecipeItem`, `Production`, and `ProductionConsumption`. Purchase quantities are constrained to each product's inventory unit. Database triggers mark a `PurchaseItem` as source-locked when price or inventory history first references it. `sourceLockedAt` is a database-managed immutable audit field: once set, it cannot be cleared or rewritten, and the parent purchase cannot be reassigned. The receipt trigger locks the source `PurchaseItem` and then its parent `Purchase`, requiring `POSTED` status before a purchase-sourced inventory receipt is written. Recipe units use canonical Product-specific factors to the base unit; the database derives the source-unit-to-inventory-unit ratio and rejects missing, cross-dimension, or identity conversion definitions. Production consumption records snapshot converted inventory quantity, conversion factor, and cost. Each Production also snapshots its Recipe output product, yield quantity, and yield unit when it is created; those values and its `recipeId` cannot be rewritten. Once a Recipe has any Production reference, its output definition, revision, and RecipeItem composition are database-immutable. Create a new Recipe row with the next revision for structural changes; `name`, `note`, and `status` remain editable metadata. The database checks `recipe quantity × conversion factor = inventory quantity` at 9 decimal places and `inventory quantity × unit cost = amount` at 6 decimal places. A consumption can create a single `CONSUMPTION` inventory history only while its parent production is `POSTED`. Future application code must use the documented source-row → parent-row lock order and perform conditional state transitions with stock effects in one transaction. Future domain code must access Prisma behind application/infrastructure boundaries rather than importing it directly.

Validate the schema and generate the API client from the repository root:

```bash
pnpm --filter @lotus-brain/api prisma:validate
pnpm --filter @lotus-brain/api prisma:generate
```

## Workspace commands

Run these commands from the repository root. Turborepo executes the matching tasks across workspace packages in dependency order and caches eligible results locally.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start development tasks; this is persistent and is not cached. |
| `pnpm build` | Build all workspace packages. Next.js build output is cached, excluding its internal cache. |
| `pnpm lint` | Run linting across workspace packages. |

The workspace contains the web application at `apps/web` and the NestJS API at `apps/api`. Add future shared packages under `packages/*`; they are automatically included by the pnpm workspace and Turborepo task graph.

## Remote caching

The repository uses Turbo's local cache by default. To enable a shared remote cache, authenticate and link the repository with your Vercel team:

```bash
pnpm turbo login
pnpm turbo link
```

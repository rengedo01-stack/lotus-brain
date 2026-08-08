# Lotus BRAIN

Lotus BRAIN is a pnpm workspace managed with Turborepo.

## Requirements

- Node.js 20.11.1 or later
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

The web application is available at [http://localhost:3000](http://localhost:3000), and the API health check is available at [http://localhost:3001/health](http://localhost:3001/health).

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

# Conflow

A local, human-in-the-loop LinkedIn content engine: generate a matrix of
drafts in one voice, guard against repetition, review and approve them, then
publish manually (for now).

npm workspaces monorepo, three packages:

```
packages/
  server/   CLI + HTTP API + BullMQ worker — the actual engine.
            Postgres + pgvector, Redis, model/embedding calls.
            Start here: packages/server/README.md
  shared/   Types shared across the network boundary (PostRow, RunRow, ...).
            No runtime code, no build step — see its package.json.
  web/      The frontend: a Vite + React SPA, plus a small Express BFF
            (packages/web/server) that serves the built app and proxies
            /api/* to the real backend, injecting the API token server-side
            so it never reaches the browser.
```

## Quick start

```sh
npm install                      # installs and links all three packages
docker compose up -d             # postgres + redis + minio (repo-root infra)

npm run typecheck                # -> @content-engine/server
npm test                         # -> @content-engine/server
npm run build                    # -> @content-engine/server

npm run dev -w @content-engine/server -- <command>   # the CLI, see packages/server/README.md
npm run api:dev -w @content-engine/server            # the HTTP API
npm run worker:dev -w @content-engine/server         # the BullMQ worker

npm run dev -w @content-engine/web                   # Vite dev server (frontend)
npm run bff -w @content-engine/web                   # the BFF (needs packages/web/.env)
```

The root-level `typecheck`/`test`/`build`/`dev`/`api:dev`/`worker:dev` scripts
are just shortcuts to the `@content-engine/server` versions — most day-to-day
backend work only needs those, not the `-w` form.

## Where things actually live

`docker-compose.yml` and `scripts/postgres-init/`'s docker-compose reference
stay at the repo root — they're dev infrastructure for the whole project
(Postgres/Redis/MinIO), not specific to one package.

Everything else backend-related — the run book, the full CLI command list,
the HTTP API routes, architecture notes — is in
[`packages/server/README.md`](packages/server/README.md) and
[`packages/server/docs/architecture.md`](packages/server/docs/architecture.md).
The frontend doesn't have much to document yet — it's a fresh scaffold
(Vite + React + Tailwind + shadcn/ui, `better-design` for the design system).

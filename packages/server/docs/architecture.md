# Architecture — CLI, API, worker

Phase 1 was a single CLI. M12 added an HTTP API and a background worker **without
forking the codebase**: the CLI, the API, and the worker are three thin shells
over the same `pipeline/` · `store/` · `cards/` · `export/` code.

```
        ┌─────────┐      ┌─────────┐      ┌──────────┐
        │  cli.ts │      │  api/   │      │ worker/  │      three entrypoints
        └────┬────┘      └────┬────┘      └────┬─────┘      (three processes)
             │                │                │
             └────────────────┴────────────────┘
                              │  they all import:
             ┌────────────────┼────────────────┬───────────────┐
        pipeline/          store/           queue/          config/  util/
        (generate,        (Postgres        (enqueue a       (env)   (errors,
         dedup,             access)          job, read                logger…)
         regenerate)                         its status)
```

Nothing in `pipeline/` or `store/` knows whether it was called by the CLI, an
HTTP handler, or a queue worker.

---

## The three processes

| process | command | what it is | talks to |
|---|---|---|---|
| **CLI** | `npm run dev -- <cmd>` | one-shot commands, exits when done | Postgres, model APIs |
| **API** | `npm run api` | long-lived HTTP server; fast reads/writes inline, long jobs handed to the queue | Postgres, Redis |
| **worker** | `npm run worker` | long-lived; pulls jobs off the queue and runs the pipeline | Postgres, Redis, model APIs |

The API and the worker **never call each other**. Everything between them goes
through two shared stores:

- **Redis** (the queue) — "there is a job to do", plus its status/progress/result
- **Postgres** — the actual data (runs, posts, embeddings); the run row also
  carries the job's lifecycle (`status`, `error`, `progress_json`)

---

## Lifecycle of a generation run

```
  client                API (process 1)          Redis            worker (process 2)       Postgres
    │                        │                     │                     │                     │
    │ POST /v1/runs          │                     │                     │                     │
    │───────────────────────>│                     │                     │                     │
    │                        │ insertRun(status=queued)─────────────────────────────────────-->│
    │                        │ enqueueJob("generate",{runId})            │                     │
    │                        │────────────────────>│ (job stored in Redis)                     │
    │                        │ setRunJobId(runId, jobId)─────────────────────────────────────->│
    │  202 {runId, jobId}    │                     │                     │                     │
    │<───────────────────────│                     │                     │                     │
    │                        │                     │  BRPOPLPUSH (blocking pull)               │
    │                        │                     │<────────────────────│                     │
    │                        │                     │                     │ runGenerationForRun(run)
    │                        │                     │                     │ setRunStatus(running)──>│
    │                        │                     │                     │ …expand, generate,     │
    │                        │                     │                     │   dedup, insertPost ×N─>│
    │                        │                     │  job.updateProgress({postsCreated…})      │
    │                        │                     │<────────────────────│  + setRunProgress()───>│
    │                        │                     │                     │ setRunStatus(completed)>│
    │                        │                     │  job → "completed"  │                     │
    │                        │                     │<────────────────────│                     │
    │                        │                     │                     │                     │
    │ GET /v1/runs/:id  (poll — or GET /v1/runs/:id/events, SSE, pushes the │
    │  same nudge instead of the client asking)    │                     │                     │
    │───────────────────────>│ read run + posts ────────────────────────────────────────────-->│
    │  {run:{status:"completed"…}, counts, …}      │                     │                     │
    │<───────────────────────│                     │                     │                     │
```

Key point: the API's job after `POST /v1/runs` is **done in milliseconds**. It
created a row, dropped a message, and returned. The worker picks the message up
whenever it's free. The client learns the outcome by reading Postgres again
(`GET /v1/runs/:id`), not by holding the original request open.

---

## What Redis / BullMQ actually does

BullMQ is a library that implements a job queue *on top of* Redis data
structures. Redis is a plain container running `redis-server` — it has no idea
this project exists. BullMQ gives us, for free, four things a bare queue (SQS,
Cloud Tasks) does not:

1. **Atomic claim** — `Queue.add` does `LPUSH`; `Worker` does a blocking
   `BRPOPLPUSH` that atomically moves the job to an "active" list. Two workers
   can never grab the same job.
2. **Job state + result store** — job status (`waiting`/`active`/`completed`/
   `failed`), progress, return value, and failure reason all live in Redis
   hashes. That's what `GET /v1/jobs/:id` reads.
3. **Pub/sub events** — `job.updateProgress()` and completion publish on a Redis
   channel. `queue/queue.ts`'s `subscribeToJob()` wraps one shared `QueueEvents`
   subscriber per API process; `GET /v1/runs/:id/events` relays it as SSE. One
   Redis subscription serves every SSE client the replica has open — each
   connection just adds/removes its own filtered listener.
4. **Stalled-job recovery** — the worker renews a lock every `stalledInterval`
   (~30s). If the worker dies, the lock expires and the next worker re-queues the
   job (or fails it after `maxStalledCount`).

The **queue does not orchestrate workers**. It is passive. Workers connect *to*
Redis and pull. Zero workers → jobs pile up until one appears. Three workers →
they share the load. "How many workers, when to scale them" is the job of
whatever runs the worker containers (docker-compose = fixed count, Kubernetes
HPA, Cloud Run min/max instances).

---

## Deployment topology

Locally today: `docker compose up -d` runs **postgres** + **redis** + **minio**;
the API and worker run on the host (`npm run api` / `npm run worker`) against
that Postgres.

For a real deployment, four containers / services:

```
        ┌────────────┐        ┌────────────┐
        │    api     │        │   worker   │       stateless — scale each
        │ (Express)  │        │  (BullMQ)  │       independently
        └─────┬──────┘        └─────┬──────┘
              │  enqueue / read     │  consume
              └──────────┬──────────┘
                    ┌────▼────┐         ┌──────────────┐
                    │  redis  │         │  object store │  (MinIO / S3 / R2)
                    │ (queue) │         │   — cards     │
                    └─────────┘         └──────────────┘
              ┌──────────┴──────────┐
              │  postgres + pgvector │
              └─────────────────────┘
```

- **redis** — a managed instance (Upstash, ElastiCache, MemoryStore) or its own
  container. It *is* "the queue server", and yes it is a separate container from
  the API and the worker.
- **the database** — was the one real blocker for multi-container: SQLite is a
  local file that only works when every process shares a filesystem. Fixed by
  the M13 migration to Postgres + pgvector, a real client-server database — a
  managed instance (Cloud SQL, RDS, Supabase, Neon — anywhere pgvector is
  enabled) is a drop-in swap for the local `docker-compose` one via
  `DATABASE_URL`. All DB access funnels through `store/`, which is what made
  this a contained rewrite rather than a scattered one.
- **api** and **worker** are both stateless — run one of each, or ten.

The worker's jobs run 20–40 min, which **exceeds AWS Lambda's 15-min ceiling**.
So "serverless" for the worker realistically means Cloud Run / Fargate (a
container that scales to zero), not a function. The API (fast handlers) fits
Lambda fine.

---

## Swapping the queue

Everything queue-specific is behind `src/queue/queue.ts`:

```ts
enqueueJob(type, payload) → { jobId }      // API side
readJob(jobId)            → JobView | null // API side (GET /v1/jobs/:id)
pingRedis()               → boolean        // health check
```

and the worker's `src/worker/index.ts` (the BullMQ `Worker` setup). The job
*logic* — `src/worker/handlers.ts` — takes a tiny `JobLike` interface
(`{ name, data, updateProgress }`) and is queue-agnostic.

### → AWS SQS / GCP Cloud Tasks

These are **pipes only** — no job-state store, no result, no progress. So the
swap is not 1:1; you also add somewhere to keep job state:

- `enqueueJob` → `sqs.sendMessage` / `cloudtasks.createTask`
- job state → for `generate` jobs you already have it: the `runs` row carries
  `status` / `error` / `progress_json`, and `GET /v1/runs/:id` returns all of it.
  `GET /v1/jobs/:id` would read the row instead of BullMQ. For `regenerate` /
  `cards` you'd add a small `jobs` table (or put status on the post row).
- worker → replace the BullMQ `Worker` with a poll loop (`sqs.receiveMessage` →
  `handleJob` → `sqs.deleteMessage`). `handlers.ts` is untouched.
- you lose BullMQ's stalled-job recovery; SQS gives you visibility-timeout
  redelivery instead, which covers the same failure.

### → Cloud Run Jobs

A different execution model — not an always-on worker that pulls, but a
container that runs once per job and exits:

- the API (or Cloud Tasks, or Eventarc) triggers a **Job execution**, passing the
  payload as an env var / argument
- the job container's entrypoint is a thin script: read payload → `handleJob()` →
  exit
- parallelism / retries are Cloud Run Jobs config, not a worker loop
- this is the most "scale-to-zero" option: no idle worker process at all

In every case, `pipeline/` and `store/` don't move.

---

## Failure handling

| failure | what happens |
|---|---|
| generation throws mid-run | `runGenerationForRun` catches → `setRunStatus(failed, message)`; posts already created stay in the DB and are usable; BullMQ marks the job `failed` |
| model creds missing (throws before the run starts) | `handleGenerate`'s outer try/catch still marks the run `failed` |
| worker process crashes (and another replica exists) | no app-level boot sweep — a fresh worker replica can't tell "abandoned by a dead worker" from "another live replica is still on it", so it doesn't guess. Recovery is entirely BullMQ's stalled-job detection: the lock the dead worker stopped renewing expires, and the job is redelivered (or `failed` after `maxStalledCount`). Note: `generate` isn't resumable, so a redelivered run re-does the whole matrix loop — the dedup layer flags most of the re-generated posts as near-duplicates rather than silently doubling content, but it is wasted LLM spend |
| the *only* worker dies and nothing replaces it | stalled-job detection is itself run by an active `Worker`'s own periodic check — with zero workers alive, nothing is left to ever notice. The run sits at `running` forever until a worker restarts, at which point its stalled check reconciles the old job (see row above). A real deployment relies on the orchestrator (Cloud Run min-instances, k8s replica count) to replace a dead worker quickly; on a laptop this is why a long run should run under `caffeinate -i` — a machine sleep can starve BullMQ's own lock-renewal timer long enough for the lock to expire while the worker is still technically alive, producing repeated "could not renew lock" errors that never resolve on their own. `lockDuration` is set to 10 minutes (up from BullMQ's 30s default) to give real slack against exactly that |
| a stuck job (or a hung `worker.close()`) blocks the worker from exiting on Ctrl-C | `SIGINT`/`SIGTERM` gives `worker.close()` `SHUTDOWN_GRACE_MS` (10s) to finish gracefully, then force-exits — Ctrl-C is never allowed to hang indefinitely |
| a run's job never settles (worker dead, per above) and a client is watching `GET /v1/runs/:id/events` | the heartbeat keeps the *connection* from being idle-timed-out by proxies, but doesn't bound the *wait* — `SSE_MAX_DURATION_MS` (default 60min) does: the stream sends `event: timeout` and closes rather than holding an open socket, a live timer, and a Redis listener for a result that, with no worker left to produce one, will never come |
| API + worker migrate a fresh DB at the same moment | Postgres handles concurrent DDL natively (real MVCC, not a single-writer file) — every statement in `migrate()` is `CREATE ... IF NOT EXISTS`, so two processes racing each other just both succeed. (This used to need a SQLite-specific `busy_timeout` + a tolerated "duplicate column" race before the M13 Postgres migration — Postgres doesn't need either.) |
| Redis down | `POST /v1/runs` fails (can't enqueue); all `GET` routes still work; `/health` reports `redis: "error"` but `ok: true` |

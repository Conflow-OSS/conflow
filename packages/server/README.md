# Conflow

Local, human-in-the-loop LinkedIn content engine. Phase 1: generate a matrix of
drafts in one voice, guard against repetition, hand the results to a person.

Full plan and the generation prompt:
<https://claude.ai/code/artifact/9e69a568-5b35-4206-a21c-8d2b2934a177>

## Status

| Milestone | What | State |
|---|---|---|
| M1 | Scaffold | ✅ |
| M2 | Store layer (originally SQLite + sqlite-vec, migrated to Postgres + pgvector in M13) | ✅ |
| M3 | Embeddings (Voyage) + `seed` command | ✅ |
| M4 | Model adapters (Z.ai / Vertex) + `test-model` + voice eval | ✅ |
| M5 | Prompt assembly (`assemblePrompt`) | ✅ |
| M6 | Matrix flow — topic-list input | ✅ |
| M7 | Matrix flow — story → topics | ✅ |
| M8 | Case-study flow | ✅ |
| M9 | Dedup + flags + regenerate | ✅ |
| M9.5 | Lesson-driven Z variants + card summary | ✅ |
| M10 | Export + hardening | ✅ |
| M10.5 | Modular prompt + regeneration context | ✅ |
| M11 | Approval gate + Imejis image cards (MinIO) | ✅ |
| M12a | HTTP API — skeleton + read/approve routes | ✅ |
| M12b | Job queue (BullMQ) + worker process + `POST /runs` | ✅ |
| M12c | Card jobs + seed endpoint + SSE progress | ✅ |
| M13 | Postgres + pgvector — SQLite/sqlite-vec fully retired | ✅ |

## Run book

```sh
# 1. one-time setup
npm install
docker compose up -d postgres             # + redis, minio when you need the API/worker
cp .env.example .env
#    - set VOYAGE_API_KEY
#    - MODEL_CHANNEL=vertex  -> `gcloud auth application-default login`, set VERTEX_PROJECT
#    - MODEL_CHANNEL=zai     -> set ZAI_API_KEY
npm test                                  # needs postgres (content_engine_test) — see below
npm run dev -- migrate                    # create the schema in content_engine

# 2. seed the voice reference (your own hand-written posts, one per file)
npm run dev -- seed ./seed/posts

# 3. generate — pick one
npm run dev -- generate --flow matrix   --topics-file topics/mine.txt
npm run dev -- generate --flow matrix   --story-file  stories/some-incident.md
npm run dev -- generate --flow casestudy --story-file stories/my-project.md

# 4. review
npm run dev -- show                       # every post from the latest run
npm run dev -- flags                      # just the flagged ones
npm run dev -- regenerate <post_id>       # replace a flagged post

# 5. approve (nothing is carded until it's approved)
npm run dev -- approve <post_id>
npm run dev -- reject  <post_id>
npm run dev -- approve-all <run_id>       # bulk-approve every pending ok post

# 6. image cards  (needs IMEJIS_API_KEY; IMAGE_STORE=disk writes to CARD_DIR,
#                  IMAGE_STORE=minio needs the S3_* env + a running MinIO. The
#                  store creates the bucket and, with S3_PUBLIC_READ=true, sets an
#                  anonymous-GET policy so the card URLs open in a browser.)
npm run dev -- cards <run_id> --limit 10  # render a card per approved post w/o one
npm run dev -- card  <post_id>            # (re)render one card, e.g. after editing its summary

# 7. export
npm run dev -- export <run_id>            # -> data/exports/<run_id>/*.md  (+ _summary.md)
npm run dev -- export <run_id> --format json
```

`X · Y · Z` = topics × angles-per-topic × posts-per-angle. Set `GEN_X` / `GEN_Y`
/ `GEN_Z` in `.env` (`GEN_X` is ignored for the topic-list flow — the file wins).

### If a run dies partway

Every post is written to the database the moment it is generated, tagged with
its `run_id`. A crashed or killed run leaves all completed posts intact — run
`show <run_id>` / `export <run_id>` on the partial run, or start a fresh one.
API calls retry with exponential backoff (`LLM_MAX_RETRIES`, `RETRY_BASE_MS`,
`LLM_TIMEOUT_MS`); only a call that fails every retry aborts the run.

## Commands

Run the CLI one of three ways:

```sh
npm run dev -- <cmd> [args]     # via tsx, no build — what the run book uses
npm run build && ./dist/cli.js <cmd>
npm run build && npm link       # once → then `content <cmd>` anywhere
```

(`npx content` fetches an unrelated package from the registry — don't use it.)

```
content migrate                                   create / update the schema
content seed <dir>                                embed hand-written posts
content test-model [--prompt <t>] [--system <f>]  one call to the configured channel
content generate --flow matrix --topics-file f    matrix flow from a topic list
content generate --flow matrix --story-file f     matrix flow from a story
content generate --flow casestudy --story-file f  case-study flow (grounded in your own project)
content show [run_id]                             print every post from a run
content flags [--run <id>]                        list flagged posts
content regenerate <post_id>                      re-run one slot (old row -> regenerated)
content approve <post_id> | reject <post_id>      set a post's review state
content approve-all <run_id> [--include-flagged]  bulk-approve pending posts
content publish <post_id>                         mark an approved post published (manual, no unpublish)
content cards <run_id> [--limit <n>]              render Imejis cards for approved posts
content card <post_id>                            (re)render one post's card
content export <run_id> [--format md|json]        write a run to data/exports/<run_id>/
content stats                                     quick overview
```

## HTTP API + worker

The same engine, over HTTP, so a frontend can drive it. The CLI still works
unchanged — CLI, API, and worker are all thin shells over `pipeline/` · `store/`.

Long jobs (generating a run, regenerating a post) don't fit a request: the API
drops them on a **BullMQ queue** and returns `202` with a job id; a separate
**worker process** runs them and writes progress back to the run row.

```sh
docker compose up -d                 # redis (queue) + minio (cards)
#  set API_TOKEN in .env  (clients send `Authorization: Bearer <it>`)
npm run api:dev                      # http://127.0.0.1:8787
npm run worker:dev                   # in a second terminal
#  compiled:  npm run build && npm run api   /   npm run worker
```

Routes (all under `/v1`, bearer auth except `/health`):

```
GET  /health                              db + redis check (no auth)
GET  /v1/stats                            vectors + latest-run breakdown

POST /v1/runs                             { flow, input, topicCount?, anglesPerTopic?, postsPerAngle? } -> 202 { runId, jobId }
      flow  = matrix | casestudy
      input = { kind: "topics", topics: [...] } | { kind: "story", text: "..." }
      topicCount/anglesPerTopic/postsPerAngle default to GEN_X/Y/Z when omitted — see "Configuring a run" below
GET  /v1/runs?limit=&offset=              { runs: [{ run, counts }] }, newest first
GET  /v1/runs/:id                         { run, counts, topics, posts }
GET  /v1/runs/:id/posts?status=&approval=&includeSuperseded=&includeRejected=  status = ok | flagged | all; superseded and rejected posts hidden by default (an explicit approval=rejected still shows them)
GET  /v1/runs/:id/topics                  this run's own topics only — see GET /v1/topics for every topic ever used
POST /v1/runs/:id/approve-all             { includeFlagged?: boolean }
GET  /v1/runs/:id/export?format=md|json   md = the _summary.md; json = full run

GET  /v1/topics?limit=&offset=&q=         every base topic ever used, any run, grouped with every angle already explored under it — a "have I covered this before" check, before starting a new run
GET  /v1/posts?limit=&offset=&run_id=&status=&approval=&includeSuperseded=&includeRejected=   every generated post, any run, never seed — paginated
GET  /v1/posts/:id
PATCH /v1/posts/:id                       { body?, summary? } -> 200 { post }; synchronous — see below
PUT  /v1/posts/:id/approval               { approval: approved|rejected|pending }
POST /v1/posts/:id/publish                approved-only; no body, no unpublish
POST /v1/posts/:id/regenerate             -> 202 { jobId }
POST /v1/posts/:id/card                   (re)render one post's card -> 200 { post }; synchronous, idempotent; refuses a superseded post
GET  /v1/posts/:id/card.png               streams the card's bytes from the image store

POST /v1/runs/:id/cards                   { limit? } -> 202 { jobId }; batch, approved posts only (already skips superseded posts)
POST /v1/seed                             { posts: [{ name, body }] } -> 202 { jobId }; wipes and replaces the whole corpus
GET  /v1/seed-posts?limit=&offset=        the voice-reference corpus, paginated
POST /v1/seed-posts                       { body } -> 201 { post }; adds one, leaves the rest of the corpus alone
DELETE /v1/seed-posts/:id                 removes one seed post

GET  /v1/jobs/:id                         { job: { state, progress, result, error } }
GET  /v1/runs/:id/events                  SSE: progress/completed/failed for the run's generation job
```

### Configuring a run

`GEN_X`/`GEN_Y`/`GEN_Z` in `.env` are the CLI's only way to set topic count /
angles-per-topic / posts-per-angle — there's no per-invocation override there.
`POST /v1/runs` accepts the same three as optional request fields
(`topicCount`, `anglesPerTopic`, `postsPerAngle`); any left out fall back to
the server's env values. Whatever the run actually executes with — env
default or request override — is recorded on the run's own `config` and is
what the worker reads when it runs the job, not a fresh env read at execution
time (so a later env change can't retroactively change what an already-queued
run does).

Run lifecycle: `queued` → `running` → `completed` / `failed` (on `run.status`,
with `run.progress_json` updated as posts land). A worker crash mid-job is
BullMQ's problem to notice (stalled-job detection), not the app's — nothing
sweeps the DB on boot. The posts a crashed run already produced stay usable.
That detection needs *some* worker process running its periodic stalled-job
check, though — if the only worker is killed and never restarted, nothing is
left to ever notice, and the run just sits at `running` until a worker comes
back (at which point its own stalled check reconciles it, possibly by
redelivering the job — see "if generation gets interrupted" below).

`GET /v1/runs/:id/events` is push (SSE + a 15s heartbeat), not polling, and is
scoped to the run's **generation** job only — a card batch on the same run
isn't relayed there, poll `GET /v1/jobs/:id` for that. The stream is a nudge,
not the source of truth: the client still renders from `GET /v1/runs/:id`, and
on reconnect just re-fetches (events that fired during a disconnect aren't
replayed — there's no event log, by design). A run with no live job to track
(created by the CLI, which runs synchronously, not queued) gets one
`event: unavailable` and the stream closes. The connection also has a hard
ceiling — `SSE_MAX_DURATION_MS` (default 60min) — after which it sends
`event: timeout` and closes rather than waiting forever for a result that, if
the worker died with nothing left to notice, will never come.

### Editing and publishing

`PATCH /v1/posts/:id` overwrites a generated post's body and/or summary in
place (no new row, unlike regenerate) and always resets `approval` back to
`pending` — an edit invalidates whatever review the old text already got.
A body change re-embeds and re-runs the same sibling/ledger dedup check as
generation; a summary change clears the post's card fields (`image_url` etc.)
since the rendered image no longer matches — re-render it with
`POST /v1/posts/:id/card`. Seed posts, already-superseded posts, and
already-published posts can't be edited this way.

Both `PATCH /v1/posts/:id` and `POST /v1/posts/:id/card` are **synchronous** —
not queued, unlike generate/regenerate/the batch card render. An edit is one
Voyage call plus a couple of indexed dedup queries; a single card is one
Imejis render plus one object-storage put (and idempotent, so an unchanged
summary costs nothing). Both are bounded to a second or two, comfortably
under any proxy timeout — nothing here has the LLM's 15–90s-per-post latency
that makes generate/regenerate genuinely need a background worker. If either
one is ever actually slow, that's a dependency (Voyage, Imejis, the DB) to
debug directly, not a reason to route it through the queue.

Publishing is manual bookkeeping — "I posted this myself, elsewhere" — not a
real integration (that's Postiz, later). `POST /v1/posts/:id/publish` requires
`approval = "approved"` first, and there's deliberately no unpublish: once a
post is marked published, editing it is refused too, so the local record and
whatever actually got posted can't silently drift apart.

### If generation gets interrupted

A worker that's killed (crash, `Ctrl-C` force-kill, the machine sleeping long
enough that BullMQ's lock renewal falls behind and the lock expires) leaves
its in-flight job's row at `run.status = "running"`. Nothing auto-fails it —
restart the worker and BullMQ's own stalled-job check reconciles it, typically
by **redelivering the job**, which re-runs the whole matrix loop from scratch
on that run. That's not silent duplication — the dedup layer flags most of the
re-generated posts as near-duplicates of the first attempt's — but it is
wasted model spend. On a laptop, `caffeinate -i npm run worker:dev` (macOS)
keeps the machine from sleeping mid-run and avoids this entirely; it isn't a
concern on an always-on server/container.

## Layout

```
src/
  config/     env schema + loader (zod)
  store/      db (Postgres pool), migrate, runs, topics, posts (incl. changePostApproval, publishPost), vec
  embeddings/ voyage client
  models/     ContentModel interface, zai + vertex adapters, factory
  prompt/     system.md, task-context/generate/regenerate.md, goldens/, assemble.ts
  pipeline/   inputs, expand, plan, generate, parse, dedup, run, regenerate, edit, seed
  cards/      imejis client, ImageStore interface (put/find/get/delete), MinioImageStore, disk store, run
  export/     markdown + json writers + buildRunExport
  queue/      the job-queue port (enqueue / inspect / subscribe) — BullMQ; used by api + worker
  api/        express app, auth, error middleware, routes/  (one process)
  worker/     BullMQ worker — handlers (generate, regenerate, cards, card, seed)  (another process)
  util/       ids, cosine, logger, retry, http, errors, slug
  cli.ts      command wiring
test/         offline unit tests (vitest)
topics/ stories/  input files for the generate flows
seed/posts/   hand-written posts, one per file
data/         exports + local card storage  (git-ignored) — the DB itself is in Postgres now
```

## Database

Postgres + [pgvector](https://github.com/pgvector/pgvector) — `docker-compose.yml`'s
`postgres` service (`pgvector/pgvector:pg16`) creates both `content_engine`
(the app) and `content_engine_test` (the test suite) the first time it starts
on a fresh volume. `migrate()` is still hand-rolled, idempotent
`CREATE ... IF NOT EXISTS` DDL run on every boot (API, worker, and CLI
`migrate` all call it) — no separate migration tool. The embedding lives as a
real `vector(EMBED_DIM)` column directly on `posts` (no sidecar table the way
SQLite's `vec0` virtual table needed one).

`npm test` needs `docker compose up -d postgres` — every test file shares the
one `content_engine_test` database (vitest runs test files sequentially, so
this is safe) and clears its own tables on start.

## Out of Phase 1

Publishing (Postiz), image cards (Imejis — the `<summary>` field feeds this),
a web review dashboard, and a performance feedback loop. See the plan artifact.

## Authenticate Vertex AI

```sh
bash <(curl -sSL https://storage.googleapis.com/cloud-samples-data/adc/setup_adc.sh)
```

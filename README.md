# content-engine

Local, human-in-the-loop LinkedIn content engine. Phase 1: generate a matrix of
drafts in one voice, guard against repetition, hand the results to a person.

Full plan and the generation prompt:
<https://claude.ai/code/artifact/9e69a568-5b35-4206-a21c-8d2b2934a177>

## Status

| Milestone | What | State |
|---|---|---|
| M1 | Scaffold | ✅ |
| M2 | Store layer (SQLite + sqlite-vec) | ✅ |
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

## Run book

```sh
# 1. one-time setup
npm install
cp .env.example .env
#    - set VOYAGE_API_KEY
#    - MODEL_CHANNEL=vertex  -> `gcloud auth application-default login`, set VERTEX_PROJECT
#    - MODEL_CHANNEL=zai     -> set ZAI_API_KEY
npm test                                  # all offline, no API calls
npm run dev -- migrate                    # create ./data/content.db

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

POST /v1/runs                             { flow, input } -> 202 { runId, jobId }
      flow  = matrix | casestudy
      input = { kind: "topics", topics: [...] } | { kind: "story", text: "..." }
GET  /v1/runs?limit=&offset=              { runs: [{ run, counts }] }, newest first
GET  /v1/runs/:id                         { run, counts, topics, posts }
GET  /v1/runs/:id/posts?status=&approval= status = ok | flagged | all
GET  /v1/runs/:id/topics
POST /v1/runs/:id/approve-all             { includeFlagged?: boolean }
GET  /v1/runs/:id/export?format=md|json   md = the _summary.md; json = full run

GET  /v1/posts/:id
PUT  /v1/posts/:id/approval               { approval: approved|rejected|pending }
POST /v1/posts/:id/regenerate             -> 202 { jobId }
POST /v1/posts/:id/card                   (re)render one post's card -> 202 { jobId }
GET  /v1/posts/:id/card.png               streams the card's bytes from the image store

POST /v1/runs/:id/cards                   { limit? } -> 202 { jobId }; batch, approved posts only
POST /v1/seed                             { posts: [{ name, body }] } -> 202 { jobId }

GET  /v1/jobs/:id                         { job: { state, progress, result, error } }
GET  /v1/runs/:id/events                  SSE: progress/completed/failed for the run's generation job
```

Run lifecycle: `queued` → `running` → `completed` / `failed` (on `run.status`,
with `run.progress_json` updated as posts land). A worker crash mid-job is
BullMQ's problem to notice (stalled-job detection), not the app's — nothing
sweeps the DB on boot. The posts a crashed run already produced stay usable.

`GET /v1/runs/:id/events` is push (SSE + a 15s heartbeat), not polling, and is
scoped to the run's **generation** job only — a card batch on the same run
isn't relayed there, poll `GET /v1/jobs/:id` for that. The stream is a nudge,
not the source of truth: the client still renders from `GET /v1/runs/:id`, and
on reconnect just re-fetches (events that fired during a disconnect aren't
replayed — there's no event log, by design). A run with no live job to track
(created by the CLI, which runs synchronously, not queued) gets one
`event: unavailable` and the stream closes.

## Layout

```
src/
  config/     env schema + loader (zod)
  store/      db, migrate, runs, topics, posts (incl. changePostApproval), vec
  embeddings/ voyage client
  models/     ContentModel interface, zai + vertex adapters, factory
  prompt/     system.md, task-context/generate/regenerate.md, goldens/, assemble.ts
  pipeline/   inputs, expand, plan, generate, parse, dedup, run, regenerate, seed
  cards/      imejis client, ImageStore interface (put/find/get), MinioImageStore, disk store, run
  export/     markdown + json writers + buildRunExport
  queue/      the job-queue port (enqueue / inspect / subscribe) — BullMQ; used by api + worker
  api/        express app, auth, error middleware, routes/  (one process)
  worker/     BullMQ worker — handlers (generate, regenerate, cards, card, seed)  (another process)
  util/       ids, cosine, logger, retry, http, errors, slug
  cli.ts      command wiring
test/         offline unit tests (vitest)
topics/ stories/  input files for the generate flows
seed/posts/   hand-written posts, one per file
data/         SQLite db + exports  (git-ignored)
```

## Out of Phase 1

Publishing (Postiz), image cards (Imejis — the `<summary>` field feeds this),
a web review dashboard, and a performance feedback loop. See the plan artifact.

## Authenticate Vertex AI

```sh
bash <(curl -sSL https://storage.googleapis.com/cloud-samples-data/adc/setup_adc.sh)
```

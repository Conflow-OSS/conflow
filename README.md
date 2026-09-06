# content-engine

Local, human-in-the-loop LinkedIn content engine. Phase 1: generate a matrix of
drafts in one voice, guard against repetition, hand the results to a person.

Full plan and the generation prompt:
<https://claude.ai/code/artifact/9e69a568-5b35-4206-a21c-8d2b2934a177>

## Status — Phase 1 complete

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
content export <run_id> [--format md|json]        write a run to data/exports/<run_id>/
content stats                                     quick overview
```

## Layout

```
src/
  config/     env schema + loader (zod)
  store/      db, migrate, runs, topics, posts, vec
  embeddings/ voyage client
  models/     ContentModel interface, zai + vertex adapters, factory
  prompt/     system.md, task.md, goldens/, assemble.ts
  pipeline/   inputs, expand, plan, generate, parse, dedup, run, regenerate
  export/     markdown + json writers
  util/       ids, cosine, logger, retry, http, slug
  cli.ts      command wiring
test/         offline unit tests (vitest)
topics/ stories/  input files for the generate flows
seed/posts/   hand-written posts, one per file
data/         SQLite db + exports  (git-ignored)
```

## Out of Phase 1

Publishing (Postiz), image cards (Imejis — the `<summary>` field feeds this),
a web review dashboard, and a performance feedback loop. See the plan artifact.

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
| M10 | Export + hardening | ⏳ |

## Quickstart

```sh
npm install
cp .env.example .env        # set VOYAGE_API_KEY; ZAI_API_KEY or Vertex ADC for M4
npm test                    # offline: schema, vectors, cosine, voyage client, seed
npm run dev -- migrate      # create ./data/content.db
npm run dev -- seed ./seed/posts
npm run dev -- stats
```

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
content export <run_id> [--format md|json]        write a run to disk             [M10]
content stats                                     quick overview
```

## Layout

```
src/
  config/     env schema + loader (zod)
  store/      db, migrate, runs, topics, posts, vec
  util/       ids, cosine, logger, retry
  cli.ts      command wiring
test/         offline unit tests (vitest)
seed/posts/   hand-written posts, one per file  (git-ignored content)
data/         SQLite db + exports  (git-ignored)
```

```
bash <(curl -sSL \                                                                    
https://storage.googleapis.com/cloud-samples-data/adc/setup_adc.sh)
```
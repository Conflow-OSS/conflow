# seed/posts/

Prince's own **hand-written** LinkedIn posts, one per `.md` file, raw text only
(no front-matter). `content seed ./seed/posts` embeds each one with Voyage and
stores it as `kind = 'seed'`.

These are the voice ground truth and the day-one dedup baseline. **Never put
AI-generated posts here** — generated output enters through `content generate`
and would drag the retrieved "voice" toward the model's own style over time.

Add as many real posts as you have (10–30 is plenty to start).

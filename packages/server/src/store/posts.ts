import { ConflictError, NotFoundError } from "../util/errors.js";
import { newId } from "../util/ids.js";
import { getDb, type Queryable } from "./db.js";
import type {
  Approval,
  HookStyle,
  PostFormat,
  PostKind,
  PostRow,
  PostStatus,
} from "./types.js";

export interface NewPost {
  kind: PostKind;
  run_id?: string | null;
  topic_id?: string | null;
  variant_index?: number | null;
  format: PostFormat;
  hook_style?: HookStyle;
  topic_angle?: string | null;
  lesson_text?: string | null;
  body: string;
  summary?: string | null;
  status?: PostStatus;
  flag_reason?: string | null;
  dup_of_id?: string | null;
  dup_score?: number | null;
  model_channel?: string | null;
  model_id?: string | null;
}

const COLUMN_NAMES = [
  "id",
  "kind",
  "run_id",
  "topic_id",
  "variant_index",
  "format",
  "hook_style",
  "topic_angle",
  "lesson_text",
  "body",
  "char_count",
  "summary",
  "summary_char_count",
  "status",
  "flag_reason",
  "dup_of_id",
  "dup_score",
  "superseded_by_id",
  "approval",
  "approved_at",
  "published_at",
  "image_url",
  "image_key",
  "image_generated_at",
  "image_error",
  "model_channel",
  "model_id",
  "created_at",
] as const;

// The embedding lives on this same table (a real pgvector column, not a
// sidecar table like SQLite needed) — deliberately left out of every query
// below. A post can be a few KB of JSON without it; a 1024-float vector
// tagging along on every fetch would be wasted bandwidth on every read, and
// would leak into every API response that just does res.json({ post }).
// store/vec.ts is the only place that ever selects it.
const COLUMNS = COLUMN_NAMES.join(", ");
// `posts.`-qualified variant for queries that join to `topics` — both tables
// have their own `id`/`run_id` columns, so the bare COLUMNS list above would
// be ambiguous the moment a join is in scope.
const QUALIFIED_COLUMNS = COLUMN_NAMES.map((c) => `posts.${c}`).join(", ");

/** Character count by code point — closer to how a person (and LinkedIn) counts. */
export function charCount(text: string): number {
  return [...text].length;
}

/**
 * `db` defaults to the pool, but `pipeline/seed.ts` passes in a transaction's
 * scoped connection instead — the pool's own connection wouldn't be part of
 * that transaction, which would silently break its atomicity.
 */
export async function insertPost(p: NewPost, db: Queryable = getDb()): Promise<PostRow> {
  const summary = p.summary ?? null;
  const row: PostRow = {
    id: newId(),
    kind: p.kind,
    run_id: p.run_id ?? null,
    topic_id: p.topic_id ?? null,
    variant_index: p.variant_index ?? null,
    format: p.format,
    hook_style: p.hook_style ?? null,
    topic_angle: p.topic_angle ?? null,
    lesson_text: p.lesson_text ?? null,
    body: p.body,
    char_count: charCount(p.body),
    summary,
    summary_char_count: summary === null ? null : charCount(summary),
    status: p.status ?? "ok",
    flag_reason: p.flag_reason ?? null,
    dup_of_id: p.dup_of_id ?? null,
    dup_score: p.dup_score ?? null,
    superseded_by_id: null,
    approval: "pending",
    approved_at: null,
    published_at: null,
    image_url: null,
    image_key: null,
    image_generated_at: null,
    image_error: null,
    model_channel: p.model_channel ?? null,
    model_id: p.model_id ?? null,
    created_at: new Date().toISOString(),
  };

  await db`INSERT INTO posts ${db(row, ...COLUMN_NAMES)}`;
  return row;
}

export async function getPost(id: string): Promise<PostRow | undefined> {
  const sql = getDb();
  const [row] = await sql.unsafe<PostRow[]>(`SELECT ${COLUMNS} FROM posts WHERE id = $1`, [id]);
  return row;
}

/**
 * A run's posts, interleaved across *base* topics — not across `topic_id`,
 * which is really a (base topic, angle) pair here (one `topics` row per
 * angle). Partitioning by topic_id alone only spread angles of the same
 * base topic apart from each other's own variants; two different angles of
 * the *same* base topic still landed side by side, which still reads as
 * "the same topic twice" to a reviewer. Partitioning by the base topic
 * itself (topics.base_index, scoped per run) fixes that: every base topic's
 * turn comes up before any base topic gets a second turn.
 *
 * `wave` is "the Nth post for this base topic", ordered variant-then-angle
 * (variant_index outer, angle_index inner) — so a 3-topic x 2-angle x
 * 2-variant run visits every topic's (angle 1, variant 1) post, then every
 * topic's (angle 2, variant 1), then every topic's (angle 1, variant 2),
 * etc., rather than exhausting one topic's angles before moving on.
 * Deterministic — no randomness — so the order is stable across repeat
 * visits and safe to paginate. A post with no topic (shouldn't happen for
 * `kind = 'generated'`, but defensively) gets its own one-post partition
 * via COALESCE, rather than being silently dropped by the join.
 *
 * Superseded (`status = 'regenerated'`) posts are excluded from the wave
 * computation itself by default, not just from the final output — a
 * regenerated post and its replacement share the same topic_id and
 * variant_index, so both compete for the same wave slot. Filtering them out
 * *after* ranking (which the API route used to do) leaves a gap in that
 * topic's sequence, which shifts every later wave and corrupts the
 * interleave for the whole run. Pass `includeSuperseded: true` to see them
 * anyway; their exact position in that case can be off by one wave since
 * they're back to competing for slots — acceptable for an audit view, not
 * for the default one.
 */
export async function listByRun(
  runId: string,
  opts: { includeSuperseded?: boolean } = {},
): Promise<PostRow[]> {
  const sql = getDb();
  const supersededClause = opts.includeSuperseded ? "" : "AND posts.status != 'regenerated'";
  return sql.unsafe<PostRow[]>(
    `SELECT ${COLUMNS} FROM (
       SELECT ${QUALIFIED_COLUMNS},
         topics.base_index AS __base_index,
         topics.angle_index AS __angle_index,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(topics.base_index::text, posts.id)
           ORDER BY posts.variant_index, topics.angle_index
         ) AS wave
       FROM posts
       LEFT JOIN topics ON topics.id = posts.topic_id
       WHERE posts.run_id = $1 ${supersededClause}
     ) ranked
     ORDER BY wave, __base_index DESC, __angle_index DESC, variant_index DESC`,
    [runId],
  );
}

export async function listFlagged(runId?: string): Promise<PostRow[]> {
  const sql = getDb();
  const whereRun = runId ? `AND run_id = $1` : "";
  const params = runId ? [runId] : [];
  return sql.unsafe<PostRow[]>(
    `SELECT ${COLUMNS} FROM posts
      WHERE status IN ('flag_dup','flag_length') ${whereRun}
      ORDER BY created_at`,
    params,
  );
}

export interface StatusPatch {
  flag_reason?: string | null;
  dup_of_id?: string | null;
  dup_score?: number | null;
  superseded_by_id?: string | null;
}

export async function setStatus(id: string, status: PostStatus, patch: StatusPatch = {}): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE posts SET status = ${status}, flag_reason = ${patch.flag_reason ?? null},
      dup_of_id = ${patch.dup_of_id ?? null}, dup_score = ${patch.dup_score ?? null},
      superseded_by_id = ${patch.superseded_by_id ?? null}
    WHERE id = ${id}
  `;
}

/**
 * Posts a fresh draft is checked against for the cross-topic pass:
 * every seed post, plus generated posts that are still standing (`status = 'ok'`
 * and not rejected). Superseded (`regenerated`) and `discarded` drafts are excluded.
 */
export async function dedupLedger(opts: { excludeTopicId?: string | null } = {}): Promise<PostRow[]> {
  const sql = getDb();
  return sql.unsafe<PostRow[]>(
    `SELECT ${COLUMNS} FROM posts
      WHERE (kind = 'seed' OR (kind = 'generated' AND status = 'ok' AND approval != 'rejected'))
        AND ($1::text IS NULL OR topic_id IS NULL OR topic_id != $1)`,
    [opts.excludeTopicId ?? null],
  );
}

/** The still-standing generated variants for one angle-topic — used as dedup siblings. */
export async function standingVariantsOfTopic(
  topicId: string,
  excludePostId?: string,
): Promise<PostRow[]> {
  const sql = getDb();
  return sql.unsafe<PostRow[]>(
    `SELECT ${COLUMNS} FROM posts
      WHERE topic_id = $1 AND kind = 'generated' AND status = 'ok' AND approval != 'rejected'
        AND ($2::text IS NULL OR id != $2)
      ORDER BY created_at`,
    [topicId, excludePostId ?? null],
  );
}

export async function setApproval(id: string, approval: Approval): Promise<void> {
  const sql = getDb();
  const approvedAt = approval === "approved" ? new Date().toISOString() : null;
  await sql`UPDATE posts SET approval = ${approval}, approved_at = ${approvedAt} WHERE id = ${id}`;
}

export interface ApprovalChange {
  post: PostRow;
  /** Set when the post was approved despite being flagged. */
  warning?: string;
}

/**
 * Change one post's approval, enforcing the rules the CLI and the API share:
 * a superseded post can't be approved, and approving a flagged post is allowed
 * but handed back as a warning. Callers run `migrate()` first.
 */
export async function changePostApproval(postId: string, approval: Approval): Promise<ApprovalChange> {
  const post = await getPost(postId);
  if (!post) {
    throw new NotFoundError(`no post with id ${postId}`);
  }
  if (post.status === "regenerated") {
    throw new ConflictError(`post ${postId} was already replaced — approve its replacement instead`);
  }

  const flagged = post.status === "flag_dup" || post.status === "flag_length";
  const warning =
    approval === "approved" && flagged ? `post is ${post.status} — approved anyway` : undefined;

  await setApproval(postId, approval);
  return { post: (await getPost(postId)) as PostRow, warning };
}

/** Mark an approved post published. Publishing is manual for now — there's no unpublish. */
export async function publishPost(postId: string): Promise<PostRow> {
  const post = await getPost(postId);
  if (!post) {
    throw new NotFoundError(`no post with id ${postId}`);
  }
  if (post.approval !== "approved") {
    throw new ConflictError(`post ${postId} must be approved before it can be published`);
  }
  if (post.published_at) {
    return post; // already published — treat as a no-op, not an error
  }

  const sql = getDb();
  await sql`UPDATE posts SET published_at = ${new Date().toISOString()} WHERE id = ${postId}`;
  return (await getPost(postId)) as PostRow;
}

export interface EditPatch {
  body: string;
  summary: string | null;
  status: PostStatus;
  flag_reason: string | null;
  dup_of_id: string | null;
  dup_score: number | null;
  image_url: string | null;
  image_key: string | null;
  image_generated_at: string | null;
  image_error: string | null;
}

/**
 * Overwrite a post's content in place (no new row, unlike regenerate). Always
 * resets approval to pending — an edit invalidates whatever was reviewed
 * before it. Image fields are passed through explicitly rather than decided
 * here: `pipeline/edit.ts` clears them only when the summary actually changed.
 */
export async function editPostContent(postId: string, patch: EditPatch): Promise<void> {
  const sql = getDb();
  const summaryCharCount = patch.summary === null ? null : charCount(patch.summary);
  await sql`
    UPDATE posts SET
      body = ${patch.body},
      char_count = ${charCount(patch.body)},
      summary = ${patch.summary},
      summary_char_count = ${summaryCharCount},
      status = ${patch.status},
      flag_reason = ${patch.flag_reason},
      dup_of_id = ${patch.dup_of_id},
      dup_score = ${patch.dup_score},
      approval = 'pending',
      approved_at = NULL,
      image_url = ${patch.image_url},
      image_key = ${patch.image_key},
      image_generated_at = ${patch.image_generated_at},
      image_error = ${patch.image_error}
    WHERE id = ${postId}
  `;
}

/** Whether some other post's card still points at this exact storage key. */
export async function imageKeyInUseElsewhere(imageKey: string, excludePostId: string): Promise<boolean> {
  const sql = getDb();
  const [row] = await sql<[{ n: number }]>`
    SELECT COUNT(*)::int AS n FROM posts WHERE image_key = ${imageKey} AND id != ${excludePostId}
  `;
  return row.n > 0;
}

/** Approve every pending post in a run. Skips flagged posts unless includeFlagged. */
export async function approvePendingInRun(runId: string, includeFlagged: boolean): Promise<number> {
  const sql = getDb();
  const statusClause = includeFlagged ? "" : "AND status = 'ok'";
  const result = await sql.unsafe(
    `UPDATE posts SET approval = 'approved', approved_at = $1
      WHERE run_id = $2 AND kind = 'generated' AND approval = 'pending' ${statusClause}`,
    [new Date().toISOString(), runId],
  );
  return result.count;
}

/** Approved, well-formed posts in a run that have a summary but no card image yet. */
export async function postsNeedingCards(runId: string, limit: number): Promise<PostRow[]> {
  const sql = getDb();
  return sql.unsafe<PostRow[]>(
    `SELECT ${COLUMNS} FROM posts
      WHERE run_id = $1 AND status = 'ok' AND approval = 'approved'
        AND summary IS NOT NULL AND image_url IS NULL
      ORDER BY created_at
      LIMIT $2`,
    [runId, limit],
  );
}

export async function setPostImage(id: string, image: { url: string; key: string }): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE posts SET image_url = ${image.url}, image_key = ${image.key},
      image_generated_at = ${new Date().toISOString()}, image_error = NULL
    WHERE id = ${id}
  `;
}

export async function setPostImageError(id: string, message: string): Promise<void> {
  const sql = getDb();
  await sql`UPDATE posts SET image_error = ${message} WHERE id = ${id}`;
}

export async function countByStatus(runId: string): Promise<Record<string, number>> {
  const sql = getDb();
  const rows = await sql<Array<{ status: string; n: number }>>`
    SELECT status, COUNT(*)::int AS n FROM posts WHERE run_id = ${runId} GROUP BY status
  `;
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function countByApproval(runId: string): Promise<Record<string, number>> {
  const sql = getDb();
  const rows = await sql<Array<{ approval: string; n: number }>>`
    SELECT approval, COUNT(*)::int AS n FROM posts WHERE run_id = ${runId} GROUP BY approval
  `;
  return Object.fromEntries(rows.map((r) => [r.approval, r.n]));
}

export interface PostListFilter {
  limit: number;
  offset: number;
  runId?: string;
  status: "ok" | "flagged" | "all";
  approval?: Approval;
  includeSuperseded: boolean;
  includeRejected: boolean;
}

/**
 * Every generated post across every run — never seed posts, those have their
 * own listing (`listSeedPosts`). Filtering happens in SQL, not after the
 * fetch, since this is paginated: filtering post-fetch would silently break
 * `limit`/`offset` (a page could come back short, or double-count across
 * pages) once more than one page of results exists.
 *
 * Ordering interleaves across base topics the same way `listByRun` does —
 * see that function's comment for why topic_id alone wasn't specific enough
 * (it's really a (base topic, angle) pair here). (run_id, base_index)
 * together are a safe cross-run partition key, since base_index is only
 * scoped within one run.
 */
export async function listPosts(filter: PostListFilter): Promise<{ posts: PostRow[]; total: number }> {
  const sql = getDb();
  const conditions: string[] = [`kind != 'seed'`];
  const params: (string | number)[] = [];

  if (!filter.includeSuperseded) {
    conditions.push(`status != 'regenerated'`);
  }
  if (!filter.includeRejected && filter.approval !== "rejected") {
    conditions.push(`approval != 'rejected'`);
  }
  if (filter.runId) {
    params.push(filter.runId);
    // Qualified even though there's no join in scope for the count query
    // below — posts.run_id is unambiguous either way, and this same
    // `conditions` array feeds both the joined and the unjoined query.
    conditions.push(`posts.run_id = $${params.length}`);
  }
  if (filter.status === "ok") {
    conditions.push(`status = 'ok'`);
  } else if (filter.status === "flagged") {
    conditions.push(`status IN ('flag_dup', 'flag_length')`);
  }
  if (filter.approval) {
    params.push(filter.approval);
    conditions.push(`approval = $${params.length}`);
  }

  const where = conditions.join(" AND ");
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const [posts, [{ n }]] = await Promise.all([
    sql.unsafe<PostRow[]>(
      `SELECT ${COLUMNS} FROM (
         SELECT ${QUALIFIED_COLUMNS},
           posts.run_id AS __run_id,
           topics.base_index AS __base_index,
           topics.angle_index AS __angle_index,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(posts.run_id || ':' || topics.base_index::text, posts.id)
             ORDER BY posts.variant_index, topics.angle_index
           ) AS wave
         FROM posts
         LEFT JOIN topics ON topics.id = posts.topic_id
         WHERE ${where}
       ) ranked
       ORDER BY wave, __run_id DESC, __base_index DESC, __angle_index DESC, variant_index DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, filter.limit, filter.offset],
    ),
    sql.unsafe<[{ n: number }]>(`SELECT COUNT(*)::int AS n FROM posts WHERE ${where}`, params),
  ]);

  return { posts, total: n };
}

/** The voice-reference corpus — a different concern from generated posts, so its own listing. */
export async function listSeedPosts(limit: number, offset: number): Promise<{ posts: PostRow[]; total: number }> {
  const sql = getDb();
  const [posts, [{ n }]] = await Promise.all([
    sql.unsafe<PostRow[]>(
      `SELECT ${COLUMNS} FROM posts WHERE kind = 'seed' ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM posts WHERE kind = 'seed'`,
  ]);
  return { posts, total: n };
}

/**
 * Remove one seed post without touching the rest of the corpus (unlike
 * `seedDocuments`, which wipes and replaces all of them). Any post that had
 * flagged a duplicate against this one has that reference cleared first —
 * `dup_of_id` has no ON DELETE behavior, so Postgres would otherwise refuse
 * the delete outright.
 */
export async function deleteSeedPost(id: string): Promise<void> {
  const sql = getDb();
  await sql.begin(async (tx) => {
    const [post] = await tx<Array<{ id: string }>>`
      SELECT id FROM posts WHERE id = ${id} AND kind = 'seed'
    `;
    if (!post) {
      throw new NotFoundError(`no seed post with id ${id}`);
    }
    await tx`UPDATE posts SET dup_of_id = NULL WHERE dup_of_id = ${id}`;
    await tx`DELETE FROM posts WHERE id = ${id}`;
  });
}

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
  "approval",
  "approved_at",
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
    approval: "pending",
    approved_at: null,
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

export async function listByRun(runId: string): Promise<PostRow[]> {
  const sql = getDb();
  return sql.unsafe<PostRow[]>(
    `SELECT ${COLUMNS} FROM posts WHERE run_id = $1 ORDER BY created_at`,
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
}

export async function setStatus(id: string, status: PostStatus, patch: StatusPatch = {}): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE posts SET status = ${status}, flag_reason = ${patch.flag_reason ?? null},
      dup_of_id = ${patch.dup_of_id ?? null}, dup_score = ${patch.dup_score ?? null}
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

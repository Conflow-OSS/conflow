import { ConflictError, NotFoundError } from "../util/errors.js";
import { newId } from "../util/ids.js";
import { getDb } from "./db.js";
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

const COLUMNS = `id, kind, run_id, topic_id, variant_index, format, hook_style,
  topic_angle, lesson_text, body, char_count, summary, summary_char_count, status,
  flag_reason, dup_of_id, dup_score, approval, approved_at, image_url, image_key,
  image_generated_at, image_error, model_channel, model_id, created_at`;

/** Character count by code point — closer to how a person (and LinkedIn) counts. */
export function charCount(text: string): number {
  return [...text].length;
}

export function insertPost(p: NewPost): PostRow {
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
  getDb()
    .prepare(
      `INSERT INTO posts (${COLUMNS}) VALUES
       (@id, @kind, @run_id, @topic_id, @variant_index, @format, @hook_style,
        @topic_angle, @lesson_text, @body, @char_count, @summary, @summary_char_count,
        @status, @flag_reason, @dup_of_id, @dup_score, @approval, @approved_at,
        @image_url, @image_key, @image_generated_at, @image_error,
        @model_channel, @model_id, @created_at)`,
    )
    .run(row);
  return row;
}

export function getPost(id: string): PostRow | undefined {
  return getDb().prepare(`SELECT * FROM posts WHERE id = ?`).get(id) as
    | PostRow
    | undefined;
}

export function listByRun(runId: string): PostRow[] {
  return getDb()
    .prepare(`SELECT * FROM posts WHERE run_id = ? ORDER BY created_at`)
    .all(runId) as PostRow[];
}

export function listFlagged(runId?: string): PostRow[] {
  const sql = runId
    ? `SELECT * FROM posts WHERE run_id = ? AND status IN ('flag_dup','flag_length') ORDER BY created_at`
    : `SELECT * FROM posts WHERE status IN ('flag_dup','flag_length') ORDER BY created_at`;
  const stmt = getDb().prepare(sql);
  return (runId ? stmt.all(runId) : stmt.all()) as PostRow[];
}

export interface StatusPatch {
  flag_reason?: string | null;
  dup_of_id?: string | null;
  dup_score?: number | null;
}

export function setStatus(id: string, status: PostStatus, patch: StatusPatch = {}): void {
  getDb()
    .prepare(
      `UPDATE posts SET status = @status, flag_reason = @flag_reason,
         dup_of_id = @dup_of_id, dup_score = @dup_score WHERE id = @id`,
    )
    .run({
      id,
      status,
      flag_reason: patch.flag_reason ?? null,
      dup_of_id: patch.dup_of_id ?? null,
      dup_score: patch.dup_score ?? null,
    });
}

/**
 * Posts a fresh draft is checked against for the cross-topic pass:
 * every seed post, plus generated posts that are still standing (`status = 'ok'`
 * and not rejected). Superseded (`regenerated`) and `discarded` drafts are excluded.
 */
export function dedupLedger(opts: { excludeTopicId?: string | null } = {}): PostRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM posts
        WHERE (kind = 'seed' OR (kind = 'generated' AND status = 'ok' AND approval != 'rejected'))
          AND (@excl IS NULL OR topic_id IS NULL OR topic_id != @excl)`,
    )
    .all({ excl: opts.excludeTopicId ?? null }) as PostRow[];
}

/** The still-standing generated variants for one angle-topic — used as dedup siblings. */
export function standingVariantsOfTopic(topicId: string, excludePostId?: string): PostRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM posts
        WHERE topic_id = @topicId AND kind = 'generated' AND status = 'ok' AND approval != 'rejected'
          AND (@excludePostId IS NULL OR id != @excludePostId)
        ORDER BY created_at`,
    )
    .all({ topicId, excludePostId: excludePostId ?? null }) as PostRow[];
}

export function setApproval(id: string, approval: Approval): void {
  getDb()
    .prepare(`UPDATE posts SET approval = @approval, approved_at = @approvedAt WHERE id = @id`)
    .run({
      id,
      approval,
      approvedAt: approval === "approved" ? new Date().toISOString() : null,
    });
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
export function changePostApproval(postId: string, approval: Approval): ApprovalChange {
  const post = getPost(postId);
  if (!post) {
    throw new NotFoundError(`no post with id ${postId}`);
  }
  if (post.status === "regenerated") {
    throw new ConflictError(`post ${postId} was already replaced — approve its replacement instead`);
  }

  const flagged = post.status === "flag_dup" || post.status === "flag_length";
  const warning =
    approval === "approved" && flagged ? `post is ${post.status} — approved anyway` : undefined;

  setApproval(postId, approval);
  return { post: getPost(postId) as PostRow, warning };
}

/** Approve every pending post in a run. Skips flagged posts unless includeFlagged. */
export function approvePendingInRun(runId: string, includeFlagged: boolean): number {
  const statusClause = includeFlagged ? "" : "AND status = 'ok'";
  const result = getDb()
    .prepare(
      `UPDATE posts SET approval = 'approved', approved_at = @now
        WHERE run_id = @runId AND kind = 'generated' AND approval = 'pending' ${statusClause}`,
    )
    .run({ runId, now: new Date().toISOString() });
  return result.changes;
}

/** Approved, well-formed posts in a run that have a summary but no card image yet. */
export function postsNeedingCards(runId: string, limit: number): PostRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM posts
        WHERE run_id = @runId AND status = 'ok' AND approval = 'approved'
          AND summary IS NOT NULL AND image_url IS NULL
        ORDER BY created_at
        LIMIT @limit`,
    )
    .all({ runId, limit }) as PostRow[];
}

export function setPostImage(id: string, image: { url: string; key: string }): void {
  getDb()
    .prepare(
      `UPDATE posts SET image_url = @url, image_key = @key,
         image_generated_at = @now, image_error = NULL WHERE id = @id`,
    )
    .run({ id, url: image.url, key: image.key, now: new Date().toISOString() });
}

export function setPostImageError(id: string, message: string): void {
  getDb().prepare(`UPDATE posts SET image_error = @message WHERE id = @id`).run({ id, message });
}

export function countByStatus(runId: string): Record<string, number> {
  const rows = getDb()
    .prepare(`SELECT status, COUNT(*) AS n FROM posts WHERE run_id = ? GROUP BY status`)
    .all(runId) as Array<{ status: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export function countByApproval(runId: string): Record<string, number> {
  const rows = getDb()
    .prepare(`SELECT approval, COUNT(*) AS n FROM posts WHERE run_id = ? GROUP BY approval`)
    .all(runId) as Array<{ approval: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.approval, r.n]));
}

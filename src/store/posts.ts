import { newId } from "../util/ids.js";
import { getDb } from "./db.js";
import type {
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
  body: string;
  status?: PostStatus;
  flag_reason?: string | null;
  dup_of_id?: string | null;
  dup_score?: number | null;
  model_channel?: string | null;
  model_id?: string | null;
}

const COLUMNS = `id, kind, run_id, topic_id, variant_index, format, hook_style,
  topic_angle, body, char_count, status, flag_reason, dup_of_id, dup_score,
  model_channel, model_id, created_at`;

/** Character count by code point — closer to how a person (and LinkedIn) counts. */
export function charCount(body: string): number {
  return [...body].length;
}

export function insertPost(p: NewPost): PostRow {
  const row: PostRow = {
    id: newId(),
    kind: p.kind,
    run_id: p.run_id ?? null,
    topic_id: p.topic_id ?? null,
    variant_index: p.variant_index ?? null,
    format: p.format,
    hook_style: p.hook_style ?? null,
    topic_angle: p.topic_angle ?? null,
    body: p.body,
    char_count: charCount(p.body),
    status: p.status ?? "ok",
    flag_reason: p.flag_reason ?? null,
    dup_of_id: p.dup_of_id ?? null,
    dup_score: p.dup_score ?? null,
    model_channel: p.model_channel ?? null,
    model_id: p.model_id ?? null,
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO posts (${COLUMNS}) VALUES
       (@id, @kind, @run_id, @topic_id, @variant_index, @format, @hook_style,
        @topic_angle, @body, @char_count, @status, @flag_reason, @dup_of_id,
        @dup_score, @model_channel, @model_id, @created_at)`,
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
 * every seed post, plus generated posts that are still standing (`status = 'ok'`).
 * Superseded (`regenerated`) and `discarded` drafts are excluded.
 */
export function dedupLedger(opts: { excludeTopicId?: string | null } = {}): PostRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM posts
        WHERE (kind = 'seed' OR (kind = 'generated' AND status = 'ok'))
          AND (@excl IS NULL OR topic_id IS NULL OR topic_id != @excl)`,
    )
    .all({ excl: opts.excludeTopicId ?? null }) as PostRow[];
}

/** The still-standing generated variants for one angle-topic — used as dedup siblings. */
export function standingVariantsOfTopic(topicId: string, excludePostId?: string): PostRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM posts
        WHERE topic_id = @topicId AND kind = 'generated' AND status = 'ok'
          AND (@excludePostId IS NULL OR id != @excludePostId)
        ORDER BY created_at`,
    )
    .all({ topicId, excludePostId: excludePostId ?? null }) as PostRow[];
}

export function countByStatus(runId: string): Record<string, number> {
  const rows = getDb()
    .prepare(`SELECT status, COUNT(*) AS n FROM posts WHERE run_id = ? GROUP BY status`)
    .all(runId) as Array<{ status: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

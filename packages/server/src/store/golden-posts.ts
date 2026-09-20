import { BadRequestError, ConflictError, NotFoundError } from "../util/errors.js";
import { newId } from "../util/ids.js";
import { getDb } from "./db.js";
import type { GoldenPostRow, HookStyle, PostFormat } from "./types.js";

export const MAX_GOLDEN_POSTS = 5;

const COLUMN_NAMES = [
  "id",
  "body",
  "format",
  "hook_style",
  "design_template_id",
  "created_at",
  "updated_at",
] as const;
const COLUMNS = COLUMN_NAMES.join(", ");

export interface NewGoldenPost {
  body: string;
  format: PostFormat;
  hook_style?: HookStyle;
  design_template_id?: string | null;
}

export interface GoldenPostPatch {
  body?: string;
  format?: PostFormat;
  hook_style?: HookStyle;
  design_template_id?: string | null;
}

/**
 * `format = "short"` forces `hook_style` to null (a short post has no hook
 * style, matching how `prompt/assemble.ts` already resolves it) — `"long"`
 * requires an explicit questions/callout choice, since neither is a sensible
 * default.
 */
function resolveHookStyle(format: PostFormat, hookStyle: HookStyle | undefined): HookStyle {
  if (format === "short") {
    return null;
  }
  if (hookStyle !== "questions" && hookStyle !== "callout") {
    throw new BadRequestError('a "long" golden post needs hook_style set to "questions" or "callout"');
  }
  return hookStyle;
}

export async function listGoldenPosts(): Promise<GoldenPostRow[]> {
  const sql = getDb();
  return sql.unsafe<GoldenPostRow[]>(`SELECT ${COLUMNS} FROM golden_posts ORDER BY created_at`);
}

export async function getGoldenPost(id: string): Promise<GoldenPostRow | undefined> {
  const sql = getDb();
  const [row] = await sql.unsafe<GoldenPostRow[]>(`SELECT ${COLUMNS} FROM golden_posts WHERE id = $1`, [id]);
  return row;
}

export async function insertGoldenPost(p: NewGoldenPost): Promise<GoldenPostRow> {
  const sql = getDb();
  const [{ n }] = await sql<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM golden_posts`;
  if (n >= MAX_GOLDEN_POSTS) {
    throw new ConflictError(`at most ${MAX_GOLDEN_POSTS} golden posts are allowed — delete one first`);
  }

  const now = new Date().toISOString();
  const row: GoldenPostRow = {
    id: newId(),
    body: p.body,
    format: p.format,
    hook_style: resolveHookStyle(p.format, p.hook_style),
    design_template_id: p.design_template_id ?? null,
    created_at: now,
    updated_at: now,
  };

  await sql`INSERT INTO golden_posts ${sql(row, ...COLUMN_NAMES)}`;
  return row;
}

export async function updateGoldenPost(id: string, patch: GoldenPostPatch): Promise<GoldenPostRow> {
  const existing = await getGoldenPost(id);
  if (!existing) {
    throw new NotFoundError(`no golden post with id ${id}`);
  }

  const format = patch.format ?? existing.format;
  const hookStyle = resolveHookStyle(format, patch.hook_style !== undefined ? patch.hook_style : existing.hook_style);

  const sql = getDb();
  await sql`
    UPDATE golden_posts SET
      body = ${patch.body ?? existing.body},
      format = ${format},
      hook_style = ${hookStyle},
      design_template_id = ${patch.design_template_id !== undefined ? patch.design_template_id : existing.design_template_id},
      updated_at = ${new Date().toISOString()}
    WHERE id = ${id}
  `;
  return (await getGoldenPost(id)) as GoldenPostRow;
}

export async function deleteGoldenPost(id: string): Promise<void> {
  const sql = getDb();
  const result = await sql`DELETE FROM golden_posts WHERE id = ${id}`;
  if (result.count === 0) {
    throw new NotFoundError(`no golden post with id ${id}`);
  }
}

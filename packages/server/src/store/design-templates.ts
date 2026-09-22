import { NotFoundError } from "../util/errors.js";
import { newId } from "../util/ids.js";
import { getDb } from "./db.js";
import type { DesignTemplateRow } from "./types.js";

const COLUMN_NAMES = [
  "id",
  "name",
  "imejis_design_id",
  "preview_image_url",
  "preview_image_key",
  "created_at",
  "updated_at",
] as const;
const COLUMNS = COLUMN_NAMES.join(", ");

export interface NewDesignTemplate {
  name: string;
  imejis_design_id: string;
  preview_image_url: string;
  preview_image_key: string;
}

export interface DesignTemplatePatch {
  name?: string;
  imejis_design_id?: string;
  preview_image_url?: string;
  preview_image_key?: string;
}

export async function listDesignTemplates(): Promise<DesignTemplateRow[]> {
  const sql = getDb();
  return sql.unsafe<DesignTemplateRow[]>(`SELECT ${COLUMNS} FROM design_templates ORDER BY created_at`);
}

export async function getDesignTemplate(id: string): Promise<DesignTemplateRow | undefined> {
  const sql = getDb();
  const [row] = await sql.unsafe<DesignTemplateRow[]>(
    `SELECT ${COLUMNS} FROM design_templates WHERE id = $1`,
    [id],
  );
  return row;
}

export async function insertDesignTemplate(p: NewDesignTemplate): Promise<DesignTemplateRow> {
  const sql = getDb();
  const now = new Date().toISOString();
  const row: DesignTemplateRow = {
    id: newId(),
    name: p.name,
    imejis_design_id: p.imejis_design_id,
    preview_image_url: p.preview_image_url,
    preview_image_key: p.preview_image_key,
    created_at: now,
    updated_at: now,
  };
  await sql`INSERT INTO design_templates ${sql(row, ...COLUMN_NAMES)}`;
  return row;
}

export async function updateDesignTemplate(id: string, patch: DesignTemplatePatch): Promise<DesignTemplateRow> {
  const existing = await getDesignTemplate(id);
  if (!existing) {
    throw new NotFoundError(`no design template with id ${id}`);
  }

  const sql = getDb();
  await sql`
    UPDATE design_templates SET
      name = ${patch.name ?? existing.name},
      imejis_design_id = ${patch.imejis_design_id ?? existing.imejis_design_id},
      preview_image_url = ${patch.preview_image_url ?? existing.preview_image_url},
      preview_image_key = ${patch.preview_image_key ?? existing.preview_image_key},
      updated_at = ${new Date().toISOString()}
    WHERE id = ${id}
  `;
  return (await getDesignTemplate(id)) as DesignTemplateRow;
}

export async function deleteDesignTemplate(id: string): Promise<void> {
  const sql = getDb();
  const result = await sql`DELETE FROM design_templates WHERE id = ${id}`;
  if (result.count === 0) {
    throw new NotFoundError(`no design template with id ${id}`);
  }
}

/** How many golden posts currently point at this template — used to warn on delete. */
export async function goldenPostsUsingTemplate(id: string): Promise<number> {
  const sql = getDb();
  const [{ n }] = await sql<[{ n: number }]>`
    SELECT COUNT(*)::int AS n FROM golden_posts WHERE design_template_id = ${id}
  `;
  return n;
}

import { getImageStore } from "../cards/factory.js";
import {
  deleteDesignTemplate,
  getDesignTemplate,
  goldenPostsUsingTemplate,
  insertDesignTemplate,
  updateDesignTemplate,
} from "../store/design-templates.js";
import type { DesignTemplateRow } from "../store/types.js";
import { NotFoundError } from "../util/errors.js";
import { newId } from "../util/ids.js";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function previewKey(contentType: string): string {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] ?? "bin";
  return `design-templates/${newId()}.${extension}`;
}

export interface NewDesignTemplateInput {
  name: string;
  imejisDesignId: string;
  imageBuffer: Buffer;
  contentType: string;
}

/** Upload the preview image, then create the row that points at it. */
export async function createDesignTemplate(input: NewDesignTemplateInput): Promise<DesignTemplateRow> {
  const stored = await getImageStore().put(previewKey(input.contentType), input.imageBuffer, input.contentType);
  return insertDesignTemplate({
    name: input.name,
    imejis_design_id: input.imejisDesignId,
    preview_image_url: stored.url,
    preview_image_key: stored.key,
  });
}

export interface DesignTemplateUpdateInput {
  name?: string;
  imejisDesignId?: string;
  image?: { buffer: Buffer; contentType: string };
}

export async function editDesignTemplate(id: string, input: DesignTemplateUpdateInput): Promise<DesignTemplateRow> {
  const existing = await getDesignTemplate(id);
  if (!existing) {
    throw new NotFoundError(`no design template with id ${id}`);
  }

  if (!input.image) {
    return updateDesignTemplate(id, { name: input.name, imejis_design_id: input.imejisDesignId });
  }

  const store = getImageStore();
  const stored = await store.put(previewKey(input.image.contentType), input.image.buffer, input.image.contentType);
  const updated = await updateDesignTemplate(id, {
    name: input.name,
    imejis_design_id: input.imejisDesignId,
    preview_image_url: stored.url,
    preview_image_key: stored.key,
  });
  await store.delete(existing.preview_image_key);
  return updated;
}

export interface RemoveDesignTemplateResult {
  /** How many golden posts had this template unassigned as a result. */
  detachedGoldenPosts: number;
}

export async function removeDesignTemplate(id: string): Promise<RemoveDesignTemplateResult> {
  const existing = await getDesignTemplate(id);
  if (!existing) {
    throw new NotFoundError(`no design template with id ${id}`);
  }

  const detachedGoldenPosts = await goldenPostsUsingTemplate(id);
  await deleteDesignTemplate(id);
  await getImageStore().delete(existing.preview_image_key);
  return { detachedGoldenPosts };
}

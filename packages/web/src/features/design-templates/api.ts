import type { DesignTemplateRow } from "@content-engine/shared";
import { api } from "@/lib/api";

export function listDesignTemplates() {
  return api.get<{ designTemplates: DesignTemplateRow[] }>("/design-templates");
}

function toFormData(input: { name?: string; imejisDesignId?: string; image?: File }): FormData {
  const formData = new FormData();
  if (input.name !== undefined) formData.set("name", input.name);
  if (input.imejisDesignId !== undefined) formData.set("imejisDesignId", input.imejisDesignId);
  if (input.image !== undefined) formData.set("image", input.image);
  return formData;
}

export interface CreateDesignTemplateInput {
  name: string;
  imejisDesignId: string;
  image: File;
}

export function createDesignTemplate(input: CreateDesignTemplateInput) {
  return api.postForm<{ designTemplate: DesignTemplateRow }>("/design-templates", toFormData(input));
}

export interface UpdateDesignTemplateInput {
  name?: string;
  imejisDesignId?: string;
  image?: File;
}

export function updateDesignTemplate(id: string, input: UpdateDesignTemplateInput) {
  return api.patchForm<{ designTemplate: DesignTemplateRow }>(`/design-templates/${id}`, toFormData(input));
}

export function deleteDesignTemplate(id: string) {
  return api.delete<{ detachedGoldenPosts: number }>(`/design-templates/${id}`);
}

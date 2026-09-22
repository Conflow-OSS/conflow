import type { GoldenPostRow, HookStyle, PostFormat } from "@content-engine/shared";
import { api } from "@/lib/api";

export function listGoldenPosts() {
  return api.get<{ goldenPosts: GoldenPostRow[] }>("/golden-posts");
}

export function getGoldenPost(id: string) {
  return api.get<{ goldenPost: GoldenPostRow }>(`/golden-posts/${id}`);
}

export interface CreateGoldenPostInput {
  title: string;
  body: string;
  format: PostFormat;
  hookStyle?: HookStyle;
  designTemplateId?: string;
  idealLengthMin: number;
  idealLengthMax: number;
}

export function createGoldenPost(input: CreateGoldenPostInput) {
  return api.post<{ goldenPost: GoldenPostRow }>("/golden-posts", input);
}

export interface UpdateGoldenPostInput {
  title?: string;
  body?: string;
  format?: PostFormat;
  hookStyle?: HookStyle | null;
  designTemplateId?: string | null;
  idealLengthMin?: number;
  idealLengthMax?: number;
}

export function updateGoldenPost(id: string, input: UpdateGoldenPostInput) {
  return api.patch<{ goldenPost: GoldenPostRow }>(`/golden-posts/${id}`, input);
}

export function deleteGoldenPost(id: string) {
  return api.delete<void>(`/golden-posts/${id}`);
}

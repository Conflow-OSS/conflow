import type { PostRow } from "@content-engine/shared";
import { api } from "@/lib/api";

export interface SeedPostListResult {
  posts: PostRow[];
  total: number;
  limit: number;
  offset: number;
}

export function listSeedPosts(limit: number, offset: number) {
  return api.get<SeedPostListResult>(`/seed-posts?limit=${limit}&offset=${offset}`);
}

export function addSeedPost(body: string) {
  return api.post<{ post: PostRow }>(`/seed-posts`, { body });
}

export function deleteSeedPost(id: string) {
  return api.delete<void>(`/seed-posts/${id}`);
}

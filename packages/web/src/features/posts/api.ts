import type { Approval, PostRow } from "@content-engine/shared";
import { api } from "@/lib/api";

export interface PostListFilter {
  limit?: number;
  offset?: number;
  run_id?: string;
  status?: "ok" | "flagged" | "all";
  approval?: Approval;
  includeSuperseded?: boolean;
  includeRejected?: boolean;
  includePublished?: boolean;
}

export interface PostListResult {
  posts: PostRow[];
  total: number;
  limit: number;
  offset: number;
}

export function listPosts(filter: PostListFilter = {}) {
  const params = new URLSearchParams();
  if (filter.limit) params.set("limit", String(filter.limit));
  if (filter.offset) params.set("offset", String(filter.offset));
  if (filter.run_id) params.set("run_id", filter.run_id);
  if (filter.status) params.set("status", filter.status);
  if (filter.approval) params.set("approval", filter.approval);
  if (filter.includeSuperseded) params.set("includeSuperseded", "true");
  if (filter.includeRejected) params.set("includeRejected", "true");
  if (filter.includePublished) params.set("includePublished", "true");
  const qs = params.toString();
  return api.get<PostListResult>(`/posts${qs ? `?${qs}` : ""}`);
}

export function getPost(postId: string) {
  return api.get<{ post: PostRow }>(`/posts/${postId}`);
}

export function setApproval(postId: string, approval: Approval) {
  return api.put<{ post: PostRow; warning?: string }>(`/posts/${postId}/approval`, { approval });
}

export function publishPost(postId: string) {
  return api.post<{ post: PostRow }>(`/posts/${postId}/publish`);
}

export interface EditPostInput {
  body?: string;
  summary?: string;
}

export function editPost(postId: string, input: EditPostInput) {
  return api.patch<{ post: PostRow }>(`/posts/${postId}`, input);
}

export function renderCard(postId: string) {
  return api.post<{ post: PostRow }>(`/posts/${postId}/card`);
}

export interface RegenerateResult {
  jobId: string;
}

export function regeneratePost(postId: string) {
  return api.post<RegenerateResult>(`/posts/${postId}/regenerate`);
}

export interface JobView {
  id: string;
  type: string;
  state: string;
  progress: unknown;
  result: unknown;
  error: string | null;
  createdAt: number | null;
  finishedAt: number | null;
}

export interface RegenerateJobResult {
  oldPostId: string;
  newPostId: string;
  status: PostRow["status"];
}

export function getJob(jobId: string) {
  return api.get<{ job: JobView }>(`/jobs/${jobId}`);
}

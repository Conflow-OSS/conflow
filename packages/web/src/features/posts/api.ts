import type { Approval, PostRow } from "@content-engine/shared";
import { api } from "@/lib/api";

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

import type { Approval, Flow, PostRow, RunRow, TopicRow } from "@content-engine/shared";
import { api } from "@/lib/api";

// The backend adds a parsed `config` alongside the raw `config_json` (it
// doesn't replace it — withParsedConfig spreads the row, then adds `config`
// on top) — so the response is the full RunRow plus this one extra field.
export type RunWithParsedConfig = RunRow & {
  config: { topicCount?: number; anglesPerTopic?: number; postsPerAngle?: number; model?: string };
};

export interface RunCounts {
  status: Record<string, number>;
  approval: Record<string, number>;
}

export interface RunListItem {
  run: RunWithParsedConfig;
  counts: RunCounts;
}

export function listRuns(limit: number, offset: number) {
  return api.get<{ runs: RunListItem[] }>(`/runs?limit=${limit}&offset=${offset}`);
}

export interface RunDetail {
  run: RunWithParsedConfig;
  counts: RunCounts;
  topics: number;
  posts: number;
}

export function getRun(runId: string) {
  return api.get<RunDetail>(`/runs/${runId}`);
}

export function getRunTopics(runId: string) {
  return api.get<{ topics: TopicRow[] }>(`/runs/${runId}/topics`);
}

export interface RunPostsFilter {
  status?: "ok" | "flagged" | "all";
  approval?: Approval;
  includeSuperseded?: boolean;
  includeRejected?: boolean;
}

export function getRunPosts(runId: string, filter: RunPostsFilter = {}) {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.approval) params.set("approval", filter.approval);
  if (filter.includeSuperseded) params.set("includeSuperseded", "true");
  if (filter.includeRejected) params.set("includeRejected", "true");
  const qs = params.toString();
  return api.get<{ posts: PostRow[] }>(`/runs/${runId}/posts${qs ? `?${qs}` : ""}`);
}

export type CreateRunInput = {
  flow: Flow;
  input: { kind: "topics"; topics: string[] } | { kind: "story"; text: string };
  topicCount?: number;
  anglesPerTopic?: number;
  postsPerAngle?: number;
};

export interface CreateRunResult {
  runId: string;
  jobId: string;
}

export function createRun(body: CreateRunInput) {
  return api.post<CreateRunResult>("/runs", body);
}

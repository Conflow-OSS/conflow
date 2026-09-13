import { api } from "@/lib/api";

// Not part of @content-engine/shared — this is a grouped/deduped cross-run
// view the backend computes on the fly (GROUP BY base_text), distinct from
// the flat per-run TopicRow used elsewhere.
export interface DistinctTopic {
  base_text: string;
  run_ids: string[];
  angles: string[];
  last_used_at: string;
}

export interface TopicSearchResult {
  topics: DistinctTopic[];
  total: number;
  limit: number;
  offset: number;
}

export function searchTopics(q: string, limit = 10) {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return api.get<TopicSearchResult>(`/topics?${params.toString()}`);
}

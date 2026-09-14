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

export interface TopicListFilter {
  q?: string;
  limit?: number;
  offset?: number;
}

/** Every base topic ever used, deduped and grouped across runs — the Topics browse page. */
export function listTopics(filter: TopicListFilter = {}) {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.limit) params.set("limit", String(filter.limit));
  if (filter.offset) params.set("offset", String(filter.offset));
  const qs = params.toString();
  return api.get<TopicSearchResult>(`/topics${qs ? `?${qs}` : ""}`);
}

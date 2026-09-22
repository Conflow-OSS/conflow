// The API's response shapes — the single source of truth for both
// packages/server (which returns these directly from its routes) and
// packages/web (which types the responses it receives from the BFF).
// Types only, deliberately: nothing here has a runtime footprint, so this
// package needs no build step — see the package.json comment for why.

export type Flow = "matrix" | "casestudy";
export type InputKind = "story" | "topic_list";

export type PostKind = "generated" | "seed";
export type PostFormat = "short" | "long";
export type HookStyle = "questions" | "callout" | null;
export type PostStatus =
  | "ok"
  | "flag_dup"
  | "flag_length"
  | "discarded"
  | "regenerated";

export type Approval = "pending" | "approved" | "rejected";

export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface DesignTemplateRow {
  id: string;
  name: string;
  imejis_design_id: string;
  preview_image_url: string;
  preview_image_key: string;
  created_at: string;
  updated_at: string;
}

export interface GoldenPostRow {
  id: string;
  title: string | null;
  body: string;
  format: PostFormat;
  hook_style: HookStyle;
  design_template_id: string | null;
  ideal_length_min: number | null;
  ideal_length_max: number | null;
  created_at: string;
  updated_at: string;
}

export interface RunRow {
  id: string;
  flow: Flow;
  created_at: string;
  config_json: string;
  input_kind: InputKind;
  input_text: string | null;
  status: RunStatus;
  job_id: string | null;
  error: string | null;
  progress_json: string | null;
}

export interface TopicRow {
  id: string;
  run_id: string;
  base_text: string;
  base_index: number;
  angle_text: string;
  angle_index: number;
}

export interface PostRow {
  id: string;
  kind: PostKind;
  run_id: string | null;
  topic_id: string | null;
  variant_index: number | null;
  format: PostFormat;
  hook_style: HookStyle;
  topic_angle: string | null;
  lesson_text: string | null;
  body: string;
  char_count: number;
  summary: string | null;
  summary_char_count: number | null;
  status: PostStatus;
  flag_reason: string | null;
  dup_of_id: string | null;
  dup_score: number | null;
  superseded_by_id: string | null;
  approval: Approval;
  approved_at: string | null;
  published_at: string | null;
  image_url: string | null;
  image_key: string | null;
  image_generated_at: string | null;
  image_error: string | null;
  model_channel: string | null;
  model_id: string | null;
  created_at: string;
  golden_post_id: string | null;
}

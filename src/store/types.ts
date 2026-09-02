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

export interface RunRow {
  id: string;
  flow: Flow;
  created_at: string;
  config_json: string;
  input_kind: InputKind;
  input_text: string | null;
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
  body: string;
  char_count: number;
  status: PostStatus;
  flag_reason: string | null;
  dup_of_id: string | null;
  dup_score: number | null;
  model_channel: string | null;
  model_id: string | null;
  created_at: string;
}

import type { DesignTemplateRow, GoldenPostRow, HookStyle, PostFormat } from "@content-engine/shared";
import { DesignTemplatePicker } from "@/features/design-templates/DesignTemplatePicker";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const TITLE_MAX = 80;

export interface GoldenPostFormValues {
  title: string;
  body: string;
  format: PostFormat;
  hookStyle: HookStyle;
  designTemplateId: string | null;
  /** kept as strings so the number inputs can be empty mid-edit */
  idealLengthMin: string;
  idealLengthMax: string;
}

export function emptyGoldenPostForm(): GoldenPostFormValues {
  return {
    title: "",
    body: "",
    format: "long",
    hookStyle: "questions",
    designTemplateId: null,
    idealLengthMin: "",
    idealLengthMax: "",
  };
}

export function goldenPostToForm(goldenPost: GoldenPostRow): GoldenPostFormValues {
  return {
    title: goldenPost.title ?? "",
    body: goldenPost.body,
    format: goldenPost.format,
    hookStyle: goldenPost.hook_style,
    designTemplateId: goldenPost.design_template_id,
    idealLengthMin: goldenPost.ideal_length_min?.toString() ?? "",
    idealLengthMax: goldenPost.ideal_length_max?.toString() ?? "",
  };
}

export function isGoldenPostFormValid(values: GoldenPostFormValues): boolean {
  const min = Number(values.idealLengthMin);
  const max = Number(values.idealLengthMax);
  return (
    values.title.trim().length > 0 &&
    values.title.length <= TITLE_MAX &&
    values.body.trim().length > 0 &&
    (values.format === "short" || values.hookStyle !== null) &&
    Number.isFinite(min) &&
    min > 0 &&
    Number.isFinite(max) &&
    max > 0 &&
    min <= max
  );
}

export function GoldenPostFormFields({
  values,
  onChange,
  templates,
}: {
  values: GoldenPostFormValues;
  onChange: (next: GoldenPostFormValues) => void;
  templates: DesignTemplateRow[];
}) {
  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel required>Title</FieldLabel>
        <Input
          value={values.title}
          maxLength={TITLE_MAX}
          onChange={(e) => onChange({ ...values, title: e.target.value })}
          placeholder="e.g. Canary rollout story"
        />
        <FieldDescription>
          {values.title.length}/{TITLE_MAX} characters
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel required>Body</FieldLabel>
        <Textarea rows={10} value={values.body} onChange={(e) => onChange({ ...values, body: e.target.value })} />
        <FieldDescription>{values.body.length} characters</FieldDescription>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel required>Format</FieldLabel>
          <Select
            value={values.format}
            onValueChange={(next) =>
              onChange({
                ...values,
                format: next as PostFormat,
                hookStyle: next === "short" ? null : (values.hookStyle ?? "questions"),
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short</SelectItem>
              <SelectItem value="long">Long</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {values.format === "long" && (
          <Field>
            <FieldLabel required>Hook style</FieldLabel>
            <Select
              value={values.hookStyle ?? undefined}
              onValueChange={(next) => onChange({ ...values, hookStyle: next as HookStyle })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose one" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="questions">Questions</SelectItem>
                <SelectItem value="callout">Callout</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel required>Ideal length — min</FieldLabel>
          <Input
            type="number"
            min={1}
            value={values.idealLengthMin}
            onChange={(e) => onChange({ ...values, idealLengthMin: e.target.value })}
            placeholder="e.g. 900"
          />
        </Field>
        <Field>
          <FieldLabel required>Ideal length — max</FieldLabel>
          <Input
            type="number"
            min={1}
            value={values.idealLengthMax}
            onChange={(e) => onChange({ ...values, idealLengthMax: e.target.value })}
            placeholder="e.g. 1100"
          />
        </Field>
      </div>
      <FieldDescription>
        Character-count target for posts generated from this golden post. Not enforced by the AI yet — just kept
        for reference and future use.
      </FieldDescription>

      <Field>
        <FieldLabel>Design template</FieldLabel>
        <DesignTemplatePicker
          templates={templates}
          value={values.designTemplateId}
          onValueChange={(id) => onChange({ ...values, designTemplateId: id })}
        />
      </Field>
    </div>
  );
}

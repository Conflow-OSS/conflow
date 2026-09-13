import { Icon } from "@iconify/react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useCreateRun } from "@/features/runs/hooks";
import { TopicSearch } from "@/features/topics/TopicSearch";
import type { Flow } from "@content-engine/shared";

type InputMode = "topics" | "story";

export function GeneratePage() {
  const [flow, setFlow] = useState<Flow>("matrix");
  const [inputMode, setInputMode] = useState<InputMode>("topics");
  const [topicsText, setTopicsText] = useState("");
  const [storyText, setStoryText] = useState("");
  const [topicCount, setTopicCount] = useState("");
  const [anglesPerTopic, setAnglesPerTopic] = useState("");
  const [postsPerAngle, setPostsPerAngle] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const createRun = useCreateRun();

  const effectiveMode: InputMode = flow === "casestudy" ? "story" : inputMode;

  function handleFlowChange(next: Flow) {
    setFlow(next);
    setFormError(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const input =
      effectiveMode === "topics"
        ? { kind: "topics" as const, topics: topicsText.split("\n").map((t) => t.trim()).filter(Boolean) }
        : { kind: "story" as const, text: storyText.trim() };

    if (input.kind === "topics" && input.topics.length === 0) {
      setFormError("Add at least one topic, one per line.");
      return;
    }
    if (input.kind === "story" && input.text.length === 0) {
      setFormError(flow === "casestudy" ? "Paste the case study text." : "Write the story.");
      return;
    }

    createRun.mutate({
      flow,
      input,
      topicCount: parsePositiveInt(topicCount),
      anglesPerTopic: parsePositiveInt(anglesPerTopic),
      postsPerAngle: parsePositiveInt(postsPerAngle),
    });
  }

  if (createRun.isSuccess) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card>
          <CardContent className="space-y-4 text-center">
            <Icon icon="feather:check-circle" className="mx-auto h-8 w-8 text-primary" />
            <div>
              <h1 className="text-lg font-semibold">Run queued</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Generation is running in the background — the run page shows live progress.
              </p>
            </div>
            <div className="flex justify-center gap-3">
              <Button asChild variant="primary">
                <Link to={`/runs/${createRun.data.runId}`}>View run</Link>
              </Button>
              <Button variant="outline" onClick={() => createRun.reset()}>
                Start another
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-lg font-semibold">Generate a run</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Pick a flow, give it something to work from, and queue a generation run.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Field>
          <FieldLabel>Flow</FieldLabel>
          <RadioGroup value={flow} onValueChange={(v) => handleFlowChange(v as Flow)} className="grid-cols-1 gap-3 sm:grid-cols-2">
            <FlowOption
              value="matrix"
              current={flow}
              title="Matrix"
              description="Topics → angles → posts. Good for a batch of ideas."
            />
            <FlowOption
              value="casestudy"
              current={flow}
              title="Case study"
              description="One story, expanded into posts. Story input only."
            />
          </RadioGroup>
        </Field>

        {flow === "matrix" && (
          <Field>
            <FieldLabel>Input</FieldLabel>
            <RadioGroup
              value={inputMode}
              onValueChange={(v) => setInputMode(v as InputMode)}
              className="grid-cols-2 gap-3"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="topics" id="mode-topics" />
                Topic list
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="story" id="mode-story" />
                Story
              </label>
            </RadioGroup>
          </Field>
        )}

        {effectiveMode === "topics" ? (
          <Field>
            <FieldLabel>Topics</FieldLabel>
            <Textarea
              rows={6}
              placeholder={"One topic per line, e.g.\nRight-sizing pod requests and limits on Kubernetes\nWhy your on-call rotation keeps burning people out"}
              value={topicsText}
              onChange={(e) => setTopicsText(e.target.value)}
            />
            <FieldDescription>Each line becomes one base topic, expanded into angles and posts.</FieldDescription>
          </Field>
        ) : (
          <Field>
            <FieldLabel>{flow === "casestudy" ? "Case study" : "Story"}</FieldLabel>
            <Textarea
              rows={8}
              placeholder={
                flow === "casestudy"
                  ? "Paste the case study — what happened, what you did, what changed."
                  : "Write the story — topics and angles get expanded from it automatically."
              }
              value={storyText}
              onChange={(e) => setStoryText(e.target.value)}
            />
          </Field>
        )}

        <Field>
          <FieldLabel>Check for reused topics</FieldLabel>
          <TopicSearch />
        </Field>

        <div>
          <p className="mb-2 text-sm font-medium">Overrides (optional)</p>
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Topics" value={topicCount} onChange={setTopicCount} disabled={effectiveMode === "story"} />
            <NumberField label="Angles / topic" value={anglesPerTopic} onChange={setAnglesPerTopic} />
            <NumberField label="Posts / angle" value={postsPerAngle} onChange={setPostsPerAngle} />
          </div>
          <FieldDescription className="mt-2">Leave blank to use the server defaults.</FieldDescription>
        </div>

        {formError && <FieldError>{formError}</FieldError>}
        {createRun.isError && (
          <FieldError>{createRun.error instanceof Error ? createRun.error.message : "Failed to queue the run."}</FieldError>
        )}

        <Button type="submit" variant="primary" disabled={createRun.isPending} className="w-full">
          {createRun.isPending ? "Queuing…" : "Generate"}
        </Button>
      </form>
    </div>
  );
}

function FlowOption({
  value,
  current,
  title,
  description,
}: {
  value: Flow;
  current: Flow;
  title: string;
  description: string;
}) {
  const id = `flow-${value}`;
  return (
    <label
      htmlFor={id}
      className={
        "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors " +
        (current === value ? "border-primary bg-primary/5" : "border-border")
      }
    >
      <RadioGroupItem value={value} id={id} className="mt-0.5" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        beam={false}
        type="number"
        min={1}
        inputMode="numeric"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function parsePositiveInt(value: string): number | undefined {
  const n = Number(value);
  return value.trim() !== "" && Number.isInteger(n) && n > 0 ? n : undefined;
}

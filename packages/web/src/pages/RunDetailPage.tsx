import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PostsView } from "@/features/posts/PostsView";
import { RunStatusBadge } from "@/features/runs/RunStatusBadge";
import { useRun, useRunEvents, useRunPosts, useRunTopics } from "@/features/runs/hooks";

const TERMINAL_MESSAGES: Record<string, { title: string; tone: "success" | "error" }> = {
  completed: { title: "Generation completed", tone: "success" },
  failed: { title: "Generation failed", tone: "error" },
  timeout: { title: "Gave up waiting for a result — the run may still finish in the background", tone: "error" },
  unavailable: { title: "No live job to track for this run", tone: "error" },
};

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  if (!runId) throw new Error("RunDetailPage rendered without a runId param");

  const runQuery = useRun(runId);
  const topicsQuery = useRunTopics(runId);
  const postsQuery = useRunPosts(runId);

  const run = runQuery.data?.run;
  const isLive = run?.status === "queued" || run?.status === "running";
  const { progress, terminal } = useRunEvents(runId, isLive);

  useEffect(() => {
    if (!terminal) return;
    const message = TERMINAL_MESSAGES[terminal];
    if (message.tone === "success") toast.success(message.title);
    else toast.error(message.title);
  }, [terminal]);

  if (runQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!run) {
    return <p className="p-6 text-sm text-muted-foreground">No run with id {runId}.</p>;
  }

  const topicsById = new Map((topicsQuery.data?.topics ?? []).map((topic) => [topic.id, topic]));

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold capitalize">{run.flow} run</h1>
          <RunStatusBadge status={run.status} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{new Date(run.created_at).toLocaleString()}</p>
        {run.error && <p className="mt-2 text-sm text-destructive">{run.error}</p>}
      </div>

      {isLive && (
        <div className="rounded-lg border border-border bg-card p-4 [box-shadow:var(--shadow-s)]">
          <p className="mb-2 text-sm text-muted-foreground">
            {progress ? describePhase(progress.phase) : "Waiting for the worker to pick this up…"}
          </p>
          {progress && progress.postsExpected > 0 && (
            <>
              <Progress value={(progress.postsCreated / progress.postsExpected) * 100} />
              <p className="mt-1 text-xs text-muted-foreground">
                {progress.postsCreated} / {progress.postsExpected} posts
              </p>
            </>
          )}
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          Topics {topicsQuery.data ? `(${topicsQuery.data.topics.length})` : ""}
        </h2>
        {topicsQuery.data && topicsQuery.data.topics.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {topicsQuery.data.topics.map((topic) => (
              <li key={topic.id} className="text-muted-foreground">
                <span className="text-foreground">{topic.base_text}</span> — {topic.angle_text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No topics yet.</p>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Posts</h2>
        {postsQuery.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <PostsView posts={postsQuery.data?.posts ?? []} topicsById={topicsById} />
        )}
      </div>
    </div>
  );
}

function describePhase(phase: string): string {
  switch (phase) {
    case "expanding":
      return "Expanding the story into topics…";
    case "generating":
      return "Generating posts…";
    case "done":
      return "Wrapping up…";
    default:
      return "Working…";
  }
}

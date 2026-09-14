import { Icon } from "@iconify/react";
import { Progress } from "@/components/ui/progress";
import type { RunLogEntry } from "./hooks";

/**
 * The live view of a run's generation job — a status header (spinning while
 * running), the current progress bar, and a running log of every event
 * received so far. Each new log line animates in; the whole thing replaces
 * the old single-line "waiting for the worker" text once events start
 * arriving.
 */
export function RunProgressPanel({ log, isLive }: { log: RunLogEntry[]; isLive: boolean }) {
  const latestProgress = [...log].reverse().find((entry) => entry.progress)?.progress;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card [box-shadow:var(--shadow-m)]">
      <div className="flex items-center gap-2 border-b border-border bg-accent/40 px-4 py-3">
        {isLive ? (
          <Icon icon="feather:loader" className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <Icon icon="feather:check-circle" className="h-4 w-4 text-primary" />
        )}
        <p className="text-sm font-medium">{isLive ? "Generation running…" : "Generation finished"}</p>
      </div>

      {latestProgress && latestProgress.postsExpected > 0 && (
        <div className="border-b border-border px-4 py-3">
          <Progress value={(latestProgress.postsCreated / latestProgress.postsExpected) * 100} />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {latestProgress.postsCreated} / {latestProgress.postsExpected} posts
          </p>
        </div>
      )}

      <div className="max-h-56 space-y-1 overflow-y-auto p-3">
        {log.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon icon="feather:loader" className="h-3.5 w-3.5 animate-spin" />
            Waiting for the worker to pick this up…
          </p>
        ) : (
          log.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs duration-300 animate-in fade-in slide-in-from-bottom-1"
            >
              <span className="mt-0.5 shrink-0 tabular-nums text-muted-foreground">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className={entry.kind === "failed" ? "text-destructive" : "text-foreground"}>{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createRun, getRun, getRunPosts, getRunTopics, listRuns, type RunPostsFilter } from "./api";

export function useRuns(limit: number, offset: number) {
  return useQuery({
    queryKey: ["runs", { limit, offset }],
    queryFn: () => listRuns(limit, offset),
  });
}

export function useRun(runId: string) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun(runId),
  });
}

export function useRunTopics(runId: string) {
  return useQuery({
    queryKey: ["run", runId, "topics"],
    queryFn: () => getRunTopics(runId),
    enabled: !!runId,
  });
}

export function useRunPosts(runId: string, filter: RunPostsFilter = {}) {
  return useQuery({
    queryKey: ["run", runId, "posts", filter],
    queryFn: () => getRunPosts(runId, filter),
  });
}

export function useCreateRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createRun,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["runs"] }),
  });
}

export interface RunProgress {
  phase: "expanding" | "generating" | "done";
  postsCreated: number;
  postsExpected: number;
}

export type RunTerminalState = "completed" | "failed" | "timeout" | "unavailable";

export function describePhase(phase: RunProgress["phase"]): string {
  switch (phase) {
    case "expanding":
      return "Expanding the story into topics";
    case "generating":
      return "Generating posts";
    case "done":
      return "Wrapping up";
  }
}

const TERMINAL_LOG_MESSAGES: Record<RunTerminalState, string> = {
  completed: "Generation completed",
  failed: "Generation failed",
  timeout: "Gave up waiting for a result — the run may still finish in the background",
  unavailable: "No live job to track for this run",
};

export interface RunLogEntry {
  id: number;
  timestamp: number;
  kind: "progress" | RunTerminalState;
  message: string;
  progress?: RunProgress;
}

/**
 * Live progress for a run's generation job. `enabled` should be false once
 * the run is already completed/failed — nothing to subscribe to then, and
 * the endpoint would just send one immediate terminal event anyway.
 *
 * The stream is a nudge, not the source of truth: every event (including
 * "progress") triggers a refetch of the real run+posts data rather than
 * trusting the SSE payload as final — the query hooks above stay the only
 * place that renders real data. This hook additionally accumulates a `log`
 * of every event received, so the UI can render a running history instead
 * of only the latest snapshot.
 *
 * EventSource auto-reconnects by default on any connection close, including
 * the server's own deliberate close after a terminal event — explicitly
 * closing here on every terminal event prevents a reconnect loop.
 */
export function useRunEvents(runId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [terminal, setTerminal] = useState<RunTerminalState | null>(null);
  const [log, setLog] = useState<RunLogEntry[]>([]);

  useEffect(() => {
    if (!enabled) return;
    setProgress(null);
    setTerminal(null);
    setLog([]);
    let nextId = 0;

    const source = new EventSource(`/api/runs/${runId}/events`);
    const refetch = () => {
      void queryClient.invalidateQueries({ queryKey: ["run", runId] });
      void queryClient.invalidateQueries({ queryKey: ["run", runId, "posts"] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    };

    source.addEventListener("progress", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as RunProgress;
      setProgress(data);
      setLog((prev) => [
        ...prev,
        {
          id: nextId++,
          timestamp: Date.now(),
          kind: "progress",
          message: `${describePhase(data.phase)} — ${data.postsCreated}/${data.postsExpected} posts`,
          progress: data,
        },
      ]);
      refetch();
    });

    const onTerminal = (name: RunTerminalState) => () => {
      setTerminal(name);
      setLog((prev) => [...prev, { id: nextId++, timestamp: Date.now(), kind: name, message: TERMINAL_LOG_MESSAGES[name] }]);
      refetch();
      source.close();
    };
    source.addEventListener("completed", onTerminal("completed"));
    source.addEventListener("failed", onTerminal("failed"));
    source.addEventListener("timeout", onTerminal("timeout"));
    source.addEventListener("unavailable", onTerminal("unavailable"));

    return () => source.close();
  }, [runId, enabled, queryClient]);

  return { progress, terminal, log };
}

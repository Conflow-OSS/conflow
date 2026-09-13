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

/**
 * Live progress for a run's generation job. `enabled` should be false once
 * the run is already completed/failed — nothing to subscribe to then, and
 * the endpoint would just send one immediate terminal event anyway.
 *
 * The stream is a nudge, not the source of truth: every event (including
 * "progress") triggers a refetch of the real run+posts data rather than
 * trusting the SSE payload as final — the query hooks above stay the only
 * place that renders real data. This hook only surfaces the live counter
 * for a nicer in-progress display, plus terminal state for the caller to
 * react to (e.g. show a toast).
 *
 * EventSource auto-reconnects by default on any connection close, including
 * the server's own deliberate close after a terminal event — explicitly
 * closing here on every terminal event prevents a reconnect loop.
 */
export function useRunEvents(runId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [terminal, setTerminal] = useState<"completed" | "failed" | "timeout" | "unavailable" | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setProgress(null);
    setTerminal(null);

    const source = new EventSource(`/api/runs/${runId}/events`);
    const refetch = () => {
      void queryClient.invalidateQueries({ queryKey: ["run", runId] });
      void queryClient.invalidateQueries({ queryKey: ["run", runId, "posts"] });
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    };

    source.addEventListener("progress", (event) => {
      setProgress(JSON.parse((event as MessageEvent).data) as RunProgress);
      refetch();
    });

    const onTerminal = (name: "completed" | "failed" | "timeout" | "unavailable") => () => {
      setTerminal(name);
      refetch();
      source.close();
    };
    source.addEventListener("completed", onTerminal("completed"));
    source.addEventListener("failed", onTerminal("failed"));
    source.addEventListener("timeout", onTerminal("timeout"));
    source.addEventListener("unavailable", onTerminal("unavailable"));

    return () => source.close();
  }, [runId, enabled, queryClient]);

  return { progress, terminal };
}

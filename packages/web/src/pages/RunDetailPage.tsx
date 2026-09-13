import { useParams } from "react-router-dom";

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Run {runId}</h1>
      <p className="text-sm text-muted-foreground">Milestone 2 builds this out — posts, topics, live SSE progress.</p>
    </div>
  );
}

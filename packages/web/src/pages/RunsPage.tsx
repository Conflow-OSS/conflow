import { Icon } from "@iconify/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RunStatusBadge } from "@/features/runs/RunStatusBadge";
import { useRuns } from "@/features/runs/hooks";
import { useState } from "react";

const PAGE_SIZE = 20;

export function RunsPage() {
  const [offset, setOffset] = useState(0);
  const { data, isLoading, isFetching } = useRuns(PAGE_SIZE, offset);
  const runs = data?.runs ?? [];
  const hasNextPage = runs.length === PAGE_SIZE;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Runs</h1>
        <Button asChild variant="primary">
          <Link to="/generate">
            <Icon icon="feather:plus" className="h-4 w-4" />
            Generate a run
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No runs yet — <Link to="/generate" className="text-primary underline-offset-4 hover:underline">generate one</Link>.
        </p>
      ) : (
        <div className="space-y-3">
          {runs.map(({ run, counts }) => (
            <Link key={run.id} to={`/runs/${run.id}`} className="block">
              <Card className="cursor-pointer transition-shadow hover:[box-shadow:var(--shadow-l)]">
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">{run.flow}</span>
                      <RunStatusBadge status={run.status} />
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {new Date(run.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    <div>{sumCounts(counts.status)} posts</div>
                    <div>{counts.status.flag_dup ?? 0} + {counts.status.flag_length ?? 0} flagged</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center justify-center gap-3">
        {offset > 0 && (
          <Button variant="outline" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </Button>
        )}
        {hasNextPage && (
          <Button variant="outline" disabled={isFetching} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

function sumCounts(status: Record<string, number>): number {
  return Object.values(status).reduce((total, n) => total + n, 0);
}

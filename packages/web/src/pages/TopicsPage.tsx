import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useTopics } from "@/features/topics/hooks";

const PAGE_SIZE = 20;

/**
 * Every base topic ever used, deduped and grouped across runs — a "have I
 * covered this before?" reference distinct from the same search box on the
 * Generate page, which only checks while picking new topics.
 */
export function TopicsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [queryInput, setQueryInput] = useState(searchParams.get("q") ?? "");
  const q = searchParams.get("q") ?? "";
  const offset = Number(searchParams.get("offset") ?? 0);

  const { data, isLoading, isFetching } = useTopics({ q: q || undefined, limit: PAGE_SIZE, offset });
  const topics = data?.topics ?? [];
  const hasNextPage = topics.length === PAGE_SIZE;

  // Debounce writes to the URL (which drives the actual query) so typing
  // doesn't fire a request per keystroke; the input itself stays responsive.
  useEffect(() => {
    const trimmed = queryInput.trim();
    if (trimmed === q) return;
    const id = setTimeout(() => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (trimmed) params.set("q", trimmed);
        else params.delete("q");
        params.delete("offset");
        return params;
      });
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput]);

  function setOffset(next: number) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("offset", String(next));
      return params;
    });
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Topics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every base topic used across all runs, so you can check what's already been covered.
        </p>
      </div>

      <div className="mb-4">
        <Input
          beam={false}
          placeholder="Search topics…"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : topics.length === 0 ? (
        <p className="text-sm text-muted-foreground">{q ? "No topics match that search." : "No topics used yet."}</p>
      ) : (
        <div className="space-y-3">
          {topics.map((topic) => (
            <Card key={topic.base_text}>
              <CardContent className="space-y-1.5 pt-5">
                <p className="font-medium">{topic.base_text}</p>
                {topic.angles.length > 0 && (
                  <p className="text-sm text-muted-foreground">{topic.angles.join(" · ")}</p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Icon icon="feather:clock" className="h-3.5 w-3.5" />
                    Last used {new Date(topic.last_used_at).toLocaleDateString()}
                  </span>
                  {topic.run_ids.length === 1 ? (
                    <Link to={`/runs/${topic.run_ids[0]}`} className="text-primary hover:underline">
                      View run
                    </Link>
                  ) : (
                    <span>Used in {topic.run_ids.length} runs</span>
                  )}
                </div>
              </CardContent>
            </Card>
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

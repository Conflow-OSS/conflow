import type { Approval } from "@content-engine/shared";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingIcon } from "@/components/ui/loading-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { PostsView } from "@/features/posts/PostsView";
import { useBulkApproval, useBulkPublish, usePosts } from "@/features/posts/hooks";

const PAGE_SIZE = 20;
type StatusFilter = "all" | "ok" | "flagged";
const APPROVAL_OPTIONS: Array<Approval | "any"> = ["any", "pending", "approved", "rejected"];

export function PostsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const status = (searchParams.get("status") as StatusFilter) ?? "all";
  const approval = (searchParams.get("approval") as Approval | null) ?? undefined;
  const includeSuperseded = searchParams.get("includeSuperseded") === "true";
  const includeRejected = searchParams.get("includeRejected") === "true";
  const offset = Number(searchParams.get("offset") ?? 0);

  const filter = { limit: PAGE_SIZE, offset, status, approval, includeSuperseded, includeRejected };
  const { data, isLoading, isFetching } = usePosts(filter);
  const posts = data?.posts ?? [];
  const hasNextPage = posts.length === PAGE_SIZE;

  const bulkApproval = useBulkApproval();
  const bulkPublish = useBulkPublish();
  const bulkPending = bulkApproval.isPending || bulkPublish.isPending;

  function updateParam(key: string, value: string | null) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value === null) params.delete(key);
      else params.set(key, value);
      params.delete("offset");
      return params;
    });
  }

  function setOffset(next: number) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("offset", String(next));
      return params;
    });
  }

  const selection = useMemo(
    () => ({
      selectedIds,
      onToggle: (id: string) =>
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
    }),
    [selectedIds],
  );

  function reportBulk(action: string, result: { total: number; failed: number }) {
    if (result.failed === 0) toast.success(`${action}: ${result.total} post${result.total === 1 ? "" : "s"}`);
    else toast.warning(`${action}: ${result.total - result.failed} succeeded, ${result.failed} failed`);
    setSelectedIds(new Set());
  }

  function handleBulkApproval(next: "approved" | "rejected") {
    bulkApproval.mutate(
      { ids: [...selectedIds], approval: next },
      { onSuccess: (result) => reportBulk(next === "approved" ? "Approved" : "Rejected", result) },
    );
  }

  function handleBulkPublish() {
    bulkPublish.mutate([...selectedIds], {
      onSuccess: (result) => reportBulk("Published", result),
    });
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Posts</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => updateParam("status", v === "all" ? null : v)}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="ok">OK only</SelectItem>
              <SelectItem value="flagged">Flagged only</SelectItem>
            </SelectContent>
          </Select>

          <Select value={approval ?? "any"} onValueChange={(v) => updateParam("approval", v === "any" ? null : v)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Approval" />
            </SelectTrigger>
            <SelectContent>
              {APPROVAL_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt} className="capitalize">
                  {opt === "any" ? "Any approval" : opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Checkbox
              checked={includeSuperseded}
              onCheckedChange={(v) => updateParam("includeSuperseded", v ? "true" : null)}
            />
            Superseded
          </label>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Checkbox
              checked={includeRejected}
              onCheckedChange={(v) => updateParam("includeRejected", v ? "true" : null)}
            />
            Rejected
          </label>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 [box-shadow:var(--shadow-s)]">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button size="sm" variant="primary" disabled={bulkPending} onClick={() => handleBulkApproval("approved")}>
            <LoadingIcon pending={bulkApproval.isPending && bulkApproval.variables?.approval === "approved"} icon="feather:check" />
            Approve
          </Button>
          <Button size="sm" variant="destructive" disabled={bulkPending} onClick={() => handleBulkApproval("rejected")}>
            <LoadingIcon pending={bulkApproval.isPending && bulkApproval.variables?.approval === "rejected"} icon="feather:x" />
            Reject
          </Button>
          <Button size="sm" variant="outline" disabled={bulkPending} onClick={handleBulkPublish}>
            <LoadingIcon pending={bulkPublish.isPending} icon="feather:send" />
            Publish
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <PostsView posts={posts} selection={selection} emptyMessage="No posts match these filters." />
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

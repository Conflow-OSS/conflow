import { Icon } from "@iconify/react";
import { Link } from "react-router-dom";
import { CARD_PREVIEW_CHARS, truncate } from "@/lib/text";
import { usePost } from "./hooks";

/** Small inline preview for a related post referenced only by id (dup_of_id, superseded_by_id). */
export function RelatedPostLink({ postId, label }: { postId: string; label: string }) {
  const { data, isLoading } = usePost(postId);

  return (
    <Link
      to={`/posts/${postId}`}
      className="block rounded-lg border border-border bg-card/50 p-3 transition-colors hover:border-ring/30"
    >
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon icon="feather:link" className="h-3.5 w-3.5" />
        {label}
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <p className="truncate text-sm">{truncate(data?.post.body ?? "", CARD_PREVIEW_CHARS)}</p>
      )}
    </Link>
  );
}

import { Icon } from "@iconify/react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { usePost } from "./hooks";

/**
 * Shows the related post's full body inline, next to (desktop) or below
 * (mobile) the current post — see PostDetailPage's comparison grid. A plain
 * link to the other post's own page isn't enough here: judging "is this
 * actually a duplicate" or "did the regenerated version improve on this"
 * needs both bodies visible at once, not a round trip.
 */
export function RelatedPostPanel({ postId, label }: { postId: string; label: string }) {
  const { data, isLoading } = usePost(postId);
  const post = data?.post;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon icon="feather:link" className="h-3.5 w-3.5" />
          {label}
        </p>
        <Link to={`/posts/${postId}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          Open standalone
        </Link>
      </div>
      {isLoading || !post ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="rounded-lg border border-border bg-card p-4 [box-shadow:var(--shadow-s)]">
          <p className="whitespace-pre-line text-sm leading-relaxed">{post.body}</p>
        </div>
      )}
    </div>
  );
}

import { Icon } from "@iconify/react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { LoadingIcon } from "@/components/ui/loading-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { EditPostDialog } from "@/features/posts/EditPostDialog";
import { PostBadges } from "@/features/posts/PostBadges";
import { RegenerateAction } from "@/features/posts/RegenerateAction";
import { RelatedPostPanel } from "@/features/posts/RelatedPostPanel";
import { usePost, usePublishPost, useRenderCard, useSetApproval } from "@/features/posts/hooks";
import { useRunTopics } from "@/features/runs/hooks";
import { toClipboardSafeText } from "@/lib/text";
import { cn } from "@/lib/utils";

export function PostDetailPage() {
  const { postId } = useParams<{ postId: string }>();
  if (!postId) throw new Error("PostDetailPage rendered without a postId param");

  const location = useLocation();
  const navigate = useNavigate();
  // location.key is "default" only when there's no in-app history to go back
  // to (a direct link or a fresh page load) — fall back to the run/posts
  // page in that case rather than navigating the user out of the app.
  const canGoBack = location.key !== "default";

  const postQuery = usePost(postId);
  const setApproval = useSetApproval(postId);
  const publish = usePublishPost(postId);
  const renderCard = useRenderCard(postId);
  // The base topic text isn't denormalized onto PostRow (unlike angle/lesson
  // below), so it has to be looked up from the run's own topics list.
  const topicsQuery = useRunTopics(postQuery.data?.post.run_id ?? "");

  if (postQuery.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const post = postQuery.data?.post;
  if (!post) {
    return <p className="p-6 text-sm text-muted-foreground">No post with id {postId}.</p>;
  }

  function handleApproval(approval: "approved" | "rejected") {
    setApproval.mutate(approval, {
      onSuccess: (res) => {
        toast.success(approval === "approved" ? "Post approved" : "Post rejected");
        if (res.warning) toast.warning(res.warning);
      },
    });
  }

  function handlePublish() {
    publish.mutate(undefined, { onSuccess: () => toast.success("Post marked as published") });
  }

  function handleRenderCard() {
    renderCard.mutate(undefined, {
      onSuccess: () => toast.success("Card rendered"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to render card"),
    });
  }

  const isPublished = !!post.published_at;
  const canPublish = post.approval === "approved" && !isPublished;

  const relatedId =
    post.status === "flag_dup" ? post.dup_of_id : post.status === "regenerated" ? post.superseded_by_id : null;
  const relatedLabel =
    post.status === "flag_dup"
      ? `Matched duplicate${post.dup_score ? ` (${Math.round(post.dup_score * 100)}% match)` : ""}`
      : "Superseded by";

  return (
    <div className={cn("mx-auto space-y-6 p-6", relatedId ? "max-w-6xl" : "max-w-3xl")}>
      <div>
        {canGoBack ? (
          <button
            onClick={() => navigate(-1)}
            className="text-xs text-muted-foreground hover:underline"
          >
            <Icon icon="feather:arrow-left" className="mr-1 inline h-3 w-3" />
            Back
          </button>
        ) : (
          <Link to={post.run_id ? `/runs/${post.run_id}` : "/posts"} className="text-xs text-muted-foreground hover:underline">
            <Icon icon="feather:arrow-left" className="mr-1 inline h-3 w-3" />
            {post.run_id ? "Back to run" : "Back to posts"}
          </Link>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold capitalize">{post.format} post</h1>
            <PostBadges post={post} />
          </div>
          <span className="text-xs text-muted-foreground">{post.char_count} chars</span>
        </div>
        <PostContext
          topic={topicsQuery.data?.topics.find((t) => t.id === post.topic_id)?.base_text}
          angle={post.topic_angle}
          lesson={post.lesson_text}
        />
      </div>

      {relatedId ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PostBodyPanel label="This post" body={post.body} />
          <RelatedPostPanel postId={relatedId} label={relatedLabel} />
        </div>
      ) : (
        <PostBodyPanel body={post.body} />
      )}

      {post.image_url && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">Card image</p>
          <img src={post.image_url} alt="" className="w-full max-w-sm rounded-md border border-border" />
        </div>
      )}

      {post.summary && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-muted-foreground">Summary</p>
            <CopyButton variant="ghost" className="h-7 w-7" value={toClipboardSafeText(post.summary)} label="Copy summary" />
          </div>
          <p className="text-sm">{post.summary}</p>
        </div>
      )}

      {post.published_at && (
        <p className="text-sm text-muted-foreground">Published {new Date(post.published_at).toLocaleString()}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button
          variant={post.approval === "approved" ? "secondary" : "primary"}
          disabled={setApproval.isPending || post.approval === "approved"}
          onClick={() => handleApproval("approved")}
        >
          <LoadingIcon pending={setApproval.isPending} icon="feather:check" />
          {setApproval.isPending ? "Approving…" : "Approve"}
        </Button>
        <Button
          variant={post.approval === "rejected" ? "secondary" : "destructive"}
          disabled={setApproval.isPending || post.approval === "rejected" || isPublished}
          onClick={() => handleApproval("rejected")}
        >
          <LoadingIcon pending={setApproval.isPending} icon="feather:x" />
          {setApproval.isPending ? "Rejecting…" : "Reject"}
        </Button>
        <Button variant="outline" disabled={!canPublish || publish.isPending} onClick={handlePublish}>
          <LoadingIcon pending={publish.isPending} icon="feather:send" />
          {publish.isPending ? "Publishing…" : post.published_at ? "Published" : "Mark published"}
        </Button>
        <EditPostDialog post={post} disabled={isPublished} />
        <Button variant="outline" disabled={!post.summary || renderCard.isPending || isPublished} onClick={handleRenderCard}>
          <LoadingIcon pending={renderCard.isPending} icon="feather:image" />
          {renderCard.isPending ? "Rendering…" : post.image_url ? "Re-render card" : "Render card"}
        </Button>
        {post.kind === "generated" && post.status !== "regenerated" && !isPublished && <RegenerateAction postId={post.id} />}
      </div>
      {isPublished && (
        <p className="text-xs text-muted-foreground">
          This post is published — editing, rejecting, re-rendering the card, and regenerating are locked.
        </p>
      )}
      {!canPublish && !post.published_at && (
        <p className="text-xs text-muted-foreground">Approve the post before publishing.</p>
      )}
    </div>
  );
}

function PostContext({
  topic,
  angle,
  lesson,
}: {
  topic?: string | null;
  angle?: string | null;
  lesson?: string | null;
}) {
  if (!topic && !angle && !lesson) return null;
  return (
    <div className="mt-2 space-y-0.5 text-sm text-muted-foreground">
      {topic && (
        <p>
          <span className="text-foreground">Topic:</span> {topic}
        </p>
      )}
      {angle && (
        <p>
          <span className="text-foreground">Angle:</span> {angle}
        </p>
      )}
      {lesson && (
        <p>
          <span className="text-foreground">Lesson:</span> {lesson}
        </p>
      )}
    </div>
  );
}

function PostBodyPanel({ label, body }: { label?: string; body: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        {label ? <p className="text-xs font-medium text-muted-foreground">{label}</p> : <span />}
        <CopyButton variant="ghost" className="h-7 w-7" value={toClipboardSafeText(body)} label="Copy post body" />
      </div>
      <div className="rounded-lg border border-border bg-card p-4 [box-shadow:var(--shadow-s)]">
        <p className="whitespace-pre-line text-sm leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

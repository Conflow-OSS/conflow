import { Icon } from "@iconify/react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EditPostDialog } from "@/features/posts/EditPostDialog";
import { PostBadges } from "@/features/posts/PostBadges";
import { RegenerateAction } from "@/features/posts/RegenerateAction";
import { RelatedPostLink } from "@/features/posts/RelatedPostLink";
import { usePost, usePublishPost, useRenderCard, useSetApproval } from "@/features/posts/hooks";

export function PostDetailPage() {
  const { postId } = useParams<{ postId: string }>();
  if (!postId) throw new Error("PostDetailPage rendered without a postId param");

  const postQuery = usePost(postId);
  const setApproval = useSetApproval(postId);
  const publish = usePublishPost(postId);
  const renderCard = useRenderCard(postId);

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

  const canPublish = post.approval === "approved" && !post.published_at;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <Link to={post.run_id ? `/runs/${post.run_id}` : "/posts"} className="text-xs text-muted-foreground hover:underline">
          <Icon icon="feather:arrow-left" className="mr-1 inline h-3 w-3" />
          {post.run_id ? "Back to run" : "Back to posts"}
        </Link>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold capitalize">{post.format} post</h1>
            <PostBadges post={post} />
          </div>
          <span className="text-xs text-muted-foreground">{post.char_count} chars</span>
        </div>
        {post.topic_angle && <p className="mt-1 text-sm text-muted-foreground">{post.topic_angle}</p>}
      </div>

      {post.status === "flag_dup" && post.dup_of_id && (
        <RelatedPostLink postId={post.dup_of_id} label={`Flagged as a duplicate${post.dup_score ? ` (${Math.round(post.dup_score * 100)}% match)` : ""}`} />
      )}
      {post.status === "regenerated" && post.superseded_by_id && (
        <RelatedPostLink postId={post.superseded_by_id} label="Superseded by" />
      )}

      <div className="rounded-lg border border-border bg-card p-4 [box-shadow:var(--shadow-s)]">
        <p className="whitespace-pre-line text-sm leading-relaxed">{post.body}</p>
      </div>

      {post.image_url && (
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">Card image</p>
          <img src={post.image_url} alt="" className="w-full max-w-sm rounded-md border border-border" />
        </div>
      )}

      {post.summary && (
        <div>
          <p className="mb-1 text-sm font-medium text-muted-foreground">Summary</p>
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
          <Icon icon="feather:check" className="h-4 w-4" />
          Approve
        </Button>
        <Button
          variant={post.approval === "rejected" ? "secondary" : "destructive"}
          disabled={setApproval.isPending || post.approval === "rejected"}
          onClick={() => handleApproval("rejected")}
        >
          <Icon icon="feather:x" className="h-4 w-4" />
          Reject
        </Button>
        <Button variant="outline" disabled={!canPublish || publish.isPending} onClick={handlePublish}>
          <Icon icon="feather:send" className="h-4 w-4" />
          {post.published_at ? "Published" : "Mark published"}
        </Button>
        <EditPostDialog post={post} />
        <Button variant="outline" disabled={!post.summary || renderCard.isPending} onClick={handleRenderCard}>
          <Icon icon="feather:image" className="h-4 w-4" />
          {post.image_url ? "Re-render card" : "Render card"}
        </Button>
        {post.kind === "generated" && post.status !== "regenerated" && <RegenerateAction postId={post.id} />}
      </div>
      {!canPublish && !post.published_at && (
        <p className="text-xs text-muted-foreground">Approve the post before publishing.</p>
      )}
    </div>
  );
}

import type { PostRow } from "@content-engine/shared";
import { Badge } from "@/components/ui/badge";

// Three independent dimensions, deliberately not folded into one status
// chip — a post can be simultaneously "flagged as a duplicate" *and*
// "approved anyway" *and* "not yet published", and each fact answers a
// different question a reviewer might have.
export function PostBadges({ post }: { post: PostRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge status={post.status} />
      <ApprovalBadge approval={post.approval} />
      {post.published_at && <Badge variant="primary">Published</Badge>}
    </div>
  );
}

function StatusBadge({ status }: { status: PostRow["status"] }) {
  switch (status) {
    case "flag_dup":
      return <Badge variant="warning">Duplicate</Badge>;
    case "flag_length":
      return <Badge variant="warning">Off-length</Badge>;
    case "regenerated":
      return <Badge variant="secondary">Superseded</Badge>;
    case "discarded":
      return <Badge variant="secondary">Discarded</Badge>;
    case "ok":
      return null; // the default, nothing-wrong state doesn't need a badge
  }
}

function ApprovalBadge({ approval }: { approval: PostRow["approval"] }) {
  switch (approval) {
    case "approved":
      return <Badge variant="success">Approved</Badge>;
    case "rejected":
      return <Badge variant="destructive">Rejected</Badge>;
    case "pending":
      return null; // the default state — reduces noise on a list of mostly-pending posts
  }
}

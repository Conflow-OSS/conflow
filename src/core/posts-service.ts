import { migrate } from "../store/migrate.js";
import { getPost, setApproval } from "../store/posts.js";
import type { Approval, PostRow } from "../store/types.js";
import { ConflictError, NotFoundError } from "./errors.js";

export interface ApprovalChange {
  post: PostRow;
  /** Set when the post was approved despite being flagged. */
  warning?: string;
}

/**
 * Change a post's approval, with the same rules the CLI has always enforced:
 * a superseded post can't be approved, and approving a flagged post is allowed
 * but reported back as a warning.
 */
export function changePostApproval(postId: string, approval: Approval): ApprovalChange {
  migrate();

  const post = getPost(postId);
  if (!post) {
    throw new NotFoundError(`no post with id ${postId}`);
  }
  if (post.status === "regenerated") {
    throw new ConflictError(
      `post ${postId} was already replaced — approve its replacement instead`,
    );
  }

  const flagged = post.status === "flag_dup" || post.status === "flag_length";
  const warning =
    approval === "approved" && flagged ? `post is ${post.status} — approved anyway` : undefined;

  setApproval(postId, approval);
  return { post: getPost(postId) as PostRow, warning };
}

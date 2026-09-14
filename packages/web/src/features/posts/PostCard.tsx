import type { PostRow } from "@content-engine/shared";
import { Link } from "react-router-dom";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { CARD_PREVIEW_CHARS, truncate } from "@/lib/text";
import { PostBadges } from "./PostBadges";
import type { PostSelection } from "./selection";

/**
 * A pure preview surface — no action buttons here at all. Deciding anything
 * (approve/reject/edit/regenerate/publish) requires seeing the full post,
 * which a truncated card can't safely represent; the whole card is just a
 * link into the detail view (M4), same as a table row. The optional
 * `selection` checkbox (M5, global posts page only) is the one exception —
 * picking posts for a bulk action isn't "deciding" anything on its own.
 */
export function PostCard({ post, selection }: { post: PostRow; selection?: PostSelection }) {
  return (
    <Link to={`/posts/${post.id}`} className="relative block">
      {selection && (
        <div
          className="absolute left-3 top-3 z-10"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Checkbox
            checked={selection.selectedIds.has(post.id)}
            onCheckedChange={() => selection.onToggle(post.id)}
            className="bg-card"
          />
        </div>
      )}
      <Card className="h-full cursor-pointer transition-shadow hover:[box-shadow:var(--shadow-l)]">
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <span className={selection ? "pl-6 text-xs text-muted-foreground capitalize" : "text-xs text-muted-foreground capitalize"}>
            {post.format}
          </span>
          <span className="text-xs text-muted-foreground">{post.char_count} chars</span>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* LinkedIn's own layout: text first, media below it */}
          <p className="whitespace-pre-line text-sm leading-relaxed">
            {truncate(post.body, CARD_PREVIEW_CHARS)}
          </p>
          {post.image_url && (
            <img
              src={post.image_url}
              alt=""
              className="w-full rounded-md border border-border object-cover"
            />
          )}
        </CardContent>
        <CardFooter>
          <PostBadges post={post} />
        </CardFooter>
      </Card>
    </Link>
  );
}

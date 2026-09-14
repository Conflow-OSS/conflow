import type { PostRow, TopicRow } from "@content-engine/shared";
import { useNavigate } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { truncate } from "@/lib/text";
import { PostBadges } from "./PostBadges";
import type { PostSelection } from "./selection";

/**
 * Dense, desktop-oriented preview — same rule as the grid: no action
 * buttons on the row itself, only badges and truncated text. A table row's
 * columns are just as truncated as a grid card's body, so the same "you
 * can't safely decide from a preview" reasoning applies equally here. The
 * optional `selection` checkbox column (M5) is for picking posts for a bulk
 * action, not for deciding anything about one post.
 */
export function PostsTable({
  posts,
  topicsById,
  selection,
}: {
  posts: PostRow[];
  topicsById?: Map<string, TopicRow>;
  selection?: PostSelection;
}) {
  const navigate = useNavigate();
  const allSelected = selection ? posts.length > 0 && posts.every((p) => selection.selectedIds.has(p.id)) : false;
  const someSelected = selection ? posts.some((p) => selection.selectedIds.has(p.id)) : false;

  function toggleAll() {
    if (!selection) return;
    for (const post of posts) {
      const isSelected = selection.selectedIds.has(post.id);
      if (allSelected ? isSelected : !isSelected) selection.onToggle(post.id);
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selection && (
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={toggleAll}
                aria-label="Select all"
              />
            </TableHead>
          )}
          <TableHead className="hidden md:table-cell">Topic / angle</TableHead>
          <TableHead>Body</TableHead>
          <TableHead className="hidden sm:table-cell">Format</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden lg:table-cell text-right">Chars</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {posts.map((post) => {
          const topic = post.topic_id ? topicsById?.get(post.topic_id) : undefined;
          return (
            <TableRow
              key={post.id}
              className="cursor-pointer"
              onClick={() => navigate(`/posts/${post.id}`)}
            >
              {selection && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selection.selectedIds.has(post.id)}
                    onCheckedChange={() => selection.onToggle(post.id)}
                    aria-label={`Select post ${post.id}`}
                  />
                </TableCell>
              )}
              <TableCell className="hidden md:table-cell max-w-48 truncate text-muted-foreground">
                {topic ? `${topic.base_text} — ${topic.angle_text}` : "—"}
              </TableCell>
              <TableCell className="max-w-md truncate">{truncate(post.body, 100)}</TableCell>
              <TableCell className="hidden sm:table-cell capitalize text-muted-foreground">
                {post.format}
              </TableCell>
              <TableCell>
                <PostBadges post={post} />
              </TableCell>
              <TableCell className="hidden lg:table-cell text-right text-muted-foreground">
                {post.char_count}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

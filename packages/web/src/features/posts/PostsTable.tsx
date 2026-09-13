import type { PostRow, TopicRow } from "@content-engine/shared";
import { useNavigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { truncate } from "@/lib/text";
import { PostBadges } from "./PostBadges";

/**
 * Dense, desktop-oriented preview — same rule as the grid: no action
 * buttons on the row itself, only badges and truncated text. A table row's
 * columns are just as truncated as a grid card's body, so the same "you
 * can't safely decide from a preview" reasoning applies equally here.
 */
export function PostsTable({
  posts,
  topicsById,
}: {
  posts: PostRow[];
  topicsById?: Map<string, TopicRow>;
}) {
  const navigate = useNavigate();

  return (
    <Table>
      <TableHeader>
        <TableRow>
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

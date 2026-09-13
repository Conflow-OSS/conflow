import type { PostRow, TopicRow } from "@content-engine/shared";
import { Icon } from "@iconify/react";
import { useSearchParams } from "react-router-dom";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PostCard } from "./PostCard";
import { PostsTable } from "./PostsTable";
import type { PostSelection } from "./selection";

type ViewMode = "table" | "grid";

/**
 * The layout choice lives in the URL (?view=), not local state — so a link
 * to "this run's posts in grid view" is a real, shareable/bookmarkable URL,
 * consistent with how filters (M5) work too.
 */
export function PostsView({
  posts,
  topicsById,
  emptyMessage = "No posts yet.",
  selection,
}: {
  posts: PostRow[];
  topicsById?: Map<string, TopicRow>;
  emptyMessage?: string;
  selection?: PostSelection;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view: ViewMode = searchParams.get("view") === "grid" ? "grid" : "table";

  const setView = (next: string) => {
    if (!next) return; // ToggleGroup fires "" when re-clicking the active item — ignore
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("view", next);
      return params;
    });
  };

  if (posts.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ToggleGroup type="single" value={view} onValueChange={setView}>
          <ToggleGroupItem value="table" aria-label="Table view">
            <Icon icon="feather:list" className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <Icon icon="feather:grid" className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {view === "table" ? (
        <PostsTable posts={posts} topicsById={topicsById} selection={selection} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} selection={selection} />
          ))}
        </div>
      )}
    </div>
  );
}

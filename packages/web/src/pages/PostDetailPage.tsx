import { useParams } from "react-router-dom";

export function PostDetailPage() {
  const { postId } = useParams<{ postId: string }>();
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Post {postId}</h1>
      <p className="text-sm text-muted-foreground">
        Milestone 4 builds this out — the slide-over on desktop / full page on mobile, and every action.
      </p>
    </div>
  );
}

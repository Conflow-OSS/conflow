import { Icon } from "@iconify/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { LoadingIcon } from "@/components/ui/loading-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAddSeedPost, useDeleteSeedPost, useSeedPosts } from "@/features/seed/hooks";

const PAGE_SIZE = 20;

export function SeedPage() {
  const [offset, setOffset] = useState(0);
  const [newBody, setNewBody] = useState("");
  const { data, isLoading, isFetching } = useSeedPosts(PAGE_SIZE, offset);
  const addSeedPost = useAddSeedPost();
  const deleteSeedPost = useDeleteSeedPost();

  const posts = data?.posts ?? [];
  const hasNextPage = posts.length === PAGE_SIZE;

  function handleAdd() {
    const body = newBody.trim();
    if (!body) return;
    addSeedPost.mutate(body, {
      onSuccess: () => {
        toast.success("Seed post added");
        setNewBody("");
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to add seed post"),
    });
  }

  function handleDelete(id: string) {
    deleteSeedPost.mutate(id, {
      onSuccess: () => toast.success("Seed post removed"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete seed post"),
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Seed corpus</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reference posts used for voice and the duplicate check — new generated posts are compared against these
          plus recent runs. Not published content on its own.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <Field>
            <FieldLabel>Add a seed post</FieldLabel>
            <Textarea
              rows={5}
              placeholder="Paste a past post to add to the reference corpus…"
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
            />
            <FieldDescription>{newBody.length} characters</FieldDescription>
          </Field>
          <Button variant="primary" disabled={!newBody.trim() || addSeedPost.isPending} onClick={handleAdd}>
            {addSeedPost.isPending && <LoadingIcon pending icon="feather:plus" />}
            {addSeedPost.isPending ? "Adding…" : "Add"}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No seed posts yet.</p>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <Card key={post.id}>
              <CardContent className="flex items-start justify-between gap-4 pt-5">
                <div className="min-w-0">
                  <p className="whitespace-pre-line text-sm leading-relaxed">{post.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {post.char_count} chars · added {new Date(post.created_at).toLocaleDateString()}
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="shrink-0" aria-label="Delete seed post">
                      <Icon icon="feather:trash-2" className="h-4 w-4 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove this seed post?</AlertDialogTitle>
                      <AlertDialogDescription>
                        It stops counting toward the duplicate check. Any post currently flagged against it keeps
                        its flag but loses the reference.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(post.id)}>Remove</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-3">
        {offset > 0 && (
          <Button variant="outline" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </Button>
        )}
        {hasNextPage && (
          <Button variant="outline" disabled={isFetching} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

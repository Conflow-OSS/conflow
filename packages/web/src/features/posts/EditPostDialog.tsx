import { Icon } from "@iconify/react";
import type { PostRow } from "@content-engine/shared";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { LoadingIcon } from "@/components/ui/loading-icon";
import { Textarea } from "@/components/ui/textarea";
import { useEditPost } from "./hooks";

export function EditPostDialog({ post, disabled }: { post: PostRow; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(post.body);
  const [summary, setSummary] = useState(post.summary ?? "");
  const editPost = useEditPost(post.id);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setBody(post.body);
      setSummary(post.summary ?? "");
      editPost.reset();
    }
  }

  function handleSave() {
    const input: { body?: string; summary?: string } = {};
    if (body !== post.body) input.body = body;
    if (summary !== (post.summary ?? "")) input.summary = summary;
    if (Object.keys(input).length === 0) {
      setOpen(false);
      return;
    }
    editPost.mutate(input, {
      onSuccess: () => {
        toast.success("Post updated");
        setOpen(false);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <Icon icon="feather:edit-2" className="h-4 w-4" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit post</DialogTitle>
          <DialogDescription>
            Changing the body re-runs the length and duplicate checks and resets approval to pending.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel>Body</FieldLabel>
          <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          <FieldDescription>{body.length} characters</FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Summary</FieldLabel>
          <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
          <FieldDescription>Used for the LinkedIn card image. Changing it clears the rendered card.</FieldDescription>
        </Field>

        {editPost.isError && (
          <p className="text-sm text-destructive">
            {editPost.error instanceof Error ? editPost.error.message : "Failed to save."}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={editPost.isPending} onClick={handleSave}>
            {editPost.isPending && <LoadingIcon pending icon="feather:save" />}
            {editPost.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

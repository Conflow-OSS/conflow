import type { DesignTemplateRow } from "@content-engine/shared";
import { Icon } from "@iconify/react";
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
import { LoadingIcon } from "@/components/ui/loading-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { useDesignTemplates } from "@/features/design-templates/hooks";
import { GoldenPostCard } from "./GoldenPostCard";
import {
  GoldenPostFormFields,
  emptyGoldenPostForm,
  isGoldenPostFormValid,
  type GoldenPostFormValues,
} from "./GoldenPostForm";
import { useCreateGoldenPost, useGoldenPosts } from "./hooks";

const MAX_GOLDEN_POSTS = 5;

export function GoldenPostsTab() {
  const { data: goldenData, isLoading: goldenLoading } = useGoldenPosts();
  const { data: templateData, isLoading: templatesLoading } = useDesignTemplates();
  const goldenPosts = goldenData?.goldenPosts ?? [];
  const templates = templateData?.designTemplates ?? [];
  const templatesById = new Map(templates.map((template) => [template.id, template]));
  const atMax = goldenPosts.length >= MAX_GOLDEN_POSTS;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Golden posts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Real examples of your voice — up to {MAX_GOLDEN_POSTS}. The AI matches every one's tone, and the
            format/hook mix of generated posts follows an even split across them.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <AddGoldenPostDialog templates={templates} disabled={atMax} />
          {atMax && (
            <p className="text-xs text-muted-foreground">Maximum of {MAX_GOLDEN_POSTS} reached — delete one to add another.</p>
          )}
        </div>
      </div>

      {goldenLoading || templatesLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : goldenPosts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No golden posts yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {goldenPosts.map((goldenPost) => (
            <GoldenPostCard
              key={goldenPost.id}
              goldenPost={goldenPost}
              template={goldenPost.design_template_id ? templatesById.get(goldenPost.design_template_id) : undefined}
              templates={templates}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddGoldenPostDialog({ templates, disabled }: { templates: DesignTemplateRow[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<GoldenPostFormValues>(emptyGoldenPostForm());
  const createGoldenPost = useCreateGoldenPost();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setValues(emptyGoldenPostForm());
      createGoldenPost.reset();
    }
  }

  function handleCreate() {
    createGoldenPost.mutate(
      {
        title: values.title,
        body: values.body,
        format: values.format,
        hookStyle: values.format === "long" ? (values.hookStyle ?? undefined) : undefined,
        designTemplateId: values.designTemplateId ?? undefined,
        idealLengthMin: Number(values.idealLengthMin),
        idealLengthMax: Number(values.idealLengthMax),
      },
      {
        onSuccess: () => {
          toast.success("Golden post added");
          setOpen(false);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to add golden post"),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="primary" disabled={disabled}>
          <Icon icon="feather:plus" className="h-4 w-4" />
          Add golden post
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add golden post</DialogTitle>
          <DialogDescription>
            A real example of your voice. The AI matches its tone and vibe to every golden post you add, and splits
            the generation mix evenly across all of them (max {MAX_GOLDEN_POSTS}).
          </DialogDescription>
        </DialogHeader>
        <GoldenPostFormFields values={values} onChange={setValues} templates={templates} />
        {createGoldenPost.isError && (
          <p className="text-sm text-destructive">
            {createGoldenPost.error instanceof Error ? createGoldenPost.error.message : "Failed to save."}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!isGoldenPostFormValid(values) || createGoldenPost.isPending}
            onClick={handleCreate}
          >
            {createGoldenPost.isPending && <LoadingIcon pending icon="feather:plus" />}
            {createGoldenPost.isPending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

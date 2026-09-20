import type { DesignTemplateRow, GoldenPostRow } from "@content-engine/shared";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { LoadingIcon } from "@/components/ui/loading-icon";
import { CARD_PREVIEW_CHARS, truncate } from "@/lib/text";
import { useDeleteGoldenPost, useUpdateGoldenPost } from "./hooks";
import type { UpdateGoldenPostInput } from "./api";
import { GoldenPostFormFields, goldenPostToForm, isGoldenPostFormValid, type GoldenPostFormValues } from "./GoldenPostForm";

export function GoldenPostCard({
  goldenPost,
  template,
  templates,
}: {
  goldenPost: GoldenPostRow;
  template?: DesignTemplateRow;
  templates: DesignTemplateRow[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<GoldenPostFormValues>(() => goldenPostToForm(goldenPost));
  const updateGoldenPost = useUpdateGoldenPost(goldenPost.id);
  const deleteGoldenPost = useDeleteGoldenPost();

  function startEditing() {
    setValues(goldenPostToForm(goldenPost));
    updateGoldenPost.reset();
    setIsEditing(true);
  }

  function handleSave() {
    const original = goldenPostToForm(goldenPost);
    const input: UpdateGoldenPostInput = {};
    if (values.title !== original.title) input.title = values.title;
    if (values.body !== original.body) input.body = values.body;
    if (values.format !== original.format) input.format = values.format;
    if (values.hookStyle !== original.hookStyle) input.hookStyle = values.hookStyle;
    if (values.designTemplateId !== original.designTemplateId) input.designTemplateId = values.designTemplateId;
    if (values.idealLengthMin !== original.idealLengthMin) input.idealLengthMin = Number(values.idealLengthMin);
    if (values.idealLengthMax !== original.idealLengthMax) input.idealLengthMax = Number(values.idealLengthMax);

    if (Object.keys(input).length === 0) {
      setIsEditing(false);
      return;
    }
    updateGoldenPost.mutate(input, {
      onSuccess: () => {
        toast.success("Golden post updated");
        setIsEditing(false);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update golden post"),
    });
  }

  function handleDelete() {
    deleteGoldenPost.mutate(goldenPost.id, {
      onSuccess: () => toast.success("Golden post deleted"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete golden post"),
    });
  }

  return (
    <Card className="relative overflow-hidden" beam={false}>
      {!isEditing && (
        <Button
          variant="secondary"
          size="icon"
          className="absolute right-2 top-2 z-10 h-8 w-8 [box-shadow:var(--shadow-m)]"
          aria-label="Edit golden post"
          onClick={startEditing}
        >
          <Icon icon="feather:edit-2" className="h-4 w-4" />
        </Button>
      )}

      {isEditing ? (
        <CardContent className="space-y-4 pt-5">
          <GoldenPostFormFields values={values} onChange={setValues} templates={templates} />
          {updateGoldenPost.isError && (
            <p className="text-sm text-destructive">
              {updateGoldenPost.error instanceof Error ? updateGoldenPost.error.message : "Failed to save."}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Delete golden post">
                  <Icon icon="feather:trash-2" className="h-4 w-4 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this golden post?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It stops being used as a voice example, and its share of the generation mix goes to the
                    remaining golden posts.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!isGoldenPostFormValid(values) || updateGoldenPost.isPending} onClick={handleSave}>
                {updateGoldenPost.isPending && <LoadingIcon pending icon="feather:save" />}
                {updateGoldenPost.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </CardContent>
      ) : (
        <>
          {template && <img src={template.preview_image_url} alt="" className="aspect-square w-full object-cover" />}
          <CardHeader className="gap-1.5 space-y-0">
            <p className="pr-8 text-sm font-semibold">{goldenPost.title ?? "Untitled"}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="capitalize">
                {goldenPost.format}
              </Badge>
              {goldenPost.hook_style && (
                <Badge variant="secondary" className="capitalize">
                  {goldenPost.hook_style}
                </Badge>
              )}
              {goldenPost.ideal_length_min !== null && goldenPost.ideal_length_max !== null && (
                <Badge variant="outline">
                  {goldenPost.ideal_length_min}–{goldenPost.ideal_length_max} chars
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm leading-relaxed">
              {expanded ? goldenPost.body : truncate(goldenPost.body, CARD_PREVIEW_CHARS)}
            </p>
            {goldenPost.body.length > CARD_PREVIEW_CHARS && (
              <button
                type="button"
                className="mt-1.5 text-sm font-medium text-primary hover:underline"
                onClick={() => setExpanded((prev) => !prev)}
              >
                {expanded ? "see less" : "…see more"}
              </button>
            )}
          </CardContent>
          <CardFooter>
            <p className="text-xs text-muted-foreground">Updated {new Date(goldenPost.updated_at).toLocaleDateString()}</p>
          </CardFooter>
        </>
      )}
    </Card>
  );
}

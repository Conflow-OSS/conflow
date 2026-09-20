import type { DesignTemplateRow } from "@content-engine/shared";
import { Icon } from "@iconify/react";
import { type ReactNode, useState } from "react";
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
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
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
import { FileInput } from "@/components/ui/file-input";
import { Input } from "@/components/ui/input";
import { LoadingIcon } from "@/components/ui/loading-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateDesignTemplate, useDeleteDesignTemplate, useDesignTemplates, useUpdateDesignTemplate } from "./hooks";

const NAME_MAX = 60;

export function DesignTemplatesTab() {
  const { data, isLoading } = useDesignTemplates();
  const templates = data?.designTemplates ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Design templates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The Imejis card templates your golden posts render with. Add the template's real Imejis design ID and a
            preview image, so you can tell them apart at a glance.
          </p>
        </div>
        <DesignTemplateDialog
          trigger={
            <Button variant="primary">
              <Icon icon="feather:plus" className="h-4 w-4" />
              Add template
            </Button>
          }
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No design templates yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <DesignTemplateCard key={template.id} template={template} />
          ))}
        </div>
      )}
    </div>
  );
}

function DesignTemplateCard({ template }: { template: DesignTemplateRow }) {
  const deleteTemplate = useDeleteDesignTemplate();

  function handleDelete() {
    deleteTemplate.mutate(template.id, {
      onSuccess: (result) => {
        toast.success(
          result.detachedGoldenPosts > 0
            ? `Template deleted — ${result.detachedGoldenPosts} golden post(s) had it unassigned`
            : "Template deleted",
        );
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete template"),
    });
  }

  return (
    <Card className="overflow-hidden" beam={false}>
      <img src={template.preview_image_url} alt="" className="aspect-square w-full object-cover" />
      <CardHeader className="gap-0.5 space-y-0">
        <p className="truncate text-sm font-medium">{template.name}</p>
        <p className="truncate text-xs text-muted-foreground">{template.imejis_design_id}</p>
      </CardHeader>
      <CardFooter className="justify-end">
        <DesignTemplateDialog
          template={template}
          trigger={
            <Button variant="outline" size="icon" aria-label="Edit template">
              <Icon icon="feather:edit-2" className="h-4 w-4" />
            </Button>
          }
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Delete template">
              <Icon icon="feather:trash-2" className="h-4 w-4 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this design template?</AlertDialogTitle>
              <AlertDialogDescription>
                Any golden post currently using it loses the assignment — its cards stop rendering until you assign
                a different template.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
}

function DesignTemplateDialog({ template, trigger }: { template?: DesignTemplateRow; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(template?.name ?? "");
  const [imejisDesignId, setImejisDesignId] = useState(template?.imejis_design_id ?? "");
  const [image, setImage] = useState<File | null>(null);
  const createTemplate = useCreateDesignTemplate();
  const updateTemplate = useUpdateDesignTemplate(template?.id ?? "");
  const mutation = template ? updateTemplate : createTemplate;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName(template?.name ?? "");
      setImejisDesignId(template?.imejis_design_id ?? "");
      setImage(null);
      mutation.reset();
    }
  }

  function handleSave() {
    if (!template && !image) {
      toast.error("A preview image is required");
      return;
    }
    const onSuccess = () => {
      toast.success(template ? "Template updated" : "Template added");
      setOpen(false);
    };
    const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed to save template");

    if (template) {
      updateTemplate.mutate(
        {
          name: name !== template.name ? name : undefined,
          imejisDesignId: imejisDesignId !== template.imejis_design_id ? imejisDesignId : undefined,
          image: image ?? undefined,
        },
        { onSuccess, onError },
      );
    } else {
      createTemplate.mutate({ name, imejisDesignId, image: image! }, { onSuccess, onError });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{template ? "Edit design template" : "Add design template"}</DialogTitle>
          <DialogDescription>
            The Imejis design ID is the real template configured on Imejis — the name and preview image here are
            just how you'll recognize it.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel required>Name</FieldLabel>
          <Input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blue gradient" />
          <FieldDescription>
            {name.length}/{NAME_MAX} characters
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel required>Imejis design ID</FieldLabel>
          <Input
            value={imejisDesignId}
            onChange={(e) => setImejisDesignId(e.target.value)}
            placeholder="e.g. sbOUjiAfOhsl7UfKBtuqU"
          />
        </Field>

        <Field>
          <FieldLabel required={!template}>Preview image</FieldLabel>
          <FileInput accept="image/png,image/jpeg,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          {template && <FieldDescription>Leave empty to keep the current image.</FieldDescription>}
        </Field>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : "Failed to save."}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || !imejisDesignId.trim() || mutation.isPending}
            onClick={handleSave}
          >
            {mutation.isPending && <LoadingIcon pending icon="feather:save" />}
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

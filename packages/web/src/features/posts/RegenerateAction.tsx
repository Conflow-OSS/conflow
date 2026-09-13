import { Icon } from "@iconify/react";
import { Link } from "react-router-dom";
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
import type { RegenerateJobResult } from "./api";
import { useJob, useRegeneratePost } from "./hooks";

/**
 * Regenerate is the one queued action here. Kicks off the job, polls it,
 * and once done points at the replacement post — the old row stays around
 * (flipped to status "regenerated") rather than disappearing.
 */
export function RegenerateAction({ postId }: { postId: string }) {
  const regenerate = useRegeneratePost(postId);
  const jobId = regenerate.data?.jobId ?? null;
  const jobQuery = useJob(jobId);
  const job = jobQuery.data?.job;

  if (job?.state === "completed") {
    const result = job.result as RegenerateJobResult;
    return (
      <div className="flex items-center gap-2 text-sm">
        <Icon icon="feather:check-circle" className="h-4 w-4 text-primary" />
        <span>Regenerated —</span>
        <Button asChild variant="link" size="sm" className="h-auto p-0">
          <Link to={`/posts/${result.newPostId}`}>view the new post</Link>
        </Button>
      </div>
    );
  }

  if (job?.state === "failed") {
    return <p className="text-sm text-destructive">Regeneration failed: {job.error ?? "unknown error"}</p>;
  }

  if (jobId && job && job.state !== "completed" && job.state !== "failed") {
    return (
      <Button variant="outline" disabled>
        <Icon icon="feather:loader" className="h-4 w-4 animate-spin" />
        Regenerating…
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <Icon icon="feather:refresh-cw" className="h-4 w-4" />
          Regenerate
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Regenerate this post?</AlertDialogTitle>
          <AlertDialogDescription>
            A new version is generated from the same topic and angle. This post is kept for reference but marked
            as superseded once the new one is ready.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => regenerate.mutate()}>Regenerate</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

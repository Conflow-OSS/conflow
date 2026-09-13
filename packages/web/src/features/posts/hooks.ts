import type { Approval } from "@content-engine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  editPost,
  getJob,
  getPost,
  publishPost,
  regeneratePost,
  renderCard,
  setApproval,
  type EditPostInput,
} from "./api";

export function usePost(postId: string) {
  return useQuery({ queryKey: ["post", postId], queryFn: () => getPost(postId) });
}

/** Every mutation below changes fields the runs/posts list views also render. */
function useInvalidatePost(postId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["post", postId] });
    void queryClient.invalidateQueries({ queryKey: ["posts"] });
    void queryClient.invalidateQueries({ queryKey: ["run"] });
    void queryClient.invalidateQueries({ queryKey: ["runs"] });
  };
}

export function useSetApproval(postId: string) {
  const invalidate = useInvalidatePost(postId);
  return useMutation({
    mutationFn: (approval: Approval) => setApproval(postId, approval),
    onSuccess: invalidate,
  });
}

export function usePublishPost(postId: string) {
  const invalidate = useInvalidatePost(postId);
  return useMutation({
    mutationFn: () => publishPost(postId),
    onSuccess: invalidate,
  });
}

export function useEditPost(postId: string) {
  const invalidate = useInvalidatePost(postId);
  return useMutation({
    mutationFn: (input: EditPostInput) => editPost(postId, input),
    onSuccess: invalidate,
  });
}

export function useRenderCard(postId: string) {
  const invalidate = useInvalidatePost(postId);
  return useMutation({
    mutationFn: () => renderCard(postId),
    onSuccess: invalidate,
  });
}

export function useRegeneratePost(postId: string) {
  return useMutation({ mutationFn: () => regeneratePost(postId) });
}

/**
 * Polls a job until it leaves a running state. Used for regenerate, the one
 * action here that's queued (BullMQ) instead of synchronous.
 */
export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId!),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const state = query.state.data?.job.state;
      return state === "completed" || state === "failed" ? false : 1500;
    },
  });
}

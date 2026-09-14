import type { Approval } from "@content-engine/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  editPost,
  getJob,
  getPost,
  listPosts,
  publishPost,
  regeneratePost,
  renderCard,
  setApproval,
  type EditPostInput,
  type PostListFilter,
} from "./api";

export function usePosts(filter: PostListFilter) {
  return useQuery({ queryKey: ["posts", filter], queryFn: () => listPosts(filter) });
}

export function usePost(postId: string) {
  return useQuery({ queryKey: ["post", postId], queryFn: () => getPost(postId) });
}

/** Every mutation below changes fields the runs/posts list views also render. */
function useInvalidatePosts() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["post"] });
    void queryClient.invalidateQueries({ queryKey: ["posts"] });
    void queryClient.invalidateQueries({ queryKey: ["run"] });
    void queryClient.invalidateQueries({ queryKey: ["runs"] });
  };
}

export function useSetApproval(postId: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (approval: Approval) => setApproval(postId, approval),
    onSuccess: invalidate,
  });
}

export function usePublishPost(postId: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: () => publishPost(postId),
    onSuccess: invalidate,
  });
}

export function useEditPost(postId: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (input: EditPostInput) => editPost(postId, input),
    onSuccess: invalidate,
  });
}

export function useRenderCard(postId: string) {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: () => renderCard(postId),
    onSuccess: invalidate,
  });
}

interface BulkResult {
  total: number;
  failed: number;
}

async function runBulk(ids: string[], action: (id: string) => Promise<unknown>): Promise<BulkResult> {
  const results = await Promise.allSettled(ids.map(action));
  return { total: ids.length, failed: results.filter((r) => r.status === "rejected").length };
}

/** No batch-by-ids endpoint exists on the backend — this loops the same single-post routes M4 uses. */
export function useBulkApproval() {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: ({ ids, approval }: { ids: string[]; approval: Approval }) =>
      runBulk(ids, (id) => setApproval(id, approval)),
    onSuccess: invalidate,
  });
}

export function useBulkPublish() {
  const invalidate = useInvalidatePosts();
  return useMutation({
    mutationFn: (ids: string[]) => runBulk(ids, (id) => publishPost(id)),
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

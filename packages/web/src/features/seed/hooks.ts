import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addSeedPost, deleteSeedPost, listSeedPosts } from "./api";

export function useSeedPosts(limit: number, offset: number) {
  return useQuery({ queryKey: ["seed-posts", { limit, offset }], queryFn: () => listSeedPosts(limit, offset) });
}

export function useAddSeedPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => addSeedPost(body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["seed-posts"] }),
  });
}

export function useDeleteSeedPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSeedPost(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["seed-posts"] }),
  });
}

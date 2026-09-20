import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createGoldenPost,
  deleteGoldenPost,
  getGoldenPost,
  listGoldenPosts,
  updateGoldenPost,
  type CreateGoldenPostInput,
  type UpdateGoldenPostInput,
} from "./api";

export function useGoldenPosts() {
  return useQuery({ queryKey: ["golden-posts"], queryFn: listGoldenPosts });
}

export function useGoldenPost(id: string) {
  return useQuery({ queryKey: ["golden-post", id], queryFn: () => getGoldenPost(id), enabled: !!id });
}

export function useCreateGoldenPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGoldenPostInput) => createGoldenPost(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["golden-posts"] }),
  });
}

export function useUpdateGoldenPost(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateGoldenPostInput) => updateGoldenPost(id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["golden-posts"] }),
  });
}

export function useDeleteGoldenPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteGoldenPost(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["golden-posts"] }),
  });
}

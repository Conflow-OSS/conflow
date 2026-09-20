import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDesignTemplate,
  deleteDesignTemplate,
  listDesignTemplates,
  updateDesignTemplate,
  type CreateDesignTemplateInput,
  type UpdateDesignTemplateInput,
} from "./api";

export function useDesignTemplates() {
  return useQuery({ queryKey: ["design-templates"], queryFn: listDesignTemplates });
}

export function useCreateDesignTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDesignTemplateInput) => createDesignTemplate(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["design-templates"] }),
  });
}

export function useUpdateDesignTemplate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDesignTemplateInput) => updateDesignTemplate(id, input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["design-templates"] }),
  });
}

// Deleting a template detaches it server-side from any golden post that had
// it assigned — golden-posts is invalidated too so those cards stop pointing
// at a stale template id.
export function useDeleteDesignTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDesignTemplate(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["design-templates"] });
      void queryClient.invalidateQueries({ queryKey: ["golden-posts"] });
    },
  });
}

import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The backend is the source of truth and SSE tells us exactly when to
      // refetch (see the run-detail page) — a short window here just avoids
      // refetching the same data twice on quick back-and-forth navigation.
      staleTime: 10_000,
      retry: 1,
    },
  },
});

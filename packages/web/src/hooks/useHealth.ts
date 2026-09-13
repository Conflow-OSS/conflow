import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface HealthResponse {
  ok: boolean;
  db: "ok" | "error";
  redis: "ok" | "error";
}

/** A real end-to-end check: browser -> Vite/BFF proxy -> real backend -> Postgres/Redis. */
export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<HealthResponse>("/health"),
    refetchInterval: 30_000,
    retry: false,
  });
}

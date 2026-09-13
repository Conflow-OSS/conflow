import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { searchTopics } from "./api";

/** Debounces the raw input so keystrokes don't each fire a request. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** "Have I covered this before?" search used while picking topics for a new run. */
export function useTopicSearch(query: string) {
  const debounced = useDebounced(query.trim(), 300);
  return useQuery({
    queryKey: ["topics", "search", debounced],
    queryFn: () => searchTopics(debounced),
    enabled: debounced.length > 1,
  });
}

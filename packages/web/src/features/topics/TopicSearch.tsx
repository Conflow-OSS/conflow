import { Icon } from "@iconify/react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useTopicSearch } from "./hooks";

/**
 * "Have I covered this before?" — a lookup, not a picker. Typing here never
 * feeds the topics list on the form; it just shows what's already been used
 * so duplication is obvious before the dedup check runs.
 */
export function TopicSearch() {
  const [query, setQuery] = useState("");
  const { data, isFetching } = useTopicSearch(query);

  return (
    <div className="space-y-2">
      <Input
        beam={false}
        placeholder="Search past topics before you write new ones…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim().length > 1 && (
        <div className="rounded-lg border border-border bg-card/50 p-2 text-sm">
          {isFetching ? (
            <p className="text-muted-foreground">Searching…</p>
          ) : data && data.topics.length > 0 ? (
            <ul className="space-y-1.5">
              {data.topics.map((topic) => (
                <li key={topic.base_text} className="flex items-start gap-2">
                  <Icon icon="feather:clock" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-foreground">{topic.base_text}</p>
                    <p className="text-xs text-muted-foreground">
                      used in {topic.run_ids.length} run{topic.run_ids.length === 1 ? "" : "s"} · last{" "}
                      {new Date(topic.last_used_at).toLocaleDateString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No matches — this looks new.</p>
          )}
        </div>
      )}
    </div>
  );
}

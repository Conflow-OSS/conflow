import type { RunRow } from "@content-engine/shared";
import { Badge } from "@/components/ui/badge";

export function RunStatusBadge({ status }: { status: RunRow["status"] }) {
  switch (status) {
    case "completed":
      return <Badge variant="success">Completed</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "running":
      return <Badge variant="primary">Running</Badge>;
    case "queued":
      return <Badge variant="secondary">Queued</Badge>;
  }
}

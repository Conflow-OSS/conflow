import { ulid } from "ulid";

/** Lexicographically sortable, timestamp-prefixed id. */
export function newId(): string {
  return ulid();
}

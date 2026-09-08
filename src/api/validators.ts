import { z } from "zod";
import { BadRequestError } from "../core/errors.js";

/** Parse `data` against `schema`, turning a failure into a 400 with a readable message. */
export function parseOrThrow<Schema extends z.ZodTypeAny>(
  schema: Schema,
  data: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new BadRequestError(message);
  }
  return result.data;
}

export const runListQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export const postFilterQuery = z.object({
  status: z.enum(["ok", "flagged", "all"]).default("all"),
  approval: z.enum(["pending", "approved", "rejected"]).optional(),
});

export const exportQuery = z.object({
  format: z.enum(["md", "json"]).default("md"),
});

export const approveAllBody = z.object({
  includeFlagged: z.boolean().default(false),
});

export const approvalBody = z.object({
  approval: z.enum(["approved", "rejected", "pending"]),
});

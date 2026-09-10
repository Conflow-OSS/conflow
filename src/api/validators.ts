import { z } from "zod";
import { BadRequestError } from "../util/errors.js";

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

export const createRunBody = z
  .object({
    flow: z.enum(["matrix", "casestudy"]),
    input: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("topics"), topics: z.array(z.string().min(1)).min(1) }),
      z.object({ kind: z.literal("story"), text: z.string().min(1) }),
    ]),
  })
  .refine((body) => !(body.flow === "casestudy" && body.input.kind === "topics"), {
    message: "the casestudy flow needs a story, not a topic list",
  });

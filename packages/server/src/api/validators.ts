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

export const topicListQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  q: z.string().min(1).optional(),
});

export const postFilterQuery = z.object({
  status: z.enum(["ok", "flagged", "all"]).default("all"),
  approval: z.enum(["pending", "approved", "rejected"]).optional(),
  // "all" still excludes superseded/rejected posts unless these are set —
  // both are dead weight for routine review, not something a reviewer
  // normally wants mixed into an unfiltered view. Explicitly asking for
  // approval=rejected still works regardless of includeRejected — an
  // explicit filter always wins over the default-hide behavior.
  includeSuperseded: z.coerce.boolean().default(false),
  includeRejected: z.coerce.boolean().default(false),
});

export const postListQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  run_id: z.string().min(1).optional(),
  status: z.enum(["ok", "flagged", "all"]).default("all"),
  approval: z.enum(["pending", "approved", "rejected"]).optional(),
  includeSuperseded: z.coerce.boolean().default(false),
  includeRejected: z.coerce.boolean().default(false),
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

export const editPostBody = z
  .object({
    body: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
  })
  .refine((value) => value.body !== undefined || value.summary !== undefined, {
    message: "provide body and/or summary to edit",
  });

export const createRunBody = z
  .object({
    flow: z.enum(["matrix", "casestudy"]),
    input: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("topics"), topics: z.array(z.string().min(1)).min(1) }),
      z.object({ kind: z.literal("story"), text: z.string().min(1) }),
    ]),
    // All three optional — unset falls back to the server's env defaults
    // (GEN_X/Y/Z). topicCount only matters for a story input; topics-list
    // input already gets its topic count from the list's own length.
    topicCount: z.coerce.number().int().positive().optional(),
    anglesPerTopic: z.coerce.number().int().positive().optional(),
    postsPerAngle: z.coerce.number().int().positive().optional(),
  })
  .refine((body) => !(body.flow === "casestudy" && body.input.kind === "topics"), {
    message: "the casestudy flow needs a story, not a topic list",
  });

export const cardsBatchBody = z.object({
  limit: z.coerce.number().int().positive().optional(),
});

export const seedBody = z.object({
  posts: z
    .array(z.object({ name: z.string().min(1), body: z.string().min(1) }))
    .min(1),
});

/** One seed post, added without disturbing the rest of the corpus. */
export const addSeedPostBody = z.object({
  body: z.string().min(1),
});

export const seedPostListQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

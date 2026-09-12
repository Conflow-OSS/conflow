import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PostStatus } from "../src/store/types.js";
import { resetTestTables, useTestDatabase } from "./support/test-db.js";

useTestDatabase();
process.env.LOG_LEVEL = "error";

const { migrate } = await import("../src/store/migrate.js");
const { insertRun } = await import("../src/store/runs.js");
const {
  insertPost,
  getPost,
  setApproval,
  approvePendingInRun,
  postsNeedingCards,
  countByApproval,
} = await import("../src/store/posts.js");
const { closeDb } = await import("../src/store/db.js");

await migrate();
await resetTestTables();

function newGeneratedPost(
  runId: string,
  extras: { status?: PostStatus; summary?: string | null } = {},
) {
  return insertPost({
    kind: "generated",
    run_id: runId,
    format: "long",
    body: "a".repeat(1000),
    summary: extras.summary === undefined ? "a one-line summary" : extras.summary,
    status: extras.status ?? "ok",
  });
}

let runId: string;

beforeEach(async () => {
  runId = (await insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" })).id;
});

afterAll(async () => {
  await closeDb();
});

describe("approval", () => {
  it("new posts start pending", async () => {
    const post = await newGeneratedPost(runId);
    expect((await getPost(post.id))!.approval).toBe("pending");
    expect((await getPost(post.id))!.approved_at).toBeNull();
  });

  it("approve sets approved_at, reject does not", async () => {
    const post = await newGeneratedPost(runId);

    await setApproval(post.id, "approved");
    expect((await getPost(post.id))!.approval).toBe("approved");
    expect((await getPost(post.id))!.approved_at).not.toBeNull();

    await setApproval(post.id, "rejected");
    expect((await getPost(post.id))!.approval).toBe("rejected");
    expect((await getPost(post.id))!.approved_at).toBeNull();
  });

  it("approve-all approves pending ok posts, skipping flagged ones by default", async () => {
    await newGeneratedPost(runId);
    await newGeneratedPost(runId);
    await newGeneratedPost(runId, { status: "flag_dup" } as never);

    const count = await approvePendingInRun(runId, false);
    expect(count).toBe(2);
    expect(await countByApproval(runId)).toMatchObject({ approved: 2, pending: 1 });
  });

  it("approve-all --include-flagged approves the flagged posts too", async () => {
    await newGeneratedPost(runId);
    await newGeneratedPost(runId, { status: "flag_length" } as never);

    const count = await approvePendingInRun(runId, true);
    expect(count).toBe(2);
    expect(await countByApproval(runId)).toMatchObject({ approved: 2 });
  });

  it("approve-all does not re-approve an already-approved post", async () => {
    const post = await newGeneratedPost(runId);
    await setApproval(post.id, "approved");
    await newGeneratedPost(runId);

    expect(await approvePendingInRun(runId, false)).toBe(1);
  });
});

describe("postsNeedingCards", () => {
  it("returns only approved, ok posts with a summary and no image, up to the limit", async () => {
    const approved = await newGeneratedPost(runId);
    await setApproval(approved.id, "approved");

    const pending = await newGeneratedPost(runId); // not approved
    void pending;

    const noSummary = await newGeneratedPost(runId, { summary: null } as never);
    await setApproval(noSummary.id, "approved");

    const eligible = await postsNeedingCards(runId, 10);
    expect(eligible.map((post) => post.id)).toEqual([approved.id]);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 5; i++) {
      const post = await newGeneratedPost(runId);
      await setApproval(post.id, "approved");
    }
    expect(await postsNeedingCards(runId, 3)).toHaveLength(3);
  });
});

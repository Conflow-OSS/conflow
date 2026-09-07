import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PostStatus } from "../src/store/types.js";

const workDir = mkdtempSync(join(tmpdir(), "content-engine-approve-"));
process.env.DB_PATH = join(workDir, "approve.db");
process.env.EMBED_DIM = "8";
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

migrate();

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

beforeEach(() => {
  runId = insertRun({ flow: "matrix", config: {}, input_kind: "topic_list" }).id;
});

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe("approval", () => {
  it("new posts start pending", () => {
    const post = newGeneratedPost(runId);
    expect(getPost(post.id)!.approval).toBe("pending");
    expect(getPost(post.id)!.approved_at).toBeNull();
  });

  it("approve sets approved_at, reject does not", () => {
    const post = newGeneratedPost(runId);

    setApproval(post.id, "approved");
    expect(getPost(post.id)!.approval).toBe("approved");
    expect(getPost(post.id)!.approved_at).not.toBeNull();

    setApproval(post.id, "rejected");
    expect(getPost(post.id)!.approval).toBe("rejected");
    expect(getPost(post.id)!.approved_at).toBeNull();
  });

  it("approve-all approves pending ok posts, skipping flagged ones by default", () => {
    newGeneratedPost(runId);
    newGeneratedPost(runId);
    newGeneratedPost(runId, { status: "flag_dup" } as never);

    const count = approvePendingInRun(runId, false);
    expect(count).toBe(2);
    expect(countByApproval(runId)).toMatchObject({ approved: 2, pending: 1 });
  });

  it("approve-all --include-flagged approves the flagged posts too", () => {
    newGeneratedPost(runId);
    newGeneratedPost(runId, { status: "flag_length" } as never);

    const count = approvePendingInRun(runId, true);
    expect(count).toBe(2);
    expect(countByApproval(runId)).toMatchObject({ approved: 2 });
  });

  it("approve-all does not re-approve an already-approved post", () => {
    const post = newGeneratedPost(runId);
    setApproval(post.id, "approved");
    newGeneratedPost(runId);

    expect(approvePendingInRun(runId, false)).toBe(1);
  });
});

describe("postsNeedingCards", () => {
  it("returns only approved, ok posts with a summary and no image, up to the limit", () => {
    const approved = newGeneratedPost(runId);
    setApproval(approved.id, "approved");

    const pending = newGeneratedPost(runId); // not approved
    void pending;

    const noSummary = newGeneratedPost(runId, { summary: null } as never);
    setApproval(noSummary.id, "approved");

    const eligible = postsNeedingCards(runId, 10);
    expect(eligible.map((post) => post.id)).toEqual([approved.id]);
  });

  it("respects the limit", () => {
    for (let i = 0; i < 5; i++) {
      const post = newGeneratedPost(runId);
      setApproval(post.id, "approved");
    }
    expect(postsNeedingCards(runId, 3)).toHaveLength(3);
  });
});

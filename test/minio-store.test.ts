import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.S3_ENDPOINT = "http://localhost:9000";
process.env.S3_BUCKET = "content-cards";
process.env.S3_ACCESS_KEY = "minioadmin";
process.env.S3_SECRET_KEY = "minioadmin";
process.env.S3_PUBLIC_URL_BASE = "http://localhost:9000";
process.env.S3_PUBLIC_READ = "true";
process.env.LOG_LEVEL = "error";

// Record every command the store sends; tests flip these flags to steer the fake S3.
const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
let bucketExists = false;
let objectExists = true;

vi.mock("@aws-sdk/client-s3", () => {
  class FakeCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      async send(command: FakeCommand & { constructor: { name: string } }) {
        const name = command.constructor.name;
        sent.push({ name, input: command.input });
        if (name === "HeadBucketCommand" && !bucketExists) throw new Error("NotFound");
        if (name === "CreateBucketCommand") bucketExists = true;
        if (name === "HeadObjectCommand" && !objectExists) throw new Error("NotFound");
        return {};
      }
    },
    HeadBucketCommand: class extends FakeCommand {},
    CreateBucketCommand: class extends FakeCommand {},
    HeadObjectCommand: class extends FakeCommand {},
    PutObjectCommand: class extends FakeCommand {},
    PutBucketPolicyCommand: class extends FakeCommand {},
  };
});

const { MinioImageStore } = await import("../src/cards/minio-store.js");

beforeEach(() => {
  sent.length = 0;
  bucketExists = false;
  objectExists = true;
});

describe("MinioImageStore", () => {
  it("creates the bucket and sets a public-read policy on first put", async () => {
    const store = new MinioImageStore();
    const stored = await store.put("cards/abc.png", Buffer.from("x"), "image/png");

    const commandNames = sent.map((command) => command.name);
    expect(commandNames).toContain("CreateBucketCommand");
    expect(commandNames).toContain("PutBucketPolicyCommand");
    expect(commandNames).toContain("PutObjectCommand");

    const policyCommand = sent.find((command) => command.name === "PutBucketPolicyCommand")!;
    const policy = JSON.parse(policyCommand.input.Policy as string);
    expect(policy.Statement[0]).toMatchObject({
      Action: ["s3:GetObject"],
      Resource: ["arn:aws:s3:::content-cards/*"],
    });

    expect(stored.url).toBe("http://localhost:9000/content-cards/cards/abc.png");
  });

  it("does not create the bucket when it already exists, but still sets the policy", async () => {
    bucketExists = true;
    const store = new MinioImageStore();
    await store.put("cards/abc.png", Buffer.from("x"), "image/png");

    const commandNames = sent.map((command) => command.name);
    expect(commandNames).not.toContain("CreateBucketCommand");
    expect(commandNames).toContain("PutBucketPolicyCommand");
  });

  it("runs bucket setup only once across multiple puts", async () => {
    const store = new MinioImageStore();
    await store.put("cards/a.png", Buffer.from("a"), "image/png");
    await store.put("cards/b.png", Buffer.from("b"), "image/png");

    expect(sent.filter((command) => command.name === "PutBucketPolicyCommand")).toHaveLength(1);
  });

  it("skips the policy when S3_PUBLIC_READ is off", async () => {
    process.env.S3_PUBLIC_READ = "false";
    vi.resetModules();
    const { MinioImageStore: StoreWithPrivateBucket } = await import("../src/cards/minio-store.js");
    const store = new StoreWithPrivateBucket();
    await store.put("cards/abc.png", Buffer.from("x"), "image/png");

    expect(sent.map((command) => command.name)).not.toContain("PutBucketPolicyCommand");
    process.env.S3_PUBLIC_READ = "true";
    vi.resetModules();
  });

  it("find() returns the stored image when the object is present", async () => {
    const store = new MinioImageStore();
    const found = await store.find("cards/present.png");
    expect(found).toEqual({
      url: "http://localhost:9000/content-cards/cards/present.png",
      key: "cards/present.png",
    });
  });

  it("find() returns null when the object is missing", async () => {
    objectExists = false;
    const store = new MinioImageStore();
    expect(await store.find("cards/missing.png")).toBeNull();
  });
});

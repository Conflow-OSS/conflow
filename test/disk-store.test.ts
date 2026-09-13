import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const workDir = mkdtempSync(join(tmpdir(), "content-engine-disk-store-"));
process.env.CARD_DIR = join(workDir, "cards");
process.env.LOG_LEVEL = "error";

const { LocalDiskImageStore } = await import("../src/cards/disk-store.js");

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("LocalDiskImageStore", () => {
  it("writes the bytes to CARD_DIR and returns a file:// url", async () => {
    const store = new LocalDiskImageStore();
    const bytes = Buffer.from("fake-png-bytes");

    const stored = await store.put("cards/post-123.png", bytes, "image/png");

    const expectedPath = join(process.env.CARD_DIR!, "post-123.png");
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath)).toEqual(bytes);
    expect(stored.url).toBe(`file://${expectedPath}`);
    expect(stored.key).toBe("cards/post-123.png");
  });

  it("find() returns the stored image only after it has been put", async () => {
    const store = new LocalDiskImageStore();
    expect(await store.find("cards/never-written.png")).toBeNull();

    await store.put("cards/written.png", Buffer.from("x"), "image/png");
    expect(await store.find("cards/written.png")).toMatchObject({ key: "cards/written.png" });
  });

  it("get() returns the bytes, and throws when nothing is there", async () => {
    const store = new LocalDiskImageStore();
    await expect(store.get("cards/missing.png")).rejects.toThrow(/no card at/);

    await store.put("cards/present.png", Buffer.from("hello"), "image/png");
    expect(await store.get("cards/present.png")).toEqual(Buffer.from("hello"));
  });

  it("delete() removes the file, and is a no-op when nothing is there", async () => {
    const store = new LocalDiskImageStore();
    await store.put("cards/to-delete.png", Buffer.from("x"), "image/png");
    expect(await store.find("cards/to-delete.png")).not.toBeNull();

    await store.delete("cards/to-delete.png");
    expect(await store.find("cards/to-delete.png")).toBeNull();

    await expect(store.delete("cards/never-existed.png")).resolves.toBeUndefined();
  });
});

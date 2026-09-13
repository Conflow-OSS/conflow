import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { loadEnv } from "../config/load.js";
import { NotFoundError } from "../util/errors.js";
import type { ImageStore, StoredImage } from "./image-store.js";

/**
 * Writes cards to a local directory. For local development and for the point
 * where you don't want to run object storage — `image_url` is a file:// path.
 */
export class LocalDiskImageStore implements ImageStore {
  async put(key: string, body: Buffer, _contentType: string): Promise<StoredImage> {
    const filePath = this.pathFor(key);
    mkdirSync(loadEnv().CARD_DIR, { recursive: true });
    writeFileSync(filePath, body);
    return { url: `file://${filePath}`, key };
  }

  async find(key: string): Promise<StoredImage | null> {
    const filePath = this.pathFor(key);
    return existsSync(filePath) ? { url: `file://${filePath}`, key } : null;
  }

  async get(key: string): Promise<Buffer> {
    const filePath = this.pathFor(key);
    if (!existsSync(filePath)) {
      throw new NotFoundError(`no card at ${key}`);
    }
    return readFileSync(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = this.pathFor(key);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  private pathFor(key: string): string {
    return resolve(join(loadEnv().CARD_DIR, basename(key)));
  }
}

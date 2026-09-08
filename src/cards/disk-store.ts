import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { loadEnv } from "../config/load.js";
import type { ImageStore, StoredImage } from "./image-store.js";

/**
 * Writes cards to a local directory. For local development and for the point
 * where you don't want to run object storage — `image_url` is a file:// path.
 */
export class LocalDiskImageStore implements ImageStore {
  async put(key: string, body: Buffer, _contentType: string): Promise<StoredImage> {
    const directory = loadEnv().CARD_DIR;
    mkdirSync(directory, { recursive: true });

    const filePath = join(directory, basename(key));
    writeFileSync(filePath, body);

    return { url: `file://${resolve(filePath)}`, key };
  }
}

import { loadEnv } from "../config/load.js";
import { LocalDiskImageStore } from "./disk-store.js";
import type { ImageStore } from "./image-store.js";
import { MinioImageStore } from "./minio-store.js";

/** The card image store, chosen by IMAGE_STORE. Swap here for R2 / GCS later. */
export function getImageStore(): ImageStore {
  return loadEnv().IMAGE_STORE === "disk" ? new LocalDiskImageStore() : new MinioImageStore();
}

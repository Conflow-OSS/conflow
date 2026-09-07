import type { ImageStore } from "./image-store.js";
import { MinioImageStore } from "./minio-store.js";

/** The card image store. Only MinIO for now; swap here for R2 / GCS later. */
export function getImageStore(): ImageStore {
  return new MinioImageStore();
}

export interface StoredImage {
  /** the URL to read the image back */
  url: string;
  /** the storage key, for later deletion or re-upload */
  key: string;
}

/** Somewhere to put a rendered card. One implementation for now (MinIO). */
export interface ImageStore {
  put(key: string, body: Buffer, contentType: string): Promise<StoredImage>;
}

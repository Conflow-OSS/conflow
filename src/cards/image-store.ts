export interface StoredImage {
  /** the URL to read the image back */
  url: string;
  /** the storage key, for later deletion or re-upload */
  key: string;
}

/** Somewhere to keep rendered cards. MinIO or local disk. */
export interface ImageStore {
  put(key: string, body: Buffer, contentType: string): Promise<StoredImage>;
  /** the stored image at `key`, or null if nothing is there yet */
  find(key: string): Promise<StoredImage | null>;
}

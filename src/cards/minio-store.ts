import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { loadEnv } from "../config/load.js";
import { logger } from "../util/logger.js";
import type { ImageStore, StoredImage } from "./image-store.js";

/** Stores card images in an S3-compatible bucket (MinIO by default). */
export class MinioImageStore implements ImageStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase: string;
  private readonly publicRead: boolean;
  private bucketReady = false;

  constructor() {
    const env = loadEnv();
    if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY || !env.S3_PUBLIC_URL_BASE) {
      throw new Error(
        "S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY and S3_PUBLIC_URL_BASE are required for card storage",
      );
    }

    this.bucket = env.S3_BUCKET;
    this.publicUrlBase = env.S3_PUBLIC_URL_BASE.replace(/\/+$/, "");
    this.publicRead = env.S3_PUBLIC_READ;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredImage> {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return { url: this.urlFor(key), key };
  }

  async find(key: string): Promise<StoredImage | null> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { url: this.urlFor(key), key };
    } catch {
      return null;
    }
  }

  private urlFor(key: string): string {
    return `${this.publicUrlBase}/${this.bucket}/${key}`;
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      logger.info("creating storage bucket", { bucket: this.bucket });
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }

    if (this.publicRead) {
      await this.applyPublicReadPolicy();
    }
    this.bucketReady = true;
  }

  /** Anonymous GET on every object, so the stored URLs open in a browser and a
   *  publisher can fetch them. Idempotent. */
  private async applyPublicReadPolicy(): Promise<void> {
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: ["*"] },
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${this.bucket}/*`],
        },
      ],
    };
    try {
      await this.client.send(
        new PutBucketPolicyCommand({ Bucket: this.bucket, Policy: JSON.stringify(policy) }),
      );
    } catch (error) {
      logger.warn("could not set the bucket read policy — objects may not be publicly readable", {
        bucket: this.bucket,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

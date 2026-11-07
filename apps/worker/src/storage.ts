import type { Db } from "./db.ts";
import { FatalError, RetryableError } from "./errors.ts";

export const BUCKETS = { original: "ads-original", derived: "ads-derived" } as const;
export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

export async function download(db: Db, bucket: Bucket, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error) throw new RetryableError(`storage download ${bucket}/${path}: ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function upload(
  db: Db,
  bucket: Bucket,
  path: string,
  bytes: Uint8Array,
  contentType = "image/png",
): Promise<void> {
  const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new RetryableError(`storage upload ${bucket}/${path}: ${error.message}`);
}

export async function signedUrl(db: Db, bucket: Bucket, path: string, seconds = 600): Promise<string> {
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw new FatalError(`storage sign ${bucket}/${path}: ${error.message}`);
  return data.signedUrl;
}

// Paths always start with <owner_id>/ so storage policies can scope by owner.
export const paths = {
  normalized: (owner: string, adId: string): string => `${owner}/${adId}/normalized.png`,
  maskedAd: (owner: string, adId: string): string => `${owner}/${adId}/masked.png`,
  condition: (owner: string, analysisId: string, conditionId: string): string =>
    `${owner}/${analysisId}/conditions/${conditionId}.png`,
  variantOriginal: (owner: string, analysisId: string, variantId: string): string =>
    `${owner}/${analysisId}/variants/${variantId}.png`,
};

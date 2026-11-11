import 'server-only';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SIGNED_URL_TTL_SECONDS } from '@/lib/config/app';
import { requireEnv } from '@/lib/env/server';
import { toDbError } from './errors';

/**
 * Plate crops live in a private Amazon S3 bucket (Block Public Access on). The server writes
 * and deletes them with the EC2 instance role; browsers only ever get short-lived presigned
 * GET URLs.
 */

let client: S3Client | undefined;
const s3 = () => (client ??= new S3Client({ region: requireEnv('AWS_REGION') }));
const bucket = () => requireEnv('S3_BUCKET');

export function cropPath(batchId: string, postId: string): string {
  // Same shape as the posts.crop_path CHECK constraint: <batch uuid>/<post uuid>.webp
  return `${batchId}/${postId}.webp`;
}

export async function uploadCrop(path: string, webp: Buffer): Promise<void> {
  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: path,
        Body: webp,
        ContentType: 'image/webp',
        CacheControl: 'private, max-age=300',
        IfNoneMatch: '*', // never overwrite an existing crop
      }),
    );
  } catch (err) {
    throw toDbError('storage_upload', { code: (err as Error).name });
  }
}

/** Best effort; failures are left for the daily cleanup via pending_storage_deletes. */
export async function removeCrops(paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  try {
    const res = await s3().send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: paths.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    return (res.Errors ?? []).length === 0;
  } catch {
    return false;
  }
}

/** Short-lived presigned URLs for private crops, keyed by path. */
export async function signCropUrls(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;
  try {
    const signed = await Promise.all(
      unique.map((Key) =>
        getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key }), {
          expiresIn: SIGNED_URL_TTL_SECONDS,
        }),
      ),
    );
    unique.forEach((path, i) => urls.set(path, signed[i]!));
  } catch (err) {
    throw toDbError('storage_sign', { code: (err as Error).name });
  }
  return urls;
}

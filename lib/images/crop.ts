import 'server-only';
import sharp, { type Metadata } from 'sharp';

/**
 * Server-side re-validation of an uploaded plate crop (spec §7.3). The client already crops
 * and re-encodes, but nothing from the client is trusted:
 *  - decode for real and check the actual format (not the declared MIME type);
 *  - bound the pixel count (decompression bombs) and minimum size;
 *  - apply EXIF orientation, then drop ALL metadata (sharp strips it unless asked to keep it);
 *  - re-encode to WebP ≤ 800 px wide and ≤ 300 KB.
 */

export const CROP_LIMITS = {
  maxInputPixels: 4096 * 4096,
  minWidth: 40,
  minHeight: 16,
  maxOutputWidth: 800,
  maxOutputBytes: 300 * 1024,
  formats: ['webp', 'jpeg', 'png'] as readonly string[],
} as const;

export type CropRejection = 'image_unreadable' | 'image_type' | 'image_too_small';

export class CropError extends Error {
  constructor(readonly reason: CropRejection) {
    super(reason);
  }
}

export async function processCrop(input: Buffer): Promise<Buffer> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: CROP_LIMITS.maxInputPixels }).metadata();
  } catch {
    throw new CropError('image_unreadable');
  }
  if (!meta.format || !CROP_LIMITS.formats.includes(meta.format)) throw new CropError('image_type');
  if ((meta.pages ?? 1) > 1) throw new CropError('image_type'); // no animations

  // Orientation-corrected size.
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;
  if (width < CROP_LIMITS.minWidth || height < CROP_LIMITS.minHeight) {
    throw new CropError('image_too_small');
  }

  let quality = 75;
  for (;;) {
    let out: Buffer;
    try {
      out = await sharp(input, { limitInputPixels: CROP_LIMITS.maxInputPixels, failOn: 'error' })
        .rotate()
        .resize({ width: CROP_LIMITS.maxOutputWidth, withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .toBuffer();
    } catch {
      throw new CropError('image_unreadable');
    }
    if (out.length <= CROP_LIMITS.maxOutputBytes || quality <= 35) return out;
    quality -= 15;
  }
}

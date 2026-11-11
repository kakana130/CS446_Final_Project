/**
 * In-browser photo handling for the found flow (spec §3.3, §7.3). The original photo never
 * leaves the device: we decode it with EXIF orientation applied, keep only pixels on a canvas
 * (which discards EXIF/GPS), and upload small WebP crops.
 */

// Large enough that a small plate in a wide shot is still readable; crops stay ≤ 800 px.
export const PHOTO_MAX_EDGE = 2048;
export const CROP_MAX_WIDTH = 800;
export const CROP_TARGET_BYTES = 150 * 1024;
export const CROP_PADDING = 0.12;
export const MIN_CROP_EDGE = 24;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LoadedPhoto {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/** Decode (orientation-corrected) and downscale so the longest edge is ≤ 2048 px. */
export async function loadPhoto(file: Blob): Promise<LoadedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { canvas, width, height };
}

/** Grow a box by `padding` of its size on every side, clamped to the image. Pure. */
export function padRect(
  rect: Rect,
  imageWidth: number,
  imageHeight: number,
  padding = CROP_PADDING,
): Rect {
  const padX = rect.width * padding;
  const padY = rect.height * padding;
  const x = Math.max(0, Math.floor(rect.x - padX));
  const y = Math.max(0, Math.floor(rect.y - padY));
  const right = Math.min(imageWidth, Math.ceil(rect.x + rect.width + padX));
  const bottom = Math.min(imageHeight, Math.ceil(rect.y + rect.height + padY));
  return { x, y, width: right - x, height: bottom - y };
}

/** Normalize a dragged box (any direction) into a positive rect inside the image. Pure. */
export function normalizeDrag(
  a: { x: number; y: number },
  b: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
): Rect {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const x1 = clamp(Math.min(a.x, b.x), imageWidth);
  const y1 = clamp(Math.min(a.y, b.y), imageHeight);
  const x2 = clamp(Math.max(a.x, b.x), imageWidth);
  const y2 = clamp(Math.max(a.y, b.y), imageHeight);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Crop (with padding) and encode as WebP ≤ 800 px wide, lowering quality until it is under
 * ~150 KB. Browsers that can't encode WebP fall back to JPEG; the server re-encodes anyway.
 */
export async function cropToBlob(
  photo: LoadedPhoto,
  rect: Rect,
  padding = CROP_PADDING,
): Promise<Blob> {
  const r = padRect(rect, photo.width, photo.height, padding);
  const scale = Math.min(1, CROP_MAX_WIDTH / r.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(r.width * scale));
  canvas.height = Math.max(1, Math.round(r.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.drawImage(photo.canvas, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const webp = await toBlob(canvas, 'image/webp', quality);
    const blob =
      webp && webp.type === 'image/webp' ? webp : await toBlob(canvas, 'image/jpeg', quality);
    if (!blob) throw new Error('encode_failed');
    if (blob.size <= CROP_TARGET_BYTES || quality === 0.4) return blob;
  }
  throw new Error('encode_failed');
}

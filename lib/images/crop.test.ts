import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CropError, processCrop } from './crop';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 240, g: 240, b: 235 } } });

describe('processCrop', () => {
  it('re-encodes JPEG/PNG/WebP to WebP', async () => {
    for (const input of [
      await solid(400, 120).jpeg().toBuffer(),
      await solid(400, 120).png().toBuffer(),
      await solid(400, 120).webp().toBuffer(),
    ]) {
      const out = await processCrop(input);
      expect((await sharp(out).metadata()).format).toBe('webp');
    }
  });

  it('strips all metadata, including EXIF and GPS', async () => {
    const withExif = await solid(400, 120)
      .withExif({ IFD0: { Make: 'PhoneCo', Model: 'X1' }, IFD3: { GPSLatitudeRef: 'N' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await processCrop(withExif);
    const meta = await sharp(out).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });

  it('applies EXIF orientation before stripping it', async () => {
    // Stored 120x400 with orientation 6 (rotate 90°) → displayed 400x120.
    const rotated = await solid(120, 400).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const out = await sharp(await processCrop(rotated)).metadata();
    expect([out.width, out.height]).toEqual([400, 120]);
  });

  it('downsizes to at most 800 px wide and never upscales', async () => {
    const big = await sharp(await processCrop(await solid(2000, 600).png().toBuffer())).metadata();
    expect(big.width).toBe(800);
    const small = await sharp(await processCrop(await solid(300, 100).png().toBuffer())).metadata();
    expect(small.width).toBe(300);
  });

  it('keeps output under 300 KB even for noisy images', async () => {
    const noise = Buffer.alloc(800 * 600 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 256;
    const input = await sharp(noise, { raw: { width: 800, height: 600, channels: 3 } })
      .png()
      .toBuffer();
    const out = await processCrop(input);
    expect(out.length).toBeLessThanOrEqual(300 * 1024);
  });

  it('rejects tiny crops', async () => {
    await expect(processCrop(await solid(30, 10).png().toBuffer())).rejects.toMatchObject({
      reason: 'image_too_small',
    });
  });

  it('rejects non-images and unsupported formats', async () => {
    await expect(
      processCrop(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).rejects.toBeInstanceOf(CropError);
    await expect(processCrop(Buffer.from('not an image at all'))).rejects.toMatchObject({
      reason: 'image_unreadable',
    });
    const gif = await solid(100, 40).gif().toBuffer();
    await expect(processCrop(gif)).rejects.toMatchObject({ reason: 'image_type' });
  });
});

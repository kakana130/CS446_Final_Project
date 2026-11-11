import { expect, test, type Page } from '@playwright/test';

/**
 * Automatic plate finding + reading in the found flow (Tesseract fallback). The test photo is
 * drawn in the browser with the page's own Thai web font, so it doesn't depend on fonts
 * installed on the CI machine.
 */

interface PlateSpec {
  x: number;
  y: number;
  text: string;
  province: string;
  /** Plate size relative to the default 760×340. */
  scale?: number;
}

async function addDrawnPhoto(page: Page, plates: PlateSpec[], size = { w: 1600, h: 1200 }) {
  await page.evaluate(
    async ({ specs, size }) => {
      const family = getComputedStyle(document.body).fontFamily;
      // Load the page's own web font only: its fallback face points at local("Arial"), which
      // Linux CI machines don't have, and that makes the whole load reject.
      const primary = family.split(',')[0]!;
      await document.fonts.load(`700 150px ${primary}`, 'กข0123456789').catch(() => undefined);
      await document.fonts.ready;
      const c = document.createElement('canvas');
      c.width = size.w;
      c.height = size.h;
      const g = c.getContext('2d')!;
      g.fillStyle = '#6f6452';
      g.fillRect(0, 0, c.width, c.height);
      for (const p of specs) {
        const k = p.scale ?? 1;
        g.fillStyle = '#fbfaf6';
        g.fillRect(p.x, p.y, 760 * k, 340 * k);
        g.strokeStyle = '#111';
        g.lineWidth = 12 * k;
        g.strokeRect(p.x + 14 * k, p.y + 14 * k, 732 * k, 312 * k);
        g.fillStyle = '#111';
        g.textAlign = 'center';
        g.textBaseline = 'alphabetic';
        g.font = `700 ${150 * k}px ${family}`;
        g.fillText(p.text, p.x + 380 * k, p.y + 190 * k);
        g.font = `600 ${64 * k}px ${family}`;
        g.fillText(p.province, p.x + 380 * k, p.y + 290 * k);
      }
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.92));
      const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'plates.jpg', { type: 'image/jpeg' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { specs: plates, size },
  );
}

/** Screen position of a point given in photo pixels (the photo is shown scaled). */
async function photoPoint(page: Page, size: { w: number; h: number }) {
  const img = page.locator('figure img').first();
  await img.scrollIntoViewIfNeeded();
  const b = (await img.boundingBox())!;
  return (x: number, y: number) =>
    [b.x + (x / size.w) * b.width, b.y + (y / size.h) * b.height] as const;
}

async function drag(page: Page, from: readonly [number, number], to: readonly [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.mouse.up();
}

test('suggests a box for each plate; nothing is cut until the user confirms', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/found');
  await addDrawnPhoto(page, [
    { x: 120, y: 140, text: 'กท 2058', province: 'ฉะเชิงเทรา' },
    { x: 720, y: 720, text: '1กข 1234', province: 'กรุงเทพมหานคร' },
  ]);

  await expect(page.getByText(/ระบบหาเจอ 2 ป้าย/)).toBeVisible({ timeout: 150_000 });
  // Suggestions only: no cards yet, and a preview of what would be cut.
  await expect(page.getByRole('heading', { name: 'ป้ายที่ 1' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'ป้ายที่จะเพิ่ม' })).toBeVisible();

  await page.getByRole('button', { name: 'เพิ่มทั้ง 2 ป้ายที่หาเจอ' }).click();
  await expect(page.getByRole('heading', { name: 'ป้ายที่ 2' })).toBeVisible();
  // The crops hold the whole plate (the plates are 760×340, ratio 2.2).
  for (const n of [1, 2]) {
    const size = await page
      .getByRole('img', { name: `รูปป้ายที่ ${n}` })
      .evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight]);
    expect(size[0]! / size[1]!).toBeGreaterThan(1.5);
    expect(size[0]! / size[1]!).toBeLessThan(3);
  }

  // Each card is read and prefilled (the user still confirms). The reading is shown back.
  const readings = page.getByText(/^อ่านได้เป็น หมวด/);
  await expect(readings).toHaveCount(2, { timeout: 60_000 });
  const joined = (await readings.allTextContents()).join(' | ');
  expect(joined).toContain('หมวด กท · เลข 2058');
  expect(joined).toContain('หมวด 1กข · เลข 1234');
  await expect(page.getByRole('button', { name: 'จังหวัด: ฉะเชิงเทรา' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'จังหวัด: กรุงเทพมหานคร' })).toBeVisible();
});

test('manual cropping: draw a box, resize it by a corner, then crop exactly that', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/found');
  await addDrawnPhoto(page, [{ x: 120, y: 140, text: 'กท 2058', province: 'ฉะเชิงเทรา' }]);
  await expect(page.getByText(/ระบบหาเจอ 1 ป้าย/)).toBeVisible({ timeout: 150_000 });

  // Take the suggested box as is.
  await page.getByRole('button', { name: 'เพิ่มป้ายนี้' }).click();
  await expect(page.getByRole('heading', { name: 'ป้ายที่ 1' })).toBeVisible();
  await expect(page.getByText(/^อ่านได้เป็น หมวด กท · เลข 20\d\d/)).toBeVisible({
    timeout: 60_000,
  });

  // The photo folds away once its plates are added; open it again to add another by hand.
  await expect(page.getByText('เพิ่มจากรูปนี้แล้ว 1 ป้าย')).toBeVisible();
  await page.getByRole('button', { name: 'เพิ่มป้ายอื่นจากรูปนี้' }).click();
  // Draw a new box by hand (outside the starting box), then drag its bottom-right corner.
  const at = await photoPoint(page, { w: 1600, h: 1200 });
  await drag(page, at(100, 120), at(900, 500));
  await expect(page.getByRole('img', { name: 'ป้ายที่จะเพิ่ม' })).toBeVisible();
  await drag(page, at(900, 500), at(1000, 560));
  await expect(page.getByRole('heading', { name: 'ป้ายที่ 2' })).toHaveCount(0);
  await page.getByRole('button', { name: 'เพิ่มป้ายนี้' }).click();

  await expect(page.getByRole('heading', { name: 'ป้ายที่ 2' })).toBeVisible();
  await expect(page.getByText(/^อ่านได้เป็น หมวด กท · เลข 20\d\d/)).toHaveCount(2, {
    timeout: 60_000,
  });
  // Exactly the resized box (900×440 → about 2.05), not re-cropped.
  const ratio = await page
    .getByRole('img', { name: 'รูปป้ายที่ 2' })
    .evaluate((i: HTMLImageElement) => i.naturalWidth / i.naturalHeight);
  expect(ratio).toBeGreaterThan(1.95);
  expect(ratio).toBeLessThan(2.15);
});

test('suggests a small plate in a large photo', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/found');
  await addDrawnPhoto(
    page,
    [{ x: 1300, y: 950, text: 'กท 2058', province: 'ฉะเชิงเทรา', scale: 0.4 }],
    { w: 2048, h: 1536 },
  );
  await expect(page.getByText(/ระบบหาเจอ 1 ป้าย/)).toBeVisible({ timeout: 150_000 });
  await page.getByRole('button', { name: 'เพิ่มป้ายนี้' }).click();
  // Read too (a small plate may lose a character; the user always checks it).
  await expect(page.getByText(/^อ่านได้เป็น หมวด กท · เลข 20\d\d/)).toBeVisible({
    timeout: 60_000,
  });
});

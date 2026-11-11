import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

/**
 * With manual entry only: a lost watch and a found post for the same plate are matched
 * instantly, and each side reaches the other (owner via "My posts" + the anti-scam reveal,
 * finder via the match page with its device token).
 */

// Unusual letters + a random number per test run, so runs (and viewports) never collide.
// The letters vary too: a near match (one digit off) with an older run's post would show
// "already found" and stop the owner's flow.
const rare = ['ฬฮ', 'ฮฬ', 'ฆฬ', 'ฬฆ', 'ฌฮ', 'ฮฌ', 'ฆฮ', 'ฮฆ'];
const letters = rare[Math.floor(Math.random() * rare.length)];

async function fillPlate(page: Page, number: string) {
  // One field for the whole plate, typed the way it reads ("ฬฮ1234").
  await page.getByLabel('เลขทะเบียน', { exact: true }).fill(`${letters}${number}`);
  await expect(page.getByText(`อ่านได้เป็น หมวด ${letters} · เลข ${number}`)).toBeVisible();
  await page.getByRole('button', { name: /^จังหวัด:/ }).click();
  const sheet = page.getByRole('dialog', { name: 'เลือกจังหวัด' });
  await sheet.getByRole('searchbox').fill('กทม');
  await sheet.getByRole('button', { name: /กรุงเทพมหานคร/ }).click();
  await expect(sheet).toBeHidden();
}

async function passTurnstile(page: Page) {
  // The test sitekey solves itself; wait until the widget has produced a token.
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, {
    timeout: 30_000,
  });
}

async function plateImage(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360">
    <rect width="800" height="360" fill="#7a6a55"/>
    <rect x="100" y="80" width="600" height="220" fill="#fff" stroke="#111" stroke-width="12"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

test('owner and finder are matched and can reach each other', async ({ page, browser }) => {
  const number = String(1000 + Math.floor(Math.random() * 8999));
  // Roles come from device tokens, so the owner and the finder use separate browsers.
  const owner = page;
  const finderContext = await browser.newContext(test.info().project.use);
  const finder = await finderContext.newPage();

  // --- Owner: register a watch --------------------------------------------------------------
  await owner.goto('/lost');
  await fillPlate(owner, number);
  // Search first (D-100); nobody has found it yet, so the owner reports it lost.
  await owner.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  await expect(owner.getByText('ยังไม่มีใครเก็บป้ายนี้ได้')).toBeVisible();
  await owner.getByRole('button', { name: 'แจ้งป้ายหายไว้' }).click();
  await expect(owner).toHaveURL(/step=contact/);

  await owner.getByLabel('LINE ID (แนะนำ)').fill('e2e.owner');
  await owner.getByLabel(/^หมายเหตุ/).fill('ป้ายหลัง มีสติกเกอร์');
  await owner.getByRole('button', { name: 'ถัดไป' }).click();
  await expect(owner).toHaveURL(/step=confirm/);

  await owner.getByRole('checkbox').check();
  await passTurnstile(owner);
  await owner.getByRole('button', { name: 'แจ้งป้ายหาย', exact: true }).click();
  await expect(owner.getByText('แจ้งป้ายหายแล้ว พอมีคนเก็บได้ เราจะจับคู่ให้ทันที')).toBeVisible();

  // --- Finder: photograph, crop, confirm, send ------------------------------------------------
  await finder.goto('/found');
  await finder
    .locator('input[type="file"][multiple]')
    .setInputFiles({ name: 'plate.jpg', mimeType: 'image/jpeg', buffer: await plateImage() });
  await finder.getByRole('button', { name: 'ใช้ทั้งรูปเลย' }).click();
  await expect(finder.getByRole('heading', { name: 'ป้ายที่ 1' })).toBeVisible();
  await fillPlate(finder, number);
  // Step 1 already says someone is looking for this plate, before anything is posted.
  await expect(finder.getByText('มีคนกำลังตามหาป้ายนี้อยู่!')).toBeVisible();
  await finder.getByRole('button', { name: 'ถัดไป' }).click();
  await expect(finder).toHaveURL(/step=details/);

  await finder.getByLabel(/^หมายเหตุ/).fill('เจอใกล้วัด ทั้งป้ายหน้าและหลัง');
  await finder.getByLabel('LINE ID (แนะนำ)').fill('e2e.finder');
  await finder.getByRole('checkbox').check();
  await passTurnstile(finder);
  await finder.getByRole('button', { name: /^ส่ง 1 ป้าย/ }).click();
  await expect(finder.getByText('เจ้าของป้ายกำลังตามหาอยู่!')).toBeVisible();

  // --- Finder on the match page: sees the owner's note and contact ---------------------------
  await finder.getByRole('link', { name: /ดูรายละเอียด/ }).click();
  await expect(finder).toHaveURL(/\/match\/[0-9a-f-]{36}$/);
  await expect(finder.getByText('ตรงกัน', { exact: true })).toBeVisible();
  await expect(finder.getByText('ป้ายหลัง มีสติกเกอร์')).toBeVisible(); // owner's note
  await expect(finder.getByText('คุณเป็นคนที่เก็บป้ายนี้ได้')).toBeVisible();
  await expect(finder.getByText('e2e.owner')).toHaveCount(0);
  await finder.getByRole('button', { name: 'ดูช่องทางติดต่อเจ้าของป้าย' }).click();
  await expect(finder.getByText('e2e.owner')).toBeVisible();

  // --- Owner: "My posts" shows the match; checklist, then the finder's contact --------------
  await owner.goto('/my-posts');
  await expect(owner.getByText('จับคู่ได้ 1 รายการ')).toBeVisible();
  await owner.getByRole('link', { name: 'ดูการจับคู่' }).click();
  await expect(owner.getByText('คุณเป็นเจ้าของป้ายนี้')).toBeVisible();
  await expect(owner.getByRole('img', { name: 'รูปป้ายที่มีคนเก็บได้' })).toBeVisible();
  await expect(owner.getByText('e2e.finder')).toHaveCount(0);

  await owner.getByRole('button', { name: 'ดูช่องทางติดต่อคนที่เก็บป้ายได้' }).click();
  const sheet = owner.getByRole('dialog', { name: 'อ่านก่อนติดต่อคนที่เก็บป้ายได้' });
  await expect(sheet.getByText('ถ้ามีคนขอให้โอนเงินก่อนได้ป้ายคืน อย่าโอนเด็ดขาด')).toBeVisible();
  await sheet.getByRole('checkbox').check();
  await passTurnstile(owner);
  await sheet.getByRole('button', { name: 'แสดงช่องทางติดต่อ' }).click();
  await expect(owner.getByText('e2e.finder')).toBeVisible();
  await expect(owner.getByText('เจอใกล้วัด ทั้งป้ายหน้าและหลัง')).toBeVisible(); // finder's note
  await expect(owner.getByRole('link', { name: 'เปิดใน LINE' })).toHaveAttribute(
    'href',
    'https://line.me/ti/p/~e2e.finder',
  );

  // --- Searching again shows the found plate under the owner's own report (D-101) ---------
  await owner.goto('/lost');
  await fillPlate(owner, number);
  await owner.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  await expect(owner.getByText('ตรงกัน', { exact: true }).first()).toBeVisible();

  // --- Report a post (D-080) ------------------------------------------------------------------
  await owner.getByRole('button', { name: 'รายงาน', exact: true }).first().click();
  const report = owner.getByRole('dialog', { name: 'รายงานโพสต์นี้' });
  await report.getByText('ป้ายยังติดอยู่กับรถ (ไม่ได้หาย)').click();
  await passTurnstile(owner);
  await report.getByRole('button', { name: 'ส่งรายงาน' }).click();
  await expect(report.getByText('ขอบคุณที่แจ้ง')).toBeVisible();

  await finderContext.close();
});

import { expect, test, type Browser, type Page } from '@playwright/test';
import sharp from 'sharp';

/**
 * Several posts on one plate (D-104): two people report the same plate lost and two people
 * find it (front and rear plates). The finder sees every owner and a warning to check the
 * registration book; the owner is told the two found posts may be the front and rear plates.
 */

const rare = ['ฬฮ', 'ฮฬ', 'ฆฬ', 'ฬฆ', 'ฌฮ', 'ฮฌ', 'ฆฮ', 'ฮฆ'];
const letters = rare[Math.floor(Math.random() * rare.length)];

async function fillPlate(page: Page, number: string) {
  await page.getByLabel('เลขทะเบียน', { exact: true }).fill(`${letters}${number}`);
  await expect(page.getByText(`อ่านได้เป็น หมวด ${letters} · เลข ${number}`)).toBeVisible();
  await page.getByRole('button', { name: /^จังหวัด:/ }).click();
  const sheet = page.getByRole('dialog', { name: 'เลือกจังหวัด' });
  await sheet.getByRole('searchbox').fill('กทม');
  await sheet.getByRole('button', { name: /กรุงเทพมหานคร/ }).click();
  await expect(sheet).toBeHidden();
}

async function passTurnstile(page: Page) {
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

async function newPage(browser: Browser) {
  return (await browser.newContext(test.info().project.use)).newPage();
}

async function reportLost(page: Page, number: string, lineId: string) {
  await page.goto('/lost');
  await fillPlate(page, number);
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  await page.getByRole('button', { name: 'แจ้งป้ายหายไว้' }).click();
  await page.getByLabel('LINE ID (แนะนำ)').fill(lineId);
  await page.getByRole('button', { name: 'ถัดไป' }).click();
  await page.getByRole('checkbox').check();
  await passTurnstile(page);
  await page.getByRole('button', { name: 'แจ้งป้ายหาย', exact: true }).click();
  await expect(page.getByText(/^แจ้งป้ายหายแล้ว/)).toBeVisible();
}

async function postFound(page: Page, number: string, lineId: string) {
  await page.goto('/found');
  await page
    .locator('input[type="file"][multiple]')
    .setInputFiles({ name: 'plate.jpg', mimeType: 'image/jpeg', buffer: await plateImage() });
  await page.getByRole('button', { name: 'ใช้ทั้งรูปเลย' }).click();
  await fillPlate(page, number);
  await page.getByRole('button', { name: 'ถัดไป' }).click();
  await page.getByLabel('LINE ID (แนะนำ)').fill(lineId);
  await page.getByRole('checkbox').check();
  await passTurnstile(page);
  await page.getByRole('button', { name: /^ส่ง 1 ป้าย/ }).click();
}

test('two owners and two finders of one plate each see the others', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const number = String(1000 + Math.floor(Math.random() * 8999));
  const ownerA = page;
  const ownerB = await newPage(browser);
  const finder1 = await newPage(browser);
  const finder2 = await newPage(browser);

  await reportLost(ownerA, number, 'e2e.owner.a');
  await reportLost(ownerB, number, 'e2e.owner.b');

  // --- Finder 1: both owners, one button each, and the registration-book warning -----------
  await postFound(finder1, number, 'e2e.finder.one');
  await expect(finder1.getByText('มี 2 คนกำลังตามหาป้ายนี้!')).toBeVisible();
  await expect(finder1.getByRole('link', { name: /^ดูคนที่ 1/ })).toBeVisible();
  await expect(finder1.getByRole('link', { name: /^ดูคนที่ 2/ })).toBeVisible();
  await expect(finder1.getByText('มี 2 คนบอกว่าเป็นเจ้าของป้ายนี้')).toBeVisible();
  // The match page warns too.
  await finder1.getByRole('link', { name: /^ดูคนที่ 2/ }).click();
  await expect(finder1.getByText('คุณเป็นคนที่เก็บป้ายนี้ได้')).toBeVisible();
  await expect(finder1.getByText('มี 2 คนบอกว่าเป็นเจ้าของป้ายนี้')).toBeVisible();

  // --- Finder 2 (the other plate of the pair) ----------------------------------------------
  await postFound(finder2, number, 'e2e.finder.two');
  await expect(finder2.getByText('มี 2 คนกำลังตามหาป้ายนี้!')).toBeVisible();

  // --- Owner A: both found posts, with the front/rear note ---------------------------------
  await ownerA.goto('/my-posts');
  await expect(ownerA.getByText('จับคู่ได้ 2 รายการ')).toBeVisible();
  await expect(ownerA.getByText('มีคนแจ้งเจอป้ายเลขนี้ 2 รายการ')).toBeVisible();
  await expect(ownerA.getByRole('link', { name: 'ดูการจับคู่ที่ 2' })).toBeVisible();
  await ownerA.getByRole('link', { name: 'ดูการจับคู่ที่ 1' }).click();
  await expect(ownerA.getByText('คุณเป็นเจ้าของป้ายนี้')).toBeVisible();
  await expect(ownerA.getByText('มีคนแจ้งเจอป้ายเลขนี้ 2 รายการ')).toBeVisible();

  // Searching again: their own report, then both found posts with the same note.
  await ownerA.goto('/lost');
  await fillPlate(ownerA, number);
  await ownerA.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  await expect(ownerA.getByText('คุณแจ้งป้ายนี้หายไว้แล้ว')).toBeVisible();
  await expect(ownerA.getByText('มีคนแจ้งเจอป้ายเลขนี้ 2 รายการ')).toBeVisible();
  await expect(ownerA.getByRole('button', { name: 'แจ้งป้ายหายไว้' })).toHaveCount(0);
});

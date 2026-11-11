import { expect, test, type Page } from '@playwright/test';

/**
 * Managing a post (D-078, D-085): on the device it was posted from, "My posts" can extend,
 * resolve and delete it without signing in. Other devices sign in with Google (not testable
 * here); they see the offer to sign in, and the old /manage page leads to "My posts".
 */

const letters = 'ฬภ';

async function fillPlate(page: Page, number: string) {
  await page.getByLabel('เลขทะเบียน', { exact: true }).fill(`${letters}${number}`);
  await expect(page.getByText(`อ่านได้เป็น หมวด ${letters} · เลข ${number}`)).toBeVisible();
}

async function passTurnstile(page: Page) {
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, {
    timeout: 30_000,
  });
}

async function reportLost(page: Page, number: string) {
  await page.goto('/lost');
  await fillPlate(page, number);
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  await page.getByRole('button', { name: 'แจ้งป้ายหายไว้' }).click();
  // Signing in is offered next to the contact details, never required.
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบด้วย Google' })).toBeVisible();
  await page.getByLabel('LINE ID (แนะนำ)').fill('e2e.manage');
  await page.getByRole('button', { name: 'ถัดไป' }).click();
  await expect(page.getByText(/PIN/)).toHaveCount(0);
  await page.getByRole('checkbox').check();
  await passTurnstile(page);
  await page.getByRole('button', { name: 'แจ้งป้ายหาย', exact: true }).click();
  await expect(page.getByText(/^แจ้งป้ายหายแล้ว/)).toBeVisible();
}

test('the owner manages the post from My posts on the same device, no sign-in needed', async ({
  page,
  browser,
}) => {
  const number = String(1000 + Math.floor(Math.random() * 8999));
  await reportLost(page, number);

  // The same plate again on this device: shown the existing report, no second one (D-091).
  await page.goto('/lost');
  await fillPlate(page, number);
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  await expect(page.getByText('คุณแจ้งป้ายนี้หายไว้แล้ว')).toBeVisible();
  await expect(page).not.toHaveURL(/step=contact/);
  await expect(page.getByRole('button', { name: 'แจ้งป้ายหายไว้' })).toHaveCount(0);

  // The home page knows this device has a post and offers signing in to see it elsewhere.
  await page.goto('/');
  await expect(page.getByText('อยากเปิดดูโพสต์จากเครื่องอื่นด้วย?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบด้วย Google' })).toBeVisible();

  // The old search page leads to the lost-plate search (D-101).
  await page.goto('/search');
  await expect(page).toHaveURL(/\/lost$/);

  await page.goto('/my-posts');
  await page.getByRole('button', { name: 'ต่ออายุอีก 30 วัน' }).click();
  await expect(page.getByText('ต่ออายุแล้ว')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ต่ออายุอีก 30 วัน' })).toHaveCount(0);

  await page.getByRole('button', { name: 'ได้ป้ายคืนแล้ว' }).click();
  await expect(page.getByText('บันทึกแล้ว โพสต์นี้จะไม่จับคู่อีก')).toBeVisible();

  await page.getByRole('button', { name: 'ลบโพสต์' }).click();
  await page.getByRole('button', { name: 'ลบเลย' }).click();
  await expect(page.getByText('ยังไม่มีโพสต์')).toBeVisible();

  // Another device without the post: offered to sign in; the old PIN page leads here.
  const other = await (await browser.newContext(test.info().project.use)).newPage();
  await other.goto('/');
  await expect(other.getByText(/^เคยโพสต์จากเครื่องอื่น/)).toBeVisible();
  await expect(other.getByRole('button', { name: 'เข้าสู่ระบบด้วย Google' })).toBeVisible();
  await other.goto('/manage');
  await expect(other).toHaveURL(/\/my-posts$/);
  await expect(other.getByRole('button', { name: 'เข้าสู่ระบบด้วย Google' })).toBeVisible();
});

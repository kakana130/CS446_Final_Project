import { expect, test } from '@playwright/test';

/**
 * Admin area (D-080). Needs E2E_ADMIN_PASSWORD matching ADMIN_PASSWORD_HASH on the server
 * (CI uses throwaway credentials; locally, set it for your own hash or the test is skipped).
 */
const PASSWORD = process.env.E2E_ADMIN_PASSWORD;

test('admin signs in with the password, sees the logs and signs out', async ({ page }) => {
  test.skip(!PASSWORD, 'E2E_ADMIN_PASSWORD not set');

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/);

  await page.getByLabel('รหัสผ่าน').fill('definitely-wrong');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByText('รหัสผ่านไม่ถูกต้อง')).toBeVisible();

  await page.getByLabel('รหัสผ่าน').fill(PASSWORD!);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /ผู้ดูแล/ })).toBeVisible();
  await expect(page.getByText('ป้ายหาย (เปิดอยู่)')).toBeVisible();

  await page.getByRole('link', { name: 'บันทึก' }).click();
  await expect(page.getByRole('heading', { name: 'บันทึกการทำงานของผู้ดูแล' })).toBeVisible();
  await expect(page.getByText('login_ok').first()).toBeVisible();
  await expect(page.getByText('login_failed').first()).toBeVisible();

  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto('/admin?tab=reports');
  await expect(page).toHaveURL(/\/admin\/login$/);
});

import { expect, test } from '@playwright/test';

test('the About page is linked from the footer and covers use, terms, privacy and contact', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'เกี่ยวกับ', exact: true }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1, name: 'เกี่ยวกับ Plate2Home' })).toBeVisible();
  for (const name of ['วิธีใช้', 'ข้อตกลงการใช้งาน', 'ความเป็นส่วนตัว', 'ติดต่อ']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'chanachol.polk@gmail.com' })).toHaveAttribute(
    'href',
    'mailto:chanachol.polk@gmail.com',
  );
  await expect(
    page.getByRole('link', { name: /github\.com\/Chanachol9923\/Plate2Home/ }),
  ).toBeVisible();
  await expect(page.getByText('ภายใน 60 วัน')).toBeVisible();

  // English version.
  await page.goto('/en/about');
  await expect(page.getByRole('heading', { level: 1, name: 'About Plate2Home' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Terms of use' })).toBeVisible();
});

test('the full Terms of Service and Privacy Policy are linked from the footer and each other', async ({
  page,
}) => {
  await page.goto('/');
  const footer = page.getByRole('contentinfo');
  await footer.getByRole('link', { name: 'ข้อตกลงการใช้บริการ' }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'ข้อตกลงและเงื่อนไขการใช้บริการ' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '13. ติดต่อเรา' })).toBeVisible();
  await expect(page.getByText(/ดำเนินการในนาม AnnoyingDoggo/)).toBeVisible();

  await page.getByRole('link', { name: 'อ่านนโยบายความเป็นส่วนตัว' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'นโยบายความเป็นส่วนตัว' }),
  ).toBeVisible();
  await expect(page.getByText(/มีอายุ 60 วัน.*รวมแล้วไม่เกิน 90 วัน/)).toBeVisible();

  await page.goto('/en/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  await page.goto('/en/terms');
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
});

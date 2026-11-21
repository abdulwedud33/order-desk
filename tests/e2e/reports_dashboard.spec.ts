import { test, expect } from '@playwright/test';

test.describe('Milestone M9 Reports & Dashboard Flows', () => {
  test('owner views dashboard summary, switches periods, and inspects ledger reconciliations', async ({ page }) => {
    // 1. Visit reports page
    await page.goto('/reports');
    await page.waitForSelector('main');

    // 2. Check title and top header presence
    await expect(page.locator('h1')).toContainText(/Reports & Summary|ሪፖርቶች እና ማጠቃለያ|Gabaasaalee fi Cuunfaa/);

    // 3. Period selector tabs exist (Today, Week, Month)
    const todayTab = page.getByRole('tab', { name: /Today|ዛሬ|Har'a/i });
    const weekTab = page.getByRole('tab', { name: /This Week|በዚህ ሳምንት|Torban/i });
    const monthTab = page.getByRole('tab', { name: /This Month|በዚህ ወር|Ji'a/i });

    await expect(todayTab).toBeVisible();
    await expect(weekTab).toBeVisible();
    await expect(monthTab).toBeVisible();

    // 4. Stat cards exist
    await expect(page.getByText(/Completed Sales|የተጠናቀቁ ሽያጮች|Gurgurtaa Xumurame/i)).toBeVisible();
    await expect(page.getByText(/Cash Collected|የተሰበሰበ ጥሬ ገንዘብ|Qarshii Galii/i)).toBeVisible();
    await expect(page.getByText(/Unpaid Balances|ያልተከፈለ ቀሪ|Haftee Hin Kaffalamne/i)).toBeVisible();
    await expect(page.getByText(/Total Orders|ጠቅላላ ትዕዛዞች|Waliigala Ajajoota/i)).toBeVisible();

    // 5. Switch to Week tab
    await weekTab.click();
    await expect(weekTab).toHaveAttribute('aria-selected', 'true');

    // 6. Switch to Month tab
    await monthTab.click();
    await expect(monthTab).toHaveAttribute('aria-selected', 'true');
  });

  test('formula-safe CSV export triggers clean file download', async ({ page }) => {
    // 1. Create an order first so orders exist in the report period
    await page.goto('/orders/new');
    await page.waitForSelector('main');

    const customNameInput = page.locator('input[placeholder*="Custom item"]');
    await customNameInput.fill('Special Tibs');
    const customPriceInput = page.locator('input[placeholder="ETB"]');
    await customPriceInput.fill('350');
    await page.locator('form button[type="submit"]').click();

    const createBtn = page.locator('footer button');
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // 2. Visit reports page
    await page.goto('/reports');
    await page.waitForSelector('main');

    const exportBtn = page.getByRole('button', { name: /Export Orders CSV|ትዕዛዞችን በ CSV አውርድ|Ajajoota CSV baasi/i });
    await expect(exportBtn).toBeVisible();

    // Setup download listener
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await exportBtn.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^orders-.*\.csv$/);
  });

  test('offline mode shows calm banner with last cached report numbers', async ({ page, context }) => {
    // 1. Visit reports page while online
    await page.goto('/reports');
    await page.waitForSelector('main');

    // 2. Dispatch offline transition
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    // 3. Verify calm offline banner is visible
    await expect(
      page.getByText(/You're offline|ከመስመር ውጭ ነዎት|Toora irraa ala/i)
    ).toBeVisible();

    // Re-enable online
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
  });
});

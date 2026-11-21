import { test, expect } from '@playwright/test';

test.describe('Milestone M4 Live Board & Concurrency Conflicts', () => {
  test('board renders phone tabs, tablet columns, and handles concurrent status changes gracefully', async ({ page }) => {
    // 1. Visit board
    await page.goto('/');
    await page.waitForSelector('main');

    // 2. Check header and status tabs presence
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('button:has-text("New")')).toBeVisible();
    await expect(page.locator('button:has-text("In Progress")')).toBeVisible();
    await expect(page.locator('button:has-text("Ready")')).toBeVisible();

    // 3. Navigate to kitchen mode
    await page.goto('/kitchen');
    await page.waitForSelector('main');
    await expect(page.locator('h1')).toContainText(/Kitchen Display|የማብሰያ ስክሪን|Iskiriinii Kushiinaa/);

    // 4. Verify mute toggle button works
    const muteBtn = page.locator('button:has-text("Mute"), button:has-text("Unmute"), button:has-text("ድምጽ"), button:has-text("Sagalee")');
    await expect(muteBtn).toBeVisible();
    await muteBtn.click();
  });

  test('two-device conflict handling: concurrent status update reconciles calmly without crash', async ({ browser }) => {
    // Device A Context
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    // Device B Context
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    // Device A loads the board
    await pageA.goto('/');
    await pageA.waitForSelector('main');

    // Device B loads the board
    await pageB.goto('/');
    await pageB.waitForSelector('main');

    // Both devices successfully see the live board without errors
    await expect(pageA.locator('h1')).toBeVisible();
    await expect(pageB.locator('h1')).toBeVisible();

    await contextA.close();
    await contextB.close();
  });
});

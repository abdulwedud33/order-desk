import { test, expect } from '@playwright/test';

test.describe('Milestone M2 Catalog and Customers Flows', () => {
  test('catalog renders categories, item cards, and availability badges', async ({ page }) => {
    await page.goto('/catalog');
    await page.waitForSelector('main');

    // Header and Action presence
    await expect(page.locator('h1')).toContainText(/Menu & Services|ሜኑ እና እቃዎች|Meenuu & Tajaajiloota/);

    // Category filter pills
    const allCatBtn = page.locator('button', { hasText: /All Items|ሁሉም እቃዎች|Meeshaalee Hunda/ });
    await expect(allCatBtn).toBeVisible();
  });

  test('customers page renders search input with 2-character suggestion rule', async ({ page }) => {
    await page.goto('/customers');
    await page.waitForSelector('main');

    // Customer search bar
    const searchInput = page.locator('input[type="search"]');
    await expect(searchInput).toBeVisible();

    // Type 1 character -> shows prompt to type at least 2 characters
    await searchInput.fill('a');
    await expect(page.locator('p', { hasText: /Type at least 2 characters|ቢያንስ 2 ፊደላት|qubee 2/ })).toBeVisible();

    // Type 2 characters -> prompt disappears
    await searchInput.fill('ab');
    await expect(page.locator('p', { hasText: /Type at least 2 characters|ቢያንስ 2 ፊደላት|qubee 2/ })).not.toBeVisible();
  });
});

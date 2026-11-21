import { test, expect } from '@playwright/test';

test.describe('Milestone M3 Offline Order Creation and Recovery', () => {
  test('creates order in offline mode with temporary reference, then syncs on reconnect', async ({ page }) => {
    // 1. Warm up /orders route cache while online
    await page.goto('/orders');
    await page.waitForSelector('main');

    // 2. Navigate to /orders/new
    await page.goto('/orders/new');
    await page.waitForSelector('main');

    // 3. Add an item (using custom line item form)
    const customNameInput = page.locator('input[placeholder*="Custom item"]');
    await expect(customNameInput).toBeVisible();
    await customNameInput.fill('Offline Special');

    const customPriceInput = page.locator('input[placeholder="ETB"]');
    await customPriceInput.fill('180');

    // Click '+' to add line
    await page.locator('form button[type="submit"]').click();

    // Verify item line is added
    await expect(page.locator('text=Offline Special')).toBeVisible();

    // Fill table label
    const labelInput = page.locator('input[placeholder*="Table 4"]');
    await labelInput.fill('Table 12');

    // 3. Put browser into offline mode (airplane mode)
    await page.context().setOffline(true);

    // 4. Click Submit
    const submitBtn = page.locator('footer button');
    await submitBtn.click();

    // 5. Verify redirection to /orders
    await expect(page).toHaveURL(/.*\/orders/, { timeout: 10_000 });
    await page.waitForSelector('main');

    // 6. Verify optimistic order card displays temporary reference & "Saved on this phone" badge
    const savedOnPhoneBadge = page.locator('.rounded-card').getByText(/Saved on this phone|በዚህ ስልክ ላይ ተቀምጧል|Bilbila kana irratti olkaawameera/);
    await expect(savedOnPhoneBadge).toBeVisible();

    // 7. Verify temporary reference prefix (~PEND-)
    const tempRefText = page.getByText(/~PEND-/);
    await expect(tempRefText).toBeVisible();

    // 8. Reconnect to network
    await page.context().setOffline(false);

    // 9. Verify exactly one order exists on the screen
    const orderCards = page.locator('div.rounded-card');
    await expect(orderCards).toHaveCount(1);
  });
});

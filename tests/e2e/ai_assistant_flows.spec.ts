import { test, expect } from '@playwright/test';

test.describe('Milestone M10 AI Assistant & Memory Flows', () => {
  test('Quick Entry sheet parses raw message into draft card with Confirm/Discard', async ({ page }) => {
    // 1. Visit Board
    await page.goto('/');
    await page.waitForSelector('main');

    // 2. Find and click Quick Entry trigger button
    const quickEntryBtn = page.getByRole('button', { name: /Quick Entry|ፈጣን መዝገብ|Galmee Ariifataa/i });
    await expect(quickEntryBtn).toBeVisible();
    await quickEntryBtn.click();

    // 3. Quick Entry dialog opens
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 4. Fill in order message with Ethiopian phone number
    const textarea = dialog.locator('textarea');
    await textarea.fill('2 Shiro and 1 Tibs deliver to Bole 0911223344');

    // 5. Click parse button
    const parseBtn = dialog.getByRole('button', { name: /Quick Entry|ፈጣን መዝገብ|Galmee Ariifataa/i });
    await parseBtn.click();

    // 6. Draft Card appears
    await expect(dialog.getByText(/Review Draft Order|ረቂቅ ትዕዛዙን ይገምግሙ|Wixinee Ajajaa/i)).toBeVisible();
    await expect(dialog.getByText(/Phone:/)).toBeVisible();
    await expect(dialog.getByText('0911223344')).toBeVisible();

    // 7. Click Confirm & Create Order
    const confirmBtn = dialog.getByRole('button', { name: /Confirm & Create Order|አረጋግጥና ትዕዛዝ ፍጠር|Mirkaneessi & Ajaja Uumi/i });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 8. Dialog closes and order exists
    await expect(dialog).not.toBeVisible();
  });

  test('Write update dialog opens on order ticket and generates safe draft', async ({ page }) => {
    // 1. Visit Board
    await page.goto('/');
    await page.waitForSelector('main');

    // 2. Find Write Update button on ticket
    const writeUpdateBtn = page.getByRole('button', { name: /Write Update|መልዕክት ጻፍ|Ergaa Barreessi/i }).first();
    if (await writeUpdateBtn.isVisible()) {
      await writeUpdateBtn.click();

      // 3. Modal opens
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // 4. Click Generate Draft
      const generateBtn = dialog.getByRole('button', { name: /Generate Draft|ረቂቅ አዘጋጅ|Wixinee Hojiirra/i });
      if (await generateBtn.isVisible()) {
        await generateBtn.click();
      }

      // 5. Message textarea is populated
      const msgArea = dialog.locator('textarea');
      await expect(msgArea).toBeVisible();
      const text = await msgArea.inputValue();
      expect(text.length).toBeGreaterThan(0);

      // Verify no money / phone leaked
      expect(text).not.toMatch(/\b(birr|etb|\$)\b/i);
      expect(text).not.toMatch(/(?:\+251\s*|0)[97]\d{8}/);

      // 6. Copy button works
      const copyBtn = dialog.getByRole('button', { name: /Copy Message|መልዕክቱን ቅዳ|Ergaa Garagalchi/i });
      await expect(copyBtn).toBeVisible();
      await copyBtn.click();
    }
  });

  test('Owner memory screen supports adding and deleting memory items', async ({ page }) => {
    // 1. Visit /memory
    await page.goto('/memory');
    await page.waitForSelector('main');

    // 2. Form is present
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Shop Memory|የሱቅ ማህደረ ትውስታ|Yaadannoo Suuqa/i);

    // 3. Add memory item
    const keyInput = page.locator('input[placeholder*="shiro"]');
    await keyInput.fill('shiro');

    const valueInput = page.locator('input[placeholder*="Shiro wet"]');
    await valueInput.fill('Shiro Wet with injera');

    const saveBtn = page.getByRole('button', { name: /Save Item|አስቀምጥ|Olkaayi/i });
    await saveBtn.click();

    // 4. Item appears in list
    await expect(page.getByText('"shiro"')).toBeVisible();

    // 5. Delete item
    const deleteBtn = page.locator('button[aria-label*="Delete"], button[aria-label*="ሰርዝ"], button[aria-label*="Balleessi"]').first();
    await deleteBtn.click();

    // 6. Item is removed
    await expect(page.getByText('"shiro"')).not.toBeVisible();
  });
});

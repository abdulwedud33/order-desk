import { test, expect } from '@playwright/test';

test.describe('Milestone M6 Repair Lifecycle & Handover Flows', () => {
  test('repair intake, turnaround numbers, estimate threshold, and pickup code handover', async ({ page }) => {
    // 1. Visit board
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Order Desk');

    // 2. Open new order form
    await page.goto('/orders/new');
    await page.waitForSelector('main');

    // Select Repair order type
    const repairTab = page.getByRole('button', { name: /Repair/i });
    await expect(repairTab).toBeVisible();
    await repairTab.click();

    // Verify repair intake card appears
    await expect(page.locator('#repair-device')).toBeVisible();
    await expect(page.locator('#repair-problem')).toBeVisible();

    // Fill repair fields
    await page.locator('#repair-device').fill('Samsung Galaxy S22');
    await page.locator('#repair-problem').fill('Broken AMOLED display and touch');
    await page.locator('#repair-serial').fill('SM-S901B-7788');

    // Read the generated pickup code
    const pickupCodeInput = page.locator('#repair-code');
    await expect(pickupCodeInput).toBeVisible();
    const pickupCode = await pickupCodeInput.inputValue();
    expect(pickupCode).toMatch(/^\d{4}$/);

    // Add item: Screen Replacement (1200)
    const customNameInput = page.locator('input[placeholder*="Custom item"]');
    await customNameInput.fill('Screen Replacement');
    const customPriceInput = page.locator('input[placeholder="ETB"]');
    await customPriceInput.fill('1200');
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('text=Screen Replacement')).toBeVisible();

    // Submit repair order
    const createBtn = page.locator('footer button');
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // 3. Board verification
    await page.goto('/');
    await page.waitForSelector('article[aria-label^="Order"]');

    const ticket = page.locator('article[aria-label^="Order"]').first();
    await expect(ticket).toBeVisible();

    // Check device details, pickup code, and turnaround indicator
    await expect(ticket.getByText('Samsung Galaxy S22')).toBeVisible();
    await expect(ticket.getByText('Broken AMOLED display and touch')).toBeVisible();
    await expect(ticket.getByText(new RegExp(`Code: ${pickupCode}`))).toBeVisible();
    await expect(ticket.getByText(/turnaround|⏱️/i).first()).toBeVisible();

    // 4. Advance through lifecycle: new -> accepted -> in_progress -> ready
    // Step 1: Accept from New tab
    const acceptBtn = ticket.getByRole('button', { name: /Accept/i });
    await expect(acceptBtn).toBeVisible();
    await acceptBtn.click();

    // Step 2: Switch to In Progress tab and click Start
    const inProgressTab = page.locator('div.sticky button').filter({ hasText: /In Progress/i });
    await inProgressTab.click();
    const progressTicket = page.locator('article[aria-label^="Order"]').first();
    await expect(progressTicket).toBeVisible();

    const startBtn = progressTicket.getByRole('button', { name: /Start/i });
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Step 3: Click Ready to move order to ready
    const readyBtn = progressTicket.getByRole('button', { name: /Ready/i });
    await expect(readyBtn).toBeVisible();
    await readyBtn.click();

    // 5. In Ready state: Switch to Ready tab and find Handover button
    const readyTab = page.locator('div.sticky button').filter({ hasText: /Ready/i });
    await readyTab.click();
    const readyTicket = page.locator('article[aria-label^="Order"]').first();
    await expect(readyTicket).toBeVisible();

    const handoverBtn = readyTicket.getByRole('button', { name: /Handover/i });
    await expect(handoverBtn).toBeVisible();
    await handoverBtn.click();

    // Handover Dialog opens
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /Handover Device/i })).toBeVisible();

    // Financial gate: Unpaid order warns about unpaid balance
    await expect(dialog.getByText(/Order has an unpaid balance/i)).toBeVisible();

    // Close handover dialog to settle payment first
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).not.toBeVisible();

    // Open Payment Sheet to record payment
    const unpaidChip = readyTicket.getByText(/Unpaid/i).first();
    await unpaidChip.click();

    const paymentSheet = page.getByRole('dialog');
    await expect(paymentSheet).toBeVisible();
    const paySubmitBtn = paymentSheet.getByRole('button', { name: 'Record Payment', exact: true });
    await paySubmitBtn.click();
    await expect(paymentSheet).not.toBeVisible();

    // Now Balance chip displays Paid
    await expect(readyTicket.getByText(/Paid/i).first()).toBeVisible();

    // 6. Complete Handover with Pickup Code
    await readyTicket.getByRole('button', { name: /Handover/i }).click();
    await expect(dialog).toBeVisible();

    // Enter pickup code
    const codeInput = dialog.locator('#pickup-code-input');
    await expect(codeInput).toBeVisible();
    await codeInput.fill(pickupCode);

    // Submit handover
    const completeHandoverBtn = dialog.getByRole('button', { name: /Verify & Complete Handover/i });
    await expect(completeHandoverBtn).toBeEnabled();
    await completeHandoverBtn.click();

    // Dialog closes and order is completed
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText(/Device handed over successfully/i).first()).toBeVisible();
  });
});

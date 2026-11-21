import { test, expect } from '@playwright/test';

test.describe('Milestone M5 Payments & Deposits Ledger Flows', () => {
  test('payment sheet prefill, method selection, overpayment guard, balance chips, and settle-later completion gate', async ({ page }) => {
    // 1. Visit board and ensure clean state
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Order Desk');

    // 2. Create a new order via quick entry
    await page.goto('/orders/new');
    await page.waitForSelector('main');

    // Add item: Burger (240)
    const customNameInput = page.locator('input[placeholder*="Custom item"]');
    await expect(customNameInput).toBeVisible();
    await customNameInput.fill('Burger');

    const customPriceInput = page.locator('input[placeholder="ETB"]');
    await customPriceInput.fill('240');

    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('text=Burger')).toBeVisible();

    // Create Order
    const createBtn = page.locator('footer button');
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // 3. Navigate to Board (/) to test tickets and payment actions
    await page.goto('/');
    await page.waitForSelector('article[aria-label^="Order"]');

    const orderTicket = page.locator('article[aria-label^="Order"]').first();
    await expect(orderTicket).toBeVisible();

    const unpaidChip = orderTicket.getByText(/Unpaid/i).first();
    await expect(unpaidChip).toBeVisible();

    // 4. Tap BalanceChip to open Payment Sheet
    await unpaidChip.click();

    const paymentSheet = page.getByRole('dialog');
    await expect(paymentSheet).toBeVisible();
    await expect(paymentSheet.getByRole('heading', { name: /Record Payment/i })).toBeVisible();

    // Verify prefilled amount equals balance (240.00)
    const amountInput = paymentSheet.locator('#payment-amount');
    await expect(amountInput).toHaveValue('240');

    // 5. Test overpayment inline error
    await amountInput.fill('300');
    await expect(paymentSheet.getByText(/Payment amount exceeds the outstanding balance/i)).toBeVisible();

    const submitBtn = paymentSheet.getByRole('button', { name: 'Record Payment', exact: true });
    await expect(submitBtn).toBeDisabled();

    // 6. Test partial payment with Mobile Money method
    await amountInput.fill('100');
    await expect(paymentSheet.getByText(/Payment amount exceeds the outstanding balance/i)).not.toBeVisible();

    const mobileMoneyBtn = paymentSheet.getByRole('button', { name: /Mobile Money/i });
    await mobileMoneyBtn.click();
    await expect(mobileMoneyBtn).toHaveClass(/border-ember/);

    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Sheet should close and toast appear
    await expect(paymentSheet).not.toBeVisible();
    await expect(page.getByText(/Payment recorded/i)).toBeVisible();

    // 7. Verify BalanceChip is now "Partial" with remaining balance 140.00
    const partialChip = orderTicket.getByText(/Partial/i).first();
    await expect(partialChip).toBeVisible();
    await expect(orderTicket.getByText(/140\.00/i).first()).toBeVisible();

    // 8. Test settle-later completion gate
    // Switch to 'All' tab so ticket stays visible across state transitions
    const allTab = page.getByRole('button', { name: /All/i });
    if (await allTab.isVisible()) {
      await allTab.click();
    }

    // Advance order: new -> accepted -> in_progress -> ready
    const nextBtn = orderTicket.locator('button').filter({ hasText: /Accept|Start|Ready|Complete/i }).first();
    
    // Accept
    await nextBtn.click();
    await page.waitForTimeout(400);

    // Start Prep
    const startBtn = orderTicket.locator('button').filter({ hasText: /Start/i }).first();
    if (await startBtn.isVisible()) {
      await startBtn.click();
      await page.waitForTimeout(400);
    }

    // Ready
    const readyBtn = orderTicket.locator('button').filter({ hasText: /Ready/i }).first();
    if (await readyBtn.isVisible()) {
      await readyBtn.click();
      await page.waitForTimeout(400);
    }

    // Now order is ready. Attempting to click Complete with unpaid balance should trigger warning and payment sheet
    const completeBtn = orderTicket.locator('button').filter({ hasText: /Complete/i }).first();
    await expect(completeBtn).toBeVisible();
    await completeBtn.click();

    // Settle-later intercept opens payment sheet and shows warning toast
    await expect(paymentSheet).toBeVisible();
    await expect(page.getByText(/Order has an unpaid balance/i)).toBeVisible();

    // Enable Settle Later toggle in payment sheet
    const settleLaterCheckbox = paymentSheet.locator('#settle-later-checkbox');
    await settleLaterCheckbox.check();
    await expect(settleLaterCheckbox).toBeChecked();

    // Close payment sheet
    const closeBtn = paymentSheet.getByRole('button', { name: 'Close' });
    await closeBtn.click();
    await expect(paymentSheet).not.toBeVisible();

    // Verify balance chip now shows Settle later
    await expect(orderTicket.getByText(/Settle later/i)).toBeVisible();

    // 9. Now clicking Complete succeeds!
    await completeBtn.click();
    await page.waitForTimeout(400);

    // On the board, the completed order is removed from the active open tickets
    await expect(orderTicket).not.toBeVisible();

    // Verify it appears as Completed in the Orders history list (/orders)
    await page.goto('/orders');
    await page.waitForSelector('main');
    await expect(page.getByText(/Completed/i).first()).toBeVisible();
  });
});

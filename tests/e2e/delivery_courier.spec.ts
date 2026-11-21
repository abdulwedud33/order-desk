import { test, expect } from '@playwright/test';

test.describe('Milestone M7 Delivery Flow & Courier View', () => {
  test('staff creates delivery, assigns courier, courier picks up, collects cash, and completes', async ({ page }) => {
    // 1. Visit board
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Order Desk');

    // 2. Open new order form
    await page.goto('/orders/new');
    await page.waitForSelector('main');

    // Select Delivery order type
    const deliveryTab = page.getByRole('button', { name: /Delivery/i });
    await expect(deliveryTab).toBeVisible();
    await deliveryTab.click();

    // Fill delivery customer contact
    const phoneInput = page.locator('input[placeholder*="Search customer"]');
    await phoneInput.fill('+251911223344');

    const addressInput = page.locator('input[placeholder*="Delivery address"]');
    await addressInput.fill('Bole Medhanialem Mall, 3rd Floor');

    // Add item: Special Tibs (350 ETB)
    const customNameInput = page.locator('input[placeholder*="Custom item"]');
    await customNameInput.fill('Special Tibs');
    const customPriceInput = page.locator('input[placeholder="ETB"]');
    await customPriceInput.fill('350');
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('text=Special Tibs')).toBeVisible();

    // Submit delivery order
    const createBtn = page.locator('footer button');
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // 3. Board: Assign courier
    await page.goto('/');
    await page.waitForSelector('article[aria-label^="Order"]');

    const ticket = page.locator('article[aria-label^="Order"]').first();
    await expect(ticket).toBeVisible();

    // Tap Assign button
    const assignBtn = ticket.getByRole('button', { name: /Assign/i });
    await expect(assignBtn).toBeVisible();
    await assignBtn.click();

    // Assign Courier Dialog
    const assignDialog = page.getByRole('dialog');
    await expect(assignDialog).toBeVisible();
    await expect(assignDialog.getByRole('heading', { name: /Assign Delivery/i })).toBeVisible();

    // Select Courier Carl
    await assignDialog.getByText(/Courier Carl/i).click();
    const confirmAssignBtn = assignDialog.getByRole('button', { name: /Assign Courier/i });
    await expect(confirmAssignBtn).toBeEnabled();
    await confirmAssignBtn.click();
    await expect(assignDialog).not.toBeVisible();

    // 4. Advance through lifecycle: new -> accepted -> in_progress -> ready
    // Step 1: Accept
    const acceptBtn = ticket.getByRole('button', { name: /Accept/i });
    await expect(acceptBtn).toBeVisible();
    await acceptBtn.click();

    // Step 2: In Progress -> Start
    const inProgressTab = page.locator('div.sticky button').filter({ hasText: /In Progress/i });
    await inProgressTab.click();
    const progressTicket = page.locator('article[aria-label^="Order"]').first();
    await expect(progressTicket).toBeVisible();

    const startBtn = progressTicket.getByRole('button', { name: /Start/i });
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Step 3: Move to Ready
    const readyBtn = progressTicket.getByRole('button', { name: /Ready/i });
    await expect(readyBtn).toBeVisible();
    await readyBtn.click();

    // 5. Navigate to My Deliveries screen (/deliveries)
    await page.goto('/deliveries');
    await page.waitForSelector('main');

    await expect(page.locator('h1')).toContainText(/My Deliveries/i);

    // Delivery card appears
    const deliveryCard = page.locator('article[aria-label^="Delivery order"]').first();
    await expect(deliveryCard).toBeVisible();

    // Verify address is displayed
    await expect(deliveryCard.getByText('Bole Medhanialem Mall, 3rd Floor')).toBeVisible();

    // Verify Call link has safe tel: URI
    const callLink = deliveryCard.locator('a[href^="tel:"]');
    await expect(callLink).toBeVisible();
    await expect(callLink).toHaveAttribute('href', 'tel:+251911223344');

    // Verify Map link has properly encoded URL
    const mapLink = deliveryCard.locator('a[href^="https://maps.google.com"]');
    await expect(mapLink).toBeVisible();
    const mapHref = await mapLink.getAttribute('href');
    expect(mapHref).toContain('q=Bole%20Medhanialem%20Mall%2C%203rd%20Floor');

    // Verify items summary & amount to collect
    await expect(deliveryCard.getByText('Special Tibs')).toBeVisible();
    await expect(deliveryCard.getByText(/To Collect/i)).toBeVisible();

    // 6. One Big Status Button: "Picked Up" (ready -> out_for_delivery)
    const pickedUpBtn = deliveryCard.getByRole('button', { name: /Picked Up/i });
    await expect(pickedUpBtn).toBeVisible();
    await pickedUpBtn.click();

    // Status advances optimistically to out_for_delivery
    await expect(deliveryCard.getByText(/Out for Delivery/i)).toBeVisible();

    // Big button now shows "Delivered"
    const deliveredBtn = deliveryCard.getByRole('button', { name: /Delivered/i });
    await expect(deliveredBtn).toBeVisible();
    await deliveredBtn.click();

    // 7. Cash Collected Dialog opens
    const cashDialog = page.getByRole('dialog');
    await expect(cashDialog).toBeVisible();
    await expect(cashDialog.getByRole('heading', { name: /Confirm Cash Collected/i })).toBeVisible();

    // Amount input is prefilled
    const cashInput = cashDialog.locator('input[type="number"]');
    await expect(cashInput).toBeVisible();
    const prefilledValue = await cashInput.inputValue();
    expect(parseFloat(prefilledValue)).toBeGreaterThan(0);

    // Confirm cash collection & complete delivery
    const confirmDeliveryBtn = cashDialog.getByRole('button', { name: /Confirm & Complete/i });
    await expect(confirmDeliveryBtn).toBeEnabled();
    await confirmDeliveryBtn.click();
    await expect(cashDialog).not.toBeVisible();

    // 8. Order moved to Completed tab
    const completedTab = page.locator('header button').filter({ hasText: /Completed/i });
    await completedTab.click();

    const completedDeliveryCard = page.locator('article[aria-label^="Delivery order"]').first();
    await expect(completedDeliveryCard).toBeVisible();
    await expect(completedDeliveryCard.getByText(/Paid in Full/i)).toBeVisible();
  });
});

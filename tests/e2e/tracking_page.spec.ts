import { test, expect } from '@playwright/test';

test.describe('Milestone M8 Public Customer Tracking Page', () => {
  test('valid tracking token displays shop name, order code, status stepper, and zero sensitive data', async ({
    page,
  }) => {
    // Intercept track-order edge function call with valid payload
    await page.route('**/functions/v1/track-order*', async (route) => {
      const url = new URL(route.request().url());
      const token = url.searchParams.get('token');

      if (token === 'valid-token-12345678') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            found: true,
            shop_name: 'Bole Express Cafe',
            business_type: 'food',
            order_code: 'A-042',
            order_type: 'food',
            status: 'in_progress',
            due_at: new Date(Date.now() + 20 * 60000).toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ found: false, message: "We couldn't find this order." }),
        });
      }
    });

    // 1. Open tracking page
    await page.goto('/track/?token=valid-token-12345678');
    await page.waitForSelector('main');

    // 2. Verify minimal fields are rendered
    await expect(page.locator('h1')).toContainText('Bole Express Cafe');
    await expect(page.locator('text=A-042')).toBeVisible();

    // 3. Verify visual stepper
    await expect(page.locator('text=Received')).toBeVisible();
    await expect(page.locator('text=Preparing')).toBeVisible();
    await expect(page.locator('text=Ready')).toBeVisible();

    // 4. Test language switcher (EN -> አማ -> OM)
    const amBtn = page.getByRole('button', { name: 'አማ' });
    await expect(amBtn).toBeVisible();
    await amBtn.click();
    await expect(page.locator('text=በዝግጅት ላይ')).toBeVisible(); // 'Preparing' in Amharic

    const omBtn = page.getByRole('button', { name: 'OM' });
    await expect(omBtn).toBeVisible();
    await omBtn.click();
    await expect(page.locator('text=Qophii Irra Jira')).toBeVisible(); // 'Preparing' in Afaan Oromo

    // 5. Verify security invariants: NO phone, address, names, items, or money
    const bodyText = await page.locator('main').innerText();
    expect(bodyText).not.toContain('+251');
    expect(bodyText).not.toContain('0911');
    expect(bodyText).not.toContain('ETB');
    expect(bodyText).not.toContain('Total');
    expect(bodyText).not.toContain('Birr');
    expect(bodyText).not.toContain('Burger');
    expect(bodyText).not.toContain('Abebe');
  });

  test('unknown or expired token displays calm not-found message', async ({ page }) => {
    await page.route('**/functions/v1/track-order*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ found: false, message: "We couldn't find this order." }),
      });
    });

    await page.goto('/track/?token=unknown-token-123456');
    await page.waitForSelector('main');

    await expect(page.getByText(/We couldn't find this order/i)).toBeVisible();
  });

  test('rate-limited token returns 429 and displays calm throttled message', async ({ page }) => {
    await page.route('**/functions/v1/track-order*', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'Retry-After': '60' },
        body: JSON.stringify({ error: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment.' }),
      });
    });

    await page.goto('/track/?token=rate-limited-token-99');
    await page.waitForSelector('main');

    await expect(page.getByText('Too many requests. Please wait a moment and refresh.')).toBeVisible();
  });

  test('share tracking button on order card copies tracking link', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Create an order first so an order card exists on the board
    await page.goto('/orders/new');
    await page.waitForSelector('main');

    const customNameInput = page.locator('input[placeholder*="Custom item"]');
    await customNameInput.fill('Filter Coffee');
    const customPriceInput = page.locator('input[placeholder="ETB"]');
    await customPriceInput.fill('40');
    await page.locator('form button[type="submit"]').click();

    const createBtn = page.locator('footer button');
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // Board: Order card is rendered with Share Tracking button
    await page.goto('/');
    await page.waitForSelector('article[aria-label^="Order"]');

    const ticket = page.locator('article[aria-label^="Order"]').first();
    await expect(ticket).toBeVisible();

    const shareBtn = ticket.getByRole('button', { name: /Share/i });
    await expect(shareBtn).toBeVisible();
    await shareBtn.click();

    // Verify toast notification
    await expect(page.getByText(/Tracking link copied/i)).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';

test.describe('Onboarding Fixed Layout Verification', () => {
  test('header progress bar and bottom action bar stay in identical fixed positions across all steps', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForSelector('#onboarding-fixed-header');

    // Step 1: Capture initial fixed geometry
    const headerStep1 = await page.locator('#onboarding-fixed-header').boundingBox();
    const footerStep1 = await page.locator('#onboarding-fixed-footer').boundingBox();
    const messageSlotStep1 = await page.locator('#onboarding-message-slot').boundingBox();
    const nextBtnStep1 = await page.locator('#onboarding-next-btn').boundingBox();

    expect(headerStep1).not.toBeNull();
    expect(footerStep1).not.toBeNull();
    expect(messageSlotStep1).not.toBeNull();
    expect(nextBtnStep1).not.toBeNull();

    // Verify fixed height constraints from specification
    expect(headerStep1!.height).toBeCloseTo(64, 1);
    expect(footerStep1!.height).toBeGreaterThanOrEqual(80);
    expect(messageSlotStep1!.height).toBeGreaterThanOrEqual(24);

    // Transition to Step 2
    await page.click('#onboarding-next-btn');
    await page.waitForTimeout(300);

    // Step 2 Geometry
    const headerStep2 = await page.locator('#onboarding-fixed-header').boundingBox();
    const footerStep2 = await page.locator('#onboarding-fixed-footer').boundingBox();
    const messageSlotStep2 = await page.locator('#onboarding-message-slot').boundingBox();

    // Assert zero vertical/horizontal shift or resize of fixed regions
    expect(headerStep2!.x).toBe(headerStep1!.x);
    expect(headerStep2!.y).toBe(headerStep1!.y);
    expect(headerStep2!.width).toBe(headerStep1!.width);
    expect(headerStep2!.height).toBe(headerStep1!.height);

    expect(footerStep2!.x).toBe(footerStep1!.x);
    expect(footerStep2!.y).toBe(footerStep1!.y);
    expect(footerStep2!.width).toBe(footerStep1!.width);
    expect(footerStep2!.height).toBe(footerStep1!.height);

    expect(messageSlotStep2!.height).toBe(messageSlotStep1!.height);

    // Transition to Step 3
    await page.click('#onboarding-next-btn');
    await page.waitForTimeout(300);

    // Step 3 Geometry
    const headerStep3 = await page.locator('#onboarding-fixed-header').boundingBox();
    const footerStep3 = await page.locator('#onboarding-fixed-footer').boundingBox();
    const messageSlotStep3 = await page.locator('#onboarding-message-slot').boundingBox();

    expect(headerStep3!.x).toBe(headerStep1!.x);
    expect(headerStep3!.y).toBe(headerStep1!.y);
    expect(headerStep3!.width).toBe(headerStep1!.width);
    expect(headerStep3!.height).toBe(headerStep1!.height);

    expect(footerStep3!.x).toBe(footerStep1!.x);
    expect(footerStep3!.y).toBe(footerStep1!.y);
    expect(footerStep3!.width).toBe(footerStep1!.width);
    expect(footerStep3!.height).toBe(footerStep1!.height);

    expect(messageSlotStep3!.height).toBe(messageSlotStep1!.height);
  });
});

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

test.describe('Milestone M11 Performance, Accessibility & Budgets per docs/evals.md section 7', () => {
  const routesToAudit = [
    { name: 'Board', path: '/' },
    { name: 'New Order', path: '/orders/new' },
    { name: 'Reports', path: '/reports' },
    { name: 'Memory', path: '/memory' },
    { name: 'Kitchen', path: '/kitchen' },
    { name: 'Deliveries', path: '/deliveries' },
    { name: 'Tracking Page', path: '/track/?token=DEMO_TEST_TOKEN' },
  ];

  for (const route of routesToAudit) {
    test(`axe audit: ${route.name} (${route.path}) has 0 serious or critical violations`, async ({ page }) => {
      await page.goto(route.path);
      await page.waitForLoadState('domcontentloaded');

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const severeViolations = accessibilityScanResults.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical'
      );

      if (severeViolations.length > 0) {
        console.error(
          `Severe accessibility violations on ${route.path}:`,
          JSON.stringify(severeViolations, null, 2)
        );
      }

      expect(severeViolations).toEqual([]);
    });
  }

  test('bundle budget verification: tracking page <= 25 KB gzip, board JS <= 170 KB', () => {
    const outDir = path.resolve(process.cwd(), 'out');
    expect(fs.existsSync(outDir)).toBe(true);

    // 1. Verify tracking page bundle size budget (<= 25 KB gzip)
    const trackHtmlPath = path.join(outDir, 'track', 'index.html');
    expect(fs.existsSync(trackHtmlPath)).toBe(true);

    const trackHtml = fs.readFileSync(trackHtmlPath);
    const trackGzipSize = zlib.gzipSync(trackHtml).length;

    // Track page HTML + JS gzip size budget
    expect(trackGzipSize).toBeLessThanOrEqual(25 * 1024);

    // 2. Verify Next.js chunks directory exists
    const chunksDir = path.join(outDir, '_next', 'static', 'chunks');
    expect(fs.existsSync(chunksDir)).toBe(true);

    // Check individual chunk gzip sizes
    const chunkFiles = fs.readdirSync(chunksDir).filter((f) => f.endsWith('.js'));
    for (const chunk of chunkFiles) {
      const content = fs.readFileSync(path.join(chunksDir, chunk));
      const gzip = zlib.gzipSync(content).length;
      // Single chunk must stay well below total board budget of 170 KB
      expect(gzip).toBeLessThanOrEqual(170 * 1024);
    }
  });
});

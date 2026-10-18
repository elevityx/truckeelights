// AC-L1-20 CSP readiness: with the planned Report-Only policy on the HTML response, the widget path (script, API, shadow styles,
// overlay) causes no violation attributed to truckeevibes.com. Report-Only: nothing is blocked, violations are only reported.
import { boot, expect, test, widgetReady, widgetSheet } from './harness';
import { VIBES } from './routes';

const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://truckeevibes.com; connect-src 'self' https://truckeevibes.com http://127.0.0.1:54399; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:";

test('AC-L1-20 no CSP violation from truckeevibes.com', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: { blockedURI: string; sourceFile: string; directive: string }[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push({ blockedURI: e.blockedURI, sourceFile: e.sourceFile, directive: e.violatedDirective }));
  });
  await page.route(`${VIBES}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const res = await route.fetch();
    return route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy-report-only': CSP } });
  });
  await boot(page, 'vibes', '/?layer=events&view=list', { season: 'halloween' });
  await widgetReady(page, '[data-tv-list]');
  await page.locator('[data-tv-list] .erow').first().click();
  await expect(widgetSheet(page)).toBeVisible();
  await page.waitForTimeout(500);
  const v = await page.evaluate(() => (window as unknown as { __csp: { blockedURI: string; sourceFile: string; directive: string }[] }).__csp);
  const ours = v.filter((x) => /truckeevibes\.com/.test(x.blockedURI) || /truckeevibes\.com/.test(x.sourceFile));
  expect(ours, JSON.stringify(v)).toEqual([]);
});

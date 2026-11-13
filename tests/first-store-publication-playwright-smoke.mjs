import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const health = await page.request.get(origin + '/api/health');
  assert.equal(health.status(), 200);
  assert.equal((await health.json()).app, 'Kyrub');
  const response = await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.ok(response && response.status() < 400, 'The Kyrub browser entrypoint must render');
  await page.locator('body').waitFor({ state: 'visible', timeout: 15000 });
  await page.screenshot({ path: 'playwright-kyrub-isolated-smoke.png', fullPage: true });
  const api = await page.request.post(origin + '/api/action-execute?transport=first-store-publication', {
    data: { action: 'publish', canonicalStoreId: 'fictional_browser_store' },
  });
  assert.equal(api.status(), 401, JSON.stringify(await api.json()));
  assert.equal((await api.json()).error, 'AUTH_REQUIRED');
  assert.deepEqual(errors, [], 'Browser should not throw uncaught errors during initial load');
  console.log('Isolated Chromium smoke passed; screenshot saved.');
} finally {
  await browser.close();
}

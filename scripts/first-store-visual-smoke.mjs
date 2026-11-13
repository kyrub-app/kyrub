import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const origin = 'http://127.0.0.1:3000';
const out = 'artifacts/first-store-visual';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const violations = [];
const errors = [];
const failedRequests = [];
page.on('requestfailed', request => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText }));
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
  const allowedLocal = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!allowedLocal) {
    violations.push(url.origin);
    return route.abort();
  }
  return route.continue();
});
try {
  const response = await page.goto(origin, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
  await page.screenshot({ path: `${out}/initial-page.png`, fullPage: false, timeout: 15000 });
  if (!response?.ok()) throw new Error(`APP_HTTP_${response?.status() ?? 'NO_RESPONSE'}`);
  await page.waitForTimeout(1500);
  console.log('Browser diagnostics:', JSON.stringify({ errors, failedRequests: failedRequests.slice(0, 20) }));
  if (violations.length) throw new Error(`E2E_EXTERNAL_NETWORK_REQUEST: ${[...new Set(violations)].join(', ')}`);
  if (errors.some(message => message.includes('E2E_ISOLATION_GUARD_FAILED'))) {
    throw new Error('E2E_ISOLATION_GUARD_FAILED');
  }
  console.log('PASS: isolated application opens in Chromium; screenshot captured');
  console.log('NOT TESTED: user registration, store creation UI, Free activation, XP award');
} catch (error) {
  console.error('Browser failure diagnostics:', JSON.stringify({ errors, failedRequests: failedRequests.slice(0, 30), violations }));
  try { await page.screenshot({ path: `${out}/failure.png`, timeout: 5000 }); } catch { /* preserve original error */ }
  throw error;
} finally {
  await browser.close();
}

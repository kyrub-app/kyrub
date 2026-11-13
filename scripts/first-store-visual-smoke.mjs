import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const origin = 'http://127.0.0.1:3000';
const out = 'artifacts/first-store-visual';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const violations = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {\n  const request = route.request();
  const url = new URL(request.url());
  if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
  const allowedLocal = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!allowedLocal && /(?:firebaseio\.com|googleapis\.com|firestore\.google|firebaseapp\.com|firebasestorage\.app|cloudfunctions\.net)/i.test(url.hostname)) {
    violations.push(url.origin);
    return route.abort();
  }
});
try {
  const response = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.screenshot({ path: `${out}/initial-page.png`, fullPage: true });
  if (!response?.ok()) throw new Error(`APP_HTTP_${response?.status() ?? 'NO_RESPONSE'}`);
  await page.waitForTimeout(1500);
  if (violations.length) throw new Error(`E2E_EXTERNAL_FIREBASE_REQUEST: ${[...new Set(violations)].join(', ')}`);
  if (errors.some(message => message.includes('E2E_ISOLATION_GUARD_FAILED'))) {
    throw new Error('E2E_ISOLATION_GUARD_FAILED');
  }
  console.log('PASS: isolated application opens in Chromium; screenshot captured');
  console.log('NOT TESTED: user registration, store creation UI, Free activation, XP award');
} finally {
  await browser.close();
}

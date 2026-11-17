import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

const storefront = readFileSync('src/components/PublicStorefrontApp.tsx', 'utf8');
const share = readFileSync('src/components/StorePromotionsManager.tsx', 'utf8');
const billingClient = readFileSync('src/utils/storeSubscription.ts', 'utf8');

test('Praça coupon opens existing official prepaid checkout, not the retail cart', () => {
  assert.match(share, /\?coupon=\$\{encodeURIComponent\(current\.code\)\}/);
  assert.match(storefront, /OFFICIAL_STORE_CANONICAL_ID/);
  assert.match(storefront, /isOfficialPlanProductId\(product\.id\)/);
  assert.match(storefront, /setSelectedOfficialPlanId\(product\.id\)/);
  assert.match(storefront, /retailOnly = previous\.filter\(item => !isOfficialPlanProductId\(item\.product\.id\)\)/);
  assert.match(storefront, /<InitialPrepaidSubscriptionCheckout/);
  assert.match(storefront, /billingAuthority="platform"/);
  assert.match(storefront, /promotionCode=\{couponForOfficialPlan \? sharedCouponCode : undefined\}/);
  assert.match(storefront, /couponForRetail &&/);
  assert.match(billingClient, /input\.billingAuthority === 'platform' && input\.promotionCode/);
  assert.match(billingClient, /'official\.prepaid\.quote'/);
});

test('existing contract card renders original price, ERP discount and final accepted Pix price', async () => {
  const bundle = await build({
    stdin: {
      contents: "export { InitialPrepaidSubscriptionCard } from './src/components/InitialPrepaidSubscriptionCheckout.tsx';",
      resolveDir: process.cwd(), sourcefile: 'official-plan-card-fixture.ts', loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external',
    plugins: [{
      name: 'fake-auth-and-billing-network',
      setup(compiler) {
        compiler.onResolve({ filter: /(?:^|\/)(firebase|storeSubscription)(?:\.js)?$/ }, args => ({
          path: args.path, namespace: 'fake-network',
        }));
        compiler.onLoad({ filter: /.*/, namespace: 'fake-network' }, args => ({
          contents: /(?:^|\/)(?:firebase)(?:\.js)?$/.test(args.path)
            ? 'export const auth={currentUser:null};'
            : [
              'export const quoteInitialPrepaidSubscription=async()=>{throw Error("NETWORK_NOT_ALLOWED")};',
              'export const acceptInitialPrepaidSubscription=async()=>{throw Error("NETWORK_NOT_ALLOWED")};',
              'export const checkoutInitialPrepaidSubscription=async()=>{throw Error("NETWORK_NOT_ALLOWED")};',
              'export const loadInitialPrepaidSubscriptionStatus=async()=>{throw Error("NETWORK_NOT_ALLOWED")};',
            ].join('\n'),
        }));
      },
    }],
  });
  const path = new URL(`../.official-plan-praça-card-${randomUUID()}.mjs`, import.meta.url);
  await writeFile(path, bundle.outputFiles[0].text);
  try {
    const { InitialPrepaidSubscriptionCard } = await import(path.href);
    const html = renderToStaticMarkup(createElement(InitialPrepaidSubscriptionCard, {
      quote: {
        checkoutId: 'a'.repeat(64),
        status: 'quoted',
        quote: {
          months: 1, totalMinor: 100, originalTotalMinor: 39700,
          promotionDiscountMinor: 39600, promotionCode: 'BIZ1',
          discountPercent: 0, monthlyEquivalentMinor: 39700,
        },
      },
      payment: null, accepted: false, busy: false, error: '', selectedMonths: 1,
      onAccept: () => {}, onAction: () => {},
    }));
    assert.match(html, /data-official-plan-coupon-quote="BIZ1"/);
    assert.match(html, /397,00/);
    assert.match(html, /396,00/);
    assert.match(html, /1,00/);
    assert.match(html, /Confirmo a contratação/);
    assert.match(html, /sem renovação automática/);
  } finally {
    await unlink(path);
  }
});

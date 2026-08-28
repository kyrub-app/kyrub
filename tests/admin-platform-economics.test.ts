import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deriveKyrubPlatformEconomics } from '../shared/kyrubPlatformEconomics.js';
import type { KyrubEconomicLedger } from '../shared/kyrubEconomicLedger.js';

const ledger = (overrides: Partial<KyrubEconomicLedger> = {}): KyrubEconomicLedger => ({
  id: 'economic-pay-1',
  transactionId: 'pi-1',
  storeId: 'store-1',
  orderId: 'order-1',
  paymentId: 'pay-1',
  paymentMethod: 'pix',
  paymentProvider: 'mercado_pago',
  currency: 'BRL',
  source: 'marketplace_payment',
  status: 'posted',
  entries: [
    {
      id: 'sale', kind: 'sale', amountMinor: 10000,
      fundedBy: { id: 'buyer-1', role: 'buyer' },
      owedTo: { id: 'store-1', role: 'merchant' },
    },
    {
      id: 'fee', kind: 'platform_fee', amountMinor: 1000,
      fundedBy: { id: 'store-1', role: 'merchant' },
      owedTo: { id: 'kyrub', role: 'platform' },
    },
    {
      id: 'incentive', kind: 'incentive', amountMinor: 300,
      fundedBy: { id: 'kyrub', role: 'platform' },
      owedTo: { id: 'courier-1', role: 'courier' },
    },
  ],
  createdAt: '2026-08-28T22:00:00.000Z',
  schemaVersion: 1,
  ...overrides,
});

test('platform economics are derived from immutable entries rather than order totals', () => {
  const summary = deriveKyrubPlatformEconomics({ ledgers: [ledger()] });
  assert.equal(summary.totals.gmvMinor, 10000);
  assert.equal(summary.totals.consumerPaidMinor, 10000);
  assert.equal(summary.totals.platformRevenueMinor, 1000);
  assert.equal(summary.totals.platformCostsMinor, 300);
  assert.equal(summary.totals.platformNetMinor, 700);
  assert.equal(summary.totals.workerEarningsMinor, 300);
  assert.equal(summary.byPaymentMethod[0]?.key, 'pix');
  assert.equal(summary.byProvider[0]?.key, 'mercado_pago');
});

test('AI and infrastructure are never reported as zero-cost before authoritative modeling exists', () => {
  const summary = deriveKyrubPlatformEconomics({ ledgers: [ledger()] });
  assert.equal(summary.coverage.aiCosts, 'not_modeled');
  assert.equal(summary.coverage.infrastructureCosts, 'not_modeled');
});

test('finance endpoint is server-authorized, audited and bounded', () => {
  const server = readFileSync('server/admin/platformEconomicsRouter.ts', 'utf8');
  assert.match(server, /FINANCE_ROLES = new Set\(\['super_admin', 'finance'\]\)/);
  assert.match(server, /verifyFirebaseIdToken\(token\)/);
  assert.match(server, /emailVerified !== true/);
  assert.match(server, /collectionGroup\('economicLedgers'\)/);
  assert.match(server, /MAX_LEDGER_SCAN \+ 1/);
  assert.match(server, /admin\.platform_economics\.viewed/);
});

test('browser consumes an aggregate endpoint and never reads economicLedgers directly', () => {
  const client = readFileSync('src/utils/adminPlatformEconomics.ts', 'utf8');
  const workspace = readFileSync('src/components/admin/AdminPlatformEconomicsWorkspace.tsx', 'utf8');
  const root = readFileSync('src/components/admin/AdminControlPlaneRoot.tsx', 'utf8');
  const serverEntry = readFileSync('server.ts', 'utf8');
  const vercel = readFileSync('api/admin/economics/summary.ts', 'utf8');
  assert.match(client, /\/api\/admin\/economics\/summary/);
  assert.doesNotMatch(client, /economicLedgers/);
  assert.match(workspace, /read_finance/);
  assert.match(workspace, /não lê nem altera o ledger diretamente/);
  assert.match(root, /admin-platform-economics/);
  assert.match(serverEntry, /\/api\/admin\/economics/);
  assert.match(vercel, /loadAuthorizedPlatformEconomics/);
  assert.match(vercel, /no-store, max-age=0/);
});

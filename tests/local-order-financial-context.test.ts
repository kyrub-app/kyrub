import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildCanonicalOrderFinancialProjection } from '../shared/canonicalOrderFinancialProjection';

const serviceSource = readFileSync(
  'server/attendance/localOrderFinancialContextService.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/attendance/localAttendanceRouter.ts',
  'utf8'
);
const panelSource = readFileSync(
  'src/components/store/ServiceLocationFinancialContextPanel.tsx',
  'utf8'
);
const workspaceSource = readFileSync(
  'src/components/store/ServiceLocationOperationalWorkspaceBridge.tsx',
  'utf8'
);
const clientSource = readFileSync(
  'src/utils/localOrderFinancialContext.ts',
  'utf8'
);

test('canonical projection proves money independently from line settlement quantities', () => {
  assert.deepEqual(buildCanonicalOrderFinancialProjection({
    expectedAmount: 100,
    payments: [{ amount: 100, status: 'paid' }],
  }), {
    expectedAmount: 100,
    authoritativelyPaidAmount: 100,
    outstandingAmount: 0,
    pendingPaymentCount: 0,
    canonicalPaymentCount: 1,
    state: 'paid',
  });
  assert.equal(buildCanonicalOrderFinancialProjection({
    expectedAmount: 100,
    payments: [{ amount: 40, status: 'paid' }],
  }).state, 'partial');
  assert.equal(buildCanonicalOrderFinancialProjection({
    expectedAmount: 100,
    payments: [{ amount: 100, status: 'pending' }],
  }).state, 'pending');
  assert.equal(buildCanonicalOrderFinancialProjection({
    expectedAmount: 100,
    payments: [{ amount: 100, status: 'refunded' }],
  }).state, 'refunded');
});

test('service location financial context reads canonical evidence without treating legacy mirrors as payment proof', () => {
  assert.match(serviceSource, /classifyCompatiblePaymentRecord/);
  assert.match(serviceSource, /compatible\.kind === 'legacy_table_payment_mirror'/);
  assert.match(serviceSource, /ignoredLegacyMirrorCount \+= 1/);
  assert.match(serviceSource, /canonicalPayments\.push\(compatible\.payment\)/);
  assert.match(serviceSource, /payment\.orderId !== orderId/);
  assert.match(serviceSource, /payment\.context !== 'table'/);
  assert.match(serviceSource, /payment\.context !== 'pos'/);
  assert.match(serviceSource, /LOCAL_ORDER_FINANCIAL_PAYMENT_CONTEXT_INVALID/);
});

test('financial context keeps billable amount and legacy line allocation separate from canonical payment proof', () => {
  assert.match(serviceSource, /summarizeLocalOrderPayable\(order\)/);
  assert.match(serviceSource, /expectedAmount: payable\.billableAmount/);
  assert.match(serviceSource, /buildCanonicalOrderFinancialProjection/);
  assert.match(serviceSource, /lineSettlementConsistency/);
  assert.match(serviceSource, /mixed_authority_requires_reconciliation/);
  assert.match(serviceSource, /canonical_ahead/);
  assert.match(serviceSource, /line_settlement_ahead/);
  assert.doesNotMatch(serviceSource, /expectedAmount = Number\(\(finite\(order\.total\)/);
  assert.doesNotMatch(serviceSource, /paidQuantity\s*[:=]/);
});

test('financial context endpoint is owner-authorized and read-only', () => {
  assert.match(routerSource, /router\.get\('\/financial-context'/);
  assert.match(routerSource, /requireStoreAuthority/);
  assert.match(routerSource, /loadLocalOrderFinancialContext/);
  assert.match(clientSource, /\/api\/local-attendance\/financial-context/);
  assert.match(clientSource, /fetch\(url/);
  assert.doesNotMatch(clientSource, /method:\s*'POST'/);
  assert.doesNotMatch(serviceSource, /\.set\(/);
  assert.doesNotMatch(serviceSource, /\.update\(/);
  assert.doesNotMatch(serviceSource, /writeBatch/);
});

test('selected service location shows canonical money and item settlement as different states', () => {
  assert.match(workspaceSource, /<ServiceLocationFinancialContextPanel/);
  assert.match(workspaceSource, /orders=\{activeOrders\}/);
  assert.match(panelSource, /Evidência financeira canônica/);
  assert.match(panelSource, /canonicalProjection\.authoritativelyPaidAmount/);
  assert.match(panelSource, /lineSettlement\.status/);
  assert.match(panelSource, /Pagamento canônico confirmado; alocação por item continua independente/);
  assert.match(panelSource, /Conciliação necessária/);
  assert.match(panelSource, /Gerar Pix|Retomar Pix/);
  assert.match(panelSource, /webhook verificado do provedor/);
  assert.doesNotMatch(panelSource, /registerTablePayment/);
  assert.doesNotMatch(panelSource, /paidQuantity\s*=/);
  assert.doesNotMatch(panelSource, /paymentStatus\s*=/);
});

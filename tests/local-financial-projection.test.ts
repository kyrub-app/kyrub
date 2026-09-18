import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildCanonicalOrderFinancialProjection,
} from '../shared/canonicalOrderFinancialProjection';

const financialContextSource = readFileSync(
  'server/attendance/localOrderFinancialContextService.ts',
  'utf8'
);
const panelSource = readFileSync(
  'src/components/store/ServiceLocationFinancialContextPanel.tsx',
  'utf8'
);

test('canonical financial projection is independent from line settlement quantities', () => {
  const projection = buildCanonicalOrderFinancialProjection({
    expectedAmount: 42,
    payments: [{ amount: 42, status: 'paid' }],
  });
  assert.deepEqual(projection, {
    expectedAmount: 42,
    authoritativelyPaidAmount: 42,
    outstandingAmount: 0,
    pendingPaymentCount: 0,
    canonicalPaymentCount: 1,
    state: 'paid',
  });
});

test('canonical projection handles pending, partial and refunded evidence without item allocation', () => {
  assert.equal(buildCanonicalOrderFinancialProjection({
    expectedAmount: 100,
    payments: [{ amount: 100, status: 'pending' }],
  }).state, 'pending');
  assert.equal(buildCanonicalOrderFinancialProjection({
    expectedAmount: 100,
    payments: [{ amount: 40, status: 'paid' }],
  }).state, 'partial');
  assert.equal(buildCanonicalOrderFinancialProjection({
    expectedAmount: 100,
    payments: [{ amount: 100, status: 'refunded' }],
  }).state, 'refunded');
});

test('local read model names item settlement separately from provider-backed evidence', () => {
  assert.match(financialContextSource, /buildCanonicalOrderFinancialProjection/);
  assert.match(financialContextSource, /lineSettlementStatus/);
  assert.match(financialContextSource, /lineSettlementConsistency/);
  assert.match(financialContextSource, /canonical_ahead/);
  assert.match(financialContextSource, /line_settlement_ahead/);
  assert.doesNotMatch(financialContextSource, /transaction\.update|paidQuantity\s*[:=]/);
});

test('workspace displays canonical evidence without pretending item quantities were allocated', () => {
  assert.match(panelSource, /context\.canonicalProjection\.authoritativelyPaidAmount/);
  assert.match(panelSource, /context\.lineSettlementStatus/);
  assert.match(panelSource, /Pagamento canônico confirmado; alocação por item continua independente/);
  assert.doesNotMatch(panelSource, /paidQuantity\s*[:=]/);
  assert.doesNotMatch(panelSource, /paymentStatus\s*[:=]/);
});

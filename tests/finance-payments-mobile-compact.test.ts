import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (file: string) => readFileSync(file, 'utf8');

test('financial payments remain a single canonical route with four top-level tabs', () => {
  const composite = read('src/components/StoreFinanceCompositeRuntime.tsx');
  const runtime = read('src/components/StoreFinanceRuntime.tsx');
  assert.equal((composite.match(/<StoreMercadoPagoPeriodSummaryWorkspace\s/g) ?? []).length, 1);
  assert.equal((composite.match(/<StoreFinanceHistoryWorkspace\s/g) ?? []).length, 1);
  assert.equal((composite.match(/<StoreFinanceRuntime\s/g) ?? []).length, 2);
  assert.equal((composite.match(/type="month"/g) ?? []).length, 1);
  assert.match(composite, /data-kyrub-finance-four-areas="canonical"/);
  assert.match(composite, /data-kyrub-finance-shared-competence=\{period\}/);
  assert.match(composite, /data-kyrub-finance-history-accordion="collapsed-unless-focused"/);
  assert.match(composite, /open=\{Boolean\(reviewPaymentId\)\}/);
  assert.match(composite, /key=\{reviewPaymentId \|\| 'monthly'\}/);
  assert.match(composite, /onReviewPayment=\{setReviewPaymentId\}/);
  assert.match(composite, /onClearFocusedPayment=\{\(\) => setReviewPaymentId\(''\)\}/);
  assert.match(runtime, /data-kyrub-store-finance-runtime="canonical-ledger"/);
  assert.match(runtime, /data-kyrub-finance-payables-accordion="collapsed-when-empty"/);
  assert.match(runtime, /data-kyrub-store-receivables="canonical"/);
  assert.match(runtime, /open=\{receivables\.length > 0\}/);
  assert.match(runtime, /open=\{payables\.length > 0\}/);
  assert.match(runtime, /<StorePayablesWorkspace/);
  assert.match(runtime, /data-kyrub-finance-fiscal-recent="collapsed"/);
});

test('MP summary is compact but preserves evidence and dispute access', () => {
  const mp = read('src/components/store/StoreMercadoPagoPeriodSummaryWorkspace.tsx');
  assert.match(mp, /data-kyrub-mp-compact-indicators="true"/);
  assert.match(mp, /grid-cols-2 gap-2 sm:grid-cols-4/);
  assert.match(mp, /summary\.feeCoverageCount === 0 \? 'Sem evidência' : money\(knownProviderFeesMinor\)/);
  assert.match(mp, /summary\.explicitNetReceivedCount === 0 \? 'Sem evidência' : money\(summary\.explicitNetReceivedMinor\)/);
  assert.match(mp, /data-kyrub-mp-payment-review="true"/);
  assert.match(mp, /data-kyrub-mp-item-evidence="collapsed"/);
  assert.match(mp, /data-kyrub-mp-evidence-technical="collapsed"/);
  assert.match(mp, /data-kyrub-mp-missing-evidence="true"/);
  assert.match(mp, /data-kyrub-mp-divergence="provider-vs-ledger"/);
  assert.match(mp, /Nenhum valor foi corrigido automaticamente/);
  assert.match(mp, /onReviewPayment\(item\.paymentId\)/);
  assert.match(mp, /money\(item\.canonicalGrossMinor\)/);
  assert.doesNotMatch(mp, /<form|transaction\.set|transaction\.update/);
});

test('expense registration is opt-in and existing forms and list remain intact', () => {
  const payables = read('src/components/store/StorePayablesWorkspace.tsx');
  assert.match(payables, /data-kyrub-payables-create-form="collapsed"/);
  assert.match(payables, /<summary[^>]*>\+ Registrar nova conta<\/summary>/);
  assert.match(payables, /<form\s/);
  assert.match(payables, /onSubmit=\{event =>/);
  assert.match(payables, /void createPayable\(\)/);
  assert.match(payables, /Contas registradas/);
  assert.match(payables, /payables\.map\(payable/);
});

test('ledger and reconciliation endpoints are unchanged by visual folding', () => {
  const history = read('src/components/store/StoreFinanceHistoryWorkspace.tsx');
  assert.match(history, /mode: input\.paymentId \? 'payment' : 'history'/);
  assert.match(history, /focusedPaymentId/);
  const finance = read('src/components/StoreFinanceRuntime.tsx');
  assert.match(finance, /summaryScope === 'all-time-economic-ledger'/);
  assert.match(finance, /fetch\(`\/api\/store-finance\?storeId=/);
  assert.match(finance, /data-kyrub-store-receivables="canonical"/);
});

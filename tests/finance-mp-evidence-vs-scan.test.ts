import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { providerFeeValuesDisagree } from '../shared/financeProviderEvidenceCoverage';

test('provider and ledger fee mismatch is known only when both sides have evidence', () => {
  assert.equal(providerFeeValuesDisagree(100, 120, true), true);
  assert.equal(providerFeeValuesDisagree(0, 100, true), true);
  assert.equal(providerFeeValuesDisagree(0, 0, true), false);
  assert.equal(providerFeeValuesDisagree(100, 100, true), false);
  assert.equal(providerFeeValuesDisagree(null, 100, true), false);
  assert.equal(providerFeeValuesDisagree(100, null, true), false);
  assert.equal(providerFeeValuesDisagree(100, 120, false), false);
  assert.equal(providerFeeValuesDisagree(100.2, 120, true), false);
});

test('backend signals fully scanned month even if provider evidence is incomplete', () => {
  const router = readFileSync('server/payments/storeMercadoPagoPeriodSummaryRouter.ts', 'utf8');
  assert.match(router, /ledgerScanComplete: true/);
  assert.match(router, /providerFeeEvidenceCount === paymentCount/);
  assert.match(router, /explicitNetReceivedCount === paymentCount/);
  assert.match(router, /providerRefundedEvidenceCount === paymentCount/);
  assert.match(router, /releaseEvidenceCount === paymentCount/);
  assert.match(router, /feeDivergenceCount \+= 1/);
  assert.match(router, /hasDivergences: grossDivergenceCount > 0 \|\| feeDivergenceCount > 0/);
  assert.match(router, /balanced: complete && grossDivergenceCount === 0 && feeDivergenceCount === 0/);
});

test('frontend displays partial official evidence instead of incorrectly throwing', () => {
  const client = readFileSync('src/components/store/StoreMercadoPagoPeriodSummaryWorkspace.tsx', 'utf8');
  assert.match(client, /if \(!payload\.summary\?\.ledgerScanComplete\)/);
  assert.doesNotMatch(client, /if \(!payload\.summary\?\.complete\)/);
  assert.match(client, /data-kyrub-mp-evidence-state=/);
  assert.match(client, /data-kyrub-mp-missing-evidence="true"/);
  assert.match(client, /data-kyrub-mp-divergence="provider-vs-ledger"/);
  assert.match(client, /summary\.feeDivergenceCount/);
  assert.match(client, /Nenhum valor foi corrigido automaticamente/);
});

test('provider scans and historical financial totals remain distinct', () => {
  const monthly = readFileSync('src/components/StoreFinanceCompositeRuntime.tsx','utf8');
  const totals = readFileSync('src/components/StoreFinanceRuntime.tsx','utf8');
  assert.match(monthly, /<StoreMercadoPagoPeriodSummaryWorkspace storeId=\{storeId\} period=\{period\}/);
  assert.match(totals, /summaryScope === 'all-time-economic-ledger'/);
  assert.match(totals, /Indicadores históricos completos/);
});

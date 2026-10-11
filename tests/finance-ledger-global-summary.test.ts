import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  accumulateStoreFinanceLedgerBatch,
  STORE_FINANCE_SUMMARY_MAX_ENTRIES,
} from '../server/payments/storeEconomicLedgerService';
import { deriveStoreEconomicLedgerSummary, type StoreEconomicLedgerEntry } from '../shared/storeEconomicLedger';

const item = (id: string, kind: StoreEconomicLedgerEntry['kind'], amountMinor: number, withFee=false) => ({
  schemaVersion: 1,
  id, storeId: 'store-a', kind, currency: 'BRL', amountMinor,
  paymentId: 'p-'+id, paymentIntentId: '', orderId: 'order-'+id, buyerId: 'user',
  paymentMethod: 'pix', provider: 'mercado-pago', providerPaymentId: 'provider-'+id,
  providerEventId: '', sourceAuthority: 'provider_webhook', reversalOfEntryId: '',
  occurredAt: '2026-10-01T10:00:00.000Z',
  ...(withFee ? {economicAllocation: {observedCosts: [{id:'f-'+id,kind:'provider_processing',borneBy:'store',amountMinor:50,beneficiary:'mp',source:'provider'}]}} : {}),
}) as StoreEconomicLedgerEntry;
const empty = () => ({
  summary: deriveStoreEconomicLedgerSummary([]),
  providerFeesMinor: 0, providerFeeEvidenceCount: 0, scannedCount: 0,
  complete: true as const, scope: 'all-time-economic-ledger' as const,
});

test('financial summary combines all pages, including refund and chargeback', () => {
  const all = [
    ...Array.from({length:125},(_,i)=>item('capture-'+i,'payment_capture',1000,i%2===0)),
    item('refund','payment_refund',-500),
    item('chargeback','payment_chargeback',-300),
    item('reversal','payment_chargeback_reversal',300),
  ];
  const first = accumulateStoreFinanceLedgerBatch(empty(),all.slice(0,100));
  const last = accumulateStoreFinanceLedgerBatch(first,all.slice(100));
  assert.deepEqual(last.summary,deriveStoreEconomicLedgerSummary(all));
  assert.equal(last.summary.entryCount,128);
  assert.equal(last.providerFeeEvidenceCount,63);
  assert.equal(last.providerFeesMinor,3150);
  assert.equal(last.complete,true);
  assert.equal(last.scope,'all-time-economic-ledger');
});
test('empty ledgers produce zero and never fabricate money',()=>{
  assert.deepEqual(accumulateStoreFinanceLedgerBatch(empty(),[]),empty());
});
test('scan ceiling fails closed instead of pretending an incomplete total is global',()=>{
  const seed=empty(); seed.scannedCount=STORE_FINANCE_SUMMARY_MAX_ENTRIES;
  assert.throws(()=>accumulateStoreFinanceLedgerBatch(seed,[item('overflow','payment_capture',100)]),/STORE_FINANCE_SUMMARY_SCAN_INCOMPLETE/);
});
test('aggregator rejects invalid provider fee evidence',()=>{
  const bad=item('fee','payment_capture',1000,true) as unknown as {economicAllocation: {observedCosts: Array<{amountMinor:number}>}};
  bad.economicAllocation.observedCosts[0].amountMinor=-50;
  assert.throws(()=>accumulateStoreFinanceLedgerBatch(empty(),[bad as unknown as StoreEconomicLedgerEntry]),/STORE_FINANCE_SUMMARY_FEE_INVALID/);
});
test('store-finance GET uses a full paged summary, and fiscal list remains a sample',()=>{
 const source=readFileSync('server/payments/storeFinanceRouter.ts','utf8');
 const client=readFileSync('src/components/StoreFinanceRuntime.tsx','utf8');
 const service=readFileSync('server/payments/storeEconomicLedgerService.ts','utf8');
 assert.match(source,/readCompleteStoreFinanceLedgerSummary\(storeId\)/);
 assert.match(source,/summaryComplete: completeTotals.complete/);
 assert.doesNotMatch(source,/deriveStoreEconomicLedgerSummary\(entries\)/);
 assert.match(service,/\.orderBy\(FieldPath.documentId\(\)\)/);
 assert.match(service,/snapshot\.docs\.map\(document =>/);
 assert.match(client,/summaryScope === 'all-time-economic-ledger'/);
 assert.match(client,/Indicadores históricos completos do livro econômico/);
 assert.match(client,/independentes da competência mensal/);
 assert.match(client,/data-kyrub-finance-fiscal-recent="collapsed"/);
});

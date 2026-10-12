import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildPaymentCaptureEconomicEntryId,
  storeEconomicLedgerEntryPath,
} from '../shared/storeEconomicLedger';

const read = (path: string) => readFileSync(path, 'utf8');

test('exact review uses deterministic canonical capture document, never a new ledger', () => {
  const id = buildPaymentCaptureEconomicEntryId('paid-123');
  assert.equal(id, 'payment:capture:paid-123');
  assert.equal(
    storeEconomicLedgerEntryPath('store-abc', id),
    'stores/store-abc/economicLedger/payment%3Acapture%3Apaid-123'
  );
});

test('targeted server lookup stays owner-scoped, bounded and does not invoke recovery', () => {
  const code = read('server/payments/storeFinanceHistoryRouter.ts');
  assert.match(code, /await requireOwner\(request\.get\('authorization'\) \?\? '', storeId\)/);
  assert.match(code, /buildPaymentCaptureEconomicEntryId\(paymentId\)/);
  assert.match(code, /storeEconomicLedgerEntryPath\(storeId, entryId\)/);
  assert.match(code, /entry\.kind !== 'payment_capture' \|\| entry\.paymentId !== paymentId/);
  assert.match(code, /if \(entryId\.length > 240\)/);
  assert.match(code, /mode !== 'payment'/);
  const direct = code.split("if (mode === 'payment') {")[1]?.split('const recoveredCount = await')[0] ?? '';
  assert.match(direct, /findPaymentCapture\(storeId, paymentId\)/);
  assert.doesNotMatch(direct, /recoverCanonicalPaidCaptures|\.set\(|\.update\(/);
  assert.match(direct, /mode: 'payment', nextCursor: '', hasMore: false/);
});

test('existing summary hands selection to existing history and preserves month isolation', () => {
  const container = read('src/components/StoreFinanceCompositeRuntime.tsx');
  const summary = read('src/components/store/StoreMercadoPagoPeriodSummaryWorkspace.tsx');
  const history = read('src/components/store/StoreFinanceHistoryWorkspace.tsx');
  assert.match(container, /const \[reviewPaymentId, setReviewPaymentId\] = useState\(''\)/);
  assert.match(container, /setReviewPaymentId\(''\);\s*setPeriod\(nextPeriod\)/);
  assert.match(container, /onReviewPayment=\{setReviewPaymentId\}/);
  assert.match(container, /focusedPaymentId=\{reviewPaymentId\}/);
  assert.match(summary, /data-kyrub-mp-review-open-history=\{item\.paymentId\}/);
  assert.match(history, /mode: input\.paymentId \? 'payment' : 'history'/);
  assert.match(history, /const filterScope = JSON\.stringify\(\[storeId, effectivePeriod, kind, paymentMethod, focusedPaymentId\]\)/);
  assert.match(history, /!focusedPaymentId && !loading && !error && hasMore/);
  assert.match(history, /onClearFocusedPayment/);
  assert.match(history, /historyGuard\.current\.invalidate\(\)/);
  assert.match(history, /evidenceGuard\.current\.invalidate\(\)/);
});

test('targeted lookup never changes immutable payment or MP reconciliation sources', () => {
  const router = read('server/payments/storeFinanceHistoryRouter.ts');
  const selection = router.split('const findPaymentCapture = async')[1]?.split('const listHistoryPage')[0] ?? '';
  assert.match(selection, /\.get\(\)/);
  assert.doesNotMatch(selection, /transaction|writeBatch|\.set\(|\.update\(|\.delete\(/);
  const summary = read('src/components/store/StoreMercadoPagoPeriodSummaryWorkspace.tsx');
  assert.match(summary, /onReviewPayment\(item\.paymentId\)/);
});

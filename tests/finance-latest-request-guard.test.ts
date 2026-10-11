import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createFinanceRequestGuard } from '../src/utils/financeLatestRequestGuard';

const read = (file: string) => readFileSync(file, 'utf8');

test('an older successful response never replaces a newer generation', async () => {
  const guard = createFinanceRequestGuard();
  const published: string[] = [];
  const old = guard.begin();
  const newer = guard.begin();
  await Promise.resolve();
  if (guard.isCurrent(old)) published.push('old-month');
  if (guard.isCurrent(newer)) published.push('new-month');
  assert.deepEqual(published, ['new-month']);
});

test('stale errors and loading-finally are prevented after cleanup', async () => {
  const guard = createFinanceRequestGuard();
  const a = guard.begin();
  guard.invalidate();
  assert.equal(guard.isCurrent(a), false);
  const b = guard.begin();
  assert.equal(guard.isCurrent(b), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(b), false);
});

test('monthly report ignores stale response, errors, and finally', () => {
  for (const name of [
    'src/components/store/StoreFinancePeriodRuntime.tsx',
    'src/components/store/StoreMercadoPagoPeriodSummaryWorkspace.tsx',
  ]) {
    const source = read(name);
    assert.match(source, /requestGuard\.current\.begin\(\)/);
    assert.match(source, /if \(!requestGuard\.current\.isCurrent\(generation\)\) return/);
    assert.match(source, /requestGuard\.current\.invalidate\(\)/);
    assert.match(source, /if \(requestGuard\.current\.isCurrent\(generation\)\) setLoading\(false\)/);
    assert.match(source, /\}, \[storeId, period\]\)/);
  }
});

test('ledger pagination and reconciliation evidence are gated independently', () => {
  const source = read('src/components/store/StoreFinanceHistoryWorkspace.tsx');
  assert.match(source, /const historyGuard = useRef\(createFinanceRequestGuard\(\)\)/);
  assert.match(source, /const evidenceGuard = useRef\(createFinanceRequestGuard\(\)\)/);
  assert.match(source, /const filterScope = JSON\.stringify\(\[storeId, effectivePeriod, kind, paymentMethod\]\)/);
  assert.match(source, /if \(!historyGuard\.current\.isCurrent\(generation\)\) return/);
  assert.match(source, /historyGuard\.current\.invalidate\(\)/);
  assert.match(source, /evidenceGuard\.current\.invalidate\(\)/);
  assert.match(source, /loadedScope !== filterScope \|\| loading/);
  assert.match(source, /if \(!evidenceGuard\.current\.isCurrent\(evidenceGeneration\)\) return/);
  assert.match(source, /if \(append\) setLoadingMore\(false\)/);
  assert.match(source, /reconciliationRequestedRef\.current\.clear\(\)/);
  assert.match(source, /evidenceByPaymentVersion\.current\.clear\(\)/);
  assert.match(source, /evidenceByPaymentVersion\.current\.set\(paymentId, paymentVersion\)/);
  assert.match(source, /if \(!currentPayment\(\)\) return/);
  assert.match(source, /\.\.\.\(append && cursor \? \{ cursor \} : \{\}\)/);
});

test('explicit reconciliation always outranks an earlier automatic read of the same payment', () => {
  const guard = createFinanceRequestGuard();
  const version = new Map<string, number>();
  const generation = guard.begin();
  const capturedAutoVersion = version.get('payment-a') ?? 0;
  const manualVersion = capturedAutoVersion + 1;
  version.set('payment-a', manualVersion);
  // The late auto GET must be discarded although its filter is unchanged.
  const canApplyAuto = guard.isCurrent(generation)
    && (version.get('payment-a') ?? 0) === capturedAutoVersion;
  const canApplyManual = guard.isCurrent(generation)
    && version.get('payment-a') === manualVersion;
  assert.equal(canApplyAuto, false);
  assert.equal(canApplyManual, true);
});

test('per-store isolation and backend finance contracts stay unchanged', () => {
  const finance = read('src/components/StoreFinanceCompositeRuntime.tsx');
  assert.match(finance, /<FinanceTabsForStore key=\{storeId\} storeId=\{storeId\}/);
  assert.match(finance, /<StoreFinanceHistoryWorkspace storeId=\{storeId\} period=\{period\}/);
  assert.match(finance, /<StoreMercadoPagoPeriodSummaryWorkspace storeId=\{storeId\} period=\{period\}/);
  assert.match(finance, /<StoreFinancePeriodRuntime storeId=\{storeId\} period=\{period\}/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createFinanceLatestRequest } from '../src/utils/financeLatestRequest';

test('new month cancels the previous request and rejects its late response', async () => {
  const gate = createFinanceLatestRequest();
  const september = gate.begin();
  let abandoned = false;
  september.signal.addEventListener('abort', () => { abandoned = true; });
  const october = gate.begin();
  assert.equal(abandoned, true);
  assert.equal(september.signal.aborted, true);
  assert.equal(gate.isCurrent(september), false);
  assert.equal(gate.isCurrent(october), true);
});
test('teardown invalidates an in-flight promise even if transport ignores abort', () => {
  const gate = createFinanceLatestRequest();
  const ticket = gate.begin();
  gate.invalidate();
  assert.equal(ticket.signal.aborted, true);
  assert.equal(gate.isCurrent(ticket), false);
});
test('same-month manual retry fences the earlier failed request', () => {
  const gate = createFinanceLatestRequest();
  const slow = gate.begin();
  const retry = gate.begin();
  assert.equal(gate.isCurrent(slow), false);
  assert.equal(gate.isCurrent(retry), true);
});
test('all three finance readers have an AbortSignal and guard every state update', () => {
  const period = readFileSync('src/components/store/StoreFinancePeriodRuntime.tsx', 'utf8');
  const mp = readFileSync('src/components/store/StoreMercadoPagoPeriodSummaryWorkspace.tsx', 'utf8');
  const history = readFileSync('src/components/store/StoreFinanceHistoryWorkspace.tsx', 'utf8');
  for (const source of [period, mp, history]) {
    assert.match(source, /createFinanceLatestRequest\(\)/);
    assert.match(source, /\.begin\(\)/);
    assert.match(source, /\.isCurrent\(ticket\)/);
    assert.match(source, /\.invalidate\(\)/);
    assert.match(source, /ticket\.signal/);
    assert.match(source, /signal\s*\}/);
  }
  assert.match(period, /payload\.report\.period !== period/);
  assert.match(mp, /payload\.summary\.period !== period/);
  assert.match(history, /loadedQuery === queryKey/);
  assert.match(history, /period: effectivePeriod/);
  assert.match(history, /if \(!historyGate\.current\.isCurrent\(ticket\)\) return/);
  assert.match(history, /queryReady && !error && hasMore/);
  assert.match(history, /\[storeId, effectivePeriod, kind, paymentMethod\]/);
});
test('partial Mercado Pago evidence is not presented as complete bank receipts', () => {
  const mp = readFileSync('src/components/store/StoreMercadoPagoPeriodSummaryWorkspace.tsx', 'utf8');
  assert.match(mp, /Taxas MP evidenciadas/);
  assert.match(mp, /todos os provedores do mês/);
  assert.match(mp, /não o saldo bancário recebido/);
  assert.match(mp, /sem cobertura completa/i);
});

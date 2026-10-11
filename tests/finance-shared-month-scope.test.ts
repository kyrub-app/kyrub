import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  financeMonthFromDate,
  previousFinanceMonth,
  validFinanceMonth,
  financeMonthLabel,
} from '../src/utils/storeFinanceCompetence';

const read = (path: string) => readFileSync(path, 'utf8');

test('shared competence uses device local calendar month and year boundary correctly',()=>{
  assert.equal(financeMonthFromDate(new Date(2026, 9, 10)), '2026-10');
  assert.equal(previousFinanceMonth('2026-01'),'2025-12');
  assert.equal(previousFinanceMonth('2026-10'),'2026-09');
  assert.equal(financeMonthLabel('2026-10').toLowerCase().includes('outubro'), true);
});
test('invalid and blank competence never reach server as a financial period',()=>{
  for(const value of ['','2026-0','2026-00','2026-13','2026-99','foo','2026-02-10','1999-12']) {
    assert.equal(validFinanceMonth(value),false);
  }
  assert.equal(validFinanceMonth('2026-02'),true);
  assert.throws(()=>previousFinanceMonth('bad'),/FINANCE_PERIOD_INVALID/);
});
test('one controlled month from Financeiro is passed to overview MP and history',()=>{
  const c=read('src/components/StoreFinanceCompositeRuntime.tsx');
  assert.equal((c.match(/type="month"/g)||[]).length,1);
  assert.match(c, /data-kyrub-finance-shared-competence=\{period\}/);
  assert.match(c, /<StoreFinancePeriodRuntime storeId=\{storeId\} period=\{period\}/);
  assert.match(c, /<StoreMercadoPagoPeriodSummaryWorkspace storeId=\{storeId\} period=\{period\}/);
  assert.match(c, /<StoreFinanceHistoryWorkspace storeId=\{storeId\} period=\{period\}/);
  assert.match(c, /<FinanceTabsForStore key=\{storeId\}/);
  assert.match(c, /activeTab === 'margins'/);
});
test('child views cannot create a competing local month selector',()=>{
  for(const path of [
    'src/components/store/StoreFinancePeriodRuntime.tsx',
    'src/components/store/StoreMercadoPagoPeriodSummaryWorkspace.tsx',
  ]) {
    const s=read(path);
    assert.match(s,/period: string/);
    assert.doesNotMatch(s,/setPeriod\(/);
    assert.doesNotMatch(s,/type="month"/);
    assert.match(s,/\[storeId, period\]/);
  }
});
test('history offers explicit all-time switch and requests only effective month',()=>{
  const s=read('src/components/store/StoreFinanceHistoryWorkspace.tsx');
  assert.match(s,/const effectivePeriod = allPeriods \? '' : period/);
  assert.match(s,/period: effectivePeriod/);
  assert.match(s,/setAllPeriods\(true\)/);
  assert.match(s,/setAllPeriods\(current => !current\)/);
  assert.match(s,/data-kyrub-finance-history-scope/);
  assert.doesNotMatch(s,/type="month"/);
});
test('all-time ledger summary and independent margins/cash are not relabeled as month data',()=>{
  const c=read('src/components/StoreFinanceCompositeRuntime.tsx');
  const finance=read('src/components/StoreFinanceRuntime.tsx');
  assert.match(c,/sem filtro mensal compartilhado/);
  assert.match(c,/Caixa operacional: sessões/);
  assert.match(finance,/Indicadores históricos completos/);
  assert.match(finance,/summaryScope === 'all-time-economic-ledger'/);
});

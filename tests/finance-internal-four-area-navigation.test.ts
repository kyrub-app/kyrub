import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const composite = readFileSync('src/components/StoreFinanceCompositeRuntime.tsx', 'utf8');
const finance = readFileSync('src/components/StoreFinanceRuntime.tsx', 'utf8');

test('Financeiro Interno has four accessible views, one mounted at a time', () => {
  for (const id of ['overview','payments','margins','cash']) {
    assert.match(composite, new RegExp(`id: '${id}'`));
    assert.match(composite, new RegExp(`activeTab === '${id}'`));
  }
  assert.equal((composite.match(/role="tab"/g) || []).length, 1);
  assert.match(composite, /role="tablist"/);
  assert.match(composite, /role="tabpanel"/);
  assert.match(composite, /aria-selected=\{active\}/);
  assert.match(composite, /key=\{storeId\}/);
  assert.match(composite, /overflow-x-auto/);
  assert.match(composite, /ArrowRight/);
  assert.match(composite, /ArrowLeft/);
});

test('exactly one paginated finance history and one period overview are mounted', () => {
  assert.equal((composite.match(/<StoreFinancePeriodRuntime\s/g) || []).length, 1);
  assert.equal((composite.match(/<StoreFinanceHistoryWorkspace\s/g) || []).length, 1);
  assert.equal((composite.match(/<StoreMercadoPagoPeriodSummaryWorkspace\s/g) || []).length, 1);
  assert.equal((composite.match(/<StoreResultsMarginsWorkspace\s/g) || []).length, 1);
  assert.equal((composite.match(/<StoreCashDeviceInventory\s/g) || []).length, 1);
  assert.equal((composite.match(/<StoreFinanceRuntime\s/g) || []).length, 2);
  assert.match(composite, /surface="cash"/);
  assert.match(composite, /surface="payments"/);
});

test('Cash ledger and device declarations share one tab, never payment totals', () => {
  assert.match(finance, /if \(surface === 'cash'\)/);
  assert.equal((finance.match(/<StoreCashFinanceWorkspace\s/g) || []).length, 1);
  assert.equal((finance.match(/<StoreCashFinanceWorkspace\s+projection=\{cash\}/g) || []).length, 1);
  assert.match(composite, /data-kyrub-cash-management-section="device-inventory"/);
  assert.match(composite, /activeTab === 'cash'/);
});

test('100-record window is explicitly sampled, and fiscal access is preserved but collapsed', () => {
  assert.match(finance, /data-kyrub-finance-recent-window="collapsed"/);
  assert.match(finance, /até 100 lançamentos, não representam os totais globais/);
  assert.match(finance, /data-kyrub-finance-fiscal-recent="collapsed"/);
  assert.match(finance, /HistoricalFiscalSaleWorkspace/);
  assert.match(finance, /<details\s/);
  assert.equal((finance.match(/<\/details>/g) || []).length, 2);
  // No financial data or payment paths were replaced during UI consolidation.
  assert.match(finance, /fetch\(`\/api\/store-finance\?storeId=/);
  assert.match(finance, /<StorePayablesWorkspace/);
  assert.match(finance, /data-kyrub-store-receivables="canonical"/);
});

test('navigation remains inside one canonical ERP route, without modifying server authority', () => {
  const router = readFileSync('src/components/RetailerPanelRuntimeRouter.tsx', 'utf8');
  assert.match(router, /moduleId === 'financeiro'/);
  assert.doesNotMatch(composite, /cashCoordination|cashSessions|transaction\.set|fetch\(/);
  assert.doesNotMatch(finance, /cashCoordination|cashSessions|transaction\.set/);
});

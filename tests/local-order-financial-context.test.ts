import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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

test('service location financial context reads canonical evidence without treating legacy mirrors as payment proof', () => {
  assert.match(serviceSource, /classifyCompatiblePaymentRecord/);
  assert.match(serviceSource, /isPaymentAuthoritativelyPaid/);
  assert.match(serviceSource, /compatible\.kind === 'legacy_table_payment_mirror'/);
  assert.match(serviceSource, /ignoredLegacyMirrorCount \+= 1/);
  assert.match(serviceSource, /canonicalPayments\.push\(compatible\.payment\)/);
  assert.match(serviceSource, /payment\.orderId !== orderId/);
  assert.match(serviceSource, /reconciliation_required/);
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

test('selected service location projects financial evidence without exposing a manual payment action', () => {
  assert.match(workspaceSource, /<ServiceLocationFinancialContextPanel/);
  assert.match(workspaceSource, /orders=\{activeOrders\}/);
  assert.match(panelSource, /Evidência financeira canônica/);
  assert.match(panelSource, /Espelhos legados não comprovam quitação/);
  assert.match(panelSource, /authoritativelyPaidAmount/);
  assert.match(panelSource, /Conciliação necessária/);
  assert.match(panelSource, /somente leitura/);
  assert.doesNotMatch(panelSource, /registerTablePayment/);
  assert.doesNotMatch(panelSource, /paidQuantity\s*=/);
  assert.doesNotMatch(panelSource, /paymentStatus\s*=/);
  assert.doesNotMatch(panelSource, /PaymentIntent/);
});

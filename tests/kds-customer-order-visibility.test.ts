import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('src/utils/orderWorkflow.ts', 'utf8');
const visibility = workflow.slice(
  workflow.indexOf('export const isOrderVisibleInKds'),
  workflow.indexOf('export const getPendingAttendanceOrdersForLocation')
);

test('KDS excludes rejected or cancelled customer orders before partner exceptions', () => {
  const exclusion = visibility.indexOf("order.status === 'rejected' || order.status === 'cancelled'");
  const externalException = visibility.indexOf('if (isNinetyNineFoodOrder(order)) return true');
  const marketplaceException = visibility.indexOf('if (isApprovalGatedKyrubMarketplaceOrder(order)) return true');
  assert.ok(exclusion > 0);
  assert.ok(externalException > exclusion);
  assert.ok(marketplaceException > exclusion);
});

test('KDS keeps the existing partner and paid order handling intact', () => {
  assert.match(visibility, /if \(isPendingAttendanceApproval\(order\)\) return false/);
  assert.match(visibility, /if \(order\.source !== 'customer'\) return true/);
  assert.match(visibility, /if \(order\.fulfillmentType === 'dine_in'\) return true/);
  assert.match(visibility, /return order\.paymentStatus === 'paid'/);
});

test('explicit prepaid orders are not KDS-visible based on paid status alone', () => {
  const gate = visibility.indexOf("releaseMode === 'pay_before_fulfillment'");
  const paidFallback = visibility.indexOf("return order.paymentStatus === 'paid'");
  assert.ok(gate > 0 && gate < paidFallback);
  assert.ok(gate < visibility.indexOf('if (isNinetyNineFoodOrder(order)) return true'));
});

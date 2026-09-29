import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const shared = readFileSync('shared/storeSubscriptionBenefits.ts', 'utf8');
const ledgerService = readFileSync(
  'server/payments/storeSubscriptionBenefitLedgerService.ts',
  'utf8'
);
const benefitService = readFileSync(
  'server/payments/storeSubscriptionBenefitService.ts',
  'utf8'
);
const planControl = readFileSync('api/plan-control.ts', 'utf8');
const adapter = readFileSync('src/utils/storeSubscriptionBenefits.ts', 'utf8');
const workspace = readFileSync(
  'src/components/store/StoreSubscriptionsWorkspace.tsx',
  'utf8'
);

test('benefit management exposes a read-only ledger snapshot with cycles and usage history', () => {
  assert.match(shared, /interface StoreSubscriptionBenefitLedgerSnapshot/);
  assert.match(shared, /currentCycleId: string \| null/);
  assert.match(shared, /cycles: StoreSubscriptionBenefitCycle\[\]/);
  assert.match(shared, /usages: StoreSubscriptionBenefitUsage\[\]/);
  assert.match(ledgerService, /reconcileStoreSubscriptionBenefitCycle/);
  assert.match(ledgerService, /benefitCycles\/\$\{cycle\.id\}\/usages/);
  assert.match(ledgerService, /identity\.uid !== store\.ownerUserId/);
  assert.match(ledgerService, /currentCycleId: currentCycle\?\.id \?\? null/);
});

test('benefit ledger reuses plan-control instead of adding a new serverless function', () => {
  assert.match(planControl, /merchant\.subscription\.benefits\.ledger/);
  assert.match(planControl, /loadAuthorizedStoreSubscriptionBenefitLedger/);
  assert.match(adapter, /merchant\.subscription\.benefits\.ledger/);
  assert.equal(existsSync('api/store-subscription-benefits.ts'), false);
  assert.equal(existsSync('api/subscription-benefits.ts'), false);
});

test('subscriptions workspace loads benefits only after the merchant opens one contract', () => {
  assert.match(workspace, /expandedSubscriptionId/);
  assert.match(workspace, /toggleBenefits\(subscription\.id\)/);
  assert.match(workspace, /loadStoreSubscriptionBenefitLedger\(user, storeId, subscriptionId\)/);
  assert.match(workspace, /data-kyrub-subscription-benefit-panel=\{subscription\.id\}/);
  assert.doesNotMatch(workspace, /Promise\.all\([^)]*loadStoreSubscriptionBenefitLedger/);
});

test('workspace displays canonical paid-cycle balance and usage history without inventing access units', () => {
  assert.match(workspace, />Concedido</);
  assert.match(workspace, />Usado</);
  assert.match(workspace, />Restante</);
  assert.match(workspace, /Histórico de baixas/);
  assert.match(workspace, /Acesso válido neste ciclo/);
  assert.match(workspace, /Assinaturas de acesso não geram unidades artificiais/);
  assert.match(workspace, /const consumable = benefitKind !== 'access'/);
  assert.match(benefitService, /SUBSCRIPTION_BENEFIT_ACCESS_NOT_CONSUMABLE/);
});

test('manual benefit usage keeps a retry operation id stable until payload changes or succeeds', () => {
  assert.match(workspace, /pendingUsageOperationId \|\| nextOperationId\(\)/);
  assert.match(workspace, /if \(!pendingUsageOperationId\) setPendingUsageOperationId\(operationId\)/);
  assert.match(workspace, /setPendingUsageOperationId\(''\)/);
  assert.match(workspace, /setUsageUnits\(event\.target\.value\);\s*setPendingUsageOperationId\(''\)/);
  assert.match(workspace, /setUsageNote\(event\.target\.value\);\s*setPendingUsageOperationId\(''\)/);
  assert.match(benefitService, /usage_\$\{hash\(operationId\)/);
  assert.match(benefitService, /duplicate: true/);
});

test('benefit management cannot alter billing or create fulfillment side effects', () => {
  assert.match(workspace, /consumeStoreSubscriptionBenefit/);
  assert.doesNotMatch(workspace, /createAuthorizedStoreSubscription/);
  assert.doesNotMatch(workspace, /cancelAuthorizedStoreSubscription/);
  assert.doesNotMatch(workspace, /mercadoPagoStoreRequest/);
  assert.doesNotMatch(ledgerService, /orders|deliveries|appointments|stock/i);
});

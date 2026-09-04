import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync('server.ts', 'utf8');
const executionRouterSource = readFileSync(
  'server/inventory/ninetyNineFoodStatusSyncExecutionRouter.ts',
  'utf8'
);
const executionServiceSource = readFileSync(
  'server/inventory/ninetyNineFoodStatusSyncExecutionService.ts',
  'utf8'
);
const providerWriterSource = readFileSync(
  'server/integrations/ninetyNineFoodProviderStatusWriter.ts',
  'utf8'
);
const clientSource = readFileSync(
  'src/utils/ninetyNineFoodPendingStatusSync.ts',
  'utf8'
);

test('revision-bound 99Food execution router is mounted before the legacy order router under one rate limit boundary', () => {
  const mountStart = serverSource.indexOf('"/api/orders"');
  const executionIndex = serverSource.indexOf(
    'createNinetyNineFoodStatusSyncExecutionRouter()',
    mountStart
  );
  const legacyIndex = serverSource.indexOf('createOrderInventoryRouter()', mountStart);
  const mountSection = serverSource.slice(
    mountStart,
    legacyIndex + 'createOrderInventoryRouter()'.length
  );

  assert.ok(mountStart >= 0);
  assert.ok(executionIndex > mountStart);
  assert.ok(legacyIndex > executionIndex);
  assert.match(mountSection, /integrationRateLimiter/);
});

test('pending queue exposes Firestore document revision and client echoes it inside explicit authority', () => {
  assert.match(executionRouterSource, /orderDocumentRevision\(document\)/);
  assert.match(executionRouterSource, /orderRevision/);
  assert.match(clientSource, /orderRevision: string/);
  assert.match(clientSource, /const orderRevision = item\.orderRevision\.trim\(\)/);
  assert.match(clientSource, /orderRevision,/);
  assert.match(clientSource, /provider: '99food'/);
  assert.match(clientSource, /status: item\.status/);
  assert.match(clientSource, /confirmed: true/);
});

test('manual provider execution atomically claims the exact order revision before provider write', () => {
  const claimIndex = executionRouterSource.indexOf('claimNinetyNineFoodStatusSyncExecution({');
  const writeIndex = executionRouterSource.indexOf('writeNinetyNineFoodOrderStatusToProvider({');
  const finalizeIndex = executionRouterSource.indexOf('finalizeNinetyNineFoodStatusSyncExecution({');

  assert.ok(claimIndex >= 0);
  assert.ok(writeIndex > claimIndex);
  assert.ok(finalizeIndex > writeIndex);
  assert.match(executionServiceSource, /actualRevision !== expectedOrderRevision/);
  assert.match(executionServiceSource, /transaction\.create\(executionReference/);
  assert.match(executionServiceSource, /'integration\.outboundStatus': 'executing'/);
  assert.match(executionServiceSource, /outboundExecutionId/);
  assert.match(executionServiceSource, /authority: 'explicit_status_scoped_order_revision'/);
});

test('local KDS status changes and manual provider execution serialize through a separate lock document', () => {
  assert.match(executionRouterSource, /claimOrderStatusMutation\(/);
  assert.match(executionRouterSource, /releaseAfterResponse\(response, claim\)/);
  assert.match(executionRouterSource, /router\.post\('\/:orderId\/status'/);
  assert.match(executionServiceSource, /statusMutationLocks/);
  assert.match(executionServiceSource, /transaction\.get\(lockRef\)/);
  assert.match(executionServiceSource, /activeStatusMutationId\(lockSnapshot\.data\(\)\)/);
  assert.match(executionServiceSource, /transaction\.delete\(lockRef\)/);
  assert.doesNotMatch(executionServiceSource, /integration\.statusMutationExecutionId/);
});

test('dedicated provider writer rechecks status and has no local order mutation side effect', () => {
  assert.match(providerWriterSource, /buildOpenDeliveryAction/);
  assert.match(providerWriterSource, /clean\(integration\.outboundStatus\) !== 'executing'/);
  assert.match(providerWriterSource, /clean\(order\.status\) !== input\.status/);
  assert.match(providerWriterSource, /client\.sendAction\(action\)/);
  assert.match(providerWriterSource, /integration\.externalOrderId/);
  assert.doesNotMatch(providerWriterSource, /updatePersistedOrderStatus/);
  assert.doesNotMatch(providerWriterSource, /transitionOrderStatusWithInventory/);
  assert.doesNotMatch(providerWriterSource, /sendNinetyNineFoodOrderStatus/);
  assert.doesNotMatch(providerWriterSource, /\.set\(|\.update\(|\.create\(/);
});

test('only the execution that owns the marker can finalize and concurrent status drift requires attention', () => {
  assert.match(executionServiceSource, /clean\(integration\.outboundExecutionId\) === executionId/);
  assert.match(executionServiceSource, /concurrentStatusChange/);
  assert.match(executionServiceSource, /provider_write_requires_reconciliation/);
  assert.match(executionServiceSource, /effectiveOutcome === 'sent' \? 'sent' : 'attention'/);
  assert.match(executionRouterSource, /finalized\.concurrentStatusChange/);
  assert.match(executionRouterSource, /partnerSync: 'attention'/);
  assert.match(executionRouterSource, /localTransitionApplied: false/);
});

test('revision conflict remains manual with no automatic provider retry', () => {
  assert.match(executionRouterSource, /NINETY_NINE_FOOD_STATUS_SYNC_REVISION_CONFLICT/);
  assert.match(executionServiceSource, /Atualize a fila 99Food e confirme novamente/);
  assert.doesNotMatch(
    executionRouterSource,
    /setInterval|setTimeout|retryNinetyNineFood|schedule|enqueue.*retry/i
  );
});

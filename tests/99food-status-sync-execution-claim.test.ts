import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './99food-orphan-status-sync-reconciliation.test.ts';

const serverSource = readFileSync('server.ts', 'utf8');
const executionRouterSource = readFileSync(
  'server/inventory/ninetyNineFoodStatusSyncExecutionRouter.ts',
  'utf8'
);
const executionServiceSource = readFileSync(
  'server/inventory/ninetyNineFoodStatusSyncExecutionService.ts',
  'utf8'
);
const authorizationServiceSource = readFileSync(
  'server/inventory/ninetyNineFoodStatusWriteAuthorizationService.ts',
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

test('pending queue exposes Firestore document revision and client requests server authority for that exact revision', () => {
  assert.match(executionRouterSource, /orderDocumentRevision\(document\)/);
  assert.match(executionRouterSource, /orderRevision/);
  assert.match(clientSource, /orderRevision: string/);
  assert.match(clientSource, /provider-sync\/99food\/authorize/);
  assert.match(clientSource, /status: item\.status/);
  assert.match(clientSource, /orderRevision: item\.orderRevision/);
  assert.match(clientSource, /authorizationId/);
  assert.match(clientSource, /authorizationToken/);
  assert.doesNotMatch(clientSource, /confirmed:\s*true/);
});

test('server-issued authority stores only token hash, expires, and is scoped by shared multichannel governance', () => {
  assert.match(authorizationServiceSource, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(authorizationServiceSource, /tokenHash/);
  assert.match(authorizationServiceSource, /AUTHORIZATION_TTL_MS = 15 \* 60 \* 1000/);
  assert.match(authorizationServiceSource, /evaluateExternalWriteAuthorizationRequest/);
  assert.match(authorizationServiceSource, /evaluateExternalWriteAttempt/);
  assert.match(authorizationServiceSource, /channel: '99food'/);
  assert.match(authorizationServiceSource, /operationKind: 'order\.status_transition'/);
  assert.match(authorizationServiceSource, /authorizedFields: \['status'\]/);
  assert.doesNotMatch(
    authorizationServiceSource.slice(
      authorizationServiceSource.indexOf('transaction.create(authorizationRef'),
      authorizationServiceSource.indexOf('return { externalOrderId }')
    ),
    /authorizationToken/
  );
});

test('manual provider execution atomically consumes the exact one-time authority and claims the order revision before provider write', () => {
  const claimIndex = executionRouterSource.indexOf('claimNinetyNineFoodStatusSyncExecution({');
  const writeIndex = executionRouterSource.indexOf('writeNinetyNineFoodOrderStatusToProvider({');

  assert.ok(claimIndex >= 0);
  assert.ok(writeIndex > claimIndex);
  assert.match(executionServiceSource, /actualRevision !== expectedOrderRevision/);
  assert.match(executionServiceSource, /transaction\.get\(authorizationRef\)/);
  assert.match(executionServiceSource, /assertNinetyNineFoodStatusWriteAuthorizationForExecution/);
  assert.match(executionServiceSource, /consumptionStatus: 'consumed'/);
  assert.match(executionServiceSource, /useCount: 1/);
  assert.match(executionServiceSource, /consumedByExecutionId: executionId/);
  assert.match(executionServiceSource, /transaction\.create\(executionReference/);
  assert.match(executionServiceSource, /'integration\.outboundStatus': 'executing'/);
  assert.match(executionServiceSource, /authority: 'server_issued_one_time_status_scoped_order_revision'/);
});

test('successful provider response is followed by one authoritative readback before sent finalization', () => {
  const claimIndex = executionRouterSource.indexOf('claimNinetyNineFoodStatusSyncExecution({');
  const writeIndex = executionRouterSource.indexOf('writeNinetyNineFoodOrderStatusToProvider({', claimIndex);
  const readbackIndex = executionRouterSource.indexOf('inspectNinetyNineFoodProviderStatusForReconciliation({', writeIndex);
  const unresolvedIndex = executionRouterSource.indexOf("observation.outcome !== 'confirmed'", readbackIndex);
  const reconcileMarkerIndex = executionRouterSource.indexOf('markNinetyNineFoodProviderWriteOutcomeUnknown({', unresolvedIndex);
  const finalizeIndex = executionRouterSource.indexOf('finalizeNinetyNineFoodStatusSyncExecution({', reconcileMarkerIndex);

  assert.ok(claimIndex >= 0);
  assert.ok(writeIndex > claimIndex);
  assert.ok(readbackIndex > writeIndex);
  assert.ok(unresolvedIndex > readbackIndex);
  assert.ok(reconcileMarkerIndex > unresolvedIndex);
  assert.ok(finalizeIndex > reconcileMarkerIndex);
  assert.match(executionRouterSource, /partnerSync: 'reconciliation_required'/);
  assert.match(executionRouterSource, /Nenhum retry automático/);
});

test('local KDS status changes and manual provider execution serialize through a server-only lock document', () => {
  assert.match(executionRouterSource, /claimOrderStatusMutation\(/);
  assert.match(executionRouterSource, /releaseAfterResponse\(response, claim\)/);
  assert.match(executionRouterSource, /router\.post\('\/:orderId\/status'/);
  assert.match(executionServiceSource, /orderStatusMutationLocks/);
  assert.match(executionServiceSource, /authorityDocumentId/);
  assert.match(executionServiceSource, /authority: 'server_only_status_mutation_lock'/);
  assert.match(executionServiceSource, /transaction\.get\(lockRef\)/);
  assert.match(executionServiceSource, /activeStatusMutationId\(lockSnapshot\.data\(\)\)/);
  assert.match(executionServiceSource, /transaction\.delete\(lockRef\)/);
  assert.doesNotMatch(executionServiceSource, /integration\.statusMutationExecutionId/);
  assert.doesNotMatch(executionServiceSource, /\.collection\('statusMutationLocks'\)/);
});

test('execution audit is stored in a server-only top-level collection, not under the legacy artifact tree', () => {
  assert.match(executionServiceSource, /ninetyNineFoodStatusSyncExecutions/);
  assert.match(executionServiceSource, /adminDb\.collection\(STATUS_SYNC_EXECUTION_COLLECTION\)\.doc\(\)/);
  assert.match(executionServiceSource, /orderPath: orderRef\.path/);
  assert.doesNotMatch(executionServiceSource, /\.collection\('providerStatusExecutions'\)/);
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

test('revision conflict and consumed authority remain manual with no automatic provider retry', () => {
  assert.match(executionRouterSource, /NINETY_NINE_FOOD_STATUS_SYNC_REVISION_CONFLICT/);
  assert.match(executionServiceSource, /Atualize a fila 99Food e confirme novamente/);
  assert.match(authorizationServiceSource, /já foi consumida/);
  assert.doesNotMatch(
    executionRouterSource,
    /setInterval|setTimeout|retryNinetyNineFood|schedule|enqueue.*retry/i
  );
});

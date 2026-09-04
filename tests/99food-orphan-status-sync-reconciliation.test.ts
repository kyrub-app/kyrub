import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './99food-inbound-reconciliation-authority.test.ts';

const routerSource = readFileSync(
  'server/inventory/ninetyNineFoodStatusSyncExecutionRouter.ts',
  'utf8'
);
const executionServiceSource = readFileSync(
  'server/inventory/ninetyNineFoodStatusSyncExecutionService.ts',
  'utf8'
);
const reconciliationServiceSource = readFileSync(
  'server/inventory/ninetyNineFoodStatusSyncReconciliationService.ts',
  'utf8'
);
const providerReaderSource = readFileSync(
  'server/integrations/ninetyNineFoodProviderStatusReader.ts',
  'utf8'
);
const pendingClientSource = readFileSync(
  'src/utils/ninetyNineFoodPendingStatusSync.ts',
  'utf8'
);
const reconciliationClientSource = readFileSync(
  'src/utils/ninetyNineFoodStatusSyncReconciliation.ts',
  'utf8'
);
const reconciliationQueueSource = readFileSync(
  'src/components/store/NinetyNineFoodStatusSyncReconciliationQueue.tsx',
  'utf8'
);
const bridgeSource = readFileSync(
  'src/components/store/NinetyNineFoodOrderStatusBridge.tsx',
  'utf8'
);

test('manual delayed provider write records provider-write start before the external call', () => {
  const startIndex = routerSource.indexOf('markNinetyNineFoodProviderWriteStarted({');
  const providerIndex = routerSource.indexOf('writeNinetyNineFoodOrderStatusToProvider({');
  assert.ok(startIndex >= 0);
  assert.ok(providerIndex > startIndex);
  assert.match(reconciliationServiceSource, /status: 'provider_write_started'/);
  assert.match(reconciliationServiceSource, /providerWriteStartedAt/);
});

test('ambiguous transport and 5xx outcomes are separated from definitive 4xx provider failures', () => {
  assert.match(reconciliationServiceSource, /isNinetyNineFoodProviderWriteOutcomeUnknown/);
  assert.match(reconciliationServiceSource, /Open Delivery respondeu \(\\d\{3\}\)/);
  assert.match(reconciliationServiceSource, /status >= 400 && status < 500/);
  assert.match(reconciliationServiceSource, /AbortError/);
  assert.match(reconciliationServiceSource, /ETIMEDOUT/);
  assert.match(routerSource, /partnerSync: 'reconciliation_required'/);
  assert.match(reconciliationServiceSource, /status: 'provider_write_outcome_unknown'/);
  assert.match(reconciliationServiceSource, /'integration\.outboundStatus': 'reconciliation_required'/);
});

test('orphan queue waits before claiming normal in-flight executions but exposes ambiguous outcomes immediately', () => {
  assert.match(reconciliationServiceSource, /ORPHAN_AFTER_MS = 2 \* 60 \* 1000/);
  assert.match(reconciliationServiceSource, /RECONCILIATION_LEASE_MS = 60 \* 1000/);
  assert.match(reconciliationServiceSource, /status === 'provider_write_outcome_unknown' \|\| status === 'reconciliation_uncertain'/);
  assert.match(reconciliationServiceSource, /now - referenceTime >= ORPHAN_AFTER_MS/);
  assert.match(reconciliationServiceSource, /reconciliationLeaseExpiresAt/);
});

test('reconciliation atomically takes ownership before reading provider state', () => {
  const claimIndex = routerSource.indexOf('claimNinetyNineFoodStatusSyncReconciliation({');
  const inspectIndex = routerSource.indexOf('inspectNinetyNineFoodProviderStatusForReconciliation({');
  const finalizeIndex = routerSource.indexOf('finalizeNinetyNineFoodStatusSyncReconciliation({');
  assert.ok(claimIndex >= 0);
  assert.ok(inspectIndex > claimIndex);
  assert.ok(finalizeIndex > inspectIndex);
  assert.match(reconciliationServiceSource, /status: 'reconciliation_checking'/);
  assert.match(reconciliationServiceSource, /reconciliationId/);
  assert.match(reconciliationServiceSource, /'integration\.outboundStatus': 'reconciliation_required'/);
});

test('late original worker cannot overwrite a reconciliation that already took ownership', () => {
  const phaseIndex = executionServiceSource.indexOf(
    "const ownsExecutionPhase = clean(execution.status) === 'provider_write_started'"
  );
  const guardIndex = executionServiceSource.indexOf(
    'if (!ownsExecutionPhase || !ownsOrderMarker)'
  );
  const executionWriteIndex = executionServiceSource.indexOf(
    'transaction.update(executionReference',
    guardIndex
  );
  assert.ok(phaseIndex >= 0);
  assert.ok(guardIndex > phaseIndex);
  assert.ok(executionWriteIndex > guardIndex);
  assert.match(executionServiceSource, /return \{ orderMarkerFinalized: false, concurrentStatusChange \}/);
});

test('provider reconciliation reader is strictly read-only and cannot resend status', () => {
  assert.match(providerReaderSource, /client\.getOrder\(syntheticEvent\)/);
  assert.doesNotMatch(providerReaderSource, /sendAction\(/);
  assert.doesNotMatch(providerReaderSource, /buildOpenDeliveryAction/);
  assert.doesNotMatch(providerReaderSource, /\.set\(|\.update\(|\.create\(/);
  const routeStart = routerSource.indexOf("router.get('/provider-sync/99food/reconciliation'");
  const manualSendStart = routerSource.indexOf("router.post('/:orderId/provider-sync/99food'", routeStart);
  const reconciliationSection = routerSource.slice(routeStart, manualSendStart);
  assert.doesNotMatch(reconciliationSection, /writeNinetyNineFoodOrderStatusToProvider/);
  assert.match(reconciliationSection, /providerWriteAttempted: false/);
  assert.match(reconciliationSection, /localTransitionApplied: false/);
});

test('provider observation distinguishes confirmed, not observed, conflict, and uncertain without automatic retry', () => {
  assert.match(providerReaderSource, /outcome: 'confirmed'/);
  assert.match(providerReaderSource, /outcome: 'not_observed'/);
  assert.match(providerReaderSource, /outcome: 'conflict'/);
  assert.match(providerReaderSource, /outcome: 'uncertain'/);
  assert.match(providerReaderSource, /CANCELLATION_REQUESTED/);
  assert.match(providerReaderSource, /CANCELLATION_REQUEST_DENIED/);
  assert.doesNotMatch(
    providerReaderSource,
    /setInterval|setTimeout|retryNinetyNineFood|schedule|enqueue.*retry/i
  );
});

test('uncertain reconciliation stays blocked while resolved outcomes release to sent or attention', () => {
  assert.match(reconciliationServiceSource, /'reconciliation_uncertain'/);
  assert.match(reconciliationServiceSource, /effectiveOutcome === 'uncertain'/);
  assert.match(reconciliationServiceSource, /'integration\.outboundStatus': 'reconciliation_required'/);
  assert.match(reconciliationServiceSource, /effectiveOutcome === 'confirmed' \? 'sent' : 'attention'/);
  assert.match(reconciliationServiceSource, /integration\.outboundExecutionId.*FieldValue\.delete/s);
});

test('normal KDS status mutation is blocked while reconciliation is required', () => {
  assert.match(routerSource, /outboundStatus\) === 'reconciliation_required'/);
  assert.match(executionServiceSource, /'executing', 'reconciliation_required'/);
  assert.match(routerSource, /Conclua a reconciliação antes de alterar novamente o status/);
});

test('client moves ambiguous send into reconciliation UI and reconciliation never schedules automatic work', () => {
  assert.match(pendingClientSource, /'reconciliation_required'/);
  assert.match(pendingClientSource, /notifyNinetyNineFoodStatusSyncReconciliationChanged\(\)/);
  assert.match(reconciliationClientSource, /providerWriteAttempted !== false/);
  assert.match(reconciliationClientSource, /localTransitionApplied !== false/);
  assert.match(reconciliationQueueSource, /99Food · reconciliação necessária/);
  assert.match(reconciliationQueueSource, /Conferir na 99Food/);
  assert.match(reconciliationQueueSource, /Esta fila não possui caminho de provider write/);
  assert.match(reconciliationQueueSource, /A reconciliação nunca reenvia o status/);
  assert.doesNotMatch(
    reconciliationQueueSource,
    /setInterval|setTimeout|sendNinetyNineFoodPendingStatusSync|writeNinetyNineFoodOrderStatusToProvider/
  );
  assert.match(bridgeSource, /NinetyNineFoodStatusSyncReconciliationQueue/);
  assert.match(bridgeSource, /Nenhum retry será feito/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  advanceOmnichannelCursor,
  buildOmnichannelIdempotencyKey,
  calculateOmnichannelRetryDelayMs,
  canReserveOmnichannelWork,
  decideOmnichannelReconciliation,
} from '../src/utils/omnichannelSyncEngine';

const queueSource = readFileSync(
  'server/integrations/ninetyNineFoodIngressQueue.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/ninetyNineFoodRouter.ts',
  'utf8'
);
const protocolSource = readFileSync(
  'server/integrations/openDelivery.ts',
  'utf8'
);
const cursorSource = readFileSync(
  'server/integrations/omnichannelSyncCursorService.ts',
  'utf8'
);
const divergenceSource = readFileSync(
  'server/integrations/omnichannelDivergenceService.ts',
  'utf8'
);
const orderObserverSource = readFileSync(
  'server/integrations/omnichannelOrderObservationService.ts',
  'utf8'
);
const orderObserverEscalationSource = readFileSync(
  'server/integrations/omnichannelOrderObservationEscalationService.ts',
  'utf8'
);
const orderObserverRouterSource = readFileSync(
  'server/integrations/omnichannelOrderObservationRouter.ts',
  'utf8'
);
const storeConnectionsTransportSource = readFileSync(
  'server/integrations/storeConnectionsServerlessTransport.ts',
  'utf8'
);
const orderObservationClientSource = readFileSync(
  'src/utils/omnichannelOrderObservation.ts',
  'utf8'
);
const manualReviewPanelSource = readFileSync(
  'src/components/store/OmnichannelManualReviewPanel.tsx',
  'utf8'
);
const mercadoLivreBridgeSource = readFileSync(
  'src/components/store/MercadoLivreE2ETestBridge.tsx',
  'utf8'
);

test('webhook validates, persists and returns before business processing', () => {
  assert.match(queueSource, /verifyOpenDeliverySignature/);
  assert.match(queueSource, /integrationIngress/);
  assert.match(queueSource, /status: 'queued'/);
  assert.match(routerSource, /enqueueNinetyNineFoodWebhook/);
  assert.match(routerSource, /response\.status\(200\)\.end\(\)/);
  assert.doesNotMatch(routerSource, /receiveNinetyNineFoodWebhook\(\{/);
});

test('worker applies lease, shared retry policy and idempotent processing', () => {
  assert.match(queueSource, /leaseExpiresAt/);
  assert.match(queueSource, /nextAttemptAt/);
  assert.match(queueSource, /status: 'failed'/);
  assert.match(queueSource, /receiveNinetyNineFoodWebhook/);
  assert.match(queueSource, /calculateOmnichannelRetryDelayMs\(attempts\)/);
  assert.doesNotMatch(queueSource, /15_000 \* 2 \*\*/);
  assert.match(routerSource, /internal\/drain/);
  assert.match(routerSource, /INTEGRATION_CRON_SECRET|cronAuthorized/);
});

test('sync cursor storage is internal, scoped and transactionally monotonic', () => {
  assert.match(cursorSource, /integrationSyncCursors/);
  assert.match(cursorSource, /storeId/);
  assert.match(cursorSource, /channelId/);
  assert.match(cursorSource, /entityType/);
  assert.match(cursorSource, /direction/);
  assert.match(cursorSource, /adminDb\.runTransaction/);
  assert.match(cursorSource, /advanceOmnichannelCursor/);
  assert.doesNotMatch(routerSource, /integrationSyncCursors/);
});

test('divergence observability records only unresolved conflicts server-side', () => {
  assert.match(divergenceSource, /integrationSyncDivergences/);
  assert.match(divergenceSource, /decideOmnichannelReconciliation/);
  assert.match(divergenceSource, /action !== 'conflict'/);
  assert.match(divergenceSource, /status: 'open'/);
  assert.match(divergenceSource, /FieldValue\.increment\(1\)/);
  assert.match(divergenceSource, /adminDb\.runTransaction/);
  assert.doesNotMatch(routerSource, /integrationSyncDivergences/);
});

test('read-only order observer exposes 99Food ingress before a canonical order exists', () => {
  assert.match(orderObserverSource, /integrationIngress/);
  assert.match(orderObserverSource, /status === 'queued'/);
  assert.match(orderObserverSource, /status === 'failed'/);
  assert.match(orderObserverSource, /upsertObservation\(observations, '99food'/);
  assert.match(orderObserverSource, /inventoryReservation/);
  assert.match(orderObserverSource, /blocked_product_binding_unresolved/);
  assert.doesNotMatch(
    orderObserverSource,
    /FieldValue|runTransaction|transaction\.(?:set|update|create)\(|\.ref\.(?:set|update|create)\(/
  );
});

test('read-only order observer correlates Mercado Livre inbox, binding blocks and KDS', () => {
  assert.match(orderObserverSource, /integrationWebhookInbox/);
  assert.match(orderObserverSource, /mercadoLivreOrderIngressBlocks/);
  assert.match(orderObserverSource, /provider_api_refetch/);
  assert.match(orderObserverSource, /routingTarget/);
  assert.match(orderObserverSource, /toUpperCase\(\) === 'KDS'/);
  assert.match(orderObserverSource, /omnichannelDivergences/);
  assert.match(orderObserverSource, /integrationSyncDivergences/);
  assert.doesNotMatch(orderObserverSource, /fiscal|sefaz|cfop|cst/i);
});

test('retry-exhausted Mercado Livre inbox is visible as manual-review divergence without writes', () => {
  assert.match(orderObserverEscalationSource, /processingOutcome, 120\) !== 'retry_exhausted'/);
  assert.match(orderObserverEscalationSource, /manualReviewRequired !== true/);
  assert.match(orderObserverEscalationSource, /retryableFailureCount/);
  assert.match(orderObserverEscalationSource, /retryableFailureBudget/);
  assert.match(orderObserverEscalationSource, /lastRetryableErrorCode/);
  assert.match(orderObserverEscalationSource, /lastRetryableErrorDiagnostic/);
  assert.match(orderObserverEscalationSource, /retry_exhausted_manual_review_required/);
  assert.match(orderObserverEscalationSource, /manualReviews/);
  assert.match(orderObserverEscalationSource, /observation\.divergence\.state = 'open'/);
  assert.doesNotMatch(
    orderObserverEscalationSource,
    /FieldValue|runTransaction|transaction\.(?:set|update|create)\(|\.ref\.(?:set|update|create)\(/
  );
});

test('omnichannel order observation reuses the existing serverless transport and owner auth', () => {
  assert.match(orderObserverRouterSource, /verifyIdToken\(token, true\)/);
  assert.match(orderObserverRouterSource, /OMNICHANNEL_ORDER_OBSERVATION_FORBIDDEN/);
  assert.match(orderObserverRouterSource, /\/orders\/recent/);
  assert.match(orderObserverRouterSource, /listRecentOmnichannelObservedOrdersWithEscalations/);
  assert.match(storeConnectionsTransportSource, /createOmnichannelOrderObservationRouter/);
  assert.match(storeConnectionsTransportSource, /\/api\/store-connections\/omnichannel/);
});

test('manual-review client reads observer state and submits only action plus optional reason to the owner endpoint', () => {
  assert.match(orderObservationClientSource, /\/api\/store-connections\/omnichannel\/orders\/recent\?limit=/);
  assert.match(orderObservationClientSource, /method: 'POST'/);
  assert.match(orderObservationClientSource, /order-ingress-reviews\/\$\{encoded\(inboxId\)\}\/resolve/);
  assert.match(orderObservationClientSource, /JSON\.stringify\(\{\s*action,/s);
  assert.match(orderObservationClientSource, /reason: reason\.trim\(\)/);
  const resolver = orderObservationClientSource.slice(
    orderObservationClientSource.indexOf('export const resolveMercadoLivreManualReview')
  );
  assert.doesNotMatch(resolver, /canonicalProductId|paymentStatus|providerStatus|externalAccountId/);
  assert.doesNotMatch(resolver, /mercadoLivreGetJson|mercadoLivrePostJson|mercadoLivrePutJson/);
});

test('Mercado Livre manual-review panel exposes explicit human decisions with reinforced confirmation', () => {
  assert.match(manualReviewPanelSource, /Tentar novamente agora/);
  assert.match(manualReviewPanelSource, /Manter em revisão/);
  assert.match(manualReviewPanelSource, /Encerrar como não processável/);
  assert.match(manualReviewPanelSource, /Confirmar decisão/);
  assert.match(manualReviewPanelSource, /type="checkbox"/);
  assert.match(manualReviewPanelSource, /close_non_processable' && reason\.trim\(\)\.length < 8/);
  assert.match(manualReviewPanelSource, /\$\{review\.failureCount\}\/\$\{review\.failureBudget\} tentativas/);
  assert.match(manualReviewPanelSource, /loadOmnichannelManualReviews/);
  assert.match(manualReviewPanelSource, /resolveMercadoLivreManualReview/);
  assert.match(manualReviewPanelSource, /O estado comercial será relido oficialmente no Mercado Livre/);
  assert.doesNotMatch(manualReviewPanelSource, /canonicalProductId|paymentStatus|providerStatus/);
});

test('manual-review panel remains visible even when the current Mercado Livre connection id is temporarily unavailable', () => {
  const panelAt = mercadoLivreBridgeSource.indexOf('<OmnichannelManualReviewPanel');
  const connectionGateAt = mercadoLivreBridgeSource.indexOf('{connectionId ?');
  assert.ok(panelAt >= 0 && connectionGateAt > panelAt);
  assert.match(mercadoLivreBridgeSource, /OmnichannelManualReviewPanel/);
  assert.match(mercadoLivreBridgeSource, /MercadoLivreE2ETestWorkspace/);
});

test('OAuth client requests the Open Delivery scope', () => {
  assert.match(protocolSource, /scope: 'od\.all'/);
});

test('omnichannel idempotency key is stable and scoped by channel', () => {
  const first = buildOmnichannelIdempotencyKey({
    storeId: 'store-1',
    channelId: '99food',
    direction: 'inbound',
    entityType: 'order',
    externalEventId: 'event/123',
  });
  const second = buildOmnichannelIdempotencyKey({
    storeId: ' store-1 ',
    channelId: '99food',
    direction: 'inbound',
    entityType: 'order',
    externalEventId: ' event/123 ',
  });

  assert.equal(first, second);
  assert.notEqual(
    first,
    buildOmnichannelIdempotencyKey({
      storeId: 'store-1',
      channelId: 'ifood',
      direction: 'inbound',
      entityType: 'order',
      externalEventId: 'event/123',
    })
  );
});

test('omnichannel retry is exponential and bounded', () => {
  assert.equal(calculateOmnichannelRetryDelayMs(1), 30_000);
  assert.equal(calculateOmnichannelRetryDelayMs(2), 60_000);
  assert.equal(calculateOmnichannelRetryDelayMs(20), 15 * 60_000);
  assert.throws(() => calculateOmnichannelRetryDelayMs(0), /positive integer/i);
});

test('omnichannel work respects processed state, leases and future retry', () => {
  assert.equal(
    canReserveOmnichannelWork({ status: 'processed', nowMs: 100 }),
    false
  );
  assert.equal(
    canReserveOmnichannelWork({
      status: 'processing',
      nowMs: 100,
      leaseExpiresAtMs: 200,
    }),
    false
  );
  assert.equal(
    canReserveOmnichannelWork({
      status: 'failed',
      nowMs: 100,
      nextAttemptAtMs: 200,
    }),
    false
  );
  assert.equal(
    canReserveOmnichannelWork({
      status: 'processing',
      nowMs: 300,
      leaseExpiresAtMs: 200,
    }),
    true
  );
});

test('omnichannel cursor advances monotonically', () => {
  assert.deepEqual(
    advanceOmnichannelCursor(
      { checkpoint: 'page-1', observedAtMs: 100 },
      { checkpoint: 'page-2', observedAtMs: 200 }
    ),
    { checkpoint: 'page-2', observedAtMs: 200 }
  );
  assert.throws(
    () => advanceOmnichannelCursor(
      { checkpoint: 'page-2', observedAtMs: 200 },
      { checkpoint: 'page-1', observedAtMs: 100 }
    ),
    /cannot move backwards/i
  );
});

test('omnichannel reconciliation exposes concurrent divergence as conflict', () => {
  assert.equal(
    decideOmnichannelReconciliation({
      canonicalVersion: 'c2',
      externalVersion: 'e1',
      lastSyncedCanonicalVersion: 'c1',
      lastSyncedExternalVersion: 'e1',
    }),
    'push-canonical'
  );
  assert.equal(
    decideOmnichannelReconciliation({
      canonicalVersion: 'c1',
      externalVersion: 'e2',
      lastSyncedCanonicalVersion: 'c1',
      lastSyncedExternalVersion: 'e1',
    }),
    'pull-external'
  );
  assert.equal(
    decideOmnichannelReconciliation({
      canonicalVersion: 'c2',
      externalVersion: 'e2',
      lastSyncedCanonicalVersion: 'c1',
      lastSyncedExternalVersion: 'e1',
    }),
    'conflict'
  );
  assert.equal(
    decideOmnichannelReconciliation({
      canonicalVersion: 'same',
      externalVersion: 'same',
      lastSyncedCanonicalVersion: 'old-c',
      lastSyncedExternalVersion: 'old-e',
    }),
    'noop'
  );
});
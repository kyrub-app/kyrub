import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const providerServiceSource = readFileSync(
  'server/integrations/ninetyNineFoodService.ts',
  'utf8'
);
const authorityServiceSource = readFileSync(
  'server/inventory/ninetyNineFoodInboundStatusAuthorityService.ts',
  'utf8'
);

const eventProcessorStart = providerServiceSource.indexOf(
  'export const processNinetyNineFoodEvent'
);
const webhookStart = providerServiceSource.indexOf(
  'export const receiveNinetyNineFoodWebhook',
  eventProcessorStart
);
const eventProcessorSection = providerServiceSource.slice(
  eventProcessorStart,
  webhookStart
);

test('existing 99Food orders route every inbound event through the execution authority boundary', () => {
  assert.ok(eventProcessorStart >= 0);
  assert.match(providerServiceSource, /applyNinetyNineFoodInboundStatusWithAuthority/);
  assert.match(eventProcessorSection, /if \(!currentOrder\.exists\)/);
  assert.match(eventProcessorSection, /applyNinetyNineFoodInboundStatusWithAuthority\(\{/);
  assert.match(eventProcessorSection, /eventId: event\.eventId/);
  assert.match(eventProcessorSection, /eventReferencePath: reservation\.referencePath/);
  assert.doesNotMatch(eventProcessorSection, /updatePersistedOrderStatus\(/);
});

test('a late CREATED event on an existing order cannot downgrade canonical status', () => {
  assert.match(
    eventProcessorSection,
    /mappedStatus: event\.eventType === 'CREATED' \? null : status/
  );
  const missingOrderBranch = eventProcessorSection.slice(
    eventProcessorSection.indexOf('if (!currentOrder.exists)'),
    eventProcessorSection.indexOf('} else {')
  );
  assert.match(missingOrderBranch, /normalizeOpenDeliveryOrder/);
  assert.match(missingOrderBranch, /persistNormalizedOrder/);
});

test('active outbound execution requires exact server-only execution evidence before inbound mutation', () => {
  assert.match(authorityServiceSource, /ACTIVE_OUTBOUND_STATUSES/);
  assert.match(authorityServiceSource, /'executing', 'reconciliation_required'/);
  assert.match(authorityServiceSource, /outboundExecutionId/);
  assert.match(authorityServiceSource, /ninetyNineFoodStatusSyncExecutions/);
  assert.match(authorityServiceSource, /clean\(execution\.tenantId\) !== tenantId/);
  assert.match(authorityServiceSource, /clean\(execution\.orderId\) !== orderId/);
  assert.match(authorityServiceSource, /clean\(execution\.provider\) !== '99food'/);
  assert.match(
    authorityServiceSource,
    /NINETY_NINE_FOOD_INBOUND_EXECUTION_AUTHORITY_CONFLICT/
  );
});

test('inbound event atomically transfers an in-flight provider write to reconciliation', () => {
  assert.match(authorityServiceSource, /outboundStatus === 'executing'/);
  assert.match(authorityServiceSource, /EXECUTING_PHASES\.has\(executionPhase\)/);
  assert.match(authorityServiceSource, /status: 'reconciliation_uncertain'/);
  assert.match(authorityServiceSource, /integrationPatch\.outboundStatus = 'reconciliation_required'/);
  assert.match(authorityServiceSource, /inboundAuthorityTransferredAt/);
  assert.match(authorityServiceSource, /transaction\.set\(legacyReference/);
  assert.match(authorityServiceSource, /transaction\.update\(executionSnapshot\.ref/);
});

test('inbound evidence does not steal an already-owned reconciliation phase', () => {
  assert.match(authorityServiceSource, /RECONCILIATION_PHASES/);
  assert.match(authorityServiceSource, /'reconciliation_checking'/);
  assert.match(
    authorityServiceSource,
    /outboundStatus === 'executing' && EXECUTING_PHASES\.has\(executionPhase\)/
  );
  assert.doesNotMatch(
    authorityServiceSource,
    /status:\s*'reconciliation_checking'/
  );
});

test('all inbound events become evidence even when they do not map to a local status', () => {
  assert.match(authorityServiceSource, /lastInboundEventId: eventId/);
  assert.match(authorityServiceSource, /lastInboundEventType: eventType/);
  assert.match(authorityServiceSource, /lastInboundEventPath: eventReferencePath/);
  assert.match(authorityServiceSource, /inboundEvidenceCount: FieldValue\.increment\(1\)/);
  assert.match(authorityServiceSource, /if \(input\.mappedStatus\) orderPatch\.status/);
  assert.match(eventProcessorSection, /applyNinetyNineFoodInboundStatusWithAuthority/);
});

test('provider event is marked processed only after the authority transaction succeeds', () => {
  const authorityIndex = eventProcessorSection.indexOf(
    'applyNinetyNineFoodInboundStatusWithAuthority({'
  );
  const processedIndex = eventProcessorSection.indexOf(
    "status: 'processed'",
    authorityIndex
  );
  const failedIndex = eventProcessorSection.indexOf(
    "status: 'failed'",
    processedIndex
  );
  assert.ok(authorityIndex >= 0);
  assert.ok(processedIndex > authorityIndex);
  assert.ok(failedIndex > processedIndex);
});

test('inbound authority coordination never writes back to the 99Food provider or schedules retry', () => {
  assert.doesNotMatch(authorityServiceSource, /sendAction\(/);
  assert.doesNotMatch(authorityServiceSource, /writeNinetyNineFoodOrderStatusToProvider/);
  assert.doesNotMatch(authorityServiceSource, /buildOpenDeliveryAction/);
  assert.doesNotMatch(
    authorityServiceSource,
    /setInterval|setTimeout|retryNinetyNineFood|schedule|enqueue.*retry/i
  );
});

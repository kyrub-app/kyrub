import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildDeliveryDestinationResolutionSnapshotFields,
} from '../server/delivery/deliveryDestinationResolutionSnapshotService.js';
import {
  buildDeliveryCustomerArrivalPolicySnapshot,
} from '../shared/deliveryCustomerArrivalPolicy.js';

const resolution = {
  schemaVersion: 1 as const,
  inputAddress: 'Rua Exemplo, 10',
  formattedAddress: 'Rua Exemplo, 10 - São Paulo, SP, Brasil',
  placeId: 'ChIJ-example',
  latitude: -23.55,
  longitude: -46.63,
  locationType: 'ROOFTOP' as const,
  partialMatch: false,
  status: 'resolved' as const,
  provider: 'google_maps' as const,
  authority: 'kyrub_server' as const,
  source: 'google_geocoding' as const,
  resolvedAt: '2026-08-30T20:00:00.000Z',
};

test('delivery publication snapshots only server-authoritative order destination resolution', () => {
  const fields = buildDeliveryDestinationResolutionSnapshotFields({
    customerDestinationResolutionStatus: 'resolved',
    customerDestinationResolution: resolution,
    customerDestinationResolutionPaymentIntentId: 'pi_123',
  });
  assert.equal(fields.customerDestinationResolutionSnapshotStatus, 'resolved');
  assert.equal(fields.customerDestinationResolutionSnapshot?.placeId, resolution.placeId);
  assert.equal(fields.customerDestinationResolutionSnapshotAuthority, 'kyrub_server');
  assert.equal(
    fields.customerDestinationResolutionSnapshotSource,
    'order_delivery_destination_resolution'
  );
  assert.equal(fields.customerDestinationResolutionPaymentIntentId, 'pi_123');
});

test('delivery publication preserves non-resolution failure states without inventing coordinates', () => {
  const fields = buildDeliveryDestinationResolutionSnapshotFields({
    customerDestinationResolutionStatus: 'provider_not_configured',
    customerDestinationResolutionPaymentIntentId: 'pi_456',
  });
  assert.equal(fields.customerDestinationResolutionSnapshotStatus, 'provider_not_configured');
  assert.equal(fields.customerDestinationResolutionSnapshot, undefined);
});

test('delivery publication fails closed on malformed authoritative resolution', () => {
  assert.throws(
    () => buildDeliveryDestinationResolutionSnapshotFields({
      customerDestinationResolutionStatus: 'resolved',
      customerDestinationResolution: {
        ...resolution,
        authority: 'customer',
      },
    }),
    /DELIVERY_DESTINATION_RESOLUTION_INVALID/
  );
});

test('legacy orders without destination resolution are marked missing, not guessed', () => {
  const fields = buildDeliveryDestinationResolutionSnapshotFields({});
  assert.equal(fields.customerDestinationResolutionSnapshotStatus, 'missing');
  assert.equal(fields.customerDestinationResolutionSnapshot, undefined);
});

test('customer arrival policy requires an explicit positive radius and has no default', () => {
  assert.throws(
    () => buildDeliveryCustomerArrivalPolicySnapshot({
      policyId: 'customer-arrival-v1',
      version: 1,
      radiusMeters: 0,
      snapshottedAt: '2026-08-30T20:00:00.000Z',
    }),
    /DELIVERY_CUSTOMER_ARRIVAL_POLICY_INVALID/
  );
  const policy = buildDeliveryCustomerArrivalPolicySnapshot({
    policyId: 'customer-arrival-v1',
    version: 1,
    radiusMeters: 80,
    snapshottedAt: '2026-08-30T20:00:00.000Z',
  });
  assert.equal(policy.radiusMeters, 80);
  assert.equal(policy.authority, 'kyrub_platform');
});

test('delivery opportunity creates geofence only from resolved destination plus explicit versioned policy', async () => {
  const source = await readFile(
    new URL('../server/delivery/deliveryOpportunityRouter.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /buildDeliveryDestinationResolutionSnapshotFields\(order\)/);
  assert.match(source, /loadAuthoritativeDeliveryCustomerArrivalPolicy\(nowIso\)/);
  assert.match(source, /customerDestinationResolutionSnapshotStatus === 'resolved'/);
  assert.match(source, /radiusMeters: customerArrivalPolicySnapshot\.radiusMeters/);
  assert.match(source, /buildDeliveryCustomerDestinationSnapshot\(/);
  assert.match(source, /customerGeofenceSnapshotStatus:/);
  assert.doesNotMatch(source, /radiusMeters:\s*\d+/);
});

test('delivery publication freezes destination and arrival policy only on first creation', async () => {
  const source = await readFile(
    new URL('../server/delivery/deliveryOpportunityRouter.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /const destinationResolutionSnapshot = existing\.exists\s*\? null/);
  assert.match(source, /const \[waitingPolicySnapshot, responsibilityPolicySnapshot, customerArrivalPolicySnapshot\] = existing\.exists\s*\? \[null, null, null\]/);
  assert.match(source, /\.\.\.destinationResolutionSnapshot/);
});

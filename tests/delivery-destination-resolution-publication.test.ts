import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildDeliveryDestinationResolutionSnapshotFields,
} from '../server/delivery/deliveryDestinationResolutionSnapshotService.js';

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

test('delivery opportunity publication freezes destination metadata only on first creation and does not mint a geofence', async () => {
  const source = await readFile(
    new URL('../server/delivery/deliveryOpportunityRouter.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /buildDeliveryDestinationResolutionSnapshotFields\(order\)/);
  assert.match(source, /const destinationResolutionSnapshot = existing\.exists\s*\? null\s*:\s*buildDeliveryDestinationResolutionSnapshotFields\(order\)/);
  assert.match(source, /\.\.\.destinationResolutionSnapshot/);
  assert.doesNotMatch(source, /customerGeofenceSnapshot\s*:/);
  assert.doesNotMatch(source, /radiusMeters\s*:/);
});

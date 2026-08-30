import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('authorized delivery store-arrival indicator', () => {
  const viewer = readFileSync(
    'src/components/store/AuthorizedDeliveryTrackingViewer.tsx',
    'utf8'
  );

  test('projects canonical arrival evidence only while tracking is active', () => {
    assert.match(viewer, /storeArrivalEvidence/);
    assert.match(viewer, /payload\.active !== true/);
    assert.match(viewer, /courier_inside_store_geofence/);
    assert.match(viewer, /Entregador chegou à loja/);
    assert.match(viewer, /Chegada detectada por geofence/);
  });

  test('keeps the indicator observational and pickup authority separate', () => {
    assert.match(
      viewer,
      /A retirada ainda exige a confirmação segura separada\./
    );
    assert.match(
      viewer,
      /\/api\/delivery-tracking\/\$\{encodeURIComponent\(deliveryId\)\}\/location/
    );
    assert.doesNotMatch(viewer, /method:\s*['"]POST['"]/);
    assert.doesNotMatch(viewer, /\/handoff|\/pickup|settlement|receivable|payable/i);
  });
});

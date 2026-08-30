import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('authorized delivery store-arrival indicator', () => {
  const viewer = readFileSync(
    'src/components/store/AuthorizedDeliveryTrackingViewer.tsx',
    'utf8'
  );
  const storeBridge = readFileSync(
    'src/components/store/StoreDeliveryTrackingBridge.tsx',
    'utf8'
  );
  const courierBridge = readFileSync(
    'src/components/store/CourierLiveTrackingBridge.tsx',
    'utf8'
  );

  test('projects canonical arrival evidence only while tracking is active', () => {
    assert.match(viewer, /storeArrivalEvidence/);
    assert.match(viewer, /payload\.active !== true/);
    assert.match(viewer, /courier_inside_store_geofence/);
    assert.match(viewer, /Entregador chegou à loja/);
    assert.match(viewer, /Chegada detectada por geofence/);
  });

  test('store reuses the authorized tracking viewer instead of creating parallel arrival authority', () => {
    assert.match(storeBridge, /AuthorizedDeliveryTrackingViewer/);
    assert.doesNotMatch(storeBridge, /storeArrivalEvidence/);
    assert.doesNotMatch(storeBridge, /method:\s*['"]POST['"]/);
  });

  test('keeps the store indicator observational and pickup authority separate', () => {
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

  test('courier projects arrival only from the existing authoritative location response', () => {
    assert.match(courierBridge, /storeArrival\?\.arrivalDetected === true/);
    assert.match(courierBridge, /result\.arrivalDetected/);
    assert.match(courierBridge, /setStoreArrivalDetected\(true\)/);
    assert.match(courierBridge, /Você chegou à loja/);
    assert.match(courierBridge, /A retirada continua dependendo da confirmação segura\./);
    assert.match(
      courierBridge,
      /\/api\/delivery-tracking\/\$\{encodeURIComponent\(deliveryId\)\}\/location/
    );
  });

  test('courier arrival projection adds no handoff or economic action', () => {
    const postLocationSlice = courierBridge.slice(
      courierBridge.indexOf('const postLocation'),
      courierBridge.indexOf('const stopRemoteTracking')
    );
    const arrivalRenderSlice = courierBridge.slice(
      courierBridge.indexOf('{storeArrivalDetected && ('),
      courierBridge.indexOf('Localização compartilhada somente durante esta entrega.')
    );

    assert.ok(postLocationSlice.length > 0);
    assert.ok(arrivalRenderSlice.length > 0);
    assert.match(postLocationSlice, /method: 'POST'/);
    assert.doesNotMatch(postLocationSlice, /\/handoff|\/pickup|settlement|receivable|payable/i);
    assert.doesNotMatch(arrivalRenderSlice, /fetch\(|\/handoff|\/pickup|settlement|receivable|payable/i);
  });
});

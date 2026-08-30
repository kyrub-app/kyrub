import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  getDistanceMeters,
  isWithinStoreGeofence,
  parseStoreLocationDraft,
} from '../src/utils/storeLocation';
import { assessCourierStoreArrival } from '../server/delivery/storeArrivalEvidence';

describe('store location settings', () => {
  test('blank location stays blank instead of inventing coordinates', () => {
    assert.deepEqual(
      parseStoreLocationDraft({
        latitude: '',
        longitude: '',
        geofenceRadiusMeters: '',
      }),
      {}
    );
  });

  test('valid coordinates and geofence radius are normalized together', () => {
    assert.deepEqual(
      parseStoreLocationDraft({
        latitude: '-23,550520',
        longitude: '-46.633308',
        geofenceRadiusMeters: '100',
      }),
      {
        lat: -23.55052,
        lng: -46.633308,
        geofenceRadiusMeters: 100,
      }
    );
  });

  test('partial or invalid physical location fails closed', () => {
    assert.throws(() => parseStoreLocationDraft({
      latitude: '-23.5',
      longitude: '',
      geofenceRadiusMeters: '100',
    }));
    assert.throws(() => parseStoreLocationDraft({
      latitude: '91',
      longitude: '-46',
      geofenceRadiusMeters: '100',
    }));
    assert.throws(() => parseStoreLocationDraft({
      latitude: '-23.5',
      longitude: '-46',
      geofenceRadiusMeters: '10',
    }));
  });

  test('distance and geofence use the canonical store point', () => {
    assert.equal(
      Math.round(getDistanceMeters(
        { lat: -23.55052, lng: -46.633308 },
        { lat: -23.55052, lng: -46.633308 }
      )),
      0
    );
    assert.equal(isWithinStoreGeofence({
      store: { lat: -23.55052, lng: -46.633308, geofenceRadiusMeters: 100 },
      position: { lat: -23.55052, lng: -46.633308 },
    }), true);
  });

  test('settings wizard exposes GPS capture, coordinates and geofence radius', () => {
    const editor = readFileSync('src/components/store/StoreLocationEditor.tsx', 'utf8');
    const modal = readFileSync('src/components/modals/StoreConfigModal.tsx', 'utf8');
    const onboarding = readFileSync('src/utils/smartStoreOnboarding.ts', 'utf8');
    const guide = readFileSync('src/components/store/StoreOnboardingGuide.tsx', 'utf8');

    assert.match(editor, /Localização GPS da loja/);
    assert.match(editor, /navigator\.geolocation\.getCurrentPosition/);
    assert.match(editor, /data-store-profile-field="latitude"/);
    assert.match(editor, /data-store-profile-field="longitude"/);
    assert.match(editor, /data-store-profile-field="geofence-radius"/);
    assert.match(modal, /<StoreLocationEditor/);
    assert.match(onboarding, /Localização GPS/);
    assert.match(guide, /coordinates: '\[data-store-profile-field="latitude"\]'/);
  });

  test('geofence radius is private while public marketplace receives coordinates only', () => {
    const types = readFileSync('src/types/index.ts', 'utf8');
    const persistence = readFileSync('src/utils/storePersistence.ts', 'utf8');
    const marketplace = persistence.slice(
      persistence.indexOf('const marketplaceInput'),
      persistence.indexOf('const persistCanonicalMarketplaceListing')
    );

    assert.match(types, /geofenceRadiusMeters\?: number/);
    assert.match(persistence, /geofenceRadiusMeters: store\.geofenceRadiusMeters/);
    assert.match(marketplace, /publicStore\.lat = store\.lat/);
    assert.match(marketplace, /publicStore\.lng = store\.lng/);
    assert.doesNotMatch(marketplace, /geofenceRadiusMeters/);
  });
});

describe('courier store arrival geofence', () => {
  const store = {
    lat: -23.55052,
    lng: -46.633308,
    geofenceRadiusMeters: 100,
  };

  test('server assessment detects a courier inside the configured radius', () => {
    const result = assessCourierStoreArrival(store, {
      latitude: -23.55052,
      longitude: -46.633308,
      accuracy: 8,
      clientCapturedAt: 1_788_049_200_000,
    });

    assert.equal(result.configured, true);
    assert.equal(result.insideGeofence, true);
    assert.equal(result.distanceMeters, 0);
    assert.equal(result.radiusMeters, 100);
    assert.equal(result.accuracyMeters, 8);
  });

  test('server assessment keeps an outside courier outside the geofence', () => {
    const result = assessCourierStoreArrival(store, {
      latitude: -23.56052,
      longitude: -46.633308,
      accuracy: 12,
      clientCapturedAt: 1_788_049_200_000,
    });

    assert.equal(result.configured, true);
    assert.equal(result.insideGeofence, false);
    assert.ok((result.distanceMeters ?? 0) > 100);
  });

  test('missing or invalid store geofence fails closed instead of inventing arrival', () => {
    const location = {
      latitude: -23.55052,
      longitude: -46.633308,
      accuracy: 10,
      clientCapturedAt: 1_788_049_200_000,
    };

    assert.deepEqual(assessCourierStoreArrival({}, location), {
      configured: false,
      insideGeofence: false,
      distanceMeters: null,
      radiusMeters: null,
      accuracyMeters: 10,
    });
    assert.equal(
      assessCourierStoreArrival({ ...store, geofenceRadiusMeters: 10 }, location).insideGeofence,
      false
    );
  });

  test('tracking records first-entry evidence once from the private canonical store', () => {
    const router = readFileSync('server/delivery/deliveryTrackingRouter.ts', 'utf8');

    assert.match(router, /users\/\$\{storeId\}\/stores\/\$\{storeId\}/);
    assert.match(router, /assessCourierStoreArrival/);
    assert.match(router, /assessment\.configured && assessment\.insideGeofence && !existingEvidence/);
    assert.match(router, /payload\.storeArrivalEvidence/);
    assert.match(router, /kind: 'courier_inside_store_geofence'/);
    assert.match(router, /newlyDetected: shouldRecordArrival/);
  });

  test('arrival evidence stays observational and does not perform handoff or economic release', () => {
    const router = readFileSync('server/delivery/deliveryTrackingRouter.ts', 'utf8');
    const payloadSlice = router.slice(
      router.indexOf('const payload: Record<string, unknown>'),
      router.indexOf('transaction.set(trackingReference, payload')
    );

    assert.ok(payloadSlice.length > 0);
    assert.doesNotMatch(payloadSlice, /\bstatus\s*:/);
    assert.doesNotMatch(payloadSlice, /handoff/i);
    assert.doesNotMatch(payloadSlice, /settle|settlement|receivable|payable|payment/i);
    assert.match(payloadSlice, /storeArrivalAssessment/);
    assert.match(payloadSlice, /storeArrivalEvidence/);
  });
});

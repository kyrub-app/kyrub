import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  getDistanceMeters,
  isWithinStoreGeofence,
  parseStoreLocationDraft,
} from '../src/utils/storeLocation';

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

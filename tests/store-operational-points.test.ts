import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyStoreOperationalSettings, parseStoreOperationalSettings, validateStoreOperationalPointsForSave } from '../src/utils/storeOperationalSettings';
import { validateStoreOperationalPoint } from '../src/utils/storeLocation';

const point = { id: 'pickup_a', name: 'Portaria B', purpose: 'pickup' as const, lat: -23.55, lng: -46.63, instructions: 'Entrada lateral' };
test('legacy store settings load with an empty operational point list', () => {
  assert.deepEqual(parseStoreOperationalSettings({}).operationalPoints, []);
  assert.deepEqual(createEmptyStoreOperationalSettings().operationalPoints, []);
});
test('valid operational points survive serialization and reloading', () => {
  const settings = { ...createEmptyStoreOperationalSettings(), operationalPoints: [point] };
  const reloaded = parseStoreOperationalSettings(JSON.parse(JSON.stringify(settings)));
  assert.deepEqual(reloaded.operationalPoints, [point]);
});
test('invalid legacy entries are skipped without breaking valid entries', () => {
  const reloaded = parseStoreOperationalSettings({ operationalPoints: [{ ...point, id: 'bad id' }, point, point] });
  assert.deepEqual(reloaded.operationalPoints, [point]);
});
test('new saves reject duplicate identifiers and invalid coordinates', () => {
  assert.throws(() => validateStoreOperationalPointsForSave([point, point]), /duplicados/);
  assert.throws(() => validateStoreOperationalPointsForSave([{ ...point, lat: 100 }]), /latitude/);
});
test('attendance point requires a valid geofence radius', () => {
  assert.throws(() => validateStoreOperationalPoint({ ...point, purpose: 'attendance' }), /raio/);
  assert.deepEqual(validateStoreOperationalPoint({ ...point, purpose: 'attendance', geofenceRadiusMeters: 100 }).geofenceRadiusMeters, 100);
});

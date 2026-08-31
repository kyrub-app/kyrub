import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildDeliveryCustomerDestinationResolution,
  parseDeliveryCustomerDestinationResolution,
} from '../shared/deliveryCustomerDestinationResolution';

const service = readFileSync(
  'server/delivery/customerDestinationGeocodingService.ts',
  'utf8'
);

test('destination resolution is server-authoritative Google evidence', () => {
  const resolution = buildDeliveryCustomerDestinationResolution({
    inputAddress: 'Praça da Sé, São Paulo - SP',
    formattedAddress: 'Praça da Sé, Sé, São Paulo - SP, Brasil',
    placeId: 'place-test',
    latitude: -23.55052,
    longitude: -46.633308,
    locationType: 'ROOFTOP',
    partialMatch: false,
    resolvedAt: '2026-08-30T20:45:00.000Z',
  });
  assert.equal(resolution.provider, 'google_maps');
  assert.equal(resolution.authority, 'kyrub_server');
  assert.equal(resolution.source, 'google_geocoding');
  assert.equal(resolution.status, 'resolved');
});

test('partial or approximate provider matches require review', () => {
  const partial = buildDeliveryCustomerDestinationResolution({
    inputAddress: 'Rua Exemplo',
    formattedAddress: 'Rua Exemplo, Brasil',
    placeId: 'partial-test',
    latitude: -23.5,
    longitude: -46.6,
    locationType: 'ROOFTOP',
    partialMatch: true,
    resolvedAt: '2026-08-30T20:45:00.000Z',
  });
  const approximate = buildDeliveryCustomerDestinationResolution({
    inputAddress: 'Bairro Exemplo',
    formattedAddress: 'Bairro Exemplo, Brasil',
    placeId: 'approx-test',
    latitude: -23.5,
    longitude: -46.6,
    locationType: 'APPROXIMATE',
    partialMatch: false,
    resolvedAt: '2026-08-30T20:45:00.000Z',
  });
  assert.equal(partial.status, 'review_required');
  assert.equal(approximate.status, 'review_required');
});

test('client-shaped authority cannot be parsed as canonical resolution', () => {
  const valid = buildDeliveryCustomerDestinationResolution({
    inputAddress: 'Rua A, 10',
    formattedAddress: 'Rua A, 10, Brasil',
    placeId: 'place-a',
    latitude: -23.5,
    longitude: -46.6,
    locationType: 'ROOFTOP',
    partialMatch: false,
    resolvedAt: '2026-08-30T20:45:00.000Z',
  });
  assert.equal(parseDeliveryCustomerDestinationResolution({
    ...valid,
    authority: 'customer_action',
  }), null);
});

test('geocoding service resolves credential only on trusted server', () => {
  assert.match(service, /resolvePlatformCredentials/);
  assert.match(service, /GOOGLE_MAPS_PROVIDER_ID/);
  assert.match(service, /GOOGLE_MAPS_GEOCODING_ENDPOINT/);
  assert.doesNotMatch(service, /VITE_|localStorage|sessionStorage|window\./);
});

test('geocoding resolution does not mint a geofence radius or economic fact', () => {
  assert.doesNotMatch(service, /radiusMeters/);
  assert.doesNotMatch(service, /obligation|settlement|payout|wallet|custod|charge/i);
});

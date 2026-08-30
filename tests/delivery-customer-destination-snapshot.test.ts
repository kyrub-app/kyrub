import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildDeliveryCustomerDestinationSnapshot,
  parseDeliveryCustomerDestinationSnapshot,
} from '../shared/deliveryCustomerDestination';

const checkoutClient = readFileSync('src/utils/marketplaceCheckout.ts', 'utf8');
const paymentIntentRouter = readFileSync('server/payments/paymentIntentRouter.ts', 'utf8');
const paymentIntentContract = readFileSync('src/utils/canonicalPaymentIntent.ts', 'utf8');
const customerArrival = readFileSync('server/delivery/customerArrivalEvidence.ts', 'utf8');

test('canonical destination requires server authority and explicit order destination source', () => {
  const snapshot = buildDeliveryCustomerDestinationSnapshot({
    latitude: -23.55052,
    longitude: -46.633308,
    radiusMeters: 80,
    snapshottedAt: '2026-08-30T18:30:00.000Z',
  });
  assert.equal(snapshot.authority, 'kyrub_server');
  assert.equal(snapshot.source, 'order_delivery_destination');
  assert.equal(snapshot.radiusMeters, 80);

  assert.equal(parseDeliveryCustomerDestinationSnapshot({
    ...snapshot,
    authority: 'courier_action',
  }), null);
  assert.equal(parseDeliveryCustomerDestinationSnapshot({
    ...snapshot,
    source: 'courier_location',
  }), null);
});

test('destination parser never supplies a hidden geofence radius', () => {
  assert.equal(parseDeliveryCustomerDestinationSnapshot({
    latitude: -23.55052,
    longitude: -46.633308,
    authority: 'kyrub_server',
    source: 'order_delivery_destination',
    snapshottedAt: '2026-08-30T18:30:00.000Z',
  }), null);
  assert.equal(parseDeliveryCustomerDestinationSnapshot({
    latitude: -23.55052,
    longitude: -46.633308,
    radiusMeters: 0,
    authority: 'kyrub_server',
    source: 'order_delivery_destination',
    snapshottedAt: '2026-08-30T18:30:00.000Z',
  }), null);
});

test('customer arrival reuses the canonical destination contract instead of store radius policy', () => {
  assert.match(customerArrival, /parseDeliveryCustomerDestinationSnapshot/);
  assert.doesNotMatch(customerArrival, /validateStoreGeofenceRadius|STORE_GEOFENCE_MIN_METERS|STORE_GEOFENCE_MAX_METERS/);
});

test('current marketplace checkout carries text address only and cannot mint authoritative coordinates', () => {
  assert.match(checkoutClient, /deliveryAddress: string/);
  assert.match(paymentIntentRouter, /deliveryAddress: string/);
  assert.match(paymentIntentContract, /deliveryAddress: string/);
  assert.doesNotMatch(checkoutClient, /deliveryDestinationSnapshot|customerGeofenceSnapshot/);
  assert.doesNotMatch(paymentIntentRouter, /deliveryDestinationSnapshot|customerGeofenceSnapshot/);
  assert.doesNotMatch(paymentIntentContract, /deliveryDestinationSnapshot|customerGeofenceSnapshot/);
});

test('destination contract is operational only', () => {
  const contract = readFileSync('shared/deliveryCustomerDestination.ts', 'utf8');
  assert.doesNotMatch(contract, /payment|obligation|settlement|payout|wallet|custod|charge/i);
});

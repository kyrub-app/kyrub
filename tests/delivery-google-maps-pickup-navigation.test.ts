import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  buildGoogleMapsDirectionsUrl,
  buildCourierDeliveryNavigationUrl,
  courierTravelMode,
  decideCourierRoute,
} from '../src/utils/googleMapsDirections';

const deliveryModal = readFileSync('src/components/modals/DeliveryManagerModal.tsx', 'utf8');

describe('Google Maps pickup navigation', () => {
  it('builds a driving route to the pickup address without inventing coordinates', () => {
    const url = new URL(buildGoogleMapsDirectionsUrl({
      destination: 'Rua Exemplo, 123 - São Paulo - SP',
    }));
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/maps/dir/');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('destination'), 'Rua Exemplo, 123 - São Paulo - SP');
    assert.equal(url.searchParams.get('travelmode'), 'driving');
    assert.equal(url.searchParams.has('destination_place_id'), false);
  });

  it('adds a canonical Google place id only when one is available', () => {
    const url = new URL(buildGoogleMapsDirectionsUrl({
      destination: 'Loja Kyrub',
      destinationPlaceId: 'ChIJ-authoritative-place',
    }));
    assert.equal(url.searchParams.get('destination_place_id'), 'ChIJ-authoritative-place');
  });

  it('fails closed when pickup destination is empty', () => {
    assert.throws(
      () => buildGoogleMapsDirectionsUrl({ destination: '   ' }),
      /ponto de coleta/i
    );
  });

  it('routes by the assigned vehicle and current delivery stage, without inventing an origin', () => {
    const input = {
      status: 'accepted' as const,
      pickup: 'Loja XYZ, São Paulo',
      dropoff: 'Rua Comprador 100, São Paulo',
    };
    const expected = [
      ['bicycle', 'bicycling'],
      ['motorcycle', 'two-wheeler'],
      ['car', 'driving'],
    ] as const;
    for (const [vehicleType, mode] of expected) {
      assert.equal(courierTravelMode(vehicleType), mode);
      const pickup = new URL(buildCourierDeliveryNavigationUrl({ ...input, vehicleType }));
      assert.equal(pickup.searchParams.get('travelmode'), mode);
      assert.equal(pickup.searchParams.get('destination'), input.pickup);
      assert.equal(pickup.searchParams.get('dir_action'), 'navigate');
      assert.equal(pickup.searchParams.has('origin'), false);
      const customer = new URL(buildCourierDeliveryNavigationUrl({ ...input, status: 'delivering', vehicleType }));
      assert.equal(customer.searchParams.get('destination'), input.dropoff);
      assert.equal(customer.searchParams.has('origin'), false);
    }
    assert.throws(() => buildCourierDeliveryNavigationUrl({ ...input, vehicleType: null }), /veículo não confirmada/i);
    assert.throws(() => buildCourierDeliveryNavigationUrl({
      ...input, status: 'delivering', vehicleType: 'car',
      dropoff: 'Destino exato liberado após o aceite',
    }), /endereço do próximo trecho/i);
  });

  it('routes only by current return authority, never to the customer after authorized return', () => {
    const input = {
      status: 'delivering' as const, vehicleType: 'motorcycle' as const,
      pickup: 'Loja Original, São Paulo', dropoff: 'Cliente, São Paulo',
    };
    const normal = decideCourierRoute({ ...input, returnStatus: 'none' });
    assert.equal(new URL(normal.url).searchParams.get('destination'), input.dropoff);
    const authorized = decideCourierRoute({ ...input, returnStatus: 'return_authorized' });
    assert.equal(new URL(authorized.url).searchParams.get('destination'), input.pickup);
    assert.equal(new URL(authorized.url).searchParams.get('travelmode'), 'two-wheeler');
    assert.match(authorized.label, /volta à loja/);
    for (const status of [
      'authorization_revoked', 'courier_presented_to_store',
      'returned_to_store_pending_reconciliation', 'checking', 'unavailable',
    ] as const) {
      const blocked = decideCourierRoute({ ...input, returnStatus: status });
      assert.equal(blocked.url, '', status);
      assert.ok(blocked.notice.length > 20, status);
    }
    // Even when a stale return event is present, pre-pickup must lead only to the store.
    const pickup = decideCourierRoute({ ...input, status: 'accepted', returnStatus: 'return_authorized' });
    assert.equal(new URL(pickup.url).searchParams.get('destination'), input.pickup);
    assert.equal(decideCourierRoute({ ...input }).url, ''); // Missing return authority fails closed.
  });

  it('uses the same return decision for compact and embedded map navigation', () => {
    const panel = readFileSync('src/components/store/CourierLiveTrackingBridge.tsx', 'utf8');
    const map = readFileSync('src/components/store/CourierGoogleMap.tsx', 'utf8');
    const supportReturn = readFileSync('src/components/store/CourierReturnToStorePanel.tsx', 'utf8');
    assert.match(panel, /decideCourierRoute\(/);
    assert.match(supportReturn, /decideCourierRoute\(/);
    assert.match(supportReturn, /goToStore\.url/);
    assert.match(map, /decideCourierRoute\(/);
    assert.match(panel, /returnStatus=\{returnRouteStatus\}/);
    assert.match(panel, /snapshot\.metadata\.fromCache/);
    assert.match(panel, /'authorization_revoked'/);
    assert.match(panel, /where\('courierId', '==', uid\)/);
  });

  it('keeps Kyrub-order start pickup separate from secure pickup and delivering state', () => {
    assert.match(deliveryModal, /Iniciar coleta/);
    assert.match(deliveryModal, /buildCourierDeliveryNavigationUrl/);
    assert.match(deliveryModal, /operational\.source === 'kyrub-order'/);
  });
});

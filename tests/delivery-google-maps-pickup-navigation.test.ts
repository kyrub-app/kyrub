import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { buildGoogleMapsDirectionsUrl } from '../src/utils/googleMapsDirections';

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

  it('keeps Kyrub-order start pickup separate from secure pickup and delivering state', () => {
    assert.match(deliveryModal, /Iniciar coleta/);
    assert.match(deliveryModal, /openGoogleMapsDirections/);
    assert.match(deliveryModal, /operational\.source === 'kyrub-order'/);
  });
});

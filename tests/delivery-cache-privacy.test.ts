import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeDeliveryCache } from '../src/utils/courierDeliveryCache';

test('legacy local cache drops private route address and manual draft leakage', () => {
  const entries = [
    {
      id: 'order-safe', source: 'kyrub-order', status: 'accepted',
      from: 'Loja', to: 'Rua Pessoal 999', acceptedBy: 'courier-1',
      buyerId: 'buyer-1', customerName: 'Nome Privado',
      customerDestination: { latitude: 10, longitude: 11 },
      payment: 12, distance: 4,
    },
    {
      id: 'del-local', source: 'manual', status: 'available',
      from: 'Endereço sensível 1', to: 'Endereço sensível 2',
      payment: 10, distance: 1,
    },
  ];
  const cache = sanitizeDeliveryCache(entries);
  assert.equal(cache.length, 1);
  assert.equal(cache[0]?.id, 'order-safe');
  assert.equal(cache[0]?.acceptedBy, 'courier-1');
  assert.doesNotMatch(JSON.stringify(cache), /Rua Pessoal 999|Endereço sensível|Nome Privado|buyer-1|latitude/);
  assert.deepEqual(sanitizeDeliveryCache(null), []);
  assert.deepEqual(sanitizeDeliveryCache({}), []);
});

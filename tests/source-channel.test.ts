import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeCanonicalSourceChannel, toOperationalCommerceChannel, withCanonicalSourceChannel } from '../src/utils/sourceChannel';

describe('shared omnichannel source contract', () => {
  it('normalizes legacy integration aliases into operational channels', () => {
    assert.equal(normalizeCanonicalSourceChannel('mercado-livre'), 'mercado_livre');
    assert.equal(normalizeCanonicalSourceChannel('mercado_livre'), 'mercado_livre');
    assert.equal(normalizeCanonicalSourceChannel('kyrub-shop'), 'kyrub');
    assert.equal(normalizeCanonicalSourceChannel('99food'), '99food');
  });
  it('does not mistake integration protocols or fiscal authorities for sales channels', () => {
    assert.equal(normalizeCanonicalSourceChannel('open-delivery'), 'other');
    assert.equal(normalizeCanonicalSourceChannel('open_delivery'), 'other');
    assert.equal(normalizeCanonicalSourceChannel('sefaz'), 'other');
  });
  it('writes only the canonical source channel to new payloads', () => {
    assert.deepEqual(withCanonicalSourceChannel({ orderId: 'o1' }, 'mercado-livre'), { orderId: 'o1', sourceChannel: 'mercado_livre' });
    assert.equal(toOperationalCommerceChannel('mercado_livre'), 'mercado_livre');
  });
});

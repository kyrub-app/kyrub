import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('Official Store server-side checkout identity boundary', () => {
  const source = readFileSync(
    new URL('../server/admin/officialStoreCheckoutPreflight.ts', import.meta.url), 'utf8'
  );

  it('resolves seller identity from the canonical server resolver', () => {
    assert.match(source, /resolveCanonicalStoreIdentity\(input\.sellerStoreReference/);
    assert.match(source, /requirePublishedTenant: true/);
  });

  it('reads official identity from admin storage, not a client-supplied store ID', () => {
    assert.match(source, /getOfficialStoreIdentity\(\)/);
    assert.match(source, /official\?\.canonicalStoreId/);
    assert.doesNotMatch(source, /input\.officialStoreId/);
  });

  it('does not call Mercado Pago or mutate a subscription', () => {
    assert.doesNotMatch(source, /fetch\(|createOwnPaidPlanCheckout|\.set\(|\.update\(/);
  });
});

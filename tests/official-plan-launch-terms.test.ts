import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { calculateSubscriptionContractOffer } from '../shared/subscriptionContractOffers';

const expected = [
  { months: 1, discount: 0, pro: 19700, business: 39700 },
  { months: 3, discount: 20, pro: 47280, business: 95280 },
  { months: 6, discount: 30, pro: 82740, business: 166740 },
  { months: 12, discount: 40, pro: 141840, business: 285840 },
] as const;

test('official launch prices use one upfront payment with 0/20/30/40% discounts', () => {
  for (const offer of expected) {
    assert.equal(calculateSubscriptionContractOffer(19700, offer.months, offer.discount).totalMinor, offer.pro);
    assert.equal(calculateSubscriptionContractOffer(39700, offer.months, offer.discount).totalMinor, offer.business);
  }
});

test('prepaid checkout explicitly discloses expiry and requires fresh consent for another term', () => {
  const source = readFileSync('src/components/InitialPrepaidSubscriptionCheckout.tsx', 'utf8');
  assert.match(source, /sem renovação automática/);
  assert.match(source, /A assinatura termina ao final do período contratado/);
  assert.match(source, /Uma nova contratação dependerá do meu aceite/);
  assert.match(source, /quote\.quote\.totalMinor/);
  assert.match(source, /onAccept=\{setAccepted\}/);
});

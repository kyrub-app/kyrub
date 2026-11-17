import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { publishedReturnTariffOffer,validateServerTariffOffer,
  acceptServerReturnTariffOffer } from '../server/delivery/deliveryReturnTariffContractService';

const policy={
  enabled:true,policyId:'pilot_v1',version:1,effectiveFrom:'2026-11-17T09:00:00.000Z',
  currency:'BRL',returnRateMinorPerKm:150,returnMinimumMinor:400,
  recipientGraceMinutes:10,waitingIncrementMinutes:5,
  waitingRateMinorPerIncrement:100,waitingMaxMinor:500,
  waitingOperationalLimitMinutes:40,
};
test('only published bounded policy produces a signed immutable tariff offer',()=>{
  const offer=publishedReturnTariffOffer(policy,'2026-11-17T10:00:00.000Z');
  assert.ok(offer);
  assert.equal(offer.fingerprint.length,64);
  assert.equal(validateServerTariffOffer(offer),true);
  assert.equal(validateServerTariffOffer({...offer,returnMinimumMinor:999}),false);
  assert.equal(publishedReturnTariffOffer({...policy,enabled:false},'2026-11-17T10:00:00.000Z'),null);
  assert.equal(publishedReturnTariffOffer({...policy,returnRateMinorPerKm:-1},'2026-11-17T10:00:00.000Z'),null);
  assert.equal(publishedReturnTariffOffer(policy,'2026-11-17T08:59:00.000Z'),null);
});
test('explicit consent binds price, delivery and courier to the signed offer',()=>{
  const offer=publishedReturnTariffOffer(policy,'2026-11-17T10:00:00.000Z');
  assert.ok(offer);
  const base={offer,deliveryId:'delivery_1',courierId:'courier_1',
    acceptedAt:'2026-11-17T10:05:00.000Z',fingerprint:offer.fingerprint,confirmed:true};
  const signed=acceptServerReturnTariffOffer(base);
  assert.equal(signed.acceptedVia,'server_courier_claim');
  assert.equal(signed.returnRateMinorPerKm,150);
  assert.equal(signed.offerFingerprint,offer.fingerprint);
  assert.throws(()=>acceptServerReturnTariffOffer({...base,confirmed:false}));
  assert.throws(()=>acceptServerReturnTariffOffer({...base,fingerprint:'forged'}));
  assert.throws(()=>acceptServerReturnTariffOffer({...base,courierId:'not/valid'}));
  assert.throws(()=>acceptServerReturnTariffOffer({...base,
    acceptedAt:'2026-11-17T08:50:00.000Z'}));
  assert.throws(()=>acceptServerReturnTariffOffer({...base,
    offer:{...offer,returnRateMinorPerKm:999}}));
});
test('offer contract is presented before consent, accepted only in server transaction',()=>{
  const router=readFileSync('server/delivery/deliveryOpportunityRouter.ts','utf8');
  const publicOffer=readFileSync('server/delivery/deliveryPublicOfferProjection.ts','utf8');
  const modal=readFileSync('src/components/modals/DeliveryManagerModal.tsx','utf8');
  const client=readFileSync('src/utils/deliveryOpportunities.ts','utf8');
  assert.match(router,/transaction\.get\(adminDb\.doc\(RETURN_TARIFF_CONFIG_PATH\)\)/);
  assert.match(router,/transaction\.create\(claimReference/);
  assert.match(router,/returnTariffAcceptedTerms:signed/);
  assert.match(router,/validateServerTariffOffer\(offer\)/);
  assert.match(router,/returnTariffOfferSnapshot/);
  assert.match(publicOffer,/input\.returnTariffOffer \? \{returnTariffOffer: input\.returnTariffOffer\}/);
  assert.match(modal,/Concordo expressamente com estes valores/);
  assert.match(modal,/tariffConsentId/);
  assert.match(client,/returnTariffFingerprint/);
});

test('public tariff survives sanitized offer cache without retaining private delivery fields',async()=>{
  const {sanitizeDeliveryCache}=await import('../src/utils/courierDeliveryCache');
  const offer=publishedReturnTariffOffer(policy,'2026-11-17T10:00:00.000Z');
  assert.ok(offer);
  const cached=sanitizeDeliveryCache([{
    id:'test_offer_1',source:'kyrub-order',status:'available',
    from:'Loja Exemplo',to:'Endereço particular, 99',distance:4,payment:12,
    requestedBy:'Loja Exemplo',returnTariffOffer:offer,
    buyerId:'uid_cliente_privado',customerGeofenceSnapshot:{latitude:123,longitude:999},
  }]);
  const raw=cached[0] as unknown as Record<string,unknown>;
  assert.deepEqual(raw.returnTariffOffer,offer);
  assert.doesNotMatch(JSON.stringify(raw),/uid_cliente_privado|Endereço particular|latitude|longitude/);
});

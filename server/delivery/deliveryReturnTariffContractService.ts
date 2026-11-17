import { createHash } from 'node:crypto';
import { isReturnTariffOffer, type ReturnTariffOffer } from '../../shared/deliveryReturnTariffOffer.js';

export const RETURN_TARIFF_CONFIG_PATH='platformEconomicPolicies/deliveryRecipientReturnTariff' as const;
const fields=(x:ReturnTariffOffer)=>({
  policyId:x.policyId,version:x.version,effectiveFrom:x.effectiveFrom,
  currency:x.currency,returnRateMinorPerKm:x.returnRateMinorPerKm,
  returnMinimumMinor:x.returnMinimumMinor,recipientGraceMinutes:x.recipientGraceMinutes,
  waitingIncrementMinutes:x.waitingIncrementMinutes,
  waitingRateMinorPerIncrement:x.waitingRateMinorPerIncrement,
  waitingMaxMinor:x.waitingMaxMinor,
  waitingOperationalLimitMinutes:x.waitingOperationalLimitMinutes,
});
export const tariffOfferFingerprint=(offer:ReturnTariffOffer):string=>
  createHash('sha256').update(JSON.stringify(fields(offer))).digest('hex');

export const validateServerTariffOffer=(raw:unknown):raw is ReturnTariffOffer=>
  isReturnTariffOffer(raw)&&raw.fingerprint===tariffOfferFingerprint(raw);

export const publishedReturnTariffOffer=(raw:unknown,nowIso:string):ReturnTariffOffer|null=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const data=raw as Record<string,unknown>;
  if(data.enabled!==true||Number.isNaN(Date.parse(nowIso)))return null;
  const candidate={...data,fingerprint:'a'.repeat(64)};
  if(!isReturnTariffOffer(candidate)||Date.parse(candidate.effectiveFrom)>Date.parse(nowIso))return null;
  const offer=fields(candidate);
  const snapshot={...offer,fingerprint:tariffOfferFingerprint(candidate)};
  return snapshot;
};

export const acceptServerReturnTariffOffer=(input:{
  offer:unknown;
  deliveryId:string;
  courierId:string;
  acceptedAt:string;
  fingerprint:unknown;
  confirmed:unknown;
})=>{
  const offer=input.offer;
  if(!validateServerTariffOffer(offer)
    ||input.confirmed!==true ||input.fingerprint!==offer.fingerprint
    ||!/^[a-zA-Z0-9_-]{1,128}$/.test(input.deliveryId)
    ||!/^[a-zA-Z0-9_-]{1,128}$/.test(input.courierId)
    ||Number.isNaN(Date.parse(input.acceptedAt))
    ||Date.parse(input.acceptedAt)<Date.parse(offer.effectiveFrom)){
    throw new Error('DELIVERY_RETURN_TARIFF_ACCEPTANCE_REQUIRED');
  }
  return {
    schemaVersion:1 as const,
    ...fields(offer),
    deliveryId:input.deliveryId,
    courierId:input.courierId,
    acceptedVia:'server_courier_claim' as const,
    acceptedAt:input.acceptedAt,
    offerFingerprint:offer.fingerprint,
  };
};

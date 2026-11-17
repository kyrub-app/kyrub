export interface ReturnTariffOffer {
  policyId:string;
  version:number;
  effectiveFrom:string;
  currency:'BRL';
  returnRateMinorPerKm:number;
  returnMinimumMinor:number;
  recipientGraceMinutes:number;
  waitingIncrementMinutes:number;
  waitingRateMinorPerIncrement:number;
  waitingMaxMinor:number;
  waitingOperationalLimitMinutes:number;
  fingerprint:string;
}

export const isReturnTariffOffer = (raw:unknown):raw is ReturnTariffOffer => {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return false;
  const x=raw as Record<string,unknown>;
  const n=(value:unknown,lower:number,upper:number)=>
    Number.isSafeInteger(value)&&Number(value)>=lower&&Number(value)<=upper;
  const iso=typeof x.effectiveFrom==='string'&&x.effectiveFrom.length>0
    &&!Number.isNaN(Date.parse(x.effectiveFrom))
    &&new Date(x.effectiveFrom).toISOString()===x.effectiveFrom;
  return typeof x.policyId==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x.policyId)
    &&n(x.version,1,1000000)&&iso&&x.currency==='BRL'
    &&n(x.returnRateMinorPerKm,1,1000000)
    &&n(x.returnMinimumMinor,0,100000000)
    &&n(x.recipientGraceMinutes,0,240)
    &&n(x.waitingIncrementMinutes,1,120)
    &&n(x.waitingRateMinorPerIncrement,1,10000000)
    &&n(x.waitingMaxMinor,1,100000000)
    &&n(x.waitingOperationalLimitMinutes,1,480)
    &&Number(x.recipientGraceMinutes)<Number(x.waitingOperationalLimitMinutes)
    &&typeof x.fingerprint==='string'
    &&/^[a-f0-9]{64}$/.test(x.fingerprint);
};

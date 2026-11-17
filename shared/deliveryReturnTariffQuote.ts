/**
 * Deterministic, non-executable quotation from terms accepted BEFORE the
 * incident. The caller must obtain the terms and evidence from server-owned
 * records, never from a browser-submitted amount or raw GPS trace.
 */
export interface DeliveryReturnAcceptedTariffTerms {
  schemaVersion:1;
  policyId:string;
  version:number;
  deliveryId:string;
  courierId:string;
  acceptedVia:'server_courier_claim';
  acceptedAt:string;
  currency:'BRL';
  returnRateMinorPerKm:number;
  returnMinimumMinor:number;
  recipientGraceMinutes:number;
  waitingIncrementMinutes:number;
  waitingRateMinorPerIncrement:number;
  waitingMaxMinor:number;
  waitingOperationalLimitMinutes:number;
}
export interface DeliveryReturnDistanceAuthority {
  source:'independent_route_plan';
  approved:true;
  routePlanId:string;
  distanceMeters:number;
}
export interface DeliveryRecipientWaitingAuthority {
  source:'corroborated_server_interval';
  verified:true;
  arrivedAt:string;
  returnAuthorizedAt:string;
}
export interface DeliveryReturnTariffQuote {
  policyId:string|null;
  policyVersion:number|null;
  contractGraceMinutes:number|null;
  returnMinor:number|null;
  recipientWaitingMinor:number|null;
  returnStatus:'contract_unavailable'|'distance_authority_required'|'quoted_pending_review';
  waitingStatus:'contract_unavailable'|'corroborated_interval_required'|'operational_limit_review_required'|'quoted_pending_review';
  payableTotalMinor:null;
  mayExecuteFinancially:false;
}

const obj=(value:unknown):Record<string,unknown> =>
  value && typeof value==='object' && !Array.isArray(value)
    ? value as Record<string,unknown> : {};
const validId=(v:unknown):v is string =>
  typeof v==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const nonNeg=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const positive=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
const iso=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&
  !Number.isNaN(Date.parse(v))&&new Date(v).toISOString()===v;
const safeCurrency=(value:bigint):number|null=>
  value<=BigInt(Number.MAX_SAFE_INTEGER)&&value>=0n?Number(value):null;

const acceptedTerms=(raw:unknown,deliveryId:string,courierId:string):
  DeliveryReturnAcceptedTariffTerms|null=>{
  const x=obj(raw);
  if(x.schemaVersion!==1 || !validId(x.policyId)
    || !positive(x.version) || x.deliveryId!==deliveryId
    || x.courierId!==courierId || x.acceptedVia!=='server_courier_claim'
    || !iso(x.acceptedAt) || x.currency!=='BRL'
    || !positive(x.returnRateMinorPerKm)
    || !nonNeg(x.returnMinimumMinor)
    || !nonNeg(x.recipientGraceMinutes)
    || !positive(x.waitingIncrementMinutes)
    || !positive(x.waitingRateMinorPerIncrement)
    || !positive(x.waitingMaxMinor)
    || !positive(x.waitingOperationalLimitMinutes)
    || Number(x.recipientGraceMinutes)>=Number(x.waitingOperationalLimitMinutes)
  )return null;
  return x as unknown as DeliveryReturnAcceptedTariffTerms;
};

const returnDistance=(raw:unknown):number|null=>{
  const x=obj(raw);
  return x.source==='independent_route_plan'&&x.approved===true
    &&validId(x.routePlanId)&&positive(x.distanceMeters)
    ?Number(x.distanceMeters):null;
};
const waitingInterval=(raw:unknown,acceptanceAt:string,returnAuthorizationAt:string):number|null=>{
  const x=obj(raw);
  if(x.source!=='corroborated_server_interval'||x.verified!==true
    ||!iso(x.arrivedAt)||!iso(x.returnAuthorizedAt)
    ||x.returnAuthorizedAt!==returnAuthorizationAt)return null;
  const start=Date.parse(x.arrivedAt as string),end=Date.parse(x.returnAuthorizedAt as string);
  if(start<Date.parse(acceptanceAt)||end<start)return null;
  const seconds=Math.floor((end-start)/1000);
  return Number.isSafeInteger(seconds)?seconds:null;
};

export const quoteDeliveryReturnTariffs=(input:{
  deliveryId:string;
  courierId:string;
  acceptedTerms:unknown;
  returnAuthorizationAt:unknown;
  returnDistanceAuthority:unknown;
  recipientWaitingAuthority:unknown;
}):DeliveryReturnTariffQuote=>{
  if(!validId(input.deliveryId)||!validId(input.courierId)){
    throw new Error('DELIVERY_RETURN_TARIFF_INVALID');
  }
  const terms=acceptedTerms(input.acceptedTerms,input.deliveryId,input.courierId);
  // A contract added AFTER the incident cannot retroactively set a tariff.
  if(!terms || !iso(input.returnAuthorizationAt)
    || Date.parse(terms.acceptedAt)>Date.parse(input.returnAuthorizationAt))return {
    policyId:null,policyVersion:null,contractGraceMinutes:null,
    returnMinor:null,recipientWaitingMinor:null,
    returnStatus:'contract_unavailable',
    waitingStatus:'contract_unavailable',
    payableTotalMinor:null,mayExecuteFinancially:false,
  };
  const distance=returnDistance(input.returnDistanceAuthority);
  let returnMinor:number|null=null;
  if(distance!==null){
    const quoted=(BigInt(distance)*BigInt(terms.returnRateMinorPerKm)+999n)/1000n;
    returnMinor=safeCurrency(quoted>BigInt(terms.returnMinimumMinor)?quoted:BigInt(terms.returnMinimumMinor));
  }
  const waitSeconds=waitingInterval(input.recipientWaitingAuthority,terms.acceptedAt,input.returnAuthorizationAt as string);
  let recipientWaitingMinor:number|null=null;
  let waitingStatus:DeliveryReturnTariffQuote['waitingStatus']='corroborated_interval_required';
  if(waitSeconds!==null){
    if(waitSeconds>terms.waitingOperationalLimitMinutes*60){
      waitingStatus='operational_limit_review_required';
    }else{
      const excess=Math.max(0,waitSeconds-terms.recipientGraceMinutes*60);
      const incrementSeconds=terms.waitingIncrementMinutes*60;
      const increments=BigInt(Math.ceil(excess/incrementSeconds));
      const raw=increments*BigInt(terms.waitingRateMinorPerIncrement);
      recipientWaitingMinor=safeCurrency(raw>BigInt(terms.waitingMaxMinor)
        ?BigInt(terms.waitingMaxMinor):raw);
      waitingStatus=recipientWaitingMinor!==null?'quoted_pending_review':'operational_limit_review_required';
    }
  }
  return {
    policyId:terms.policyId,policyVersion:terms.version,
    contractGraceMinutes:terms.recipientGraceMinutes,
    returnMinor,recipientWaitingMinor,
    returnStatus:returnMinor===null?'distance_authority_required':'quoted_pending_review',
    waitingStatus,
    // Quotation is NOT a payable, not the buyer's refund and never a final total.
    payableTotalMinor:null,mayExecuteFinancially:false,
  };
};

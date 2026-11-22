export type HistoricalProviderAssessment={kind:'pending'|'approved'|'refunded'|'cancelled'|'rejected'|'expired'|'other'|'mismatch'};
const str=(value:unknown)=>typeof value==='string'||typeof value==='number'?String(value).trim():'';
export function normalizeHistoricalPaymentId(value:unknown):string|null{
 const id=str(value);
 return /^[0-9]{1,24}$/.test(id)?id:null;
}
export function classifyHistoricalProviderPayment(
 value:unknown,paymentId:string,expectedCollector:string,storeId:string,legacyStoreId?:string
):HistoricalProviderAssessment{
 if(!value||typeof value!=='object'||Array.isArray(value))return {kind:'mismatch'};
 const payment=value as Record<string,unknown>;
 if(str(payment.id)!==paymentId||str(payment.collector_id)!==expectedCollector||payment.currency_id!=='BRL'||payment.payment_method_id!=='pix')return {kind:'mismatch'};
 const metadata=payment.metadata;
 if(metadata&&typeof metadata==='object'&&!Array.isArray(metadata)){
  const store=(metadata as Record<string,unknown>).kyrub_store_id;
  if(store!=null&&str(store)!==storeId&&(!legacyStoreId||str(store)!==legacyStoreId))return {kind:'mismatch'};
 }
 const status=str(payment.status).toLowerCase();
 const detail=str(payment.status_detail).toLowerCase();
 if(status==='approved')return {kind:'approved'};
 if(status==='refunded'||status==='charged_back'||status==='in_mediation')return {kind:'refunded'};
 if(status==='cancelled'||status==='canceled')return {kind:detail.includes('expir')?'expired':'cancelled'};
 if(status==='rejected')return {kind:'rejected'};
 if(status==='pending'||status==='in_process'||status==='authorized')return {kind:'pending'};
 return {kind:'other'};
}

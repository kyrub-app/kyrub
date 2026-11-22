import {normalizeHistoricalPaymentId} from './mercadoPagoTestHistoryProviderPolicy.js';

// Private IDs are used only in memory to decide which verified seller-owned
// payment to query. Public projections never expose payment, buyer or order IDs.
export type LegacyRecord={id:string;data:Record<string,unknown>};
export type LegacyProviderDisposition=
  'pending'|'approved'|'refunded'|'cancelled'|'rejected'|'expired'|'other'|'unverified';
const clean=(v:unknown)=>typeof v==='string'?v.trim():'';
export function legacyProviderReferences(intents:LegacyRecord[],payments:LegacyRecord[]){
 const intentRefs=intents.map(row=>row.data.providerIntentId);
 const paymentRefs=payments.map(row=>row.data.providerPaymentId);
 const refs=[...intentRefs,...paymentRefs];
 const numeric=refs.map(normalizeHistoricalPaymentId).filter((v):v is string=>v!==null);
 return {
  uniqueIds:[...new Set(numeric)],
  intentNumeric:intentRefs.filter(v=>normalizeHistoricalPaymentId(v)!==null).length,
  paymentNumeric:paymentRefs.filter(v=>normalizeHistoricalPaymentId(v)!==null).length,
  malformed:refs.filter(v=>v!=null&&String(v).trim()!==''&&normalizeHistoricalPaymentId(v)===null).length,
  missing:refs.filter(v=>v==null||String(v).trim()==='').length
 };
}
export function summarizeLegacyPaymentAndObligations(
 payments:LegacyRecord[],obligations:LegacyRecord[],
 statuses:ReadonlyMap<string,LegacyProviderDisposition>
){
 const localPaid=payments.filter(row=>clean(row.data.status)==='paid');
 const summary={
  locallyPaid:localPaid.length,
  locallyPaidProviderApproved:0,
  locallyPaidProviderOther:0,
  locallyPaidUnverified:0,
  openObligations:0,
  openObligationsLinkedToLocallyPaid:0,
  openObligationsWithoutKnownPayment:0
 };
 for(const row of localPaid){
  const id=normalizeHistoricalPaymentId(row.data.providerPaymentId);
  const status=id?statuses.get(id):undefined;
  if(status==='approved')summary.locallyPaidProviderApproved++;
  else if(!status||status==='unverified')summary.locallyPaidUnverified++;
  else summary.locallyPaidProviderOther++;
 }
 const paidIds=new Set(localPaid.map(row=>row.id));
 const allIds=new Set(payments.map(row=>row.id));
 for(const obligation of obligations){
  if(obligation.data.status!=='pending'&&obligation.data.status!=='eligible')continue;
  summary.openObligations++;
  const linked=clean(obligation.data.paymentId);
  if(linked&&paidIds.has(linked))summary.openObligationsLinkedToLocallyPaid++;
  if(!linked||!allIds.has(linked))summary.openObligationsWithoutKnownPayment++;
 }
 return summary;
}

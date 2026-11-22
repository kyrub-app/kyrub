// Read-only, bounded projection of historical test evidence. No customer or
// provider identifiers, monetary amounts or document payloads leave the server.
type RecordData=Record<string,unknown>;
export type HistoricalEvidenceClassification={
 states:{open:number;recordedPaid:number;closedOrReversed:number;unknown:number};
 providerReferenceShape?:{numeric:number;nonNumeric:number;missing:number};
};
const str=(value:unknown):string=>
 typeof value==='string'||typeof value==='number'?String(value).trim():'';
const open=new Set(['pending','created','awaiting_payment','awaiting_approval','authorized','in_process','eligible']);
const paid=new Set(['paid','approved','settled','payment.paid']);
const closed=new Set(['expired','cancelled','canceled','failed','rejected','refunded','reversed','charged_back',
 'payment.expired','payment.cancelled','payment.failed','refund.succeeded']);
export function classifyHistoricalTestEvidence(kind:string,rows:RecordData[]):HistoricalEvidenceClassification{
 const result:HistoricalEvidenceClassification={
  states:{open:0,recordedPaid:0,closedOrReversed:0,unknown:0}
 };
 const providerKey=kind==='paymentIntents'?'providerIntentId':kind==='payments'?'providerPaymentId':'';
 if(providerKey)result.providerReferenceShape={numeric:0,nonNumeric:0,missing:0};
 for(const row of rows){
  // Webhook evidence has an event type; ledger evidence has an economic kind,
  // not a payment status. Never mark missing status as financially safe.
  const status=str(kind==='paymentWebhookEvents'?row.eventType:row.status).toLowerCase();
  if(open.has(status))result.states.open++;
  else if(paid.has(status))result.states.recordedPaid++;
  else if(closed.has(status))result.states.closedOrReversed++;
  else result.states.unknown++;
  if(result.providerReferenceShape){
   const ref=str(row[providerKey]);
   if(!ref)result.providerReferenceShape.missing++;
   else if(/^[0-9]{1,24}$/.test(ref))result.providerReferenceShape.numeric++;
   else result.providerReferenceShape.nonNumeric++;
  }
 }
 return result;
}

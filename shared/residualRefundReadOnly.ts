/** A point-in-time estimate, never authorization to send money. */
export type ResidualRefundObservation={
 state:'matched'|'review_required';
 remainingMinor:number|null;
 reason:string;
 executionEnabled:false;
};
const id=(value:unknown)=>typeof value==='string'||typeof value==='number'?String(value).trim():'';
const exactMinor=(value:unknown):number|null=>{
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)return null;
 const cents=Math.round(value*100);
 return Number.isSafeInteger(cents)&&Math.abs(value-cents/100)<1e-8?cents:null;
};
export function observeResidualRefund(input:{
 paymentId:string;providerPaymentId:string;storeId:string;orderId:string;
 originalAmountMinor:number;storedAmountMinor:number;reportedRefundedMinor:number|null;
 currency:unknown;paymentStatus:string;
 providerListing:unknown;localAttempts:readonly Record<string,unknown>[];
 historyComplete:boolean;
}):ResidualRefundObservation{
 const blocked=(reason:string):ResidualRefundObservation=>({state:'review_required',remainingMinor:null,reason,executionEnabled:false});
 const {originalAmountMinor:total,storedAmountMinor:stored}=input;
 if(!input.paymentId||!input.providerPaymentId||!input.storeId||!input.orderId||!Number.isSafeInteger(total)||total<=0||stored!==total||input.currency!=='BRL')return blocked('payment_mismatch');
 if(!input.historyComplete||input.localAttempts.length>50||!Array.isArray(input.providerListing)||input.providerListing.length>100)return blocked('history_incomplete');
 const provider=new Map<string,number>();
 let refunded=0;
 for(const raw of input.providerListing){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return blocked('provider_history_invalid');
  const row=raw as Record<string,unknown>,refundId=id(row.id),amount=exactMinor(row.amount);
  if(!refundId||provider.has(refundId)||id(row.payment_id)!==input.providerPaymentId||amount===null||amount<=0||!['approved','refunded','completed'].includes(id(row.status)))return blocked('provider_history_uncertain');
  provider.set(refundId,amount);refunded+=amount;
  if(!Number.isSafeInteger(refunded)||refunded>total)return blocked('refund_exceeds_payment');
 }
 if(input.reportedRefundedMinor!==refunded)return blocked('provider_total_mismatch');
 if(input.paymentStatus!==(refunded===total?'refunded':'approved'))return blocked('provider_status_mismatch');
 const local=new Set<string>();
 for(const row of input.localAttempts){
  const refundId=id(row.providerRefundId),amount=exactMinor(row.amount);
  if(row.status!=='refunded'||row.storeId!==input.storeId||row.orderId!==input.orderId||row.paymentId!==input.paymentId||id(row.providerPaymentId)!==input.providerPaymentId||!refundId||local.has(refundId)||amount===null||provider.get(refundId)!==amount)return blocked('local_history_uncertain');
  local.add(refundId);
 }
 if(local.size!==provider.size)return blocked('unmatched_provider_refund');
 return {state:'matched',remainingMinor:total-refunded,reason:'point_in_time_only',executionEnabled:false};
}

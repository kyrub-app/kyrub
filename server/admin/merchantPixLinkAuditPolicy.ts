// Pure, bounded diagnostic: no provider calls, credentials or financial writes.
export type AuditRow = { id: string; data: Record<string, unknown> };
const str=(value:unknown)=>typeof value==='string'?value.trim():'';
const marketplace=(row:AuditRow)=>row.data.context==='marketplace';
const targetOrder=(row:AuditRow)=>str((row.data.target as {orderId?:unknown}|undefined)?.orderId);
export function summarizeMerchantPixLinks(input:{
 orders:AuditRow[];intents:AuditRow[];payments:AuditRow[];complete:boolean;storeId:string;tenantId:string;
}){
 const {orders,intents,payments,complete,storeId,tenantId}=input;
 const orderStates={paid:0,partial:0,unpaid:0,unknown:0,completed:0};
 for(const o of orders){
  const status=o.data.paymentStatus;
  if(status==='paid'||status==='partial'||status==='unpaid')orderStates[status]++;
  else orderStates.unknown++;
  if(o.data.status==='completed')orderStates.completed++;
 }
 const pendingIntents=intents.filter(i=>marketplace(i)&&i.data.method==='pix'&&i.data.status==='pending');
 const pendingPayments=payments.filter(p=>marketplace(p)&&p.data.method==='pix'&&p.data.status==='pending');
 const pending={intents:pendingIntents.length,payments:pendingPayments.length,withProviderId:pendingPayments.filter(p=>str(p.data.providerPaymentId)).length,completeTriples:0,needsReview:0};
 const reviewed=new Set<string>();
 for(const p of pendingPayments){
  const i=pendingIntents.find(i=>i.id===str(p.data.paymentIntentId));
  const o=i?orders.find(o=>o.id===targetOrder(i)):undefined;
  const providerId=str(p.data.providerPaymentId);
  // Matched is strictly local evidence. A provider ID is not proof that a Pix
  // is payable, paid, unexpired or settled.
  if(i&&o&&p.data.storeId===storeId&&i.data.storeId===storeId&&(o.data.storeId===tenantId||o.data.storeId===storeId)&&p.data.orderId===o.id&&o.data.paymentId===p.id&&o.data.paymentIntentId===i.id&&str(i.data.providerIntentId)===providerId&&typeof p.data.amount==='number'&&p.data.amount===i.data.amount&&!reviewed.has(i.id)){
   pending.completeTriples++;reviewed.add(i.id);
  }else pending.needsReview++;
 }
 pending.needsReview+=pendingIntents.filter(i=>!reviewed.has(i.id)&&!pendingPayments.some(p=>p.data.paymentIntentId===i.id)).length;
 const paidOrders=orders.filter(o=>o.data.paymentStatus==='paid');
 const paidOrderLinks={withExplicitPaymentId:0,linkedCanonicalPaid:0,linkedOtherStatus:0,referencedNotInScan:0,withoutExplicitPaymentId:0};
 for(const o of paidOrders){
  const id=str(o.data.paymentId);
  if(!id){paidOrderLinks.withoutExplicitPaymentId++;continue;}
  paidOrderLinks.withExplicitPaymentId++;
  const p=payments.find(p=>p.id===id&&p.data.orderId===o.id&&p.data.storeId===storeId);
  if(!p)paidOrderLinks.referencedNotInScan++;
  else if(['paid','refund_requested','refund_processing','refund_failed','chargeback_reversed'].includes(str(p.data.status)))paidOrderLinks.linkedCanonicalPaid++;
  else paidOrderLinks.linkedOtherStatus++;
 }
 return {complete,orderStates,pending,paidOrderLinks};
}

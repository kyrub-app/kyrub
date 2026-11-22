import {adminDb} from '../firebaseAdmin.js';
import {legacyProviderReferences,summarizeLegacyPaymentAndObligations,type LegacyRecord,type LegacyProviderDisposition} from './merchantLegacyProviderReconciliationPolicy.js';
import {inspectOfficialTestHistory} from './mercadoPagoTestHistoryCleanupService.js';
import {loadMercadoPagoMerchantPixMigrationInventory} from './mercadoPagoMerchantPixMigrationInventoryService.js';
import {mercadoPagoStoreRequest,validateMercadoPagoStoreConnection} from '../integrations/mercadoPagoStoreOauthService.js';
import {classifyHistoricalProviderPayment,normalizeHistoricalPaymentId,type HistoricalProviderAssessment} from './mercadoPagoTestHistoryProviderPolicy.js';

// Read-only reconciliation evidence. NEVER cancels/refunds payments, manipulates
// the original documents or permits history cleanup based on a provider status.
const STORE='store-ae53dc42e57eb9d5c3f7151c1431';
const EXPECTED_ACCOUNT='3631706959';
type Group='pending'|'approved'|'refunded'|'cancelled'|'rejected'|'expired'|'other'|'unverified';
type Summary={
 checkedAt:string;storeId:string;account:'verified'|'mismatch'|'unavailable';
 referencedRecords:{intents:number;payments:number};
 uniquePaymentReferences:number;unsupportedReferences:number;
 providerStatuses:Record<Group,number>;
 metadataMismatches:number;lookupFailures:number;unlinkedProviderLabels:number;
 requiresManualReview:true;allowsCleanup:false;
 legacy:{
  counts:{intents:number;payments:number;obligations:number};
  intentNumericReferences:number;paymentNumericReferences:number;
  nonNumericReferences:number;missingReferences:number;uniquePaymentReferences:number;
  providerStatuses:Record<Group,number>;
  metadataMismatches:number;lookupFailures:number;
  localFinance:ReturnType<typeof summarizeLegacyPaymentAndObligations>;
 };
};
const tally=():Record<Group,number>=>({pending:0,approved:0,refunded:0,cancelled:0,rejected:0,expired:0,other:0,unverified:0});
const idOf=(value:unknown)=>normalizeHistoricalPaymentId(value);
const providerMarked=(d:Record<string,unknown>)=>typeof d.provider==='string'&&d.provider.trim()!=='';
export async function inspectKyrubOfficialProviderEvidence(actor:string):Promise<Summary>{
 const preflight=await inspectOfficialTestHistory(actor);
 if(preflight.storeId!==STORE||preflight.counts.orders!==5||preflight.counts.intents!==2||preflight.counts.payments!==4)throw Error('TEST_HISTORY_SCOPE_BLOCKED');
 const inventory=await loadMercadoPagoMerchantPixMigrationInventory();
 const matches=inventory.items.filter(i=>i.canonicalStoreId===STORE&&i.storeName==='Kyrub Oficial');
 if(!inventory.complete||matches.length!==1||matches[0].readiness==='identity_review'||inventory.rolloutMode!=='disabled')throw Error('TEST_HISTORY_SCOPE_BLOCKED');
 const tenant=matches[0].tenantId;
 const [intents,payments]=await Promise.all([
  adminDb.collection(`stores/${STORE}/paymentIntents`).limit(25).get(),
  adminDb.collection(`stores/${STORE}/payments`).limit(25).get()
 ]);
 if(intents.size!==2||payments.size!==4)throw Error('TEST_HISTORY_SCOPE_BLOCKED');
 const [legacyIntents,legacyPayments,legacyObligations]=await Promise.all([
  adminDb.collection(`stores/${tenant}/paymentIntents`).limit(25).get(),
  adminDb.collection(`stores/${tenant}/payments`).limit(25).get(),
  adminDb.collection(`stores/${tenant}/economicObligations`).limit(25).get()
 ]);
 // This one-time audit must never silently expand to unrelated new commercial
 // payments after the baseline was confirmed in the administrator's report.
 if(legacyIntents.size!==6||legacyPayments.size!==6||legacyObligations.size!==1)throw Error('TEST_HISTORY_SCOPE_BLOCKED');
 const legacyIntentRows:LegacyRecord[]=legacyIntents.docs.map(d=>({id:d.id,data:d.data() as Record<string,unknown>}));
 const legacyPaymentRows:LegacyRecord[]=legacyPayments.docs.map(d=>({id:d.id,data:d.data() as Record<string,unknown>}));
 const legacyObligationRows:LegacyRecord[]=legacyObligations.docs.map(d=>({id:d.id,data:d.data() as Record<string,unknown>}));
 const legacyReferences=legacyProviderReferences(legacyIntentRows,legacyPaymentRows);
 const legacyStatuses=tally();
 const legacyVerdicts=new Map<string,LegacyProviderDisposition>();
 const intentRows=intents.docs.map(d=>d.data() as Record<string,unknown>);
 const paymentRows=payments.docs.map(d=>d.data() as Record<string,unknown>);
 const refs=[
  ...intentRows.map(d=>d.providerIntentId),
  ...paymentRows.map(d=>d.providerPaymentId)
 ];
 const rawRefs=refs.filter(v=>v!==null&&v!==undefined&&String(v).trim()!=='');
 const ids=rawRefs.map(idOf).filter((id):id is string=>id!==null);
 const unique=[...new Set(ids)];
 const unsupported=rawRefs.length-ids.length;
 const statuses=tally();
 const result:Summary={
  checkedAt:new Date().toISOString(),storeId:STORE,account:'unavailable',
  referencedRecords:{
   intents:intentRows.filter(d=>d.providerIntentId!=null&&String(d.providerIntentId).trim()!=='').length,
   payments:paymentRows.filter(d=>d.providerPaymentId!=null&&String(d.providerPaymentId).trim()!=='').length
  },
  uniquePaymentReferences:unique.length,unsupportedReferences:unsupported,
  providerStatuses:statuses,metadataMismatches:0,lookupFailures:0,
  unlinkedProviderLabels:[
   ...intentRows.filter(d=>providerMarked(d)&&!idOf(d.providerIntentId)),
   ...paymentRows.filter(d=>providerMarked(d)&&!idOf(d.providerPaymentId))
  ].length,
  requiresManualReview:true,allowsCleanup:false,
  legacy:{
   counts:{intents:legacyIntents.size,payments:legacyPayments.size,obligations:legacyObligations.size},
   intentNumericReferences:legacyReferences.intentNumeric,
   paymentNumericReferences:legacyReferences.paymentNumeric,
   nonNumericReferences:legacyReferences.malformed,
   missingReferences:legacyReferences.missing,
   uniquePaymentReferences:legacyReferences.uniqueIds.length,
   providerStatuses:legacyStatuses,
   metadataMismatches:0,lookupFailures:0,
   localFinance:summarizeLegacyPaymentAndObligations(legacyPaymentRows,legacyObligationRows,legacyVerdicts)
  }
 };
 // Identity before any payment lookup: do not silently retry under another
 // account or fall back to a platform token that might belong to a third party.
 try{
  const account=await validateMercadoPagoStoreConnection(tenant);
  if(account!==EXPECTED_ACCOUNT){
   result.account='mismatch';
   statuses.unverified=unique.length;
   legacyStatuses.unverified=legacyReferences.uniqueIds.length;
   return result;
  }
  result.account='verified';
 }catch{
  result.account='unavailable';
  statuses.unverified=unique.length;
  legacyStatuses.unverified=legacyReferences.uniqueIds.length;
  return result;
 }
 // A single seller-scoped provider read per distinct ID. No fallback to the
 // platform credential, no POST, no cancellation or ledger writes.
 const cache=new Map<string,{kind:HistoricalProviderAssessment['kind']|'lookup_failure'}>();
 const inspect=async(id:string)=>{
  const existing=cache.get(id);
  if(existing)return existing.kind;
  let kind:HistoricalProviderAssessment['kind']|'lookup_failure'='lookup_failure';
  try{
   const payment=await mercadoPagoStoreRequest<Record<string,unknown>>(tenant,`/v1/payments/${encodeURIComponent(id)}`);
   kind=classifyHistoricalProviderPayment(payment,id,EXPECTED_ACCOUNT,STORE,tenant).kind;
  }catch{kind='lookup_failure';}
  cache.set(id,{kind});
  return kind;
 };
 for(const id of [...new Set([...unique,...legacyReferences.uniqueIds])])await inspect(id);
 for(const id of unique){
  const kind=cache.get(id)?.kind??'lookup_failure';
  if(kind==='mismatch'){result.metadataMismatches++;statuses.unverified++;}
  else if(kind==='lookup_failure'){result.lookupFailures++;statuses.unverified++;}
  else statuses[kind]++;
 }
 for(const id of legacyReferences.uniqueIds){
  const kind=cache.get(id)?.kind??'lookup_failure';
  if(kind==='mismatch'){result.legacy.metadataMismatches++;legacyStatuses.unverified++;legacyVerdicts.set(id,'unverified');}
  else if(kind==='lookup_failure'){result.legacy.lookupFailures++;legacyStatuses.unverified++;legacyVerdicts.set(id,'unverified');}
  else{legacyStatuses[kind]++;legacyVerdicts.set(id,kind);}
 }
 result.legacy.localFinance=summarizeLegacyPaymentAndObligations(legacyPaymentRows,legacyObligationRows,legacyVerdicts);
 return result;
}

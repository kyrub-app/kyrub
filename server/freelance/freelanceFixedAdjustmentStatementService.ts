import {adminDb} from '../firebaseAdmin.js';
import {readFixedCancellationContext} from './freelanceCancellationAccountingService.js';
import {createDirectPaymentTerms} from '../../shared/directPaymentTerms.js';
import type {FreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {appendExternalPixStatement,projectExternalPixStatements,type ExternalPixEvent,type ExternalPixStatement} from '../../shared/freelanceExternalPaymentStatements.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {prepareAdjustmentRestriction} from './freelanceEngagementRestrictionService.js';
import {writeFreelanceFinancialNotices} from './freelanceFinancialNoticeService.js';

const fail=():never=>{throw Error('FREELANCE_PAYMENT_STATEMENT_CONFLICT');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
type Queue={schemaVersion:1;offerId:string;sourceDigest:string;payerUid:string;recipientUid:string;requestedBy:string;requestedAt:string;status:'pending'|'resolved_voluntarily';resolvedAt?:string};

/** The directional obligation is reconstructed from the immutable cancellation
 * resolution. The adapter maps payer/recipient only for the pure statement
 * projector; it never replaces the original contract obligation or history. */
export async function readAdjustmentStatementContext(tx:FirebaseFirestore.Transaction,uid:string,id:string){
 const c=await readFixedCancellationContext(tx,uid,id),o=c.resolved?.obligation;
 if(!o)return fail();
 const adapter:FreelancePaymentObligation={schemaVersion:1,offerId:id,requesterUid:o.payerUid,beneficiaryUid:o.recipientUid,terms:createDirectPaymentTerms({method:'external_pix',timing:'on_completion',amountMinor:o.amountMinor}),contractedAt:o.dueAt,dueTrigger:'bilateral_service_completion',custody:'none'};
 const statementRef=c.direct.doc('fixedAdjustmentStatements'),queueRef=adminDb.doc('freelanceFixedAdjustmentReviewsV1/'+id);
 const [history,queueDoc]=await tx.getAll(statementRef,queueRef);
 const raw=history.data();
 let events:ExternalPixEvent[]=[];
 if(raw){
  if(Object.keys(raw).length!==5||raw.schemaVersion!==1||raw.offerId!==id||raw.sourceDigest!==o.sourceDigest||raw.amountMinor!==o.amountMinor||!Array.isArray(raw.events)||raw.events.length<1||raw.events.length>3||!raw.events.every(e=>e&&typeof e==='object'&&Object.keys(e).length===4&&validFreelanceId(e.id)&&validFreelanceId(e.actorUid)&&iso(e.recordedAt)&&['paid','received','not_received'].includes(e.statement)))return fail();
  events=raw.events;
 }
 const projection=projectExternalPixStatements(adapter,events),restricted=projection.state==='disputed';
 const queue=queueDoc.data() as Queue|undefined;
 if(queue){
  if(queue.schemaVersion!==1||queue.offerId!==id||queue.sourceDigest!==o.sourceDigest||queue.payerUid!==o.payerUid||queue.recipientUid!==o.recipientUid||![o.payerUid,o.recipientUid].includes(queue.requestedBy)||!iso(queue.requestedAt)||Date.parse(queue.requestedAt)<Date.parse(o.dueAt)||!projection.hadDisagreement||!['pending','resolved_voluntarily'].includes(queue.status)||Object.keys(queue).length!==(queue.status==='pending'?8:9)||(queue.status==='pending'?(!restricted||queue.resolvedAt!==undefined):(!iso(queue.resolvedAt)||Date.parse(queue.resolvedAt)<Date.parse(queue.requestedAt)||projection.state!=='bilaterally_reported_received'||queue.resolvedAt!==events.at(-1)?.recordedAt)))return fail();
 }
 await prepareAdjustmentRestriction(tx,c.obligation,restricted,restricted);
 return {c,o,adapter,statementRef,queueRef,events,projection,restricted,queue};
}
export async function readAdjustmentStatements(uid:string,id:string){
 if(!validFreelanceId(uid)||!validFreelanceId(id))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const x=await readAdjustmentStatementContext(tx,uid,id);
  return {offerId:id,sourceDigest:x.o.sourceDigest,amountMinor:x.o.amountMinor,direction:x.o.direction,role:uid===x.o.payerUid?'payer':'recipient',state:x.projection.state,hadDisagreement:x.projection.hadDisagreement,restrictionActive:x.restricted,reviewStatus:x.queue?.status??null,statements:x.events.map(e=>({role:e.actorUid===x.o.payerUid?'payer':'recipient',statement:e.statement,recordedAt:e.recordedAt})),bankVerified:false};
 },{readOnly:true});
}
type Input={sourceDigest:unknown;expectedAmountMinor:unknown;confirmed:unknown};
function validate(uid:string,id:string,b:Input){
 if(!validFreelanceId(uid)||!validFreelanceId(id)||b.confirmed!==true||typeof b.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceDigest)||!Number.isSafeInteger(b.expectedAmountMinor)||Number(b.expectedAmountMinor)<1)throw Error('FREELANCE_INVALID');
}
export async function recordAdjustmentStatement(uid:string,id:string,b:Input&{eventId:unknown;statement:unknown}){
 validate(uid,id,b);
 if(!validFreelanceId(b.eventId)||typeof b.statement!=='string'||!['paid','received','not_received'].includes(b.statement))throw Error('FREELANCE_INVALID');
 const eventId=b.eventId,statement=b.statement as ExternalPixStatement;
 return adminDb.runTransaction(async tx=>{
  const x=await readAdjustmentStatementContext(tx,uid,id),{o}=x;
  if(b.sourceDigest!==o.sourceDigest||b.expectedAmountMinor!==o.amountMinor)return fail();
  if(uid!==(statement==='paid'?o.payerUid:o.recipientUid))throw Error('FREELANCE_FORBIDDEN');
  const now=new Date().toISOString();
  // Statements record past facts, even where a key was never disclosed or was
  // revoked. They are not authority to send money or proof of bank settlement.
  const next=appendExternalPixStatement(x.adapter,x.events,{id:eventId,actorUid:uid,statement,recordedAt:now});
  if(!next.changed)return {changed:false,state:next.state,bankVerified:false};
  const restricted=next.state==='disputed',write=await prepareAdjustmentRestriction(tx,x.c.obligation,x.restricted,restricted);
  if(x.queue&&(x.queue.status!=='pending'||(!restricted&&next.state!=='bilaterally_reported_received')||Date.parse(now)<Date.parse(x.queue.requestedAt)))return fail();
  tx.set(x.statementRef,{schemaVersion:1,offerId:id,sourceDigest:o.sourceDigest,amountMinor:o.amountMinor,events:next.events});
  write();
  if(x.queue&&next.state==='bilaterally_reported_received')tx.update(x.queueRef,{status:'resolved_voluntarily',resolvedAt:now});
  const kind=restricted?'fixed_cancellation_adjustment_disputed':x.restricted?'fixed_cancellation_adjustment_released':next.state==='bilaterally_reported_received'?'fixed_cancellation_adjustment_received':'fixed_cancellation_adjustment_statement';
  writeFreelanceFinancialNotices(tx,x.c.obligation,kind,now,'both',eventId);
  return {changed:true,state:next.state,bankVerified:false};
 });
}
export async function requestAdjustmentReview(uid:string,id:string,b:Input){
 validate(uid,id,b);
 return adminDb.runTransaction(async tx=>{
  const x=await readAdjustmentStatementContext(tx,uid,id),{o}=x;
  if(b.sourceDigest!==o.sourceDigest||b.expectedAmountMinor!==o.amountMinor||!x.restricted)return fail();
  if(x.queue){if(x.queue.status!=='pending')return fail();return {created:false};}
  const now=new Date().toISOString();
  if(Date.parse(now)<Date.parse(x.events.at(-1)!.recordedAt))return fail();
  const queue:Queue={schemaVersion:1,offerId:id,sourceDigest:o.sourceDigest,payerUid:o.payerUid,recipientUid:o.recipientUid,requestedBy:uid,requestedAt:now,status:'pending'};
  tx.create(x.queueRef,queue);
  writeFreelanceFinancialNotices(tx,x.c.obligation,'fixed_cancellation_adjustment_review_requested',now,'both',o.sourceDigest);
  return {created:true};
 });
}

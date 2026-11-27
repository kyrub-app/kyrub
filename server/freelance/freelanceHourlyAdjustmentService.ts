import {readHourlyReviewNotes,appendHourlyReviewNote,normalizeHourlyReviewNote} from './freelanceHourlyReviewNotes.js';
import {writeFreelanceFinancialNotices} from './freelanceFinancialNoticeService.js';
import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {readHourlyReconciliationContext} from './freelanceHourlyReconciliationService.js';
import {canonicalVariablePaymentRecord,digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
import {createDirectPaymentTerms} from '../../shared/directPaymentTerms.js';
import type {FreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {appendExternalPixStatement,projectExternalPixStatements,type ExternalPixEvent,type ExternalPixStatement} from '../../shared/freelanceExternalPaymentStatements.js';
import {prepareAdjustmentRestriction} from './freelanceEngagementRestrictionService.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';

type Queue={schemaVersion:1;offerId:string;sourceDigest:string;payerUid:string;recipientUid:string;requestedBy:string;requestedAt:string;status:'pending'|'resolved_voluntarily';resolvedAt?:string};
const fail=():never=>{throw Error('FREELANCE_HOURLY_RECONCILIATION_CONFLICT');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
const equal=(a:unknown,b:unknown)=>a!==undefined&&canonicalVariablePaymentRecord(a)===canonicalVariablePaymentRecord(b);
/** Independent directional obligation; never replace the gross service basis.
 * No Pix disclosure, money movement or bank verification. */
export async function readHourlyAdjustmentContext(tx:Transaction,uid:string,id:string){
 const x=await readHourlyReconciliationContext(tx,uid,id);
 if(!x.frozen||!x.candidate||!x.basis)return fail();
 const direct=x.x.c.ref.collection('directPayment'),ref=direct.doc('hourlyAdjustmentObligation'),statementRef=direct.doc('hourlyAdjustmentStatements');
 const queueRef=adminDb.doc('freelanceHourlyAdjustmentReviewsV1/'+id);
 const [saved,history,queueDoc]=await tx.getAll(ref,statementRef,queueRef);
 const a=x.candidate.adjustment;
 const expected=a?{schemaVersion:1 as const,kind:'hourly_adjustment_obligation' as const,offerId:id,
  sourceDigest:digestVariablePaymentSources(x.candidate),direction:a.direction,payerUid:a.payerUid,recipientUid:a.recipientUid,
  amountMinor:a.amountMinor,dueAt:x.basis.resolvedAt,currency:'BRL' as const,method:'external_pix' as const,custody:'none' as const}:null;
 if(saved.exists&&(!expected||!equal(saved.data(),expected))||history.exists&&!saved.exists)return fail();
 const raw=history.data();
 let events:ExternalPixEvent[]=[];
 if(raw){
  if(!expected||Object.keys(raw).length!==5||raw.schemaVersion!==1||raw.offerId!==id||raw.sourceDigest!==expected.sourceDigest||raw.amountMinor!==expected.amountMinor||!Array.isArray(raw.events)||raw.events.length<1||raw.events.length>3||!raw.events.every(e=>e&&typeof e==='object'&&Object.keys(e).length===4&&validFreelanceId(e.id)&&validFreelanceId(e.actorUid)&&iso(e.recordedAt)&&['paid','received','not_received'].includes(e.statement)))return fail();
  events=raw.events;
 }
 const adapter:FreelancePaymentObligation|null=expected?{schemaVersion:1,offerId:id,requesterUid:expected.payerUid,beneficiaryUid:expected.recipientUid,terms:createDirectPaymentTerms({method:'external_pix',amountMinor:expected.amountMinor}),contractedAt:expected.dueAt,dueTrigger:'bilateral_service_completion',custody:'none'}:null;
 const projection=adapter?projectExternalPixStatements(adapter,events):null;
 const restricted=projection?.state==='disputed';
 const queue=queueDoc.data() as Queue|undefined;
 if(queue){
  if(!expected||!saved.exists||!projection?.hadDisagreement||queue.schemaVersion!==1||queue.offerId!==id||queue.sourceDigest!==expected.sourceDigest||queue.payerUid!==expected.payerUid||queue.recipientUid!==expected.recipientUid||![expected.payerUid,expected.recipientUid].includes(queue.requestedBy)||!iso(queue.requestedAt)||Date.parse(queue.requestedAt)<Date.parse(expected.dueAt)||!['pending','resolved_voluntarily'].includes(queue.status)||Object.keys(queue).length!==(queue.status==='pending'?8:9))return fail();
  if(queue.status==='pending'?!restricted||queue.resolvedAt!==undefined||Date.parse(queue.requestedAt)<Date.parse(events.at(-1)!.recordedAt):projection.state!=='bilaterally_reported_received'||!iso(queue.resolvedAt)||queue.resolvedAt!==events.at(-1)?.recordedAt||Date.parse(queue.resolvedAt)<Date.parse(queue.requestedAt)||Date.parse(queue.requestedAt)<Date.parse(events.at(-2)!.recordedAt))return fail();
 }
 const evidence=await readHourlyReviewNotes(tx,queueRef,x.x.commitment,expected?.sourceDigest??x.historyDigest,queue?.requestedAt);
 await prepareAdjustmentRestriction(tx,x.x.commitment,restricted,restricted);
 return {x,expected,adapter,events,projection,restricted,ref,statementRef,issued:saved.exists,queue,queueRef,evidence};
}
function view(c:Awaited<ReturnType<typeof readHourlyAdjustmentContext>>,uid:string){
 const o=c.expected;
 return {offerId:c.x.x.commitment.offerId,issued:c.issued,direction:o?.direction??null,amountMinor:o?.amountMinor??0,
  sourceDigest:o?.sourceDigest??null,role:o?(uid===o.payerUid?'payer':'recipient'):null,
  state:o?(c.issued?c.projection!.state:'not_issued'):'no_adjustment',restrictionActive:c.restricted,reviewStatus:c.queue?.status??null,requestedAt:c.queue?.requestedAt??null,
  statements:c.events.map(e=>({role:e.actorUid===o?.payerUid?'payer':'recipient',statement:e.statement,recordedAt:e.recordedAt})),bankVerified:false as const};
}
export async function readHourlyAdjustment(uid:string,id:string){
 return adminDb.runTransaction(async tx=>view(await readHourlyAdjustmentContext(tx,uid,id),uid),{readOnly:true});
}
export async function issueHourlyAdjustment(uid:string,id:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==2||b.confirmed!==true||typeof b.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceDigest))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const c=await readHourlyAdjustmentContext(tx,uid,id);
  if(!c.expected||b.sourceDigest!==c.expected.sourceDigest)return fail();
  if(!c.issued)tx.create(c.ref,c.expected);
  return {...view({...c,issued:true},uid),changed:!c.issued};
 });
}
export async function recordHourlyAdjustmentStatement(uid:string,id:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==5||b.confirmed!==true||!validFreelanceId(b.eventId)||typeof b.statement!=='string'||!['paid','received','not_received'].includes(b.statement)||!Number.isSafeInteger(b.expectedAmountMinor)||typeof b.sourceDigest!=='string')throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const c=await readHourlyAdjustmentContext(tx,uid,id),o=c.expected;
  if(!o||!c.adapter||!c.issued||b.sourceDigest!==o.sourceDigest||b.expectedAmountMinor!==o.amountMinor)return fail();
  if(uid!==(b.statement==='paid'?o.payerUid:o.recipientUid))throw Error('FREELANCE_FORBIDDEN');
  const next=appendExternalPixStatement(c.adapter,c.events,{id:b.eventId as string,actorUid:uid,statement:b.statement as ExternalPixStatement,recordedAt:new Date().toISOString()});
  if(!next.changed)return {changed:false,state:next.state,restrictionActive:c.restricted,bankVerified:false as const};
  const restricted=next.state==='disputed',write=await prepareAdjustmentRestriction(tx,c.x.x.commitment,c.restricted,restricted);
  if(c.queue&&(c.queue.status!=='pending'||next.state!=='bilaterally_reported_received'||Date.parse(next.events.at(-1)!.recordedAt)<Date.parse(c.queue.requestedAt)))return fail();
  tx.set(c.statementRef,{schemaVersion:1,offerId:id,sourceDigest:o.sourceDigest,amountMinor:o.amountMinor,events:next.events});
  write();
  const now=next.events.at(-1)!.recordedAt;
  if(c.queue)tx.update(c.queueRef,{status:'resolved_voluntarily',resolvedAt:now});
  const kind=restricted?'hourly_adjustment_disputed':c.restricted?'hourly_adjustment_released':'hourly_adjustment_statement';
  writeFreelanceFinancialNotices(tx,c.x.x.commitment,kind,now,'both',b.eventId as string);
  return {changed:true,state:next.state,restrictionActive:restricted,bankVerified:false as const};
 });
}

/** Participants may escalate only an actual open dispute. The queue is private;
 * closure by an administrator will require a separately authorized operation. */
export async function requestHourlyAdjustmentReview(uid:string,id:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==3||b.confirmed!==true||typeof b.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceDigest)||!Number.isSafeInteger(b.expectedAmountMinor)||Number(b.expectedAmountMinor)<1)throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const c=await readHourlyAdjustmentContext(tx,uid,id),o=c.expected;
  if(!o||!c.issued||!c.restricted||o.sourceDigest!==b.sourceDigest||o.amountMinor!==b.expectedAmountMinor)return fail();
  if(c.queue){if(c.queue.status!=='pending')return fail();return {created:false,reviewStatus:c.queue.status,requestedAt:c.queue.requestedAt};}
  const requestedAt=new Date().toISOString();
  if(Date.parse(requestedAt)<Date.parse(c.events.at(-1)!.recordedAt))return fail();
  const queue:Queue={schemaVersion:1,offerId:id,sourceDigest:o.sourceDigest,payerUid:o.payerUid,recipientUid:o.recipientUid,requestedBy:uid,requestedAt,status:'pending'};
  tx.create(c.queueRef,queue);
  writeFreelanceFinancialNotices(tx,c.x.x.commitment,'hourly_adjustment_review_requested',requestedAt,'both',o.sourceDigest);
  return {created:true,reviewStatus:queue.status,requestedAt};
 });
}
export async function addHourlyAdjustmentReviewNote(uid:string,id:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==4||b.confirmed!==true||!validFreelanceId(b.noteId)||typeof b.sourceDigest!=='string')throw Error('FREELANCE_INVALID');
 const note=normalizeHourlyReviewNote(b.note);
 return adminDb.runTransaction(async tx=>{
  const c=await readHourlyAdjustmentContext(tx,uid,id);
  if(!c.expected||c.expected.sourceDigest!==b.sourceDigest||c.queue?.status!=='pending'||!c.restricted)return fail();
  return appendHourlyReviewNote(tx,c.evidence,c.x.x.commitment,c.expected.sourceDigest,c.queue.requestedAt,uid,b.noteId as string,note);
 });
}

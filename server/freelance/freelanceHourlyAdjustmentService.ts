import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {readHourlyReconciliationContext} from './freelanceHourlyReconciliationService.js';
import {canonicalVariablePaymentRecord,digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
import {createDirectPaymentTerms} from '../../shared/directPaymentTerms.js';
import type {FreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {appendExternalPixStatement,projectExternalPixStatements,type ExternalPixEvent,type ExternalPixStatement} from '../../shared/freelanceExternalPaymentStatements.js';
import {prepareAdjustmentRestriction} from './freelanceEngagementRestrictionService.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';

const fail=():never=>{throw Error('FREELANCE_HOURLY_RECONCILIATION_CONFLICT');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
const equal=(a:unknown,b:unknown)=>a!==undefined&&canonicalVariablePaymentRecord(a)===canonicalVariablePaymentRecord(b);
/** Independent directional obligation; never replace the gross service basis.
 * No Pix disclosure, money movement or bank verification. */
export async function readHourlyAdjustmentContext(tx:Transaction,uid:string,id:string){
 const x=await readHourlyReconciliationContext(tx,uid,id);
 if(!x.frozen||!x.candidate||!x.basis)return fail();
 const direct=x.x.c.ref.collection('directPayment'),ref=direct.doc('hourlyAdjustmentObligation'),statementRef=direct.doc('hourlyAdjustmentStatements');
 const [saved,history]=await tx.getAll(ref,statementRef);
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
 await prepareAdjustmentRestriction(tx,x.x.commitment,restricted,restricted);
 return {x,expected,adapter,events,projection,restricted,ref,statementRef,issued:saved.exists};
}
function view(c:Awaited<ReturnType<typeof readHourlyAdjustmentContext>>,uid:string){
 const o=c.expected;
 return {offerId:c.x.x.commitment.offerId,issued:c.issued,direction:o?.direction??null,amountMinor:o?.amountMinor??0,
  sourceDigest:o?.sourceDigest??null,role:o?(uid===o.payerUid?'payer':'recipient'):null,
  state:o?(c.issued?c.projection!.state:'not_issued'):'no_adjustment',restrictionActive:c.restricted,
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
  tx.set(c.statementRef,{schemaVersion:1,offerId:id,sourceDigest:o.sourceDigest,amountMinor:o.amountMinor,events:next.events});
  write();
  return {changed:true,state:next.state,restrictionActive:restricted,bankVerified:false as const};
 });
}

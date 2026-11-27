import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {calculateHourlyExcessResolution} from '../../shared/freelanceHourlyExcessResolution.js';
import {readVariablePaymentSources,digestVariablePaymentSources,canonicalVariablePaymentRecord} from './freelanceVariablePaymentBasisService.js';
import {writeFreelanceFinancialNotices} from './freelanceFinancialNoticeService.js';
const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
type Role='worker'|'requester';
type Proposal={schemaVersion:1;id:string;sourceDigest:string;recognizedExcessMs:number;proposedBy:Role;proposedAt:string;status:'pending'|'accepted'|'declined'|'withdrawn';decidedBy?:Role;decidedAt?:string};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
export async function readHourlyExcessContext(tx:Transaction,uid:string,id:string){
 const s=await readVariablePaymentSources(tx,uid,id),{record,c}=s;
 if(!s.savedBasis.exists||!s.savedCommitment.exists||record.disposition!=='requires_review'||record.accounting.status!=='requires_excess_review')return fail();
 const direct=c.ref.collection('directPayment'),pointer=direct.doc('hourlyExcessAgreement'),resolutionRef=direct.doc('hourlyExcessResolution');
 const [pdoc,resolution,final,history]=await tx.getAll(pointer,resolutionRef,direct.doc('hourlyFinalObligation'),direct.doc('hourlyStatements'));
 if(final.exists||history.exists)return fail();
 const raw=pdoc.data();let proposal:Proposal|null=null;
 if(raw){
  if(Object.keys(raw).length!==2||raw.schemaVersion!==1||!validFreelanceId(raw.proposalId))return fail();
  proposal=((await tx.get(direct.doc('hourlyExcessAgreement-'+raw.proposalId))).data() as Proposal|undefined)??null;
  if(!proposal||Object.keys(proposal).length!==(proposal.status==='pending'?7:9)||proposal.schemaVersion!==1||proposal.id!==raw.proposalId||proposal.sourceDigest!==record.sourceDigest||!['worker','requester'].includes(proposal.proposedBy)||!iso(proposal.proposedAt)||Date.parse(proposal.proposedAt)<Date.parse(record.completedAt)||!['pending','accepted','declined','withdrawn'].includes(proposal.status))return fail();
  calculateHourlyExcessResolution(record,proposal.recognizedExcessMs);
  if(proposal.status==='pending'){if(proposal.decidedAt!==undefined||proposal.decidedBy!==undefined)return fail();}
  else if(!iso(proposal.decidedAt)||Date.parse(proposal.decidedAt)<Date.parse(proposal.proposedAt)||!['worker','requester'].includes(proposal.decidedBy??'')||(proposal.status==='withdrawn'?proposal.decidedBy!==proposal.proposedBy:proposal.decidedBy===proposal.proposedBy))return fail();
 }
 const resolved=proposal?.status==='accepted'?buildResolution(record,proposal):null;
 if(resolved?(!resolution.exists||canonicalVariablePaymentRecord(resolution.data())!==canonicalVariablePaymentRecord(resolved)):resolution.exists)return fail();
 return {s,record,c,direct,pointer,proposal,resolutionRef,resolved};
}
function buildResolution(record:Awaited<ReturnType<typeof readVariablePaymentSources>>['record'],p:Proposal){
 return {schemaVersion:1,kind:'hourly_excess_resolution',offerId:record.commitment.offerId,baseDigest:record.sourceDigest,sourceDigest:digestVariablePaymentSources({base:record.sourceDigest,proposal:p}),resolvedAt:p.decidedAt!,...calculateHourlyExcessResolution(record,p.recognizedExcessMs),payable:false};
}
export async function readHourlyExcessReview(uid:string,id:string){
 return adminDb.runTransaction(async tx=>{
  const {record,c,proposal,resolved}=await readHourlyExcessContext(tx,uid,id),a=record.accounting;
  return {offerId:id,role:c.actor,sourceDigest:record.sourceDigest,estimatedMinor:record.commitment.estimatedMinor,hourlyRateMinor:a.hourlyRateMinor,authorizedMinor:a.withinCapReferenceMinor,excessMs:a.excessMs,recordedMs:a.compensableMs,proposal,resolved,payable:false,bankVerified:false};
 },{readOnly:true});
}
export async function changeHourlyExcessReview(uid:string,id:string,action:'propose'|'accept'|'decline'|'withdraw',input:{proposalId:unknown;sourceDigest:unknown;recognizedExcessMs?:unknown;confirmed:unknown}){
 if(!validFreelanceId(input.proposalId)||input.confirmed!==true||typeof input.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw Error('FREELANCE_INVALID');
 const proposalId=input.proposalId;
 return adminDb.runTransaction(async tx=>{
  const {record,c,direct,pointer,proposal:p,resolutionRef}=await readHourlyExcessContext(tx,uid,id);
  if(input.sourceDigest!==record.sourceDigest)return fail();
  const now=new Date().toISOString(),ref=direct.doc('hourlyExcessAgreement-'+proposalId),recipient=c.actor==='worker'?'requester':'freelancer';
  if(Date.parse(now)<Date.parse(record.completedAt))return fail();
  if(action==='propose'){
   const ms=input.recognizedExcessMs;
   if(typeof ms!=='number'||!Number.isSafeInteger(ms)||ms<0||ms>record.accounting.excessMs)throw Error('FREELANCE_INVALID');
   calculateHourlyExcessResolution(record,ms);
   if(p?.id===proposalId){if(p.proposedBy!==c.actor||p.recognizedExcessMs!==ms)return fail();return {changed:false};}
   if((p&&['pending','accepted'].includes(p.status))||(await tx.get(ref)).exists)return fail();
   const next:Proposal={schemaVersion:1,id:proposalId,sourceDigest:record.sourceDigest,recognizedExcessMs:ms,proposedBy:c.actor,proposedAt:now,status:'pending'};
   tx.create(ref,next);tx.set(pointer,{schemaVersion:1,proposalId});
   writeFreelanceFinancialNotices(tx,record.commitment,'hourly_excess_proposed',now,recipient,proposalId);
   return {changed:true};
  }
  if(!p||p.id!==proposalId)return fail();
  const status=action==='accept'?'accepted':action==='decline'?'declined':'withdrawn';
  if(action==='withdraw'?p.proposedBy!==c.actor:p.proposedBy===c.actor)throw Error('FREELANCE_FORBIDDEN');
  if(p.status===status&&p.decidedBy===c.actor)return {changed:false};
  if(p.status!=='pending'||Date.parse(now)<Date.parse(p.proposedAt))return fail();
  if(status==='accepted')tx.create(resolutionRef,buildResolution(record,{...p,status,decidedBy:c.actor,decidedAt:now}));
  tx.update(ref,{status,decidedBy:c.actor,decidedAt:now});
  writeFreelanceFinancialNotices(tx,record.commitment,status==='accepted'?'hourly_excess_accepted':'hourly_excess_closed',now,recipient,proposalId);
  return {changed:true};
 });
}

import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {readHourlyCancellationContext} from './freelanceHourlyCancellationService.js';
import {writeFreelanceFinancialNotices} from './freelanceFinancialNoticeService.js';

const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
type Role='worker'|'requester';
type Proposal={schemaVersion:1;id:string;sourceDigest:string;recognizedServiceMinor:number;proposedBy:Role;proposedAt:string;status:'pending'|'accepted'|'declined'|'withdrawn';decidedBy?:Role;decidedAt?:string};
async function context(tx:Transaction,uid:string,id:string){
 const {c,record}=await readHourlyCancellationContext(tx,uid,id);
 // The authorized cap is a ceiling for this voluntary service-only agreement,
 // not an assessment of damages, travel reimbursement or liability.
 const capMinor=record.accounting?.authorizedCapMinor??record.commitment.estimatedMinor;
 const direct=c.ref.collection('directPayment'),pointer=direct.doc('hourlyCancellationAgreement');
 const raw=(await tx.get(pointer)).data();
 let proposal:Proposal|null=null;
 if(raw){
  if(Object.keys(raw).length!==2||raw.schemaVersion!==1||!validFreelanceId(raw.proposalId))return fail();
  proposal=(await tx.get(direct.doc('hourlyCancellationAgreement-'+raw.proposalId))).data() as Proposal|undefined??null;
  if(!proposal||proposal.schemaVersion!==1||proposal.id!==raw.proposalId||proposal.sourceDigest!==record.sourceDigest||
   !Number.isSafeInteger(proposal.recognizedServiceMinor)||proposal.recognizedServiceMinor<0||proposal.recognizedServiceMinor>capMinor||
   !['worker','requester'].includes(proposal.proposedBy)||!iso(proposal.proposedAt)||Date.parse(proposal.proposedAt)<Date.parse(record.cancelledAt)||
   !['pending','accepted','declined','withdrawn'].includes(proposal.status)||Object.keys(proposal).length!==(proposal.status==='pending'?7:9))return fail();
  if(proposal.status==='pending'){if(proposal.decidedBy!==undefined||proposal.decidedAt!==undefined)return fail();}
  else if(!iso(proposal.decidedAt)||Date.parse(proposal.decidedAt)<Date.parse(proposal.proposedAt)||!['worker','requester'].includes(proposal.decidedBy??'')||
   (proposal.status==='withdrawn'?proposal.decidedBy!==proposal.proposedBy:proposal.decidedBy===proposal.proposedBy))return fail();
 }
 return {c,record,capMinor,direct,pointer,proposal};
}
export async function readHourlyCancellationAgreement(uid:string,id:string){
 return adminDb.runTransaction(async tx=>{
  const {c,record,capMinor,proposal}=await context(tx,uid,id);
  return {offerId:id,role:c.actor,sourceDigest:record.sourceDigest,estimatedMinor:record.commitment.estimatedMinor,capMinor,
   referenceMinor:record.accounting?.withinCapReferenceMinor??null,recordedMs:record.accounting?.compensableMs??null,
   excessMs:record.accounting?.excessMs??null,proposal,agreedMinor:proposal?.status==='accepted'?proposal.recognizedServiceMinor:null,
   payable:false,bankVerified:false};
 },{readOnly:true});
}
export async function changeHourlyCancellationAgreement(uid:string,id:string,action:'propose'|'accept'|'decline'|'withdraw',input:{proposalId:unknown;sourceDigest:unknown;recognizedServiceMinor?:unknown;confirmed:unknown}){
 if(!validFreelanceId(input.proposalId)||input.confirmed!==true||typeof input.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw Error('FREELANCE_INVALID');
 const proposalId=input.proposalId;
 return adminDb.runTransaction(async tx=>{
  const {c,record,capMinor,direct,pointer,proposal:p}=await context(tx,uid,id);
  if(input.sourceDigest!==record.sourceDigest)return fail();
  const now=new Date().toISOString(),ref=direct.doc('hourlyCancellationAgreement-'+proposalId);
  if(Date.parse(now)<Date.parse(record.cancelledAt))return fail();
  const recipient=c.actor==='requester'?'freelancer':'requester';
  if(action==='propose'){
   const amount=input.recognizedServiceMinor;
   if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<0||amount>capMinor)throw Error('FREELANCE_INVALID');
   if(p?.id===proposalId){if(p.proposedBy!==c.actor||p.recognizedServiceMinor!==amount)return fail();return {changed:false};}
   if(p&&['pending','accepted'].includes(p.status)||(await tx.get(ref)).exists)return fail();
   const next:Proposal={schemaVersion:1,id:proposalId,sourceDigest:record.sourceDigest,recognizedServiceMinor:amount,proposedBy:c.actor,proposedAt:now,status:'pending'};
   tx.create(ref,next);tx.set(pointer,{schemaVersion:1,proposalId});
   writeFreelanceFinancialNotices(tx,record.commitment,'hourly_cancellation_proposed',now,recipient,proposalId);
   return {changed:true};
  }
  if(!p||p.id!==proposalId)return fail();
  const status=action==='accept'?'accepted':action==='decline'?'declined':'withdrawn';
  if(action==='withdraw'?c.actor!==p.proposedBy:c.actor===p.proposedBy)throw Error('FREELANCE_FORBIDDEN');
  if(p.status===status&&p.decidedBy===c.actor)return {changed:false};
  if(p.status!=='pending'||Date.parse(now)<Date.parse(p.proposedAt))return fail();
  tx.update(ref,{status,decidedBy:c.actor,decidedAt:now});
  writeFreelanceFinancialNotices(tx,record.commitment,status==='accepted'?'hourly_cancellation_accepted':'hourly_cancellation_closed',now,recipient,proposalId);
  return {changed:true};
 });
}

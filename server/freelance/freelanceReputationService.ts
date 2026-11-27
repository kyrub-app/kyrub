import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {readAttendanceContext} from './freelanceAttendanceScheduleService.js';
import {freelanceReputationParties,freelanceReputationSlot,type ReputationSubject} from '../../shared/freelanceReputation.js';
import {canonicalVariablePaymentRecord,digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';

const fail=():never=>{throw Error('FREELANCE_REPUTATION_CONFLICT');};
const gate=()=>{if(process.env.KYRUB_FREELANCE_REPUTATION_TEST_ONLY!=='true')throw Error('FREELANCE_FORBIDDEN');};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
// Stars are a test-only candidate for the previously discussed evaluation
// format. No criteria, final scale approval, deadline, reward or public read.
const stars=(v:unknown):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>=1&&v<=5;
type Role='requester'|'worker';
type Slot={schemaVersion:1;offerId:string;contractDigest:string;role:Role;authorUid:string;subject:ReputationSubject;stars:number;submittedAt:string};
async function context(tx:Transaction,uid:string,id:string){
 gate();
 const c=await readAttendanceContext(tx,uid,id),parties=freelanceReputationParties(c.offer,c.application);
 const contractDigest=digestVariablePaymentSources({parties,selectedAt:c.offer.selectedAt,contractedAt:c.offer.contractedAt,startedAt:c.offer.startedAt,completionRequestedAt:c.offer.completionRequestedAt,paymentMinor:c.offer.paymentMinor,paymentTerms:c.offer.paymentTerms??null,workTerms:c.offer.workTerms??null,requesterStore:c.offer.requesterStore??null});
 const collection=c.ref.collection('reputationPrivateV1'),refs={requester:collection.doc('requester'),worker:collection.doc('worker')};
 const [a,b]=await tx.getAll(refs.requester,refs.worker);
 function checked(raw:unknown,role:Role):Slot|undefined{
  if(raw===undefined)return undefined;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail();
  const r=raw as Slot,authorUid=role==='requester'?parties.requesterUid:parties.workerUid;
  const expected=freelanceReputationSlot(c.offer,c.application,authorUid);
  if(Object.keys(r).length!==8||r.schemaVersion!==1||r.offerId!==id||r.contractDigest!==contractDigest||r.role!==role||r.authorUid!==authorUid||canonicalVariablePaymentRecord(r.subject)!==canonicalVariablePaymentRecord(expected.subject)||!stars(r.stars)||!iso(r.submittedAt)||Date.parse(r.submittedAt)<Date.parse(parties.completedAt))return fail();
  return r;
 }
 const slots={requester:checked(a.data(),'requester'),worker:checked(b.data(),'worker')};
 return {c,parties,contractDigest,refs,slots};
}
function view(x:Awaited<ReturnType<typeof context>>){
 const role=x.c.actor,other=role==='requester'?'worker':'requester',own=x.slots[role],peer=x.slots[other],released=!!own&&!!peer;
 const project=(s:Slot)=>({subject:s.subject,stars:s.stars,submittedAt:s.submittedAt});
 // Before bilateral submission, reveal neither the other's score nor timing.
 return {offerId:x.parties.offerId,role,own:own?project(own):null,received:released?project(peer!):null,publicationState:released?'bilateral_released':'waiting_bilateral',rewardsGranted:false};
}
export async function readFreelanceReputation(uid:string,id:string){
 return adminDb.runTransaction(async tx=>view(await context(tx,uid,id)),{readOnly:true});
}
export async function submitFreelanceReputation(uid:string,id:string,input:unknown){
 gate();
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==2||b.confirmed!==true||!stars(b.stars))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const x=await context(tx,uid,id),role=x.c.actor,prior=x.slots[role];
  if(prior){if(prior.stars!==b.stars)return fail();return {...view(x),changed:false};}
  const submittedAt=new Date().toISOString();
  if(Date.parse(submittedAt)<Date.parse(x.parties.completedAt))return fail();
  const slot:Slot={schemaVersion:1,offerId:id,contractDigest:x.contractDigest,role,authorUid:uid,subject:freelanceReputationSlot(x.c.offer,x.c.application,uid).subject,stars:b.stars as number,submittedAt};
  tx.create(x.refs[role],slot);
  return {...view({...x,slots:{...x.slots,[role]:slot}}),changed:true};
 });
}

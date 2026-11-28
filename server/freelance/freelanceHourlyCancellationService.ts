import {adminDb} from '../firebaseAdmin.js';
import type {Transaction} from 'firebase-admin/firestore';
import type {FreelanceOffer,FreelanceApplication,FreelanceOccurrence} from '../../shared/freelanceLifecycle.js';
import {buildHourlyCancellationBasis} from '../../shared/freelanceHourlyCancellationBasis.js';
import {readAttendanceContext} from './freelanceAttendanceScheduleService.js';
import {readAttendanceTimeline} from './freelanceAttendanceService.js';
import {readExtensionRecords} from './freelanceAttendanceExtensionService.js';
import {projectAcceptedFreelanceExtensions} from '../../shared/freelanceAttendanceExtensions.js';
import {canonicalVariablePaymentRecord,digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
import {assertHourlyLifecycleCandidate} from './freelanceHourlyLifecycleGate.js';
const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
const equal=(a:unknown,b:unknown)=>a!==undefined&&canonicalVariablePaymentRecord(a)===canonicalVariablePaymentRecord(b);
async function validateHourlyCancellation(tx:Transaction,uid:string,id:string,r:{offer:FreelanceOffer;application:FreelanceApplication;occurrence:FreelanceOccurrence;changed:boolean}){
 assertHourlyLifecycleCandidate(r.offer);
 const c=await readAttendanceContext(tx,uid,id),t=await readAttendanceTimeline(tx,c);
 const ext=t?await readExtensionRecords(tx,c.ref,t.scheduleId,t.schedule,t.events):null;
 const attendance=t&&c.current?.decidedAt&&ext?{scheduleId:t.scheduleId,schedule:t.schedule,scheduleAcceptedAt:c.current.decidedAt,events:t.events,extensions:projectAcceptedFreelanceExtensions(ext.records)}:null;
 if(t&&!attendance)return fail();
 const basis=buildHourlyCancellationBasis({...r,attendance});
 const record={...basis,sourceDigest:digestVariablePaymentSources({occurrence:r.occurrence,schedule:c.current,attendance})};
 const direct=c.ref.collection('directPayment'),financial=c.ref.collection('financialBasis'),target=financial.doc('hourlyCancellation');
 const [commitment,saved,...forbidden]=await tx.getAll(direct.doc('hourlyCommitment'),target,direct.doc('obligation'),direct.doc('externalStatements'),financial.doc('remuneration'),financial.doc('hourlyCompletion'),...(r.changed?[direct.doc('hourlyFinalObligation'),direct.doc('hourlyStatements'),direct.doc('hourlyCancellationResolution')]:[]));
 if(!equal(commitment.data(),basis.commitment)||forbidden.some(d=>d.exists)||(r.changed?saved.exists:!equal(saved.data(),record)))return fail();
 return {target,record};
}

export async function prepareHourlyCancellation(tx:Transaction,uid:string,id:string,r:{offer:FreelanceOffer;application:FreelanceApplication;occurrence:FreelanceOccurrence;changed:boolean}){
 const {target,record}=await validateHourlyCancellation(tx,uid,id,r);
 return ()=>{if(r.changed)tx.create(target,record);};
}
export async function readHourlyCancellationContext(tx:Transaction,uid:string,id:string){
  const c=await readAttendanceContext(tx,uid,id);
  if(c.offer.status!=='cancelled'||c.terms?.mode!=='hourly')return fail();
  const saved=await tx.get(c.ref.collection('financialBasis').doc('hourlyCancellation'));
  const occurrenceId=saved.get('occurrenceId');
  if(typeof occurrenceId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(occurrenceId))return fail();
  const occurrence=(await tx.get(c.ref.collection('occurrences').doc(occurrenceId))).data() as FreelanceOccurrence|undefined;
  if(!occurrence)return fail();
  const {record}=await validateHourlyCancellation(tx,uid,id,{offer:c.offer,application:c.application,occurrence,changed:false});
  return {c,record};
}
export async function readHourlyCancellation(uid:string,id:string){
 return adminDb.runTransaction(async tx=>{
  const {c,record}=await readHourlyCancellationContext(tx,uid,id);
  return {offerId:id,role:c.actor,estimatedMinor:record.commitment.estimatedMinor,cancelledAt:record.cancelledAt,suspendedAt:record.suspendedAt,accounting:record.accounting,recognizedServiceMinor:null,finalAmountMinor:null,disposition:record.disposition,payable:false,bankVerified:false};
 },{readOnly:true});
}

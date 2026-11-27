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
export async function prepareHourlyCancellation(tx:Transaction,uid:string,id:string,r:{offer:FreelanceOffer;application:FreelanceApplication;occurrence:FreelanceOccurrence;changed:boolean}){
 assertHourlyLifecycleCandidate(r.offer);
 const c=await readAttendanceContext(tx,uid,id),t=await readAttendanceTimeline(tx,c);
 const ext=t?await readExtensionRecords(tx,c.ref,t.scheduleId,t.schedule,t.events):null;
 const attendance=t&&c.current?.decidedAt&&ext?{scheduleId:t.scheduleId,schedule:t.schedule,scheduleAcceptedAt:c.current.decidedAt,events:t.events,extensions:projectAcceptedFreelanceExtensions(ext.records)}:null;
 if(t&&!attendance)return fail();
 const basis=buildHourlyCancellationBasis({...r,attendance});
 const record={...basis,sourceDigest:digestVariablePaymentSources({occurrence:r.occurrence,schedule:c.current,attendance})};
 const direct=c.ref.collection('directPayment'),financial=c.ref.collection('financialBasis'),target=financial.doc('hourlyCancellation');
 const [commitment,saved,...forbidden]=await tx.getAll(direct.doc('hourlyCommitment'),target,direct.doc('obligation'),direct.doc('externalStatements'),direct.doc('hourlyFinalObligation'),direct.doc('hourlyStatements'),financial.doc('remuneration'),financial.doc('hourlyCompletion'));
 if(!equal(commitment.data(),basis.commitment)||forbidden.some(d=>d.exists)||(r.changed?saved.exists:!equal(saved.data(),record)))return fail();
 return ()=>{if(r.changed)tx.create(target,record);};
}

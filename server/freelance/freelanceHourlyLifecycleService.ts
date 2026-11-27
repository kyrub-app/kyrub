import type {Transaction,DocumentReference} from 'firebase-admin/firestore';
import type {FreelanceSelectionResult} from '../../shared/freelanceLifecycle.js';
import {buildFreelanceHourlyCommitment,buildFreelanceVariablePaymentBasis} from '../../shared/freelanceVariablePaymentBasis.js';
import {readAttendanceContext} from './freelanceAttendanceScheduleService.js';
import {readAttendanceTimeline} from './freelanceAttendanceService.js';
import {readExtensionRecords} from './freelanceAttendanceExtensionService.js';
import {projectAcceptedFreelanceExtensions} from '../../shared/freelanceAttendanceExtensions.js';
import {canonicalVariablePaymentRecord,digestVariablePaymentSources} from './freelanceVariablePaymentBasisService.js';
import {buildFinal} from './freelanceHourlyFinalObligationService.js';
import {assertHourlyLifecycleCandidate} from './freelanceHourlyLifecycleGate.js';
const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
const equal=(a:unknown,b:unknown)=>a!==undefined&&canonicalVariablePaymentRecord(a)===canonicalVariablePaymentRecord(b);
/** All reads first; callers invoke prepared writes in the same lifecycle transaction. */
export async function prepareHourlyContract(tx:Transaction,ref:DocumentReference,r:FreelanceSelectionResult){
 assertHourlyLifecycleCandidate(r.offer);
 const commitment=buildFreelanceHourlyCommitment(r.offer,r.application),direct=ref.collection('directPayment'),financial=ref.collection('financialBasis');
 const target=direct.doc('hourlyCommitment');
 const [saved,...others]=await tx.getAll(target,direct.doc('obligation'),direct.doc('externalStatements'),direct.doc('hourlyFinalObligation'),direct.doc('hourlyStatements'),financial.doc('remuneration'),financial.doc('hourlyCompletion'));
 if(others.some(d=>d.exists)||(r.changed?saved.exists:!equal(saved.data(),commitment)))return fail();
 return ()=>{if(r.changed)tx.create(target,commitment);};
}
export async function prepareHourlyCompletion(tx:Transaction,uid:string,id:string,r:FreelanceSelectionResult){
 assertHourlyLifecycleCandidate(r.offer);
 const c=await readAttendanceContext(tx,uid,id),t=await readAttendanceTimeline(tx,c);
 if(!t||c.current?.status!=='accepted'||!c.current.decidedAt||c.actor!=='requester')return fail();
 const ext=await readExtensionRecords(tx,c.ref,t.scheduleId,t.schedule,t.events);
 const extensions=projectAcceptedFreelanceExtensions(ext.records);
 const events=r.changed?[...t.events,{id:'l-confirm_completion',kind:'confirm_checkout' as const,actor:'requester' as const,at:r.offer.completedAt!}]:t.events;
 const basis=buildFreelanceVariablePaymentBasis({offer:r.offer,application:r.application,scheduleId:t.scheduleId,schedule:t.schedule,scheduleAcceptedAt:c.current.decidedAt,events,extensions});
 const record={...basis,sourceDigest:digestVariablePaymentSources({schedule:c.current,events,extensions})};
 const direct=c.ref.collection('directPayment'),financial=c.ref.collection('financialBasis');
 const target=financial.doc('hourlyCompletion'),finalRef=direct.doc('hourlyFinalObligation');
 const [commitment,saved,final,statements,...fixed]=await tx.getAll(direct.doc('hourlyCommitment'),target,finalRef,direct.doc('hourlyStatements'),direct.doc('obligation'),direct.doc('externalStatements'),financial.doc('remuneration'));
 if(!equal(commitment.data(),record.commitment)||fixed.some(d=>d.exists))return fail();
 const expected=record.disposition==='positive_amount_calculated'?buildFinal(record):null;
 if(r.changed){if(saved.exists||final.exists||statements.exists)return fail();}
 else if(!equal(saved.data(),record)||(expected?!equal(final.data(),expected):final.exists||statements.exists))return fail();
 return ()=>{if(r.changed){tx.create(target,record);if(expected)tx.create(finalRef,expected);}};
}

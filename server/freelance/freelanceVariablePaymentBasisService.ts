import type {Transaction} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import {adminDb} from '../firebaseAdmin.js';
import {readAttendanceContext} from './freelanceAttendanceScheduleService.js';
import {readAttendanceTimeline} from './freelanceAttendanceService.js';
import {readExtensionRecords} from './freelanceAttendanceExtensionService.js';
import {projectAcceptedFreelanceExtensions} from '../../shared/freelanceAttendanceExtensions.js';
import {buildFreelanceHourlyCommitment,buildFreelanceVariablePaymentBasis} from '../../shared/freelanceVariablePaymentBasis.js';

const fail=():never=>{throw Error('FREELANCE_VARIABLE_PAYMENT_CONFLICT');};
// Firestore map key order is not guaranteed; stable encoding for immutable snapshots.
export function canonicalVariablePaymentRecord(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonicalVariablePaymentRecord).join(',')+']';
 if(value!==null&&typeof value==='object'){
  const r=value as Record<string,unknown>;
  return '{'+Object.keys(r).sort().map(k=>JSON.stringify(k)+':'+canonicalVariablePaymentRecord(r[k])).join(',')+'}';
 }
 const s=JSON.stringify(value);if(s===undefined)return fail();return s;
}
const digest=(value:unknown)=>createHash('sha256').update(canonicalVariablePaymentRecord(value)).digest('hex');
/** Service-only candidate, using the local-emulator boundary of readAttendanceContext.
 * No transport action, no Pix disclosure, no bank or ledger mutation.
 * Only a fully persisted completed hourly contract can generate this evidence.
 * Both records are immutable and idempotent, never replace the fixed-price obligation. */
export async function readVariablePaymentSources(tx:Transaction,uid:string,offerId:string){
  const c=await readAttendanceContext(tx,uid,offerId);
  const commitment=buildFreelanceHourlyCommitment(c.offer,c.application);
  const t=await readAttendanceTimeline(tx,c);
  if(!t||c.current?.status!=='accepted'||!c.current.decidedAt)return fail();
  const ext=await readExtensionRecords(tx,c.ref,t.scheduleId,t.schedule,t.events);
  const extensions=projectAcceptedFreelanceExtensions(ext.records);
  const basis=buildFreelanceVariablePaymentBasis({offer:c.offer,application:c.application,scheduleId:t.scheduleId,schedule:t.schedule,scheduleAcceptedAt:c.current.decidedAt,events:t.events,extensions});
  const record={...basis,sourceDigest:digest({schedule:c.current,events:t.events,extensions})};
  const direct=c.ref.collection('directPayment'),financial=c.ref.collection('financialBasis');
  const commitmentRef=direct.doc('hourlyCommitment'),basisRef=financial.doc('hourlyCompletion');
  const [savedCommitment,savedBasis,fixedObligation,fixedBasis,statements,final,hourlyStatements]=await tx.getAll(commitmentRef,basisRef,direct.doc('obligation'),financial.doc('remuneration'),direct.doc('externalStatements'),direct.doc('hourlyFinalObligation'),direct.doc('hourlyStatements'));
  if(fixedObligation.exists||fixedBasis.exists||statements.exists||((final.exists||hourlyStatements.exists)&&(!savedCommitment.exists||!savedBasis.exists))||(hourlyStatements.exists&&!final.exists))return fail();
  if(savedCommitment.exists&&canonicalVariablePaymentRecord(savedCommitment.data())!==canonicalVariablePaymentRecord(commitment))return fail();
  if(savedBasis.exists&&(!savedCommitment.exists||canonicalVariablePaymentRecord(savedBasis.data())!==canonicalVariablePaymentRecord(record)))return fail();
  return {c,record,commitment,commitmentRef,basisRef,savedCommitment,savedBasis};
}
export async function recordFreelanceVariablePaymentBasis(uid:string,offerId:string){
 return adminDb.runTransaction(async tx=>{
  const {record,commitment,commitmentRef,basisRef,savedCommitment,savedBasis}=await readVariablePaymentSources(tx,uid,offerId);
  if(!savedCommitment.exists)tx.create(commitmentRef,commitment);
  if(!savedBasis.exists)tx.create(basisRef,record);
  return {basis:record,replay:savedBasis.exists};
 });
}

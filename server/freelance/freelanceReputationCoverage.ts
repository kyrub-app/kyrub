import {randomUUID} from 'node:crypto';
import type {Transaction} from 'firebase-admin/firestore';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {digestVariablePaymentSources,canonicalVariablePaymentRecord} from './freelanceVariablePaymentBasisService.js';
import type {ReputationSubject} from '../../shared/freelanceReputation.js';
type Scope={subject:ReputationSubject;representativeUid:string};
type Witness=Scope&{schemaVersion:1;revision:string;verifiedDigest:string|null;epoch:string};
export function reputationCoverageLocal(){
 return process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION==='true'&&!process.env.VERCEL&&!process.env.VERCEL_ENV&&!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&['127.0.0.1:8088','localhost:8088'].includes(process.env.FIRESTORE_EMULATOR_HOST??'')&&['127.0.0.1:9099','localhost:9099'].includes(process.env.FIREBASE_AUTH_EMULATOR_HOST??'')&&getFirebaseAdminProjectId()==='kyrub-security-test';
}
export const coverageRef=(scope:Scope)=>adminDb.doc('freelanceReputationCoverageV1/'+digestVariablePaymentSources(scope));
export const indexDigest=(raw:unknown)=>digestVariablePaymentSources(raw??null);
export function checkedCoverage(scope:Scope,raw:unknown):Witness|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const r=raw as Witness;
 return Object.keys(r).length===6&&r.schemaVersion===1&&validEpoch(r.epoch)&&r.representativeUid===scope.representativeUid&&canonicalVariablePaymentRecord(r.subject)===canonicalVariablePaymentRecord(scope.subject)&&typeof r.revision==='string'&&/^[a-f0-9-]{36}$/.test(r.revision)&&(r.verifiedDigest===null||typeof r.verifiedDigest==='string'&&/^[a-f0-9]{64}$/.test(r.verifiedDigest))?r:null;
}
export function writeCoverage(tx:Transaction,scope:Scope,verifiedDigest:string|null,epoch='initial'){
 if(!reputationCoverageLocal())throw Error('FREELANCE_FORBIDDEN');
 tx.set(coverageRef(scope),{...scope,schemaVersion:1,revision:randomUUID(),verifiedDigest,epoch});
}
export function invalidateUnindexedCoverage(tx:Transaction,parties:{worker:ReputationSubject;workerUid:string;requester:ReputationSubject;requesterUid:string}){
 if(!reputationCoverageLocal())return;
 writeCoverage(tx,{subject:parties.worker,representativeUid:parties.workerUid},null);
 writeCoverage(tx,{subject:parties.requester,representativeUid:parties.requesterUid},null);
}

type Maintenance={schemaVersion:1;epoch:string;active:boolean};
const validEpoch=(v:unknown):v is string=>v==='initial'||typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const maintenanceRef=()=>adminDb.doc('freelanceReputationMaintenanceV1/global');
export async function readReputationMaintenance(tx:Transaction):Promise<Maintenance>{
 const raw=(await tx.get(maintenanceRef())).data();
 if(!raw)return {schemaVersion:1,epoch:'initial',active:false};
 if(Object.keys(raw).length!==3||raw.schemaVersion!==1||!validEpoch(raw.epoch)||raw.epoch==='initial'||typeof raw.active!=='boolean')throw Error('FREELANCE_REPUTATION_INDEX_CONFLICT');
 return {schemaVersion:1,epoch:raw.epoch,active:raw.active};
}
/** Internal emulator-only maintenance protocol, no HTTP or UI. Begin before
 * any direct administrative source changes, finish only after all writes
 * stop. Epoch change invalidates every prior certification without scanning
 * subjects. Interrupted maintenance remains closed to certified reads. */
export async function beginReputationMaintenance(){
 if(!reputationCoverageLocal())throw Error('FREELANCE_FORBIDDEN');
 return adminDb.runTransaction(async tx=>{
  const current=await readReputationMaintenance(tx);
  if(current.active)throw Error('FREELANCE_REPUTATION_INDEX_CONFLICT');
  const epoch=randomUUID();
  tx.set(maintenanceRef(),{schemaVersion:1,epoch,active:true});
  return {epoch};
 });
}
export async function finishReputationMaintenance(epoch:unknown){
 if(!reputationCoverageLocal())throw Error('FREELANCE_FORBIDDEN');
 if(!validEpoch(epoch)||epoch==='initial')throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const current=await readReputationMaintenance(tx);
  if(!current.active||current.epoch!==epoch)throw Error('FREELANCE_REPUTATION_INDEX_CONFLICT');
  tx.set(maintenanceRef(),{schemaVersion:1,epoch:randomUUID(),active:false});
  return {finished:true};
 });
}

import {randomUUID} from 'node:crypto';
import type {Transaction} from 'firebase-admin/firestore';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {digestVariablePaymentSources,canonicalVariablePaymentRecord} from './freelanceVariablePaymentBasisService.js';
import type {ReputationSubject} from '../../shared/freelanceReputation.js';
type Scope={subject:ReputationSubject;representativeUid:string};
type Witness=Scope&{schemaVersion:1;revision:string;verifiedDigest:string|null};
export function reputationCoverageLocal(){
 return process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION==='true'&&!process.env.VERCEL&&!process.env.VERCEL_ENV&&!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&['127.0.0.1:8088','localhost:8088'].includes(process.env.FIRESTORE_EMULATOR_HOST??'')&&['127.0.0.1:9099','localhost:9099'].includes(process.env.FIREBASE_AUTH_EMULATOR_HOST??'')&&getFirebaseAdminProjectId()==='kyrub-security-test';
}
export const coverageRef=(scope:Scope)=>adminDb.doc('freelanceReputationCoverageV1/'+digestVariablePaymentSources(scope));
export const indexDigest=(raw:unknown)=>digestVariablePaymentSources(raw??null);
export function checkedCoverage(scope:Scope,raw:unknown):Witness|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const r=raw as Witness;
 return Object.keys(r).length===5&&r.schemaVersion===1&&r.representativeUid===scope.representativeUid&&canonicalVariablePaymentRecord(r.subject)===canonicalVariablePaymentRecord(scope.subject)&&typeof r.revision==='string'&&/^[a-f0-9-]{36}$/.test(r.revision)&&(r.verifiedDigest===null||typeof r.verifiedDigest==='string'&&/^[a-f0-9]{64}$/.test(r.verifiedDigest))?r:null;
}
export function writeCoverage(tx:Transaction,scope:Scope,verifiedDigest:string|null){
 if(!reputationCoverageLocal())throw Error('FREELANCE_FORBIDDEN');
 tx.set(coverageRef(scope),{...scope,schemaVersion:1,revision:randomUUID(),verifiedDigest});
}
export function invalidateUnindexedCoverage(tx:Transaction,parties:{worker:ReputationSubject;workerUid:string;requester:ReputationSubject;requesterUid:string}){
 if(!reputationCoverageLocal())return;
 writeCoverage(tx,{subject:parties.worker,representativeUid:parties.workerUid},null);
 writeCoverage(tx,{subject:parties.requester,representativeUid:parties.requesterUid},null);
}

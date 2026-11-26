import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {evaluateStoredCapabilityAgeAccess} from '../../shared/ageEligibility.js';
import {requireKyrubSessionMfa} from './kyrubMfaAuthorization.js';

/** Trusted human-initiated finance entry point. Control records are private
 * and absent controls preserve the existing rollout. Never use this to
 * authorize provider webhooks or automated settlement workers. */
export async function requireFinancialPolicyInTransaction(tx:Transaction,authorization:string,ownerId:string){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(ownerId))throw Error('STORE_REPRESENTATION_FORBIDDEN');
 const [ageControl,mfaControl]=await tx.getAll(adminDb.doc('erp_age_release_private/current'),adminDb.doc('financial_mfa_release_private/current'));
 if(!ageControl.exists&&!mfaControl.exists)return;
 if(ageControl.exists&&(ageControl.get('schemaVersion')!==1||ageControl.get('mode')!=='verified_adult_only'))throw Error('STORE_FINANCE_AGE_REQUIRED');
 if(mfaControl.exists&&(mfaControl.get('schemaVersion')!==1||mfaControl.get('mode')!=='recent_totp_required'))throw Error('second_factor_required');
 const identity=await requireKyrubSessionMfa(authorization,mfaControl.exists?'financial':'ordinary',300);
 if(identity.uid!==ownerId)throw Error('STORE_REPRESENTATION_FORBIDDEN');
 if(ageControl.exists){
  const record=await tx.get(adminDb.doc('age_eligibility_private/'+ownerId));
  if(!evaluateStoredCapabilityAgeAccess({actorUid:ownerId,record:record.data(),capability:'financial_operations',policy:'verified_adult_only'}))throw Error('STORE_FINANCE_AGE_REQUIRED');
 }
}
export async function requireStagedFinancialOwnerAccess(authorization:string,ownerId:string){
 await adminDb.runTransaction(tx=>requireFinancialPolicyInTransaction(tx,authorization,ownerId));
}

import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {evaluateStoredCapabilityAgeAccess,type AgeCapability} from '../../shared/ageEligibility.js';

/** Mirror the staged Firestore social gate for trusted Admin SDK writers.
 * Absent control preserves legacy behavior. Malformed or blocked controls
 * fail closed; a protected write reads evidence in its own transaction. */
export async function requireSocialAgeInTransaction(tx:Transaction,participants:readonly string[],capability:Extract<AgeCapability,'messages'|'tribes'|'social_publication'|'connections'>,errorCode:string){
 const control=await tx.get(adminDb.doc('social_age_release_private/current'));
 if(!control.exists)return;
 if(control.get('schemaVersion')!==1||control.get('mode')!=='verified_adult_only')throw Error(errorCode);
 const ids=[...new Set(participants)];
 if(!ids.length||ids.some(uid=>typeof uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(uid)))throw Error(errorCode);
 const records=await tx.getAll(...ids.map(uid=>adminDb.doc('age_eligibility_private/'+uid)));
 if(ids.some((uid,index)=>!evaluateStoredCapabilityAgeAccess({actorUid:uid,record:records[index].data(),capability,policy:'verified_adult_only'})))throw Error(errorCode);
}

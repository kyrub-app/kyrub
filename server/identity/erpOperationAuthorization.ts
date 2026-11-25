import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {evaluateStoredCapabilityAgeAccess} from '../../shared/ageEligibility.js';
import {hasStorePermission,parseStoreMember,type StorePermission,type StoreRole} from '../../src/utils/storeSecurity.js';

export async function requireErpAgeInTransaction(tx:Transaction,uid:string){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw Error('STORE_ACCESS_DENIED');
 const control=await tx.get(adminDb.doc('erp_age_release_private/current'));
 if(!control.exists)return;
 if(control.get('schemaVersion')!==1||control.get('mode')!=='verified_adult_only')throw Error('STORE_ERP_AGE_REQUIRED');
 const age=await tx.get(adminDb.doc('age_eligibility_private/'+uid));
 if(!evaluateStoredCapabilityAgeAccess({actorUid:uid,record:age.data(),capability:'store_erp',policy:'verified_adult_only'}))throw Error('STORE_ERP_AGE_REQUIRED');
}

/** Human actions only. Provider webhook processing is not a human session. */
export async function requireHumanOrderOperation(tx:Transaction,tenantId:string,uid:string,permission:StorePermission,expectedCanonicalStoreId?:string):Promise<StoreRole>{
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(tenantId))throw Error('STORE_ACCESS_DENIED');
 await requireErpAgeInTransaction(tx,uid);
 const tenant=await tx.get(adminDb.doc('tenants/'+tenantId));
 if(tenant.exists&&tenant.get('ownerId')!==tenantId)throw Error('STORE_ACCESS_DENIED');
 const canonical=tenant.get('canonicalStoreId');
 if(expectedCanonicalStoreId!==undefined&&canonical!==expectedCanonicalStoreId)throw Error('STORE_ACCESS_DENIED');
 if(canonical!==undefined&&canonical!==null&&canonical!==''){
  if(typeof canonical!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(canonical))throw Error('STORE_ACCESS_DENIED');
  const store=await tx.get(adminDb.doc('stores/'+canonical));
  if(!store.exists||store.get('ownerId')!==tenantId||store.get('id')!==canonical)throw Error('STORE_ACCESS_DENIED');
  if(uid===tenantId)return 'owner';
  const member=parseStoreMember((await tx.get(adminDb.doc('stores/'+canonical+'/members/'+uid))).data());
  if(!member||member.storeId!==canonical||member.userId!==uid||member.status!=='active'||member.role==='owner'||!hasStorePermission(member.role,permission))throw Error('STORE_ACCESS_DENIED');
  return member.role;
 }else if(uid!==tenantId)throw Error('STORE_ACCESS_DENIED');
 return 'owner';
}

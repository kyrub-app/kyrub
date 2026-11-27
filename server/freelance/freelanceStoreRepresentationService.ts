import type {Transaction} from 'firebase-admin/firestore';
import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {getPrimaryUserStoreDocumentPath} from '../../src/utils/storePaths.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
import {projectStoreInstitutionalIdentity} from '../../shared/storeInstitutionalIdentity.js';

export type FreelanceStoreRepresentation={storeId:string;displayName:string;representativeRole:'owner'};
/** No generic ERP permission authorizes assuming a freelance obligation.
 * Owner-only candidate; no plan check, no store wallet or bank authority. */
export async function readOwnedFreelanceStore(tx:Transaction,uid:string):Promise<FreelanceStoreRepresentation|null>{
 if(!validFreelanceId(uid)||process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 !/^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_FORBIDDEN');
 const [p,t]=await tx.getAll(adminDb.doc(getPrimaryUserStoreDocumentPath(uid)),adminDb.doc('tenants/'+uid));
 const privateStore=p.data(),tenant=t.data();
 if(!privateStore||privateStore.id!==uid||privateStore.ownerId!==uid||!tenant||tenant.ownerId!==uid||
 !validFreelanceId(tenant.canonicalStoreId)||tenant.canonicalStoreId===uid||
 (privateStore.canonicalStoreId!==undefined&&privateStore.canonicalStoreId!==tenant.canonicalStoreId))return null;
 const storeId=tenant.canonicalStoreId;
 const [s,m]=await tx.getAll(adminDb.doc('stores/'+storeId),adminDb.doc('stores/'+storeId+'/members/'+uid));
 const store=s.data(),member=m.data();
 if(!store||store.ownerId!==uid||store.legacyTenantId!==uid||
 !member||member.userId!==uid||member.role!=='owner'||member.status!=='active')return null;
 const identity=projectStoreInstitutionalIdentity({...privateStore,storeId});
 if(identity.displayName.length>200)return null;
 return {storeId,displayName:identity.displayName,representativeRole:'owner'};
}
export async function requireOwnedFreelanceStore(tx:Transaction,uid:string,storeId:string){
 const store=await readOwnedFreelanceStore(tx,uid);
 if(!store||store.storeId!==storeId)throw Error('FREELANCE_STORE_FORBIDDEN');
 return store;
}

import type {Transaction} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {requireFinancialPolicyInTransaction} from './stagedFinancialAuthorization.js';

export type RefundOwnerAuthority={ownerId:string;authorization:string};
/** Only human-triggered refund operations. Webhook evidence does not depend on the operator session. */
export async function requireRefundOwnerInTransaction(tx:Transaction,storeId:string,authority:RefundOwnerAuthority){
 if(storeId!==authority.ownerId||!/^[A-Za-z0-9_-]{1,128}$/.test(storeId))throw Error('STORE_REPRESENTATION_FORBIDDEN');
 const store=await tx.get(adminDb.doc('users/'+storeId+'/stores/'+storeId));
 if(!store.exists||store.get('id')!==storeId||store.get('ownerId')!==authority.ownerId)throw Error('STORE_REPRESENTATION_FORBIDDEN');
 await requireFinancialPolicyInTransaction(tx,authority.authorization,authority.ownerId);
}
export async function requireRefundOwnerAccess(storeId:string,authority:RefundOwnerAuthority){
 await adminDb.runTransaction(tx=>requireRefundOwnerInTransaction(tx,storeId,authority));
}

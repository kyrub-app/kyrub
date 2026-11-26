import {createHash} from 'node:crypto';
import type {Firestore} from 'firebase-admin/firestore';
import {isDocumentId} from './publicSocialAddressPolicy.js';

const scopes=['social','staff','admin'] as const;
export type DirectoryQuotaScope=typeof scopes[number];
const WINDOW_MS=60_000;
const MAX_REQUESTS=12;

export type DirectoryQuotaDecision={allowed:true}|{allowed:false;retryAfterSeconds:number};

/**
 * Candidate shared limiter. One bounded document per actor and directory,
 * no search terms, email, IP or profile content. All instances must use the
 * same Firestore project. No client permission or public route is added.
 * Caller authenticates and authorizes the request; storage failure must
 * deny the lookup rather than fall back to an in-memory allowance.
 * The fixed interval starts with the first admitted request; this is not
 * a rolling-window guarantee. Limit is provisional, inherited from pilots.
 */
export async function consumeDirectoryQuota(
 db:Firestore,actorUid:string,scope:DirectoryQuotaScope,now=Date.now()
):Promise<DirectoryQuotaDecision>{
 if(!isDocumentId(actorUid)||!scopes.includes(scope)||!Number.isSafeInteger(now)||now<0||now>Number.MAX_SAFE_INTEGER-WINDOW_MS)
  throw Error('DIRECTORY_QUOTA_INVALID');
 const key=createHash('sha256').update(scope+'\0'+actorUid).digest('hex');
 const ref=db.doc('directory_quota_private/'+key);
 return db.runTransaction(async tx=>{
  const snapshot=await tx.get(ref);
  const data=snapshot.data();
  if(snapshot.exists){
   if(!data||data.version!==1||data.scope!==scope||!Number.isSafeInteger(data.startedAtMs)||
      data.startedAtMs<0||!Number.isSafeInteger(data.count)||data.count<1||data.count>MAX_REQUESTS)
    throw Error('DIRECTORY_QUOTA_INVALID_STATE');
   // A clock regression must not open a second window.
   const end=data.startedAtMs+WINDOW_MS;
   if(now<end){
    if(data.count>=MAX_REQUESTS)return {allowed:false,retryAfterSeconds:Math.max(1,Math.ceil((end-now)/1000))} as const;
    tx.update(ref,{count:data.count+1});
    return {allowed:true} as const;
   }
  }
  tx.set(ref,{version:1,scope,startedAtMs:now,count:1});
  return {allowed:true} as const;
 });
}

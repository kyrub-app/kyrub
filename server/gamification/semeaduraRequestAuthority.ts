import type { SemeaduraPostKind } from '../../shared/pitangueiraJourney.js';

export const SEMEADURA_STATUS_BATCH_LIMIT=10;
export type SemeaduraStatusTarget={kind:SemeaduraPostKind;postId:string};
export type SemeaduraRequest =
 | {action:'journey'}
 | {action:'status_batch';targets:SemeaduraStatusTarget[]}
 | {action:'status'|'semear';kind:SemeaduraPostKind;postId:string};

/** Never coerce a request's action. A status query is strictly read-only. */
export function parseSemeaduraRequest(value:unknown):SemeaduraRequest|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const body=value as Record<string,unknown>;
 const keys=Object.keys(body);
 if(body.action==='journey'&&keys.length===1&&keys[0]==='action')return {action:'journey'};
 if(body.action==='status_batch'){
  if(keys.length!==2||keys.some(k=>!['action','targets'].includes(k))||
   !Array.isArray(body.targets)||body.targets.length<1||body.targets.length>SEMEADURA_STATUS_BATCH_LIMIT)return null;
  const targets:SemeaduraStatusTarget[]=[];
  const seen=new Set<string>();
  for(const item of body.targets){
   if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==2||
    Object.keys(item).some(k=>!['kind','postId'].includes(k))||
    (item.kind!=='personal'&&item.kind!=='community')||typeof item.postId!=='string'||
    !/^[A-Za-z0-9_-]{1,500}$/.test(item.postId))return null;
   const key=JSON.stringify([item.kind,item.postId]);
   if(seen.has(key))return null;
   seen.add(key);targets.push({kind:item.kind,postId:item.postId});
  }
  return {action:'status_batch',targets};
 }
 if(keys.length!==3||keys.some(k=>!['action','kind','postId'].includes(k))||
    (body.action!=='status'&&body.action!=='semear')||
    (body.kind!=='personal'&&body.kind!=='community')||
    typeof body.postId!=='string'||!/^[A-Za-z0-9_-]{1,500}$/.test(body.postId))return null;
 return {action:body.action,kind:body.kind,postId:body.postId};
}

type ActorState={uid:string;disabled:boolean;tokensValidAfterTime?:string};
type SessionDependencies={
 verify:(token:string)=>Promise<{uid:string}>;
 getUser:(uid:string)=>Promise<ActorState>;
 actualProject:()=>string;
 expectedProject:string;
 now:()=>number;
};

/** A new seed requires a currently valid account. Canonical signature/project
 * verification comes first; claims never determine an actor before verification.
 * Auth backend errors fail closed. No email/device/age restriction is invented. */
export async function authorizeSemeaduraMutation(token:string,deps:SessionDependencies):Promise<string>{
 if(deps.actualProject()!==deps.expectedProject)throw Error('SEMEADURA_AUTH_PROJECT_MISMATCH');
 const identity=await deps.verify(token);
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid))throw Error('SEMEADURA_AUTH_INVALID');
 const parts=token.split('.');
 if(parts.length!==3)throw Error('SEMEADURA_AUTH_INVALID');
 const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')) as Record<string,unknown>;
 const now=deps.now()/1000;
 if(!claims||typeof claims!=='object'||Array.isArray(claims)||
    claims.sub!==identity.uid||claims.aud!==deps.expectedProject||
    typeof claims.exp!=='number'||!Number.isFinite(claims.exp)||claims.exp<=now||
    typeof claims.auth_time!=='number'||!Number.isFinite(claims.auth_time)||
    claims.auth_time<=0||claims.auth_time>now+300)throw Error('SEMEADURA_AUTH_INVALID');
 const account=await deps.getUser(identity.uid);
 if(account.uid!==identity.uid||account.disabled!==false)throw Error('SEMEADURA_AUTH_INVALID');
 if(account.tokensValidAfterTime!==undefined){
  const validAfter=Date.parse(account.tokensValidAfterTime);
  if(!Number.isFinite(validAfter)||claims.auth_time*1000<validAfter)throw Error('SEMEADURA_AUTH_INVALID');
 }
 return identity.uid;
}

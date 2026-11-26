import {normalizeCidSosRequest} from '../../shared/cidSosRequest.js';
import {buildTrustedCidSosProfile,type TrustedTag,type CidSosConfig,type ChannelGrant} from './cidSosPrivateConfig.js';
import {planCidSosAlert,type CidSosOccurrence,type CidSosMessage} from './cidSosAlertPolicy.js';

// Server-only contract. No concrete persistence, public API, provider or production writes.
// A future adapter must enforce real atomicity (including idempotency, rate limits, budget,
// tag state, consent and outbox keys), access controls, retention and encryption.
export type PendingSosMessage={message:CidSosMessage;status:'simulation-pending';createdAt:number};
export type PrivateSosTransaction={
 readTag(tagId:string):Promise<TrustedTag|null>;
 readConfig(tagId:string):Promise<CidSosConfig|null>;
 readGrants(tagId:string):Promise<ChannelGrant[]>;
 readOccurrence(id:string):Promise<CidSosOccurrence|null>;
 readRecent(tagId:string,after:number):Promise<CidSosOccurrence[]>;
 createOccurrence(record:CidSosOccurrence):Promise<void>;
 createPendingMessage(record:PendingSosMessage):Promise<void>;
};
export type PrivateSosStore={transaction<T>(work:(tx:PrivateSosTransaction)=>Promise<T>):Promise<T>};
const deny=():never=>{throw Error('CID_SOS_UNAVAILABLE');};
// Never expose recipient snapshots, reason, coordinates or outbox entries to anonymous callers.
// This contract is simulation-only. The eventual public service must authenticate/limit the
// emitter session, bind request identifiers, and mint a separate scoped chat invitation.
export async function recordSimulatedCidSos(store:PrivateSosStore,tagId:string,input:unknown,now:number){
 const request=normalizeCidSosRequest(input);
 if(!Number.isSafeInteger(now)||now<=0)return deny();
 return store.transaction(async tx=>{
  const tag=await tx.readTag(tagId),config=await tx.readConfig(tagId);
  if(!tag||tag.tagId!==tagId||!tag.active||!config)return deny();
  const grants=await tx.readGrants(tagId);
  const profile=buildTrustedCidSosProfile(tag,config,grants,now);
  const existing=await tx.readOccurrence(request.id);
  if(existing&&(existing.tagId!==tagId||existing.ownerId!==tag.ownerId))return deny();
  const recent=await tx.readRecent(tagId,now-86400000);
  const history=existing?[existing,...recent.filter(r=>r.id!==existing.id)]:recent;
  const plan=planCidSosAlert(profile,request,now,history);
  if(!plan.duplicate){
   await tx.createOccurrence(plan.occurrence);
   for(const message of plan.messages)await tx.createPendingMessage({message,status:'simulation-pending',createdAt:now});
  }
  return {accepted:true as const,simulated:true as const};
 });
}

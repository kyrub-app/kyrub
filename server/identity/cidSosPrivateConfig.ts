// Server-only domain contract. No endpoint, Firebase write, provider, or client-issued authorization.
// The adapter MUST authenticate the owner, reload tag state and run revision checks atomically.
import {isTagId} from '../../shared/kyrubTagContract.js';
import {CID_SOS_MAX_CONTACTS} from '../../shared/cidSosRequest.js';
import {publicCidSosCapability} from './cidSosAlertPolicy.js';
type Channel='email'|'whatsapp'|'sms';
type ChannelDraft={channel:Channel;address:string};
type Person={id:string;name:string;channels:ChannelDraft[]};
export type CidSosConfig={tagId:string;ownerId:string;revision:number;enabled:boolean;owner:Person;contacts:Person[]};
export type TrustedTag={tagId:string;ownerId:string;displayName:string;active:boolean};
// Issued only after independent proof of control AND consent for this exact tag, person, address and channel.
// The future persistence adapter must check revocation and scope from a private collection.
export type ChannelGrant={tagId:string;ownerId:string;participantId:string;channel:Channel;address:string;verifiedAt:number;consent:boolean;revokedAt?:number};
const deny=():never=>{throw Error('CID_SOS_CONFIG_FORBIDDEN');};
const invalid=():never=>{throw Error('CID_SOS_CONFIG_INVALID');};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k));
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const time=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
function person(v:unknown):Person{
 if(!object(v)||!exact(v,['id','name','channels'])||!id(v.id)||typeof v.name!=='string'||!Array.isArray(v.channels)||v.channels.length>3)return invalid();
 const name=v.name.trim().normalize('NFC');
 if(!name||name.length>80||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name))return invalid();
 const channels:ChannelDraft[]=[],seen=new Set<string>();
 for(const c of v.channels){
  if(!object(c)||!exact(c,['channel','address'])||typeof c.address!=='string'||!['email','whatsapp','sms'].includes(String(c.channel))||seen.has(String(c.channel)))return invalid();
  const channel=c.channel as Channel;
  const address=c.address.trim().toLowerCase();
  if(channel==='email'?(address.length>254||!/^ [^\s@]+@[^\s@]+\.[^\s@]+$/.test(' '+address)):!/^\+55[1-9][0-9]9[0-9]{8}$/.test(address))return invalid();
  seen.add(channel);channels.push({channel,address});
 }
 return {id:v.id,name,channels};
}
function assertOwner(tag:TrustedTag,verifiedOwnerId:string){
 if(!tag||!isTagId(tag.tagId)||!id(tag.ownerId)||tag.ownerId!==verifiedOwnerId)return deny();
}
export function prepareCidSosConfig(tag:TrustedTag,verifiedOwnerId:string,previous:CidSosConfig|null,input:unknown):CidSosConfig{
 assertOwner(tag,verifiedOwnerId);
 if(previous&&(previous.tagId!==tag.tagId||previous.ownerId!==tag.ownerId))return deny();
 if(!object(input)||!exact(input,['expectedRevision','enabled','owner','contacts'])||!Number.isSafeInteger(input.expectedRevision)||typeof input.enabled!=='boolean'||!Array.isArray(input.contacts)||input.contacts.length>CID_SOS_MAX_CONTACTS)return invalid();
 const revision=previous?.revision??0;
 if(input.expectedRevision!==revision||!Number.isSafeInteger(revision+1))throw Error('CID_SOS_CONFIG_CONFLICT');
 const owner=person(input.owner),contacts=input.contacts.map(person);
 if(owner.id!==tag.ownerId)return deny();
 const seenIds=new Set<string>(),addresses=new Map<string,string>();
 for(const p of [owner,...contacts]){
  if(seenIds.has(p.id))return invalid();seenIds.add(p.id);
  for(const c of p.channels){
   const key=(c.channel==='email'?'email:':'phone:')+c.address;
   if(addresses.has(key)&&addresses.get(key)!==p.id)return invalid();
   addresses.set(key,p.id);
  }
 }
 return {tagId:tag.tagId,ownerId:tag.ownerId,revision:revision+1,enabled:input.enabled,owner,contacts};
}
export function buildTrustedCidSosProfile(tag:TrustedTag,config:CidSosConfig,grants:readonly ChannelGrant[],now:number){
 if(!time(now)||config.tagId!==tag.tagId||config.ownerId!==tag.ownerId||config.owner.id!==tag.ownerId)return deny();
 function verifiedPerson(p:Person){
  return {id:p.id,channels:p.channels.flatMap(c=>{
   const candidates=grants.filter(g=>g.tagId===tag.tagId&&g.ownerId===tag.ownerId&&g.participantId===p.id&&g.channel===c.channel&&g.address===c.address);
   // Conflicting or revoked evidence is never resolved by selecting a stale positive grant.
   if(candidates.length!==1)return [];
   const g=candidates[0];
   return g.consent===true&&g.revokedAt===undefined&&time(g.verifiedAt)&&g.verifiedAt<=now?[{...c,consent:true,verifiedAt:g.verifiedAt}]:[];
  })};
 }
 return {tagId:tag.tagId,ownerId:tag.ownerId,displayName:tag.displayName,active:tag.active,enabled:config.enabled,owner:verifiedPerson(config.owner),contacts:config.contacts.map(verifiedPerson)};
}
export function projectPublicCidSos(tag:TrustedTag,config:CidSosConfig|null,grants:readonly ChannelGrant[],now:number){
 try{return config?publicCidSosCapability(buildTrustedCidSosProfile(tag,config,grants,now),now):{available:false,smsAvailable:false};}catch{return {available:false,smsAvailable:false};}
}
// Never return raw grants or participant details through public endpoints.
export function readPrivateCidSosConfig(tag:TrustedTag,verifiedOwnerId:string,config:CidSosConfig|null){
 assertOwner(tag,verifiedOwnerId);
 if(config&&(config.tagId!==tag.tagId||config.ownerId!==tag.ownerId))return deny();
 return config?structuredClone(config):null;
}

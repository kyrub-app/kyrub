import {isOpenPromotionalTag,normalizePromotionalPresentation,type PromotionalTagPresentation} from '../../shared/kyrubTagPromotional.js';
import type {TagPasskeyPurpose} from './kyrubTagPasskeyPolicy.js';
import type {StoredTagPasskey} from './kyrubTagPasskeyVerifier.js';
export type PasskeyMutation='register'|'edit'|'block'|'unblock'|'rotate-recovery'|'recover'|'link-account';
export type PasskeyTagState=Record<string,unknown>;
export function assertPasskeyTagState(data:PasskeyTagState|undefined,purpose:TagPasskeyPurpose){
 if(purpose==='register'){
  if(!isOpenPromotionalTag(data)||data?.ownerAuthMode!=null)throw Error('TAG_FORBIDDEN');
  return;
 }
 if(!data||data.distribution!=='promotional'||data.ownerAuthMode!=='passkey'||
 typeof data.ownerId!=='string'||!/^tagpk_[A-Za-z0-9_-]{43}$/.test(data.ownerId)||
 (data.manufacturingState!==undefined&&data.manufacturingState!=='released'))throw Error('TAG_FORBIDDEN');
 if(purpose==='edit'&&data.blocked===true)throw Error('TAG_FORBIDDEN');
 if(purpose==='block'&&data.blocked===true)throw Error('TAG_FORBIDDEN');
 if(purpose==='unblock'&&data.blocked!==true)throw Error('TAG_FORBIDDEN');
}
export function isPasskeyMutation(value:unknown):value is PasskeyMutation{
 return typeof value==='string'&&['register','edit','block','unblock','rotate-recovery','recover','link-account'].includes(value);
}
// In the first pilot, only textual presentation and validated public destinations.
// No uploads, SOS contacts, account linkage or legacy auth bypass.
export function normalizePasskeyMutation(purpose:PasskeyMutation,input:unknown):PromotionalTagPresentation|null{
 if(purpose!=='register'&&purpose!=='edit'){
  if(input!==undefined&&input!==null)throw Error('TAG_INVALID');
  return null;
 }
 const result=normalizePromotionalPresentation(input);
 if(result.emergencyContacts!==undefined||result.coverPath!==undefined||result.avatarPath!==undefined)throw Error('TAG_PRESENTATION_INVALID');
 if(purpose==='register'&&result.pix!==undefined)throw Error('TAG_PRESENTATION_INVALID');
 if(!result.name)throw Error('TAG_PRESENTATION_INVALID');
 return result;
}
export function assertSamePasskeyCredential(before:StoredTagPasskey,current:StoredTagPasskey){
 if(before.id!==current.id||before.publicKey!==current.publicKey||before.counter!==current.counter||
 before.userHandle!==current.userHandle||before.backedUp!==current.backedUp)throw Error('TAG_CHANGED');
}

// Recovery authorizes a new credential, never the public tag identifier alone.
export function assertRecoveryCredentialReplacement(oldCredential:StoredTagPasskey,newCredential:StoredTagPasskey){
 if(oldCredential.id===newCredential.id||oldCredential.publicKey===newCredential.publicKey||oldCredential.userHandle===newCredential.userHandle)throw Error('TAG_FORBIDDEN');
}

export function assertTagAccountLink(data:PasskeyTagState|undefined,actor:unknown){
 assertPasskeyTagState(data,'link-account');
 if(typeof actor!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(actor)||actor.startsWith('tagpk_')||
  (data?.linkedAccountId!=null&&data.linkedAccountId!==actor))throw Error('TAG_FORBIDDEN');
}

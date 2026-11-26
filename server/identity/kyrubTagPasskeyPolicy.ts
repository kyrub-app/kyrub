import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {isTagId} from '../../shared/kyrubTagContract.js';

// Policy only. This module does not verify a WebAuthn signature or grant access.
// The transport must use a vetted WebAuthn verifier, a transactional challenge
// store and the existing isolated-project guard before enabling any ceremony.
export const TAG_PASSKEY_TTL_MS=5*60*1000;
export const TAG_PASSKEY_USER_VERIFICATION='required' as const;
export const TAG_PASSKEY_REQUIRE_USER_VERIFICATION=true;
export type TagPasskeyPurpose='register'|'edit'|'block'|'unblock'|'rotate-recovery'|'recover'|'link-account';
type Scope={origin:string;rpId:string};
const opaque=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const ownerValid=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const credentialValid=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,1400}$/.test(v);
const purposes=new Set<string>(['register','edit','block','unblock','rotate-recovery','recover','link-account']);

// Trust the configured, exact canonical origin, never a request Host header.
// Preview credentials must be scoped to the fixed isolated hostname, not to
// vercel.app or kyrub.com. Production is deliberately not authorized here.
export function isolatedTagPasskeyScope(configuredOrigin:string,requestOrigin:string):Scope{
 let origin:URL;
 try{origin=new URL(configuredOrigin);}catch{throw Error('TAG_PASSKEY_ORIGIN');}
 if(origin.origin!==configuredOrigin||requestOrigin!==configuredOrigin||origin.protocol!=='https:'||
  !/^[a-z0-9-]+\.vercel\.app$/.test(origin.hostname)||origin.port||origin.username||origin.password)
  throw Error('TAG_PASSKEY_ORIGIN');
 return {origin:origin.origin,rpId:origin.hostname};
}
type Binding={tagId:string;purpose:TagPasskeyPurpose;ownerId:string|null;credentialId:string|null;scope:Scope};
export type TagPasskeyChallenge=Binding&{id:string;challenge:string;issuedAt:number;expiresAt:number;usedAt:number|null};
function validateBinding(binding:Binding){
 if(!isTagId(binding.tagId)||!purposes.has(binding.purpose))throw Error('TAG_PASSKEY_SCOPE');
 isolatedTagPasskeyScope(binding.scope.origin,binding.scope.origin);
 if(binding.scope.rpId!==new URL(binding.scope.origin).hostname)throw Error('TAG_PASSKEY_SCOPE');
 if(binding.purpose==='register'?(binding.ownerId!==null||binding.credentialId!==null):(!ownerValid(binding.ownerId)||!credentialValid(binding.credentialId)))throw Error('TAG_PASSKEY_SCOPE');
}
export function issueTagPasskeyChallenge(binding:Binding,now=Date.now()):TagPasskeyChallenge{
 validateBinding(binding);
 if(!Number.isSafeInteger(now)||now<0)throw Error('TAG_PASSKEY_TIME');
 return {...binding,scope:{...binding.scope},id:randomBytes(32).toString('base64url'),challenge:randomBytes(32).toString('base64url'),issuedAt:now,expiresAt:now+TAG_PASSKEY_TTL_MS,usedAt:null};
}

// Call within the same transaction that marks usedAt. Never accept client
// supplied ownership/credential identifiers as the authoritative binding.
export function assertUnusedTagPasskeyChallenge(record:TagPasskeyChallenge,expected:Binding,now=Date.now()):void{
 validateBinding(expected);
 if(!opaque(record.id)||!opaque(record.challenge)||record.usedAt!==null||
 !Number.isSafeInteger(record.issuedAt)||!Number.isSafeInteger(record.expiresAt)||!Number.isSafeInteger(now)||
 record.expiresAt-record.issuedAt!==TAG_PASSKEY_TTL_MS||now<record.issuedAt||now>=record.expiresAt||
 record.tagId!==expected.tagId||record.purpose!==expected.purpose||record.ownerId!==expected.ownerId||
 record.credentialId!==expected.credentialId||record.scope.origin!==expected.scope.origin||record.scope.rpId!==expected.scope.rpId)
 throw Error('TAG_PASSKEY_CHALLENGE_INVALID');
}

// A recovery secret is separate from the public tag ID. Display once; persist
// only the domain-separated digest. Rotate atomically after successful recovery.
export function newTagPasskeyRecoveryCode():string{return randomBytes(32).toString('base64url');}
export function tagPasskeyRecoveryHash(tagId:string,secret:string):string{
 if(!isTagId(tagId)||!opaque(secret))throw Error('TAG_PASSKEY_RECOVERY_INVALID');
 return createHash('sha256').update('kyrub-tag-passkey-recovery-v1:'+tagId+':'+secret).digest('hex');
}
export function matchesTagPasskeyRecovery(tagId:string,secret:string,storedHash:string):boolean{
 if(!isTagId(tagId)||!opaque(secret)||!(/^[a-f0-9]{64}$/.test(storedHash)))return false;
 return timingSafeEqual(Buffer.from(tagPasskeyRecoveryHash(tagId,secret),'hex'),Buffer.from(storedHash,'hex'));
}

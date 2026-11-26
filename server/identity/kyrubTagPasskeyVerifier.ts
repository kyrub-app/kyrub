import {generateRegistrationOptions,generateAuthenticationOptions,verifyRegistrationResponse,verifyAuthenticationResponse,type RegistrationResponseJSON,type AuthenticationResponseJSON} from '@simplewebauthn/server';
import {assertUnusedTagPasskeyChallenge,TAG_PASSKEY_USER_VERIFICATION,TAG_PASSKEY_REQUIRE_USER_VERIFICATION,type TagPasskeyChallenge} from './kyrubTagPasskeyPolicy.js';

// These adapters prove a ceremony only. No route, database write, session or
// ownership grant is exposed by this module. A transaction must consume the
// challenge and apply the bound operation after successful verification.
export type StoredTagPasskey={id:string;publicKey:string;counter:number;userHandle:string;backedUp:boolean};
function assertFresh(record:TagPasskeyChallenge,now:number){
 assertUnusedTagPasskeyChallenge(record,{tagId:record.tagId,purpose:record.purpose,ownerId:record.ownerId,credentialId:record.credentialId,scope:record.scope},now);
}
function registrationOnly(record:TagPasskeyChallenge,now:number){
 assertFresh(record,now);
 if(record.purpose!=='register'&&record.purpose!=='recover')throw Error('TAG_PASSKEY_SCOPE');
}
function authenticationOnly(record:TagPasskeyChallenge,credential:StoredTagPasskey,now:number){
 assertFresh(record,now);
 if(record.purpose==='register'||record.purpose==='recover'||record.credentialId!==credential.id||!credential.id||
 !/^[A-Za-z0-9_-]+$/.test(credential.publicKey)||!Number.isSafeInteger(credential.counter)||credential.counter<0||
 !/^[A-Za-z0-9_-]{43}$/.test(credential.userHandle))throw Error('TAG_PASSKEY_SCOPE');
}
export async function tagRegistrationOptions(record:TagPasskeyChallenge,now=Date.now()){
 registrationOnly(record,now);
 return generateRegistrationOptions({rpName:'Kyrub',rpID:record.scope.rpId,
 // Random, non-identifying user handle per registration. The tag URL is public,
 // but is not the secret handle or the credential identifier.
 userID:Buffer.from(record.id,'base64url'),userName:'Kyrub Tag '+record.tagId.slice(0,8),
 userDisplayName:'Minha Kyrub Tag',challenge:Buffer.from(record.challenge,'base64url'),
 attestationType:'none',...(record.purpose==='recover'&&record.credentialId?{excludeCredentials:[{id:record.credentialId}]}:{}),timeout:Math.min(120000,record.expiresAt-now),
 authenticatorSelection:{residentKey:'required',userVerification:TAG_PASSKEY_USER_VERIFICATION},
 supportedAlgorithmIDs:[-7,-257]});
}
export async function verifyTagRegistration(record:TagPasskeyChallenge,response:RegistrationResponseJSON,now=Date.now()):Promise<StoredTagPasskey>{
 registrationOnly(record,now);
 const result=await verifyRegistrationResponse({response,expectedChallenge:record.challenge,
 expectedOrigin:record.scope.origin,expectedRPID:record.scope.rpId,requireUserVerification:TAG_PASSKEY_REQUIRE_USER_VERIFICATION,requireUserPresence:true});
 if(!result.verified||!result.registrationInfo)throw Error('TAG_PASSKEY_INVALID');
 const info=result.registrationInfo,c=info.credential;
 return {id:c.id,publicKey:Buffer.from(c.publicKey).toString('base64url'),counter:c.counter,userHandle:record.id,backedUp:info.credentialBackedUp};
}
export async function tagAuthenticationOptions(record:TagPasskeyChallenge,credential:StoredTagPasskey,now=Date.now()){
 authenticationOnly(record,credential,now);
 return generateAuthenticationOptions({rpID:record.scope.rpId,challenge:Buffer.from(record.challenge,'base64url'),
 allowCredentials:[{id:credential.id}],userVerification:TAG_PASSKEY_USER_VERIFICATION,
 timeout:Math.min(120000,record.expiresAt-now)});
}
export async function verifyTagAuthentication(record:TagPasskeyChallenge,credential:StoredTagPasskey,response:AuthenticationResponseJSON,now=Date.now()):Promise<StoredTagPasskey>{
 authenticationOnly(record,credential,now);
 if(response.id!==credential.id||response.rawId!==credential.id||
 (response.response.userHandle!=null&&response.response.userHandle!==credential.userHandle))throw Error('TAG_PASSKEY_INVALID');
 const result=await verifyAuthenticationResponse({response,expectedChallenge:record.challenge,expectedOrigin:record.scope.origin,
 expectedRPID:record.scope.rpId,requireUserVerification:TAG_PASSKEY_REQUIRE_USER_VERIFICATION,
 credential:{id:credential.id,publicKey:Uint8Array.from(Buffer.from(credential.publicKey,'base64url')),counter:credential.counter}});
 if(!result.verified||!result.authenticationInfo.userVerified)throw Error('TAG_PASSKEY_INVALID');
 return {...credential,counter:result.authenticationInfo.newCounter,backedUp:result.authenticationInfo.credentialBackedUp};
}

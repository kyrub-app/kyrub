import {browserSupportsWebAuthn,startRegistration,startAuthentication} from '@simplewebauthn/browser';
type RegistrationOptions=Parameters<typeof startRegistration>[0]['optionsJSON'];
type AuthenticationOptions=Parameters<typeof startAuthentication>[0]['optionsJSON'];
// UI adapters only. The server, not this result, authorizes publication.
export function supportsKyrubTagPasskey():boolean{return browserSupportsWebAuthn();}
export async function createKyrubTagPasskey(optionsJSON:RegistrationOptions){
 if(!supportsKyrubTagPasskey())throw Error('TAG_PASSKEY_UNSUPPORTED');
 return startRegistration({optionsJSON});
}
export async function confirmKyrubTagPasskey(optionsJSON:AuthenticationOptions){
 if(!supportsKyrubTagPasskey())throw Error('TAG_PASSKEY_UNSUPPORTED');
 return startAuthentication({optionsJSON});
}

export type TagPasskeyAction='register'|'edit'|'block'|'unblock'|'rotate-recovery'|'recover';
export async function runKyrubTagPasskey(tagId:string,purpose:TagPasskeyAction,presentation?:unknown,recoveryCode?:string){
 if(!/^[a-f0-9]{32}$/.test(tagId)||!supportsKyrubTagPasskey())throw Error('TAG_PASSKEY_UNSUPPORTED');
 const url='/api/health?transport=kyrub-tag-passkey&id='+encodeURIComponent(tagId);
 async function call(body:Record<string,unknown>){
  const res=await fetch(url,{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const value=await res.json();
  if(!res.ok)throw Error(typeof value?.error==='string'?value.error:'TAG_PASSKEY_FORBIDDEN');
  return value;
 }
 const begin=await call({action:'begin',purpose,...(presentation===undefined?{}:{presentation}),...(recoveryCode===undefined?{}:{recoveryCode})});
 if(!/^[A-Za-z0-9_-]{43}$/.test(begin.challengeId)||!begin.options)throw Error('TAG_PASSKEY_FORBIDDEN');
 const response=purpose==='register'||purpose==='recover'?await createKyrubTagPasskey(begin.options):await confirmKyrubTagPasskey(begin.options);
 const result=await call({action:'finish',challengeId:begin.challengeId,response,...(recoveryCode===undefined?{}:{recoveryCode})});
 if(result.tagId!==tagId||result.purpose!==purpose||!(result.recoveryCode===null||/^[A-Za-z0-9_-]{43}$/.test(result.recoveryCode)))throw Error('TAG_PASSKEY_FORBIDDEN');
 return {recoveryCode:result.recoveryCode as string|null};
}

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

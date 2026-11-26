import { adminAuth } from '../firebaseAdmin.js';
import { evaluateKyrubMfa, type SecurityResponsibility } from '../../shared/kyrubMfaPolicy.js';
/** Called by a protected operation after its authoritative role is resolved.
 * Does not enroll MFA or grant administrative/financial roles. */
export async function requireKyrubSessionMfa(authorization:string,responsibility:SecurityResponsibility,maxAgeSeconds:number){
 const token=/^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
 if(!token||token.length>8192)throw Error('authentication_required');
 const identity=await adminAuth.verifyIdToken(token,true);
 const result=evaluateKyrubMfa({authenticated:true,responsibility,
  secondFactor:identity.firebase?.sign_in_second_factor,authTimeSeconds:identity.auth_time,
  nowSeconds:Math.floor(Date.now()/1000),maxAgeSeconds});
 if(result!=='allowed')throw Error(result);
 return identity;
}

import {
  multiFactor, TotpMultiFactorGenerator, getMultiFactorResolver,
  type Auth, type User, type TotpSecret, type MultiFactorError, type MultiFactorResolver,
} from 'firebase/auth';

function requireCurrentVerifiedUser(auth:Auth,user:User):void{
 if(auth.currentUser!==user||!user.emailVerified||!user.email)throw Error('MFA_VERIFIED_SESSION_REQUIRED');
}
export function validateKyrubTotpCode(value:unknown):string{
 if(typeof value!=='string'||!/^\d{6}$/.test(value))throw Error('MFA_CODE_INVALID');
 return value;
}
export function isKyrubMfaChallenge(error:unknown):error is MultiFactorError{
 return !!error&&typeof error==='object'&&'code' in error&&error.code==='auth/multi-factor-auth-required';
}
export function listTotpFactors(resolver:Pick<MultiFactorResolver,'hints'>){
 return resolver.hints.filter(factor=>factor.factorId===TotpMultiFactorGenerator.FACTOR_ID)
  .map(factor=>({id:factor.uid,label:factor.displayName||'Aplicativo autenticador'}));
}
/**
 * Provider adapter only. Not mounted until the isolated Identity Platform
 * configuration and full sign-in/recovery flow have been reviewed.
 * The caller must reauthenticate before enrollment and keep secrets only in
 * transient memory. No localStorage, database, analytics or logging.
 */
export async function beginKyrubTotpEnrollment(auth:Auth,user:User):Promise<TotpSecret>{
 requireCurrentVerifiedUser(auth,user);
 const session=await multiFactor(user).getSession();
 requireCurrentVerifiedUser(auth,user);
 const secret=await TotpMultiFactorGenerator.generateSecret(session);
 requireCurrentVerifiedUser(auth,user);
 return secret;
}
export async function finishKyrubTotpEnrollment(auth:Auth,user:User,secret:TotpSecret,code:unknown):Promise<void>{
 requireCurrentVerifiedUser(auth,user);
 const assertion=TotpMultiFactorGenerator.assertionForEnrollment(secret,validateKyrubTotpCode(code));
 await multiFactor(user).enroll(assertion,'Kyrub');
 requireCurrentVerifiedUser(auth,user);
 // Enrollment is not evidence of a completed second-factor sign-in.
 // Only a fresh Firebase-issued session can satisfy protected server routes.
}
export function resolveKyrubTotpChallenge(auth:Auth,error:unknown):MultiFactorResolver{
 if(!isKyrubMfaChallenge(error))throw Error('MFA_CHALLENGE_INVALID');
 const resolver=getMultiFactorResolver(auth,error);
 if(!listTotpFactors(resolver).length)throw Error('MFA_FACTOR_UNSUPPORTED');
 return resolver;
}
export async function completeKyrubTotpChallenge(auth:Auth,resolver:MultiFactorResolver,factorId:string,code:unknown){
 const factor=resolver.hints.find(hint=>hint.uid===factorId&&hint.factorId===TotpMultiFactorGenerator.FACTOR_ID);
 if(!factor)throw Error('MFA_FACTOR_UNSUPPORTED');
 const initialUser=auth.currentUser;
 const assertion=TotpMultiFactorGenerator.assertionForSignIn(factor.uid,validateKyrubTotpCode(code));
 const result=await resolver.resolveSignIn(assertion);
 if(auth.currentUser?.uid!==result.user.uid||(initialUser&&initialUser.uid!==result.user.uid))throw Error('MFA_SESSION_CHANGED');
 return result.user;
}

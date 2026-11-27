import type {PrivacyContext,PrivacyRight} from './privacyRights';
export type PrivacyVerificationRoute='existing-account'|'cid-passkey'|'individual-review';
export type PrivacyIdentityEvidenceState='awaiting-evidence'|'account-control-confirmed';
export const PRIVACY_VERIFICATION_ROUTES:Record<PrivacyContext,PrivacyVerificationRoute>={ecosystem:'existing-account',cid:'cid-passkey',thirdParty:'individual-review'};
export function privacyVerificationPlan(context:PrivacyContext,right:PrivacyRight){
 const route=PRIVACY_VERIFICATION_ROUTES[context];
 if(!route)throw Error('PRIVACY_VERIFICATION_INVALID');
 // A proof of control does not determine legal identity, authority to represent
 // another subject, entitlement to records, or grounds for irreversible actions.
 return {route,right,requiresIndividualAssessment:true as const,authorizesExecution:false as const};
}

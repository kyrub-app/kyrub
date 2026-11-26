import {ageScreeningEmulatorsReady} from './ageScreeningRouter.js';
import {getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {requireKyrubSessionMfa} from './kyrubMfaAuthorization.js';
import {loadOwnerStoreInstitutionalRepresentation} from '../store/storeInstitutionalIdentityService.js';

/** Only a reviewed emulator boundary; never silently activate in production. */
export async function requireFinancialMfaPreviewOwner(authorization:string,storeId:string):Promise<string>{
 if(!ageScreeningEmulatorsReady(process.env)||getFirebaseAdminProjectId()!=='demo-kyrub-onboarding'||process.env.KYRUB_FINANCIAL_MFA_PREVIEW_ENABLED!=='true')throw Error('FINANCIAL_MFA_PREVIEW_UNAVAILABLE');
 const identity=await requireKyrubSessionMfa(authorization,'ordinary',300);
 await loadOwnerStoreInstitutionalRepresentation({storeId,authenticatedUserId:identity.uid});
 const protectedSession=await requireKyrubSessionMfa(authorization,'financial',300);
 if(protectedSession.uid!==identity.uid)throw Error('STORE_REPRESENTATION_FORBIDDEN');
 return identity.uid;
}

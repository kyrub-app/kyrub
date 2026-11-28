import {adminAuth,adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId,type FreelanceOffer} from '../../shared/freelanceLifecycle.js';
import {assertFreelanceEngagementAllowed} from './freelanceEngagementRestrictionService.js';

export function freelanceEngagementPilotEnabled(env:NodeJS.ProcessEnv=process.env){
 return env.KYRUB_FREELANCE_ENGAGEMENT_PILOT_ENABLED==='true'&&env.KYRUB_FREELANCE_PRODUCTION_READ_ENABLED==='true'&&env.VERCEL==='1'&&env.VERCEL_ENV==='production'&&env.NODE_ENV==='production'&&
 !env.FIRESTORE_EMULATOR_HOST&&!env.FIREBASE_AUTH_EMULATOR_HOST&&!env.GOOGLE_APPLICATION_CREDENTIALS&&env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION!=='true'&&env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION!=='true';
}
export function freelanceEngagementPilotAllows(uid:string,env:NodeJS.ProcessEnv=process.env){
 const ids=(env.KYRUB_FREELANCE_PILOT_UIDS??'').split(',').map(s=>s.trim()).filter(Boolean);
 return validFreelanceId(uid)&&!uid.startsWith('tagpk_')&&ids.length>0&&ids.length<=20&&ids.every(validFreelanceId)&&ids.includes(uid);
}
export function assertEngagementPilotAuthority(uid:string){
 if(!freelanceEngagementPilotEnabled()||!freelanceEngagementPilotAllows(uid)||getFirebaseAdminProjectId()!=='kyrub-b8d0e'||adminAuth.app.options.projectId!=='kyrub-b8d0e'||(adminDb as typeof adminDb&{projectId?:string}).projectId!=='kyrub-b8d0e')throw Error('FREELANCE_FORBIDDEN');
}
/** Fixed-price, personal requester and external Pix only in this candidate.
 * Other modes keep their existing gates. No contract confirmation or payment. */
export function assertEngagementPilotTerms(offer:Pick<FreelanceOffer,'paymentTerms'|'workTerms'|'requesterStore'>){
 if(offer.paymentTerms?.method!=='external_pix'||offer.workTerms?.mode!=='fixed'||offer.requesterStore!==undefined)throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
}
export async function assertEngagementPilotParticipants(tx:FirebaseFirestore.Transaction,participants:ReadonlyArray<{uid:string;role:'requester'|'freelancer'}>){
 for(const p of participants){
  assertEngagementPilotAuthority(p.uid);
  const user=await adminAuth.getUser(p.uid);
  if(user.disabled||!user.emailVerified)throw Error('FREELANCE_FORBIDDEN');
  const [age,identity,account,marker]=await tx.getAll(adminDb.doc('age_eligibility_private/'+p.uid),adminDb.doc('identity_verifications/'+p.uid),adminDb.doc('users/'+p.uid),adminDb.doc('kyrub_tag_minimal_identities/'+p.uid));
  const roles=identity.get('approvedProfiles');
  if(!account.exists||marker.get('mode')==='tag_only'||age.get('uid')!==p.uid||age.get('status')!=='verified_adult'||identity.get('status')!=='approved'||!Array.isArray(roles)||!roles.includes(p.role))throw Error('IDENTITY_VERIFICATION_REQUIRED');
 }
 await assertFreelanceEngagementAllowed(tx,...participants.map(p=>p.uid));
}

/** Contract preparation requires a separate explicit gate. No HTTP route in this parcel. */
export function freelanceContractPilotEnabled(env:NodeJS.ProcessEnv=process.env){
 return freelanceEngagementPilotEnabled(env)&&env.KYRUB_FREELANCE_CONTRACT_PILOT_ENABLED==='true'&&env.KYRUB_PERSONAL_PIX_PILOT_ENABLED==='true';
}
export function assertContractPilotTerms(offer:Pick<FreelanceOffer,'paymentTerms'|'workTerms'|'requesterStore'>){
 assertEngagementPilotTerms(offer);
 if(offer.paymentTerms?.timing!=='on_completion')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
}

/** Never admit a new job without the existing financial-resolution authority. */
export function freelanceAdmissionReady(env:NodeJS.ProcessEnv=process.env){
 return freelanceContractPilotEnabled(env)&&env.KYRUB_FREELANCE_ADMIN_REVIEW_PILOT_ENABLED==='true';
}
export function assertFreelanceAdmissionReady(){
 if(!freelanceAdmissionReady())throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
}

import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId,type FreelanceOffer} from '../../shared/freelanceLifecycle.js';
export const FREELANCE_PRODUCTION_PROJECT='kyrub-b8d0e';
export function freelanceProductionReadEnabled(env:NodeJS.ProcessEnv=process.env){
 return env.KYRUB_FREELANCE_PRODUCTION_READ_ENABLED==='true'&&env.VERCEL==='1'&&env.VERCEL_ENV==='production'&&
 env.NODE_ENV==='production'&&!env.FIRESTORE_EMULATOR_HOST&&!env.FIREBASE_AUTH_EMULATOR_HOST&&
 !env.GOOGLE_APPLICATION_CREDENTIALS&&env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION!=='true'&&env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION!=='true';
}
export function freelancePilotAllowed(env:NodeJS.ProcessEnv,uid:string){
 const allowed=(env.KYRUB_FREELANCE_PILOT_UIDS??'').split(',').map(x=>x.trim()).filter(Boolean);
 return allowed.length>0&&allowed.length<=20&&allowed.every(validFreelanceId)&&allowed.includes(uid)&&!uid.startsWith('tagpk_');
}
export function freelancePrecontractEnabled(env:NodeJS.ProcessEnv=process.env){
 return freelanceProductionReadEnabled(env)&&env.KYRUB_FREELANCE_PRODUCTION_PRECONTRACT_ENABLED==='true';
}
export function assertProductionPrecontractTerms(offer:Pick<FreelanceOffer,'workTerms'|'paymentTerms'>){
 if(!offer.workTerms||offer.paymentTerms?.method!=='external_pix'||(offer.workTerms.mode==='hourly'&&offer.paymentTerms.timing!=='on_completion'))throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
}
export function assertProductionPilot(uid:string,write:boolean){
 if(!(write?freelancePrecontractEnabled():freelanceProductionReadEnabled())||!freelancePilotAllowed(process.env,uid)||
 getFirebaseAdminProjectId()!==FREELANCE_PRODUCTION_PROJECT||(adminDb as typeof adminDb&{projectId?:string}).projectId!==FREELANCE_PRODUCTION_PROJECT)throw Error('FREELANCE_FORBIDDEN');
}
export async function assertProductionPrecontractParties(tx:FirebaseFirestore.Transaction,...uids:string[]){
 const unique=[...new Set(uids)];
 for(const uid of unique)assertProductionPilot(uid,true);
 const docs=await tx.getAll(...unique.map(uid=>adminDb.doc('age_eligibility_private/'+uid)));
 if(docs.some((doc,i)=>doc.get('uid')!==unique[i]||doc.get('status')!=='verified_adult'))throw Error('IDENTITY_VERIFICATION_REQUIRED');
}

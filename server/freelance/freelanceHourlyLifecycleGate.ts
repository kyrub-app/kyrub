import {getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import type {FreelanceOffer} from '../../shared/freelanceLifecycle.js';
/** Explicit opt-in only for disposable integration tests, never production.
 * Keep disabled by default until cancellation/excess review and UI are ready. */
export function assertHourlyLifecycleCandidate(offer:Pick<FreelanceOffer,'workTerms'|'paymentTerms'>):boolean{
 if(offer.workTerms?.mode!=='hourly')return false;
 if(process.env.KYRUB_FREELANCE_HOURLY_LIFECYCLE_TEST_ONLY!=='true'||process.env.NODE_ENV!=='test'||
 process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION!=='true'||process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION!=='true'||
 process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 !['127.0.0.1:8088','localhost:8088'].includes(process.env.FIRESTORE_EMULATOR_HOST??'')||
 !['127.0.0.1:9099','localhost:9099'].includes(process.env.FIREBASE_AUTH_EMULATOR_HOST??'')||getFirebaseAdminProjectId()!=='kyrub-security-test'||
 offer.paymentTerms?.method!=='external_pix'||offer.paymentTerms.timing!=='on_completion')throw Error('FREELANCE_WORK_MODE_NOT_ENABLED');
 return true;
}

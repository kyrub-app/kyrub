import {adminAuth,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {reservedTribePilotEnvironmentAllowed,RESERVED_TRIBE_EMULATOR_PROJECT} from '../identity/reservedTribePilotTransport.js';

/** Only the dedicated local Express harness may select this adapter.
 * No bypass, caller-supplied uid or fallback to production verification. */
export function notificationInboxEmulatorAllowed(env:Record<string,string|undefined>):boolean{
 return env.KYRUB_RESERVED_TRIBE_NOTIFICATION_E2E==='true'&&reservedTribePilotEnvironmentAllowed(env)&&
  env.NODE_ENV==='test'&&env.GCLOUD_PROJECT===RESERVED_TRIBE_EMULATOR_PROJECT&&
  env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099'&&env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8088'&&
  !env.FIREBASE_SERVICE_ACCOUNT_JSON&&!env.GOOGLE_APPLICATION_CREDENTIALS;
}
export async function verifyNotificationInboxEmulatorIdentity(token:string):Promise<{uid:string}>{
 try{
  if(!notificationInboxEmulatorAllowed(process.env)||getFirebaseAdminProjectId()!==RESERVED_TRIBE_EMULATOR_PROJECT)throw Error('AUTH_REQUIRED');
  const identity=await adminAuth.verifyIdToken(token,true);
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(identity.uid)||identity.email_verified!==true)throw Error('AUTH_REQUIRED');
  return {uid:identity.uid};
 }catch{throw Error('AUTH_REQUIRED');}
}

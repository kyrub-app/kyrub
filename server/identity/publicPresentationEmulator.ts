import {getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {reservedTribePilotEnvironmentAllowed,RESERVED_TRIBE_EMULATOR_PROJECT} from './reservedTribePilotTransport.js';

/** Local browser harness only. No Firebase writes or alternate token verifier. */
export function publicPresentationEmulatorAllowed(env:Record<string,string|undefined>):boolean{
 return env.KYRUB_PUBLIC_PRESENTATION_E2E==='true'&&reservedTribePilotEnvironmentAllowed(env)&&
  env.NODE_ENV==='test'&&env.GCLOUD_PROJECT===RESERVED_TRIBE_EMULATOR_PROJECT&&
  env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099'&&env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8088'&&
  !env.GOOGLE_APPLICATION_CREDENTIALS&&!env.FIREBASE_SERVICE_ACCOUNT_JSON;
}
export function publicPresentationEmulatorRuntimeAllowed():boolean{
 try{return publicPresentationEmulatorAllowed(process.env)&&getFirebaseAdminProjectId()===RESERVED_TRIBE_EMULATOR_PROJECT;}
 catch{return false;}
}
export function publicPresentationReadTransport(query:Record<string,unknown>):boolean{
 return query.transport==='public-kyrub-tag'||(query.transport==='manage-kyrub-tag'&&query.view==='identity'&&query.id===undefined);
}

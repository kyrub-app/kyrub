import {getFirebaseAdminProjectId} from '../firebaseAdmin.js';

export const KYRUB_PRODUCTION_PROJECT_ID='kyrub-b8d0e';

const isLocalEmulatorHost=(value:string|undefined)=>
 typeof value==='string'&&/^(localhost|127\.0\.0\.1):[1-9][0-9]{1,4}$/.test(value);

export type TagPilotIsolation='emulator'|'isolated-project'|'unsafe';

/**
 * Server-side kill switch independent from the UI and the promotional flags.
 * Promotional writes must not touch the real Kyrub Firebase project.
 * A later production launch requires a separately reviewed contract change.
 */
export function resolveTagPilotIsolation(projectId:string,config:{
 firestoreHost?:string;authHost?:string;allowedPilotProject?:string
}):TagPilotIsolation{
 if(projectId===KYRUB_PRODUCTION_PROJECT_ID||!projectId)return 'unsafe';
 if(projectId.startsWith('demo-')&&
  isLocalEmulatorHost(config.firestoreHost)&&isLocalEmulatorHost(config.authHost))return 'emulator';
 const expected=config.allowedPilotProject?.trim();
 if(expected&&expected!==KYRUB_PRODUCTION_PROJECT_ID&&expected===projectId&&
  !config.firestoreHost&&!config.authHost)return 'isolated-project';
 return 'unsafe';
}
export function currentTagPilotIsolation():TagPilotIsolation{
 return resolveTagPilotIsolation(getFirebaseAdminProjectId(),{
  firestoreHost:process.env.FIRESTORE_EMULATOR_HOST,
  authHost:process.env.FIREBASE_AUTH_EMULATOR_HOST,
  allowedPilotProject:process.env.KYRUB_TAG_PROMO_PILOT_PROJECT_ID
 });
}
export function assertTagPilotWriteIsolated():void{
 if(currentTagPilotIsolation()==='unsafe')throw Error('TAG_PILOT_PROJECT_UNSAFE');
}

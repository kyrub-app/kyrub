import {getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {PRODUCTION_TAG_ORIGIN,productionPasskeyPilotId,assertProductionPasskeyUnit} from './kyrubTagPasskeyReleasePolicy.js';

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
export function pilotPreviewConfigMatchesServer(projectId:string,config:{
  serverProjectId:string;webPilotEnabled?:string;vercelEnvironment?:string;deploymentHost?:string
}):boolean{
 return projectId!==KYRUB_PRODUCTION_PROJECT_ID &&
  projectId===config.serverProjectId &&
  config.webPilotEnabled==='true' &&
  config.vercelEnvironment==='preview' &&
  /^([a-z0-9-]+\.)+vercel\.app$/.test(config.deploymentHost??'');
}
export function tagPilotClientMatchesServer():boolean{
 const isolation=currentTagPilotIsolation();
 return isolation==='emulator'||(isolation==='isolated-project'&&
  pilotPreviewConfigMatchesServer(getFirebaseAdminProjectId(),{
   serverProjectId:process.env.VITE_FIREBASE_PROJECT_ID??'',
   webPilotEnabled:process.env.VITE_KYRUB_TAG_PILOT_CLIENT_FIREBASE,
   vercelEnvironment:process.env.VERCEL_ENV,
   deploymentHost:process.env.VERCEL_URL
  }));
}
export function assertTagPilotWriteIsolated():void{
 if(currentTagPilotIsolation()==='unsafe'||!tagPilotClientMatchesServer())
  throw Error('TAG_PILOT_PROJECT_UNSAFE');
}

/** Branch URLs survive ordinary preview deployments; immutable deployment URLs do not. */
export function stableTagPilotHost(env:NodeJS.ProcessEnv=process.env):string|null{
 const host=env.VERCEL_BRANCH_URL?.trim();
 if(env.VERCEL_ENV!=='preview'||!host||host===env.VERCEL_URL||!(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/.test(host)))return null;
 return host;
}

/** Advertise only the exact fixed preview origin and never a production write capability. */
export function tagPasskeyPilotOrigin():string|null{
 if(process.env.KYRUB_TAG_PASSKEY_PILOT_ENABLED!=='true'||process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED!=='true')return null;
 try{assertTagPilotWriteIsolated();const host=stableTagPilotHost();return host&&/^[a-z0-9-]+\.vercel\.app$/.test(host)?'https://'+host:null;}catch{return null;}
}

// Separate release gate: never loosen the legacy isolated-only write guard.
export function productionTagPasskeyTestId():string|null{
 if(process.env.VERCEL_ENV!=='production'||process.env.KYRUB_TAG_PASSKEY_PRODUCTION_ENABLED!=='true')return null;
 return productionPasskeyPilotId(getFirebaseAdminProjectId(),process.env);
}
export function tagPasskeyRuntimeOrigin():string|null{
 try{return process.env.VERCEL_ENV==='production'?(productionTagPasskeyTestId()?PRODUCTION_TAG_ORIGIN:null):tagPasskeyPilotOrigin();}catch{return null;}
}
export function tagPasskeyUnitOrigin(id:string,data:Record<string,unknown>|undefined):string|null{
 const origin=tagPasskeyRuntimeOrigin();
 if(!origin)return null;
 if(process.env.VERCEL_ENV==='production'){
  try{const approved=productionTagPasskeyTestId();if(!approved)return null;assertProductionPasskeyUnit(approved,id,data);}catch{return null;}
 }
 return origin;
}

/** Reconciled CID Pix is intentionally restricted to existing throwaway emulator pilots. */
export function cidPixEmulatorEnabled():boolean{
 if(process.env.VERCEL||process.env.VERCEL_ENV==='production'||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS)return false;
 try{return currentTagPilotIsolation()==='emulator'||cidFinanceIntegratedTestEnabled();}catch{return false;}
}

/** A fixed synthetic RP for the signed CID -> financial emulator journey.
 * Not a public HTTP release gate and not a general exemption from pilot isolation.
 */
export const CID_FINANCE_TEST_ORIGIN='https://kyrub-cid-finance-e2e.vercel.app';
export function cidFinanceIntegratedTestEnabled():boolean{
 if(process.env.NODE_ENV!=='test'||process.env.KYRUB_CID_FINANCE_INTEGRATED_TEST!=='true'||
 process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION!=='true'||process.env.VERCEL||process.env.VERCEL_ENV||
 process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8088'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
 process.env.FIREBASE_PROJECT_ID!=='kyrub-security-test'||process.env.GCLOUD_PROJECT!=='kyrub-security-test')return false;
 try{return getFirebaseAdminProjectId()==='kyrub-security-test';}catch{return false;}
}

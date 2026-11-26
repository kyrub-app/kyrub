import {isTagId} from '../../shared/kyrubTagContract.js';
export const PRODUCTION_TAG_ORIGIN='https://www.kyrub.com';
export const PRODUCTION_TAG_RP_ID='www.kyrub.com';
export function productionPasskeyPilotId(projectId:string,env:NodeJS.ProcessEnv):string|null{
 const id=env.KYRUB_TAG_PASSKEY_PRODUCTION_TEST_ID;
 return projectId==='kyrub-b8d0e'&&env.VERCEL_ENV==='production'&&
 env.KYRUB_TAG_PASSKEY_PRODUCTION_ENABLED==='true'&&env.KYRUB_TAG_PERMANENT_STOCK_ENABLED==='true'&&
 !env.FIRESTORE_EMULATOR_HOST&&!env.FIREBASE_AUTH_EMULATOR_HOST&&isTagId(id)?id:null;
}
export function assertProductionPasskeyUnit(approvedId:string,tagId:string,data:Record<string,unknown>|undefined){
 if(!isTagId(approvedId)||tagId!==approvedId||!data||
 data.distribution!=='promotional'||data.model!=='adesivo'||data.urlMode!=='permanent'||
 data.manufacturingState!=='released'||!isTagId(data.promotionalBatchId)||
 data.pilotBatch!=null||data.pilotSlot!=null||data.reservedForUid!=null||
 data.reservedEmailHash!=null||data.activationHash!==null)throw Error('TAG_FORBIDDEN');
}

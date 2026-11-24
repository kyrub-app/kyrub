/** Non-destructive, origin-local pilot preflight. IndexedDB enumeration
 * does not prove erasure on other devices, or prevent an old tab from
 * reopening persistence. Never use this as a production release attestation.
 */
export type SocialStorageCheck='ready'|'legacy-cache'|'service-worker'|'unverified';
type Probe={
 databases:()=>Promise<readonly {name?:string}[]>;
 hasServiceWorker:()=>Promise<boolean>;
};
export async function inspectSocialPilotStorage(probe:Probe):Promise<SocialStorageCheck>{
 try{
  if(await probe.hasServiceWorker())return 'service-worker';
  const databases=await probe.databases();
  if(!Array.isArray(databases)||databases.some(item=>typeof item.name!=='string'))return 'unverified';
  // Firestore SDK names contain firestore; block any such database in
  // the isolated origin rather than guessing a version-dependent name.
  if(databases.some(item=>/firestore/i.test(item.name??'')))return 'legacy-cache';
  return 'ready';
 }catch{return 'unverified';}
}
export async function verifySocialPilotStorage():Promise<void>{
 const result=await inspectSocialPilotStorage({
  databases:async()=>{
   if(typeof indexedDB==='undefined'||typeof indexedDB.databases!=='function')throw Error('STORAGE_ENUMERATION_UNAVAILABLE');
   return indexedDB.databases();
  },
  hasServiceWorker:async()=>{
   if(typeof navigator==='undefined')throw Error('BROWSER_REQUIRED');
   if(!('serviceWorker' in navigator))return false;
   const workers=navigator.serviceWorker;
   return !!workers.controller||(await workers.getRegistrations()).length>0;
  }
 });
 if(result!=='ready')throw Error('TRIBE_STORAGE_UNVERIFIED');
}

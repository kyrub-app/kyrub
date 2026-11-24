/** Non-destructive, origin-local pilot preflight. IndexedDB enumeration
 * does not prove erasure on other devices, or prevent an old tab from
 * reopening persistence. Never use this as a production release attestation.
 */
export type SocialStorageCheck='ready'|'legacy-cache'|'legacy-social-storage'|'service-worker'|'unverified';
type Probe={
 databases:()=>Promise<readonly {name?:string}[]>;
 hasServiceWorker:()=>Promise<boolean>;
 storageKeys:()=>Promise<readonly string[]>;
};
// Only known private relationship keys; do not read values or match broad
// prefixes that could include ERP records, public posts or authentication.
function isLegacySocialKey(key:string):boolean{
 return key==='kyrub_friends'||key==='kyrub_connection_requests'||
  key.startsWith('kyrub_hidden_suggestions_')||key.startsWith('kyrub_blocked_users_');
}
function enumerateStorageKeys(storage:Storage):string[]{
 const length=storage.length;
 const keys:string[]=[];
 for(let i=0;i<length;i++){
  const key=storage.key(i);
  if(typeof key!=='string')throw Error('STORAGE_ENUMERATION_UNAVAILABLE');
  keys.push(key);
 }
 if(storage.length!==length||new Set(keys).size!==length)throw Error('STORAGE_ENUMERATION_CHANGED');
 return keys;
}
export async function inspectSocialPilotStorage(probe:Probe):Promise<SocialStorageCheck>{
 try{
  if(await probe.hasServiceWorker())return 'service-worker';
  const databases=await probe.databases();
  if(!Array.isArray(databases)||databases.some(item=>typeof item.name!=='string'))return 'unverified';
  // Firestore SDK names contain firestore; block any such database in
  // the isolated origin rather than guessing a version-dependent name.
  if(databases.some(item=>/firestore/i.test(item.name??'')))return 'legacy-cache';
  const keys=await probe.storageKeys();
  if(!Array.isArray(keys)||keys.some(key=>typeof key!=='string'))return 'unverified';
  if(keys.some(isLegacySocialKey))return 'legacy-social-storage';
  return 'ready';
 }catch{return 'unverified';}
}
export async function verifySocialPilotStorage():Promise<void>{
 const result=await inspectSocialPilotStorage({
  databases:async()=>{
   if(typeof indexedDB==='undefined'||typeof indexedDB.databases!=='function')throw Error('STORAGE_ENUMERATION_UNAVAILABLE');
   return indexedDB.databases();
  },
  storageKeys:async()=>{
   if(typeof window==='undefined')throw Error('BROWSER_REQUIRED');
   return [...enumerateStorageKeys(window.localStorage),...enumerateStorageKeys(window.sessionStorage)];
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

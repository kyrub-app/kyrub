// Vite test fixture only. Never initialize with live Firebase configuration.
import {auth,db} from '../../src/utils/firebase';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword,GoogleAuthProvider,signInWithCredential,reauthenticateWithCredential,signOut,setPersistence,inMemoryPersistence,browserLocalPersistence} from 'firebase/auth';
import {initializeFirestore,persistentLocalCache,persistentMultipleTabManager,connectFirestoreEmulator,disableNetwork,enableNetwork,doc,getDocFromServer,onSnapshot,updateDoc,serverTimestamp,waitForPendingWrites,terminate} from 'firebase/firestore';
import {publishSocialPrivacyInvalidation,subscribeSocialPrivacyInvalidation} from '../../src/utils/socialPrivacyInvalidation';
import {requestReservedTribePilot,reservedTribePilotClientEnabled} from '../../src/utils/reservedTribePilotClient';

if(!reservedTribePilotClientEnabled()||auth.app.options.projectId!=='kyrub-security-test')throw Error('LOCAL_PILOT_REQUIRED');
const signIn=async (instance,credentials)=>{
 await setPersistence(instance,inMemoryPersistence);
 return (await signInWithEmailAndPassword(instance,credentials.email,credentials.password)).user.uid;
};
let legacy;
window.fixture={
 projects:()=>[auth.app.options.projectId,db.app.options.projectId],
 enabled:reservedTribePilotClientEnabled,
 authEmulator:()=>({host:auth.emulatorConfig?.host,port:auth.emulatorConfig?.port,protocol:auth.emulatorConfig?.protocol}),
 signIn:credentials=>signIn(auth,credentials),
 // Documented Firebase emulator mock ID token; fixture only.
 async signInGoogleFixture(profile){
  await setPersistence(auth,inMemoryPersistence);
  const result=await signInWithCredential(auth,GoogleAuthProvider.credential(JSON.stringify(profile)));
  return {uid:result.user.uid,verified:result.user.emailVerified,providers:result.user.providerData.map(row=>row.providerId)};
 },
 async reauthenticateGoogleFixture(profile){
  const user=auth.currentUser;
  if(!user)throw Error('FIXTURE_AUTH_REQUIRED');
  try{
   const result=await reauthenticateWithCredential(user,GoogleAuthProvider.credential(JSON.stringify(profile)));
   const proof=await result.user.getIdTokenResult(true);
   return {ok:true,uid:result.user.uid,verified:proof.claims.email_verified,provider:proof.signInProvider};
  }catch(error){return {ok:false,code:error.code??'FIXTURE_REAUTH_FAILED'};}
 },
 async signInForApp(credentials){await setPersistence(auth,browserLocalPersistence);return (await signInWithEmailAndPassword(auth,credentials.email,credentials.password)).user.uid;},
 signOut:()=>signOut(auth),
 call:async(action,fields={})=>{try{return {ok:true,value:await requestReservedTribePilot(action,fields)}}catch(e){return {ok:false,error:e.message}}},
 async queueLegacyStoreWrite(credentials,path){
  if(legacy)throw Error('FIXTURE_ALREADY_INITIALIZED');
  const app=initializeApp({...auth.app.options},'legacy-tribe-storage-fixture');
  const oldAuth=getAuth(app);
  connectAuthEmulator(oldAuth,'http://127.0.0.1:9099',{disableWarnings:true});
  const oldDb=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
  connectFirestoreEmulator(oldDb,'127.0.0.1',8088);
  const uid=await signIn(oldAuth,credentials);
  if(path!=='users/'+uid+'/stores/'+uid)throw Error('FIXTURE_STORE_REQUIRED');
  const ref=doc(oldDb,path);
  const prior=await getDocFromServer(ref);
  if(!prior.exists()||prior.data().description!=='before')throw Error('FIXTURE_STORE_MISSING');
  if(!(await indexedDB.databases()).some(row=>/firestore/i.test(row.name??'')))throw Error('PERSISTENT_CACHE_NOT_ACTIVE');
  await disableNetwork(oldDb);
  legacy={app,db:oldDb,pending:false,write:null};
  await new Promise((resolve,reject)=>{
   let stop=()=>{};
   const timer=setTimeout(()=>{stop();reject(Error('PENDING_WRITE_NOT_OBSERVED'));},15000);
   stop=onSnapshot(ref,{includeMetadataChanges:true},snapshot=>{
    legacy.pending=snapshot.metadata.hasPendingWrites;
    if(legacy.pending&&snapshot.data()?.description==='after-offline-fixture'){clearTimeout(timer);stop();resolve();}
   },error=>{clearTimeout(timer);stop();reject(error)});
   legacy.write=updateDoc(ref,{description:'after-offline-fixture',updatedAt:serverTimestamp()});
   legacy.write.catch(error=>{clearTimeout(timer);stop();reject(error)});
  });
 },
 pendingStoreWrite:()=>legacy?.pending===true,
 async flushLegacyStoreWrite(){
  if(!legacy?.pending)throw Error('PENDING_WRITE_REQUIRED');
  await enableNetwork(legacy.db);
  await Promise.all([legacy.write,waitForPendingWrites(legacy.db)]);
  legacy.pending=false;
  await terminate(legacy.db);
  await deleteApp(legacy.app);
 },
};

// Browser-only fixture counters; no identity or payload is transmitted.
let signalCounts={local:0,remote:0};
let stopSignals=()=>{};
window.fixture.startSignalProbe=()=>{
 stopSignals();signalCounts={local:0,remote:0};
 const local=subscribeSocialPrivacyInvalidation(()=>signalCounts.local++);
 const remote=subscribeSocialPrivacyInvalidation(()=>signalCounts.remote++,false);
 stopSignals=()=>{local();remote();};
};
window.fixture.signalCounts=()=>({...signalCounts});
window.fixture.publishSignal=publishSocialPrivacyInvalidation;
window.fixture.stopSignalProbe=()=>stopSignals();

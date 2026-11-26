// Test-only Firebase substitute for the synthetic HTTPS WebAuthn origin.
 // Imported exclusively by the isolated Vite harness, never by the app build.
import {initializeApp} from 'firebase/app';
import {getAuth,connectAuthEmulator} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator} from 'firebase/firestore';
import {getFirestore as getLiteFirestore,connectFirestoreEmulator as connectLiteFirestoreEmulator} from 'firebase/firestore/lite';
import {getStorage,connectStorageEmulator} from 'firebase/storage';
if(!import.meta.env.DEV||import.meta.env.VITE_KYRUB_DIRECTORY_BROWSER_EMULATOR!=='true'||location.origin!=='https://kyrub-tag-browser.vercel.app')throw Error('PASSKEY_BROWSER_FIXTURE_ONLY');
const projectId='demo-kyrub-welcome';
const app=initializeApp({projectId,apiKey:'fake-emulator-key',authDomain:projectId+'.firebaseapp.com',storageBucket:projectId+'.firebasestorage.app',appId:'1:000000000000:web:fictional'});
export const auth=getAuth(app);
connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
export const db=getFirestore(app);
connectFirestoreEmulator(db,'127.0.0.1',8088);
export const liteDb=getLiteFirestore(app);
connectLiteFirestoreEmulator(liteDb,'127.0.0.1',8088);
export const storage=getStorage(app);
connectStorageEmulator(storage,'127.0.0.1',9199);

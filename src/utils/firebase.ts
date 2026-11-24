import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  memoryLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import {
  connectFirestoreEmulator as connectLiteFirestoreEmulator,
  getFirestore as getLiteFirestore,
} from 'firebase/firestore/lite';

const firebaseConfig = {
  apiKey: 'AIzaSyCgWDortDA5DYjx4xIlC9YjKH3ZNIrv99U',
  authDomain: 'kyrub-b8d0e.firebaseapp.com',
  projectId: 'kyrub-b8d0e',
  storageBucket: 'kyrub-b8d0e.firebasestorage.app',
  messagingSenderId: '636039448089',
  appId: '1:636039448089:web:85a6c6620341bc5bcb8c88',
};

const isolatedE2E = import.meta.env?.DEV === true &&
  import.meta.env?.VITE_KYRUB_FIREBASE_EMULATOR_E2E === 'true';
if (isolatedE2E && (typeof window === 'undefined' ||
  !['localhost', '127.0.0.1'].includes(window.location.hostname))) {
  throw Error('FIREBASE_E2E_REQUIRES_LOCALHOST');
}
const selectedConfig = isolatedE2E
  ? { ...firebaseConfig, projectId: 'kyrub-security-test', authDomain: 'kyrub-security-test.firebaseapp.com', storageBucket: 'kyrub-security-test.firebasestorage.app', apiKey: 'fake-emulator-key', appId: '1:000000000000:web:fictional' }
  : firebaseConfig;

const app = getApps().length === 0
  ? initializeApp(selectedConfig)
  : getApp();

export const auth = getAuth(app);
if (isolatedE2E) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
export const storage = getStorage(app);
if (isolatedE2E) connectStorageEmulator(storage, '127.0.0.1', 9199);

const socialMemoryPilot = import.meta.env?.VITE_KYRUB_SOCIAL_MEMORY_CACHE_E2E === 'true';
if(socialMemoryPilot&&!isolatedE2E)throw Error('SOCIAL_MEMORY_CACHE_REQUIRES_LOCAL_EMULATOR');

const initializeOfflineFirstFirestore = () => {
  // The opt-in pilot must fail closed; do not fall back to a persistent instance.
  if(socialMemoryPilot)return initializeFirestore(app,{localCache:memoryLocalCache()});
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (error) {
    // Firestore may already be initialized by another module or a hot reload.
    // In that case, reuse the existing instance without interrupting the app.
    console.warn(
      'Firestore persistence reused the existing initialized instance.',
      error
    );
    return getFirestore(app);
  }
};

export const db = initializeOfflineFirstFirestore();
if (isolatedE2E) connectFirestoreEmulator(db, '127.0.0.1', 8088);

// Firestore Lite uses its own service instance and does not inherit the
// full Firestore SDK emulator endpoint. Configure it before any REST read.
export const liteDb = getLiteFirestore(app);
if (isolatedE2E) connectLiteFirestoreEmulator(liteDb, '127.0.0.1', 8088);

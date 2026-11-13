import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

// Test-only opt-in. Never route a production build or real project to an emulator.
const viteEnv = import.meta.env;
const isolatedE2E = viteEnv?.DEV === true &&
  viteEnv?.VITE_KYRUB_E2E_ISOLATED === 'true' &&
  viteEnv?.VITE_KYRUB_E2E_PROJECT_ID === 'demo-global-challenges';

if (viteEnv?.VITE_KYRUB_E2E_ISOLATED === 'true' && !isolatedE2E) {
  throw new Error('E2E_ISOLATION_GUARD_FAILED');
}

const firebaseConfig = {
  apiKey: 'AIzaSyCgWDortDA5DYjx4xIlC9YjKH3ZNIrv99U',
  authDomain: 'kyrub-b8d0e.firebaseapp.com',
  projectId: isolatedE2E ? 'demo-global-challenges' : 'kyrub-b8d0e',
  storageBucket: isolatedE2E ? 'demo-global-challenges.appspot.com' : 'kyrub-b8d0e.firebasestorage.app',
  messagingSenderId: '636039448089',
  appId: '1:636039448089:web:85a6c6620341bc5bcb8c88',
};

const app = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApp();

export const auth = getAuth(app);
if (isolatedE2E) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
export const storage = getStorage(app);
if (isolatedE2E) {
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

const initializeOfflineFirstFirestore = () => {
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
if (isolatedE2E) {
  connectFirestoreEmulator(db, '127.0.0.1', 8088);
}

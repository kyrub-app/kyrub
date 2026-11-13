import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyCgWDortDA5DYjx4xIlC9YjKH3ZNIrv99U',
  authDomain: 'kyrub-b8d0e.firebaseapp.com',
  projectId: 'kyrub-b8d0e',
  storageBucket: 'kyrub-b8d0e.firebasestorage.app',
  messagingSenderId: '636039448089',
  appId: '1:636039448089:web:85a6c6620341bc5bcb8c88',
};

const isolatedE2E = import.meta.env.DEV &&
  import.meta.env.VITE_KYRUB_FIREBASE_EMULATOR_E2E === 'true';
if (isolatedE2E && (typeof window === 'undefined' ||
  !['localhost', '127.0.0.1'].includes(window.location.hostname))) {
  throw Error('FIREBASE_E2E_REQUIRES_LOCALHOST');
}
const selectedConfig = isolatedE2E
  ? { ...firebaseConfig, projectId: 'kyrub-security-test', authDomain: 'kyrub-security-test.firebaseapp.com', apiKey: 'fake-emulator-key', appId: '1:000000000000:web:fictional' }
  : firebaseConfig;

const app = getApps().length === 0
  ? initializeApp(selectedConfig)
  : getApp();

export const auth = getAuth(app);
if (isolatedE2E) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
export const storage = getStorage(app);

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
if (isolatedE2E) connectFirestoreEmulator(db, '127.0.0.1', 8088);

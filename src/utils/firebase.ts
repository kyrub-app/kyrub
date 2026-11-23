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
// Pilot configuration is permitted only on a Vercel preview. The production
// domain always retains the established Firebase project even if someone sets
// a pilot env variable by mistake. A preview must opt in explicitly and must
// never silently fall back to production if its isolated keys are incomplete.
const pilotPreview = typeof window !== 'undefined' &&
  window.location.protocol === 'https:' && window.location.hostname.endsWith('.vercel.app');
const pilotClientRequested = import.meta.env?.VITE_KYRUB_TAG_PILOT_CLIENT_FIREBASE === 'true' && pilotPreview;
function isolatedPilotConfig() {
  const environment = import.meta.env;
  const projectId = String(environment.VITE_FIREBASE_PROJECT_ID ?? '').trim();
  const apiKey = String(environment.VITE_FIREBASE_API_KEY ?? '').trim();
  const authDomain = String(environment.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim();
  const storageBucket = String(environment.VITE_FIREBASE_STORAGE_BUCKET ?? '').trim();
  const messagingSenderId = String(environment.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '').trim();
  const appId = String(environment.VITE_FIREBASE_APP_ID ?? '').trim();
  if (!/^[a-z][a-z0-9-]{4,60}$/.test(projectId) ||
    projectId === firebaseConfig.projectId ||
    authDomain !== projectId + '.firebaseapp.com' ||
    storageBucket !== projectId + '.firebasestorage.app' ||
    !apiKey || !messagingSenderId || !appId) {
    throw Error('TAG_PILOT_FIREBASE_CONFIG_INVALID');
  }
  return {apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId};
}
const selectedConfig = isolatedE2E
  ? { ...firebaseConfig, projectId: 'kyrub-security-test', authDomain: 'kyrub-security-test.firebaseapp.com', storageBucket: 'kyrub-security-test.firebasestorage.app', apiKey: 'fake-emulator-key', appId: '1:000000000000:web:fictional' }
  : pilotClientRequested ? isolatedPilotConfig() : firebaseConfig;

const app = getApps().length === 0
  ? initializeApp(selectedConfig)
  : getApp();

// A pre-initialized Firebase app must never bypass the pilot's isolated
// configuration: refuse the session rather than authenticate on production.
if (pilotClientRequested && app.options.projectId !== selectedConfig.projectId) {
  throw Error('TAG_PILOT_FIREBASE_RUNTIME_APP_MISMATCH');
}

export const auth = getAuth(app);
if (isolatedE2E) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
export const storage = getStorage(app);
if (isolatedE2E) connectStorageEmulator(storage, '127.0.0.1', 9199);

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

// Firestore Lite uses its own service instance and does not inherit the
// full Firestore SDK emulator endpoint. Configure it before any REST read.
export const liteDb = getLiteFirestore(app);
if (isolatedE2E) connectLiteFirestoreEmulator(liteDb, '127.0.0.1', 8088);

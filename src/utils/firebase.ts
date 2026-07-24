import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCgWDortDA5DYjx4xIlC9YjKH3ZNIrv99U',
  authDomain: 'kyrub-b8d0e.firebaseapp.com',
  projectId: 'kyrub-b8d0e',
  storageBucket: 'kyrub-b8d0e.firebasestorage.app',
  messagingSenderId: '636039448089',
  appId: '1:636039448089:web:85a6c6620341bc5bcb8c88',
};

const app = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApp();

export const auth = getAuth(app);

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

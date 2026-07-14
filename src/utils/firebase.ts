import { initializeApp, getApp, getApps } from "firebase/app";
import { initializeFirestore, getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Firebase Applet Config values from firebase-applet-config.json
const firebaseConfig = {
  projectId: "gen-lang-client-0139766792",
  appId: "1:60459199718:web:672292eafae443c39c1f27",
  apiKey: "AIzaSyAKlHhj8xYi4W61VBCbJV06kgWguMZsxPQ",
  authDomain: "gen-lang-client-0139766792.firebaseapp.com",
  storageBucket: "gen-lang-client-0139766792.firebasestorage.app",
  messagingSenderId: "60459199718",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Use initializeFirestore to specify the custom databaseId if provided
export const db = initializeFirestore(app, {}, "ai-studio-kyrub-317e88e7-24bf-410f-9c7d-aa8aecc4aa39");

export const auth = getAuth(app);

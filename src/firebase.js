import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, indexedDBLocalPersistence, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { Capacitor } from "@capacitor/core";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const firebaseEnabled = Object.values(firebaseConfig).every(Boolean);

let app;
let auth;
let db;
let storage;

if (firebaseEnabled) {
  app = initializeApp(firebaseConfig);
  try {
    auth = Capacitor.isNativePlatform()
      ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
      : getAuth(app);
  } catch {
    // initializeAuth can only be called once; preserve the existing Firebase auth instance.
    auth = getAuth(app);
  }
  db = getFirestore(app);
  storage = getStorage(app);
}

export { app, auth, db, storage };
export const googleProvider = new GoogleAuthProvider();

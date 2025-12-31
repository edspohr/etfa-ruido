import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const isConfigured =
  firebaseConfig.apiKey && firebaseConfig.apiKey !== "your_api_key";

let app, auth, googleProvider, db, storage;

if (isConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
    db = getFirestore(app);
    storage = getStorage(app);
  } catch (e) {
    console.error("Firebase init error:", e);
  }
}

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export async function uploadReceiptImage(file, userId) {
  if (!storage) throw new Error("Firebase Storage not initialized");

  // Create a unique filename
  const timestamp = Date.now();
  const extension = file.name.split(".").pop();
  const filename = `${timestamp}.${extension}`;
  const path = `receipts/${userId}/${filename}`;

  const storageRef = ref(storage, path);
  const snapshot = await uploadBytes(storageRef, file);
  const downloadURL = await getDownloadURL(snapshot.ref);

  return downloadURL;
}

export { auth, googleProvider, db, storage, isConfigured };

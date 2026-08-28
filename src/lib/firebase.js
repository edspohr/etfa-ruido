import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
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

let app, auth, db, storage;

if (isConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
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

  // 20s timeout que cubre upload + getDownloadURL. Antes getDownloadURL quedaba
  // fuera del race y si colgaba dejaba archivo huérfano en Storage (imageUrl='').
  const downloadURL = await Promise.race([
    uploadBytes(storageRef, file).then(snap => getDownloadURL(snap.ref)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Upload timeout after 20 seconds")), 20000)
    ),
  ]);

  return downloadURL;
}

export { auth, db, storage, isConfigured };

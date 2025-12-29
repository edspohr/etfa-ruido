import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, googleProvider, db, isConfigured } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { AuthContext } from './AuthContextDefinition';

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(isConfigured);

  async function ensureUserExists(user) {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
          await setDoc(userRef, {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName || user.email.split('@')[0],
              role: 'professional',
              balance: 0
          });
      }
  }

  useEffect(() => {
    if (!isConfigured) {
        return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
         try {
             if (db) {
                 await ensureUserExists(user);
                 const userRef = doc(db, "users", user.uid);
                 const userSnap = await getDoc(userRef);
                 if (userSnap.exists()) {
                     setUserRole(userSnap.data().role);
                 }
             }
         } catch (e) {
             console.error("Error ensuring user exists:", e);
         }
         setCurrentUser(user);
      } else {
        setCurrentUser(null);
        setUserRole(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);



  async function loginWithGoogle() {
    if (!auth) return; 
    return signInWithPopup(auth, googleProvider);
  }

  function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  function logout() {
    return signOut(auth);
  }

  const value = {
    currentUser,
    userRole,
    loginWithGoogle,
    login,
    logout
  };

  if (!isConfigured) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
              <div className="bg-white p-8 rounded-lg shadow-md max-w-lg w-full text-center border-l-4 border-yellow-500">
                  <h2 className="text-2xl font-bold text-gray-800 mb-4">Configuración Pendiente</h2>
                  <p className="text-gray-600 mb-4">La aplicación no está conectada a Firebase.</p>
                  <div className="bg-gray-50 p-4 rounded text-left text-sm font-mono text-gray-700 overflow-x-auto mb-6">
                      <p>Edita el archivo <span className="font-bold">.env</span> y agrega tus credenciales:</p>
                      <ul className="list-disc ml-5 mt-2">
                          <li>VITE_FIREBASE_API_KEY</li>
                          <li>...y las demás variables requeridas.</li>
                      </ul>
                  </div>
                  <p className="text-xs text-gray-400">Consulta el archivo .env.example para ver el formato.</p>
              </div>
          </div>
      );
  }

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence, sendPasswordResetEmail } from 'firebase/auth';
import { auth, googleProvider, db, isConfigured } from '../lib/firebase';
import { doc, getDoc, setDoc, query, collection, where, getDocs, deleteDoc, writeBatch } from 'firebase/firestore';
import { AuthContext } from './AuthContextDefinition';

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(isConfigured);

  async function ensureUserExists(user) {
      // 1. Check if user exists by UID
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) return;

      // 2. If not, check if user exists by Email (Pre-seeded)
      const q = query(collection(db, "users"), where("email", "==", user.email));
      const querySnap = await getDocs(q);

      if (!querySnap.empty) {
          // User exists with email! We need to migrate/claim this doc text
          const existingDoc = querySnap.docs[0];
          const existingData = existingDoc.data();
          
          // Delete old doc (if ID was not UID) and create new one with UID
          // OR just keep old ID? Keeping old ID causes mismatch with auth.uid
          // Better: Create NEW doc with proper UID, copy data, delete old.
          
          await setDoc(userRef, {
              ...existingData,
              uid: user.uid,
              // If seeded data didn't have photoURL, maybe add it?
              photoURL: user.photoURL || null
          });

          // IMPORTANT: If we had related data (expenses) pointing to the old ID, we would need to migrate them too.
          // Since this is initial seed, we can make the seed use the email as ID for simplicity or just accept 
          // that the first login migrates the "Profile". 
          // Actually, migrating ID is hard because of FKs.
          
          // Simplest Approach for this specific "Seed -> Real" transition:
          // The seed will create docs with ID = email (sanitized) to be safe/predictable?
          // Or just random IDs. If random, we find by email.
          
          // Let's just create the new doc and DELETE the old one, but we must update references?
          // For now, let's assume no complex relational data exists for these "new" users yet 
          // OR, simplest of all: Just Create the new doc with the right UID and let the admin copy/paste values if needed?
          // No, user wants automatic link.
          
          // STRATEGY: 
          // 1. Seed creates users with `uid: user_email_prefix` or similar.
          // 2. AuthContext finds them. 
          // 3. Since we can't change the Doc ID easily without breaking refs, 
          //    maybe we just rely on "email" matching for "role" lookup?
          //    No, security rules rely on `request.auth.uid == userId`.
          
          // OK, we must migrate the Doc ID to match Auth UID.
          // AND migrate any expenses/allocations that point to the old ID.
          
          const oldId = existingDoc.id;
          
          // 1. Copy user data to new ID
          await setDoc(userRef, {
             ...existingData,
             uid: user.uid
          });
          
          // 2. Delete old user doc
          await deleteDoc(doc(db, "users", oldId));

          // 3. Migrate Expenses & Allocations?
          // Since we are creating fresh data now, there probably isn't much to migrate 
          // UNLESS the admin created stuff for them before they logged in.
          // Let's assume yes.
          
          // Migrate Allocations
          const allocQ = query(collection(db, "allocations"), where("userId", "==", oldId));
          const allocSnap = await getDocs(allocQ);
          const batch = writeBatch(db);
          
          allocSnap.docs.forEach(d => {
              batch.update(doc(db, "allocations", d.id), { userId: user.uid });
          });
          
          // Migrate Expenses
          const expQ = query(collection(db, "expenses"), where("userId", "==", oldId));
          const expSnap = await getDocs(expQ);
          expSnap.docs.forEach(d => {
              batch.update(doc(db, "expenses", d.id), { userId: user.uid });
          });
          
          await batch.commit();

      } else {
          // New User
          // AUTO-ADMIN FIX: Check if email belongs to initial admins to break Catch-22
          const adminEmails = [
              "edmundo@spohr.cl", 
              "maguirre@etfa-ruido.cl", 
              "aguell@etfa-ruido.cl", 
              "cmunoz@etfa-ruido.cl"
          ];
          const initialRole = adminEmails.includes(user.email) ? 'admin' : 'professional';

          await setDoc(userRef, {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName || user.email.split('@')[0],
              role: initialRole,
              balance: 0
          });
      }
  }

  useEffect(() => {
    if (!isConfigured || !auth) {
        return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
         try {
             if (db) {
                 await ensureUserExists(user);
             }
         } catch (e) {
             console.error("Error ensuring user exists:", e);
         }

         try {
             if (db) {
                 const userRef = doc(db, "users", user.uid);
                 const userSnap = await getDoc(userRef);
                 if (userSnap.exists()) {
                     setUserRole(userSnap.data().role);
                 }
             }
         } catch (e) {
             console.error("Error fetching user role:", e);
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
    try {
        await setPersistence(auth, browserLocalPersistence);
        return await signInWithPopup(auth, googleProvider);
    } catch (error) {
        console.error("Google Login Error:", error);
        throw error;
    }
  }

  function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  function resetPassword(email) {
    return sendPasswordResetEmail(auth, email);
  }

  function logout() {
    return signOut(auth);
  }

  const value = {
    currentUser,
    userRole,
    loginWithGoogle,
    login,
    resetPassword,
    logout
  };

  if (!isConfigured || !auth) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
              <div className="bg-white p-8 rounded-lg shadow-md max-w-lg w-full text-center border-l-4 border-yellow-500">
                  <h2 className="text-2xl font-bold text-gray-800 mb-4">Configuración Pendiente o Errónea</h2>
                  <p className="text-gray-600 mb-4">La aplicación no pudo conectar con Firebase.</p>
                  <p className="text-sm text-red-500 mb-4">Posible causa: Variables de entorno faltantes o inválidas.</p>
                  <div className="bg-gray-50 p-4 rounded text-left text-sm font-mono text-gray-700 overflow-x-auto mb-6">
                      <p>Verifica en Vercel (Settings &rarr; Environment Variables) que existan:</p>
                      <ul className="list-disc ml-5 mt-2">
                          <li>VITE_FIREBASE_API_KEY</li>
                          <li>...y las demás variables de .env</li>
                      </ul>
                  </div>
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

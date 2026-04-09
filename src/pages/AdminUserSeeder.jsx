import { useState } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, query, where, writeBatch } from 'firebase/firestore';

// 1. Re-initialize a SECONDARY app instance to avoid logging out the current admin
// We use the same config from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Singleton-ish pattern for secondary app
let secondaryApp;
try {
    secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
} catch {
    // If already initialized (hot reload)
    // We can't easily get existing named app from client SDK v9 modular like legacy
    // But this try-catch usually handles the 'already exists' from hot-reload
}

export default function AdminUserSeeder() {
  const [logs, setLogs] = useState([]);
  const [processing, setProcessing] = useState(false);

  const addLog = (msg) => setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`]);

  const handleCreateAccounts = async () => {
    if (!confirm("Esto creará cuentas de Authentication para los usuarios en la Base de Datos (si no existen). La contraseña será 'gastos2026'. ¿Continuar?")) return;
    
    const pin = prompt("Ingrese la clave de seguridad para confirmar:");
    if (pin !== "1234") {
        addLog("Operación cancelada: Clave incorrecta.");
        return;
    }
    
    setProcessing(true);
    setLogs([]);
    addLog("Iniciando creación de cuentas...");

    try {
        // 1. Get Users from Firestore (The profiles we just seeded)
        const snap = await getDocs(collection(db, "users"));
        const users = snap.docs.map(d => ({id: d.id, ...d.data()}));
        
        addLog(`Encontrados ${users.length} perfiles en base de datos.`);

        // 2. Get Auth instance of SECONDARY app
        // This allows creating users without kicking out the current Admin
        const secondaryAuth = getAuth(secondaryApp);

        for (const user of users) {
            if (!user.email) {
                addLog(`SALTADO: Usuario ${user.displayName} no tiene email.`);
                continue;
            }

            try {
                addLog(`Creando cuenta para: ${user.email}...`);
                
                // 1. Create User
                let authUser;
                try {
                    const credential = await createUserWithEmailAndPassword(secondaryAuth, user.email, "gastos2026");
                    authUser = credential.user;
                } catch (createError) {
                    if (createError.code === 'auth/email-already-in-use') {
                        addLog(`⚠ YA EXISTE: ${user.email}. Intentando recuperar acceso...`);
                        try {
                            const credential = await signInWithEmailAndPassword(secondaryAuth, user.email, "gastos2026");
                            authUser = credential.user;
                            addLog(`✅ RECUPERADO: UID ${authUser.uid}`);
                        } catch (loginError) {
                            addLog(`❌ ERROR RECUPERACIÓN: No se pudo acceder a ${user.email}. ¿Contraseña cambiada?`);
                            console.error(loginError);
                            continue; // Skip this user
                        }
                    } else {
                        throw createError;
                    }
                }

                if (!authUser) continue;

                // 2. Update Profile (Display Name) - Only if new or we want to enforce sync
                if (user.displayName) {
                    await updateProfile(authUser, { displayName: user.displayName });
                }

                // 3. Migrate Firestore Doc
                const realUid = authUser.uid;
                const userRef = doc(db, "users", user.id); // Old Doc Ref

                if (user.id !== realUid) {
                     addLog(`Migrando Doc ID de ${user.id} a ${realUid}...`);
                
                    // Write New Doc
                    const newDocRef = doc(db, "users", realUid);
                    
                    // Check if target exists to avoid accidental overwrite of good data with bad data?
                    // Actually, we want to sync the Firestore "user profile" (roles, balance) to this UID.
                    
                    await setDoc(newDocRef, { ...user, uid: realUid }, { merge: true });

                    // Delete Old Doc (Only if IDs differ)
                    await deleteDoc(userRef);

                    // 4. Migrate References (Expenses, Allocations)
                    const batchOps = writeBatch(db);
                    
                    const allocQ = query(collection(db, "allocations"), where("userId", "==", user.id));
                    const allocSnap = await getDocs(allocQ);
                    allocSnap.docs.forEach(d => batchOps.update(d.ref, { userId: realUid }));

                    const expQ = query(collection(db, "expenses"), where("userId", "==", user.id));
                    const expSnap = await getDocs(expQ);
                    expSnap.docs.forEach(d => batchOps.update(d.ref, { userId: realUid }));

                    await batchOps.commit();
                    
                    addLog(`✅ ÉXITO: ${user.email} migrado a UID ${realUid}.`);
                } else {
                    addLog(`ℹ OK: ${user.email} ya tiene el UID correcto.`);
                }
                
            } catch (error) {
                 addLog(`❌ ERROR FATAL: ${user.email} - ${error.message}`);
                 console.error(error);
            }
        }
        
        secondaryAuth.signOut(); // Cleanup

    } catch (e) {
        addLog(`CRITICAL ERROR: ${e.message}`);
        console.error(e);
    } finally {
        setProcessing(false);
    }
  };

  // Manual User Creation Function
  const [newUser, setNewUser] = useState({ displayName: '', email: '', role: 'professional', code: '' });
  const handleCreateSingleUser = async (e) => {
      e.preventDefault();
      if (!newUser.email || !newUser.displayName) return;

      setProcessing(true);
      try {
          const tempId = `user_${newUser.email.split('@')[0]}_${Date.now().toString().slice(-4)}`;

          await setDoc(doc(db, "users", tempId), {
              displayName: newUser.displayName,
              email: newUser.email,
              role: newUser.role,
              ...(newUser.code ? { code: newUser.code } : {}),
              balance: 0,
              forcePasswordChange: true,
              createdAt: new Date().toISOString()
          });

          addLog(`✅ Usuario Firestore creado: ${newUser.displayName} (${tempId})`);
          addLog("Ahora ejecuta 'Crear Cuentas y Unificar' para generar su acceso (Auth).");
          setNewUser({ displayName: '', email: '', role: 'professional', code: '' });
      } catch (e) {
          console.error(e);
          addLog("Error creando usuario: " + e.message);
      } finally {
          setProcessing(false);
      }
  };

  return (
    <Layout title="Administración de Usuarios">
        <div className="bg-white p-6 rounded-lg shadow-sm max-w-2xl mx-auto">

            {/* Single User Form — TOP */}
            <h3 className="font-bold text-gray-800 text-lg mb-4">Agregar Nuevo Usuario</h3>
            <form onSubmit={handleCreateSingleUser} className="space-y-4 mb-8">
                <div>
                    <label className="block text-sm text-gray-600">Nombre</label>
                    <input
                        type="text"
                        required
                        className="w-full border p-2 rounded"
                        value={newUser.displayName}
                        onChange={e => setNewUser({...newUser, displayName: e.target.value})}
                        placeholder="Ej: Juan Pérez"
                    />
                </div>
                <div>
                    <label className="block text-sm text-gray-600">Email</label>
                    <input
                        type="email"
                        required
                        className="w-full border p-2 rounded"
                        value={newUser.email}
                        onChange={e => setNewUser({...newUser, email: e.target.value})}
                        placeholder="Ej: juan@etfa-ruido.cl"
                    />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm text-gray-600">Código</label>
                        <input
                            type="text"
                            className="w-full border p-2 rounded"
                            value={newUser.code}
                            onChange={e => setNewUser({...newUser, code: e.target.value})}
                            placeholder="Ej: PMS"
                        />
                    </div>
                    <div>
                        <label className="block text-sm text-gray-600">Rol</label>
                        <select
                            className="w-full border p-2 rounded"
                            value={newUser.role}
                            onChange={e => setNewUser({...newUser, role: e.target.value})}
                        >
                            <option value="professional">Profesional</option>
                            <option value="admin">Administrador</option>
                        </select>
                    </div>
                </div>
                <button
                    type="submit"
                    disabled={processing}
                    className="w-full bg-green-600 text-white py-2 rounded font-bold hover:bg-green-700 disabled:opacity-50"
                >
                    Agregar a la Base de Datos
                </button>
            </form>

            {/* Bulk Section — secondary / collapsible */}
            <details className="bg-gray-50 border border-gray-200 rounded-lg">
                <summary className="px-5 py-3 cursor-pointer text-sm font-bold text-gray-500 select-none">
                    Provisión Masiva (Avanzado)
                </summary>
                <div className="px-5 pb-5 pt-3 space-y-4">
                    <div className="bg-yellow-50 p-4 rounded border border-yellow-200 text-sm text-yellow-800">
                        <p className="font-bold">Instrucciones:</p>
                        <ol className="list-decimal ml-5 mt-2 space-y-1">
                            <li>Asegúrate de haber agregado los perfiles base con el formulario de arriba.</li>
                            <li>Este proceso creará cuentas de Email/Password ("gastos2026") en Firebase Authentication.</li>
                            <li>Migrará automáticamente los perfiles de Firestore para coincidir con los nuevos UIDs.</li>
                            <li>Puede tardar unos segundos. No cierres la ventana.</li>
                        </ol>
                    </div>
                    <button
                        onClick={handleCreateAccounts}
                        disabled={processing}
                        className="w-full bg-blue-600 text-white py-3 rounded font-bold hover:bg-blue-700 disabled:opacity-50 text-sm"
                    >
                        {processing ? 'Procesando...' : 'Crear Cuentas y Unificar (gastos2026)'}
                    </button>
                </div>
            </details>

            <div className="mt-6 bg-gray-900 text-green-400 p-4 rounded font-mono text-xs h-64 overflow-y-auto">
                {logs.length === 0 ? <p className="text-gray-500">// Esperando iniciar...</p> : logs.map((l, i) => <p key={i}>{l}</p>)}
            </div>
        </div>
    </Layout>
  );
}

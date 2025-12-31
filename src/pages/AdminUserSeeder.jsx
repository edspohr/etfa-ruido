import { useState } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, getDocs, doc, updateDoc, setDoc, deleteDoc, query, where, writeBatch } from 'firebase/firestore';

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
                const credential = await createUserWithEmailAndPassword(secondaryAuth, user.email, "gastos2026");
                const authUser = credential.user;

                // 2. Update Profile (Display Name)
                if (user.displayName) {
                    await updateProfile(authUser, { displayName: user.displayName });
                }

                // 3. Migrate Firestore Doc
                const realUid = authUser.uid;
                const userRef = doc(db, "users", user.id); // Old Doc Ref

                addLog(`Migrando Doc ID de ${user.id} a ${realUid}...`);
                
                // Write New Doc
                const newDocRef = doc(db, "users", realUid);
                // Be careful not to overwrite if it exists? (Maybe they already logged in?)
                // Just overwrite or merge.
                await updateDoc(newDocRef, { ...user, uid: realUid }).catch(async () => {
                     // If update fails (doc doesn't exist), use set
                     await setDoc(newDocRef, { ...user, uid: realUid });
                });

                // Delete Old Doc
                if (user.id !== realUid) {
                    await deleteDoc(userRef);
                }

                // 4. Migrate References (Expenses, Allocations)
                const batchOps = writeBatch(db);
                
                const allocQ = query(collection(db, "allocations"), where("userId", "==", user.id));
                const allocSnap = await getDocs(allocQ);
                allocSnap.docs.forEach(d => batchOps.update(d.ref, { userId: realUid }));

                const expQ = query(collection(db, "expenses"), where("userId", "==", user.id));
                const expSnap = await getDocs(expQ);
                expSnap.docs.forEach(d => batchOps.update(d.ref, { userId: realUid }));

                await batchOps.commit();
                
                addLog(`✅ ÉXITO: ${user.email} creado y migrado.`);
                
            } catch (authError) {
                if (authError.code === 'auth/email-already-in-use') {
                    addLog(`⚠ YA EXISTE: ${user.email} (Auth). No se modificó.`);
                } else {
                    addLog(`❌ ERROR: ${user.email} - ${authError.message}`);
                    console.error(authError);
                }
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

  return (
    <Layout title="Administración de Usuarios">
        <div className="bg-white p-6 rounded-lg shadow-sm max-w-2xl mx-auto">
            <h2 className="text-xl font-bold mb-4">Provisión Masiva de Cuentas</h2>
            
            <div className="bg-yellow-50 p-4 rounded border border-yellow-200 mb-6 text-sm text-yellow-800">
                <p className="font-bold">Instrucciones:</p>
                <ol className="list-decimal ml-5 mt-2 space-y-1">
                    <li>Asegúrate de haber presionado "Generar Datos de Prueba" antes de esto (para tener los perfiles base).</li>
                    <li>Este proceso creará cuentas de Email/Password ("gastos2026") en Firebase Authentication.</li>
                    <li>Migrará automáticamente los perfiles de Firestore para coincidir con los nuevos UIDs.</li>
                    <li>Puede tardar unos segundos. No cierres la ventana.</li>
                </ol>
            </div>

            <button 
                onClick={handleCreateAccounts}
                disabled={processing}
                className="w-full bg-blue-600 text-white py-3 rounded font-bold hover:bg-blue-700 disabled:opacity-50"
            >
                {processing ? 'Procesando...' : 'Crear Cuentas y Unificar (gastos2026)'}
            </button>

            <div className="mt-6 bg-gray-900 text-green-400 p-4 rounded font-mono text-xs h-64 overflow-y-auto">
                {logs.length === 0 ? <p className="text-gray-500">// Esperando iniciar...</p> : logs.map((l, i) => <p key={i}>{l}</p>)}
            </div>
        </div>
    </Layout>
  );
}

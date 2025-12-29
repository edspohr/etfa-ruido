import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { db } from '../lib/firebase';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { formatCurrency } from '../lib/mockData';
import { PlusCircle, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function UserDashboard() {
  const { currentUser } = useAuth();
  const [balance, setBalance] = useState(0);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
        if (!currentUser) return;
        
        try {
            // 1. Get Live Balance
            const userRef = doc(db, "users", currentUser.uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                setBalance(userSnap.data().balance || 0);
            }

            // 2. Get Active Projects
            const q = query(collection(db, "projects"), where("status", "==", "active"));
            const pSnap = await getDocs(q);
            const pData = pSnap.docs.map(d => ({id: d.id, ...d.data()}));
            setProjects(pData);
        } catch (e) {
            console.error("Error fetching dashboard:", e);
        } finally {
            setLoading(false);
        }
    }
    fetchData();
  }, [currentUser]);

  if (loading) return <Layout title="Dashboard">Cargando...</Layout>;

  return (
    <Layout title={`Hola, ${currentUser?.displayName?.split(' ')[0] || 'Usuario'}`}>
         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-2xl shadow-lg border border-blue-500 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Wallet className="w-24 h-24" />
                </div>
                <div className="relative z-10">
                    <h3 className="text-blue-100 text-sm font-medium mb-1">Mi Cuenta Corriente(Viáticos)</h3>
                    <p className="text-4xl font-bold mb-2">
                        {formatCurrency(balance)}
                    </p>
                    <p className="text-blue-200 text-sm">Saldo disponible para gastos.</p>
                </div>
            </div>
            
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-center">
                 <Link to="/dashboard/new-expense" className="w-full bg-green-600 text-white px-4 py-4 rounded-xl hover:bg-green-700 text-lg flex items-center justify-center font-bold transition shadow-md hover:shadow-lg transform active:scale-95">
                    <PlusCircle className="mr-2 w-6 h-6" />
                    Rendir un Gasto
                </Link>
            </div>
        </div>

        <div className="mt-8 bg-white p-6 rounded-lg shadow-sm border border-gray-100">
            <h2 className="text-xl font-semibold mb-4">Proyectos Disponibles</h2>
            {projects.length === 0 ? (
                <p className="text-gray-500">No hay proyectos activos.</p>
            ) : (
                <div className="space-y-4">
                    {projects.map(p => (
                         <div key={p.id} className="border-b last:border-0 pb-4 last:pb-0 flex justify-between items-center">
                            <div>
                                <p className="font-semibold text-gray-800">{p.name}</p>
                                <p className="text-sm text-gray-600">{p.client}</p>
                            </div>
                            <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">Activo</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    </Layout>
  );
}

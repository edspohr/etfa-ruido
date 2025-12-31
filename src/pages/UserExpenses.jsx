import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { formatCurrency } from '../utils/format';

export default function UserExpenses() {
  const { currentUser } = useAuth();
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchExpenses() {
        if (!currentUser) return;
        try {
            const q = query(
                collection(db, "expenses"), 
                where("userId", "==", currentUser.uid),
                // orderBy("createdAt", "desc") // Requires index, skipping for now or handling client side sorting if needed
            );
            const snapshot = await getDocs(q);
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Manual sort as workaround for missing index
            data.sort((a,b) => new Date(b.date) - new Date(a.date));
            setExpenses(data);
        } catch (error) {
            console.error("Error fetching expenses:", error);
        } finally {
            setLoading(false);
        }
    }
    fetchExpenses();
  }, [currentUser]);

  if (loading) return <Layout title="Mis Rendiciones">Cargando...</Layout>;

  return (
    <Layout title="Mis Rendiciones Históricas">
       <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
         <table className="w-full text-left">
            <thead>
                <tr className="bg-gray-50 border-b">
                     <th className="px-6 py-3 font-medium text-gray-500">Fecha</th>
                     <th className="px-6 py-3 font-medium text-gray-500">Proyecto</th>
                     <th className="px-6 py-3 font-medium text-gray-500">Monto</th>
                     <th className="px-6 py-3 font-medium text-gray-500">Estado</th>
                </tr>
            </thead>
            <tbody>
                {expenses.map(e => (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-6 py-4 text-gray-600">{e.date}</td>
                        <td className="px-6 py-4 text-gray-800 font-medium">{e.projectName || 'Sin Proyecto'}</td>
                        <td className="px-6 py-4 font-medium">{formatCurrency(e.amount)}</td>
                        <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold 
                                ${e.status === 'approved' ? 'bg-green-100 text-green-800' : 
                                  e.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                                {e.status === 'approved' ? 'Aprobado' : e.status === 'pending' ? 'Pendiente' : 'Rechazado'}
                            </span>
                        </td>
                    </tr>
                ))}
                {expenses.length === 0 && (
                    <tr>
                        <td colSpan="4" className="text-center py-8 text-gray-500">No tienes rendiciones registradas.</td>
                    </tr>
                )}
            </tbody>
        </table>
       </div>
    </Layout>
  );
}

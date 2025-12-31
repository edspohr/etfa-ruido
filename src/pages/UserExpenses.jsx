import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, deleteDoc, doc, updateDoc, increment } from 'firebase/firestore';
import { formatCurrency } from '../utils/format';
import { Trash2, AlertCircle } from 'lucide-react';

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
                where("userId", "==", currentUser.uid)
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

  const handleDelete = async (expense) => {
      if (!confirm("¿Eliminar esta rendición pendiente? El saldo será descontado de tu cuenta.")) return;
      
      try {
          // 1. Delete Expense
          await deleteDoc(doc(db, "expenses", expense.id));
          
          // 2. Revert Balance (Subtract amount)
          // Logic: Expense submission added credit. Deletion removes it.
          // Exception: Company expenses (if any user can see them here?) don't affect user balance usually,
          // but strict user expenses do.
          if (!expense.isCompanyExpense) {
               const userRef = doc(db, "users", currentUser.uid);
               await updateDoc(userRef, {
                   balance: increment(-expense.amount)
               });
          }
          
          // Refresh list
          setExpenses(prev => prev.filter(e => e.id !== expense.id));
      } catch (error) {
          console.error("Error deleting expense:", error);
          alert("Error al eliminar.");
      }
  };

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
                     <th className="px-6 py-3 font-medium text-gray-500">Acciones</th>
                </tr>
            </thead>
            <tbody>
                {expenses.map(e => (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-6 py-4 text-gray-600">{e.date}</td>
                        <td className="px-6 py-4 text-gray-800 font-medium">{e.projectName || 'Sin Proyecto'}</td>
                        <td className="px-6 py-4 font-medium">{formatCurrency(e.amount)}</td>
                        <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                                <span className={`px-2 py-1 rounded-full text-xs font-semibold 
                                    ${e.status === 'approved' ? 'bg-green-100 text-green-800' : 
                                      e.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                                    {e.status === 'approved' ? 'Aprobado' : e.status === 'pending' ? 'Pendiente' : 'Rechazado'}
                                </span>
                                {e.status === 'rejected' && e.rejectionReason && (
                                    <div className="group relative">
                                        <AlertCircle className="w-4 h-4 text-red-500 cursor-help" />
                                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-48 bg-gray-800 text-white text-xs rounded p-2 z-10 shadow-lg">
                                            {e.rejectionReason}
                                            <div className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-gray-800"></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </td>
                        <td className="px-6 py-4">
                            {e.status === 'pending' && (
                                <button 
                                    onClick={() => handleDelete(e)}
                                    className="p-2 text-gray-400 hover:text-red-500 transition rounded-full hover:bg-red-50"
                                    title="Eliminar Rendición"
                                >
                                    <Trash2 className="w-5 h-5" />
                                </button>
                            )}
                        </td>
                    </tr>
                ))}
                {expenses.length === 0 && (
                    <tr>
                        <td colSpan="5" className="text-center py-8 text-gray-500">No tienes rendiciones registradas.</td>
                    </tr>
                )}
            </tbody>
        </table>
       </div>
    </Layout>
  );
}

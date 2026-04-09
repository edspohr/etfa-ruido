import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, getDoc, deleteDoc, doc, updateDoc, increment } from 'firebase/firestore';
import { formatCurrency } from '../utils/format';
import { Trash2, AlertCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { isOlderThan60Days } from '../utils/dateUtils';

export default function UserExpenses() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userBalance, setUserBalance] = useState(null);
  const [showHistorical, setShowHistorical] = useState(false);

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
            const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
            if (userDoc.exists()) {
              setUserBalance(userDoc.data().balance ?? 0);
            }
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
               // Check for Caja Chica
               const isCajaChica = expense.projectName?.toLowerCase().includes("caja chica");
               const targetUserId = isCajaChica ? 'user_caja_chica' : currentUser.uid;

               const userRef = doc(db, "users", targetUserId);
               await updateDoc(userRef, {
                   balance: increment(-expense.amount)
               });
          }
          
          // Refresh list
          setExpenses(prev => prev.filter(e => e.id !== expense.id));
          toast.success("Rendición eliminada.");
      } catch (error) {
          console.error("Error deleting expense:", error);
          toast.error("Error al eliminar.");
      }
  };

  const visibleExpenses = expenses.filter(e => showHistorical || !isOlderThan60Days(e.date));
  const approvedCount = visibleExpenses.filter(e => e.status === 'approved').length;
  const rejectedCount = visibleExpenses.filter(e => e.status === 'rejected').length;

  if (loading) return <Layout title="Mis Rendiciones">Cargando...</Layout>;

  return (
    <Layout title="Mis Rendiciones Históricas">
      <div className="flex justify-end mb-4">
        <button
          onClick={() => navigate('/dashboard/new-expense')}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-md transition-all flex items-center gap-2"
        >
          Nueva Rendición
        </button>
      </div>
      {userBalance !== null && (
        <div className="mb-4 bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-4 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-600">Saldo Disponible</span>
          <span className={`text-lg font-black ${userBalance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {formatCurrency(userBalance)}
          </span>
        </div>
      )}
      {(approvedCount > 0 || rejectedCount > 0) && (
        <p className="text-sm text-gray-500 mb-3">
          Tienes <span className="font-bold text-emerald-600">{approvedCount} aprobadas</span> y <span className="font-bold text-rose-600">{rejectedCount} rechazadas</span>
        </p>
      )}
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setShowHistorical(prev => !prev)}
          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline transition-colors"
        >
          {showHistorical ? 'Ocultar registros antiguos' : 'Mostrar registros anteriores a 60 días'}
        </button>
      </div>
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
                {visibleExpenses.map((e, index) => (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-6 py-4 text-gray-600">{e.date}</td>
                        <td className="px-6 py-4 text-gray-800 font-medium">{e.projectName || 'Sin Proyecto'}</td>
                        <td className="px-6 py-4 font-medium">{formatCurrency(e.amount)}</td>
                        <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                                      e.status === 'approved' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                      e.status === 'pending' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-rose-100 text-rose-700 border-rose-200'}`}>
                                      {e.status === 'approved' ? 'Aprobado' : e.status === 'pending' ? 'Pendiente' : 'Rechazado'}
                                    </span>
                                {index < 10 && e.status !== 'pending' && (
                                    <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[9px] font-bold rounded-full">Nuevo</span>
                                )}
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
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={() => navigate('/dashboard/new-expense', { state: { duplicate: e } })}
                                    className="p-2 text-gray-400 hover:text-blue-500 transition rounded-full hover:bg-blue-50"
                                    title="Duplicar Rendición"
                                >
                                    <Copy className="w-5 h-5" />
                                </button>
                                {e.status === 'pending' && (
                                    <button 
                                        onClick={() => handleDelete(e)}
                                        className="p-2 text-gray-400 hover:text-red-500 transition rounded-full hover:bg-red-50"
                                        title="Eliminar Rendición"
                                    >
                                        <Trash2 className="w-5 h-5" />
                                    </button>
                                )}
                            </div>
                        </td>
                    </tr>
                ))}
                {visibleExpenses.length === 0 && (
                    <tr>
                        <td colSpan="5" className="text-center py-8 text-gray-500">
                          {expenses.length > 0 && !showHistorical
                            ? 'No hay rendiciones recientes. Haz clic en "Mostrar registros anteriores a 60 días" para ver el historial completo.'
                            : 'No tienes rendiciones registradas.'}
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
       </div>
    </Layout>
  );
}

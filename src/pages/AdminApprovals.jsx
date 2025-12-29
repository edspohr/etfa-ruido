import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc, increment, writeBatch } from 'firebase/firestore';
import { formatCurrency } from '../lib/mockData';
import { CheckCircle, XCircle } from 'lucide-react';

export default function AdminApprovals() {
  const [pendingExpenses, setPendingExpenses] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchPending = async () => {
      try {
          setLoading(true);
          const q = query(collection(db, "expenses"), where("status", "==", "pending"));
          const snapshot = await getDocs(q);
          const data = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
          setPendingExpenses(data);
      } catch (e) {
          console.error("Error fetching pending:", e);
      } finally {
          setLoading(false);
      }
  };

  useEffect(() => {
    fetchPending();
  }, []);

  const handleApprove = async (expenseId) => {
      try {
          // Just update status
          await updateDoc(doc(db, "expenses", expenseId), {
              status: "approved"
          });
          fetchPending();
      } catch (e) {
          console.error("Error approving:", e);
          alert("Error al aprobar");
      }
  };

  const handleReject = async (expense) => {
      if (!confirm("¿Rechazar este gasto? El monto será devuelto al saldo del usuario.")) return;

      try {
          const batch = writeBatch(db);
          
          // 1. Mark as rejected
          const expenseRef = doc(db, "expenses", expense.id);
          batch.update(expenseRef, { status: "rejected" });

          // 2. Refund User
          if (expense.userId) {
              const userRef = doc(db, "users", expense.userId);
              batch.update(userRef, { balance: increment(expense.amount) });
          }

          await batch.commit();
          fetchPending();
      } catch (e) {
          console.error("Error rejecting:", e);
          alert("Error al rechazar");
      }
  };

  if (loading) return <Layout title="Aprobaciones"><p>Cargando...</p></Layout>;

  return (
    <Layout title="Aprobaciones Pendientes">
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {pendingExpenses.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
                <p>No hay rendiciones pendientes de revisión.</p>
            </div>
        ) : (
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-gray-50 border-b">
                            <th className="px-6 py-3 font-medium text-gray-500">Fecha</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Profesional</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Proyecto</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Descripción</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Monto</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pendingExpenses.map(e => (
                            <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="px-6 py-4 text-sm text-gray-600">{e.date}</td>
                                <td className="px-6 py-4 font-medium text-gray-800">{e.userName || 'N/A'}</td>
                                <td className="px-6 py-4 text-gray-600 text-sm">{e.projectName || 'N/A'}</td>
                                <td className="px-6 py-4 text-gray-600">{e.description}</td>
                                <td className="px-6 py-4 font-semibold">{formatCurrency(e.amount)}</td>
                                <td className="px-6 py-4 flex space-x-2">
                                    <button 
                                        onClick={() => handleApprove(e.id)}
                                        className="text-green-600 hover:text-green-800 p-1 hover:bg-green-50 rounded"
                                        title="Aprobar"
                                    >
                                        <CheckCircle className="w-6 h-6" />
                                    </button>
                                    <button 
                                        onClick={() => handleReject(e)}
                                        className="text-red-500 hover:text-red-700 p-1 hover:bg-red-50 rounded"
                                        title="Rechazar"
                                    >
                                        <XCircle className="w-6 h-6" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </div>
    </Layout>
  );
}

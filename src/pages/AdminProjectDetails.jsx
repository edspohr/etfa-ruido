import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, increment, writeBatch } from 'firebase/firestore';
import { formatCurrency } from '../utils/format';
import { CheckCircle, XCircle, ArrowLeft, FileText } from 'lucide-react';

export default function AdminProjectDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
        setLoading(true);
        // 1. Fetch Project
        const pRef = doc(db, "projects", id);
        const pSnap = await getDoc(pRef);
        if (pSnap.exists()) {
            setProject({ id: pSnap.id, ...pSnap.data() });
        } else {
            alert("Proyecto no encontrado");
            navigate('/admin/projects');
            return;
        }

        // 2. Fetch Expenses
        const q = query(
            collection(db, "expenses"), 
            where("projectId", "==", id)
            // orderBy("date", "desc") // requires index
        );
        const eSnap = await getDocs(q);
        const eData = eSnap.docs.map(d => ({id: d.id, ...d.data()}));
        eData.sort((a,b) => new Date(b.date) - new Date(a.date));
        setExpenses(eData);

    } catch (e) {
        console.error("Error details:", e);
    } finally {
        setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    if (id) fetchData();
  }, [id, fetchData]);

  const handleApprove = async (expenseId) => {
      try {
          await updateDoc(doc(db, "expenses", expenseId), {
              status: "approved"
          });
          fetchData(); 
      } catch (e) {
          console.error("Error approving:", e);
          alert("Error al aprobar");
      }
  };

  const handleReject = async (expense) => {
      if (!confirm("¿Rechazar este gasto? El monto será descontado del saldo del usuario.")) return;

      try {
          const batch = writeBatch(db);
          const expenseRef = doc(db, "expenses", expense.id);
          batch.update(expenseRef, { status: "rejected" });

          if (expense.userId) {
              const userRef = doc(db, "users", expense.userId);
              batch.update(userRef, { balance: increment(-expense.amount) });
          }

          await batch.commit();
          fetchData(); 
      } catch (e) {
          console.error("Error rejecting:", e);
          alert("Error al rechazar");
      }
  };

  const handleViewReceipt = (url) => {
    if (!url) {
        alert("No hay comprobante adjunto.");
        return;
    }
    window.open(url, '_blank');
  };

  if (loading) return <Layout title="Detalle de Proyecto">Cargando...</Layout>;
  if (!project) return null;

  return (
    <Layout title={`Proyecto: ${project.name}`}>
       <button onClick={() => navigate('/admin/projects')} className="flex items-center text-gray-600 mb-6 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4 mr-1" /> Volver
       </button>

       {/* Summary Cards */}
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
           <div className="bg-white p-6 rounded-lg shadow-sm border-l-4 border-blue-500">
              <p className="text-gray-500 text-sm">Presupuesto</p>
              <p className="text-2xl font-bold">{formatCurrency(project.budget)}</p>
           </div>
           <div className="bg-white p-6 rounded-lg shadow-sm border-l-4 border-orange-500">
              <p className="text-gray-500 text-sm">Gastado (Total)</p>
              <p className="text-2xl font-bold">{formatCurrency(project.expenses || 0)}</p>
           </div>
           <div className="bg-white p-6 rounded-lg shadow-sm border-l-4 border-green-500">
              <p className="text-gray-500 text-sm">Disponible</p>
              <p className="text-2xl font-bold">{formatCurrency(project.budget - (project.expenses || 0))}</p>
           </div>
       </div>

       {/* Client Info */}
       <div className="bg-white p-6 rounded-lg shadow-sm mb-8">
           <h3 className="font-bold text-lg mb-2">Información</h3>
           <p><span className="font-semibold">Cliente:</span> {project.client || 'N/A'}</p>
           <p><span className="font-semibold">Estado:</span> {project.status === 'active' ? 'Activo' : 'Inactivo'}</p>
       </div>

       {/* Expenses Table */}
       <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50">
                <h3 className="font-bold text-gray-700">Historial de Gastos</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-gray-50 border-b">
                            <th className="px-6 py-3 font-medium text-gray-500">Fecha</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Profesional</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Detalle</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Monto</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Estado</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {expenses.map(e => (
                            <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="px-6 py-4 text-sm text-gray-600">{e.date}</td>
                                <td className="px-6 py-4 font-medium text-gray-800">{e.userName}</td>
                                <td className="px-6 py-4">
                                    <p className="text-gray-800 font-medium">{e.description}</p>
                                    <span className="text-xs text-gray-500">{e.category} | {e.merchant}</span>
                                </td>
                                <td className="px-6 py-4 font-semibold">{formatCurrency(e.amount)}</td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded-full text-xs font-semibold 
                                        ${e.status === 'approved' ? 'bg-green-100 text-green-800' : 
                                        e.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                                        {e.status === 'approved' ? 'Aprobado' : e.status === 'pending' ? 'Pendiente' : 'Rechazado'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 flex space-x-2">
                                     <button 
                                        onClick={() => handleViewReceipt(e.imageUrl)}
                                        className="text-blue-600 hover:text-blue-800 p-1 hover:bg-blue-50 rounded"
                                        title="Ver Comprobante"
                                    >
                                        <FileText className="w-5 h-5" />
                                    </button>
                                    {e.status === 'pending' && (
                                        <>
                                            <button 
                                                onClick={() => handleApprove(e.id)}
                                                className="text-green-600 hover:text-green-800 p-1 hover:bg-green-50 rounded"
                                            >
                                                <CheckCircle className="w-5 h-5" />
                                            </button>
                                            <button 
                                                onClick={() => handleReject(e)}
                                                className="text-red-500 hover:text-red-700 p-1 hover:bg-red-50 rounded"
                                            >
                                                <XCircle className="w-5 h-5" />
                                            </button>
                                        </>
                                    )}
                                </td>
                            </tr>
                        ))}
                         {expenses.length === 0 && (
                            <tr>
                                <td colSpan="6" className="px-6 py-8 text-center text-gray-500">No hay gastos registrados en este proyecto.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
       </div>
    </Layout>
  );
}

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, increment } from 'firebase/firestore';
import { formatCurrency } from '../utils/format';
import { ArrowLeft, CheckCircle, XCircle, FileText, Calendar, User } from 'lucide-react';

export default function AdminProjectDetails() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
        setLoading(true);
        // 1. Get Project
        const pRef = doc(db, "projects", id);
        const pSnap = await getDoc(pRef);
        if (pSnap.exists()) {
            setProject({ id: pSnap.id, ...pSnap.data() });
        }

        // 2. Get Expenses
        const qExp = query(collection(db, "expenses"), where("projectId", "==", id));
        const expSnap = await getDocs(qExp);
        const expData = expSnap.docs
            .map(d => ({id: d.id, ...d.data()}))
            .sort((a,b) => new Date(b.date) - new Date(a.date));
        setExpenses(expData);

        // 3. Get Allocations
        const qAlloc = query(collection(db, "allocations"), where("projectId", "==", id));
        const allocSnap = await getDocs(qAlloc);
        const allocData = allocSnap.docs
            .map(d => ({id: d.id, ...d.data()}))
            .sort((a,b) => new Date(b.date) - new Date(a.date));
        setAllocations(allocData);

    } catch (e) {
        console.error("Error fetching details:", e);
    } finally {
        setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) fetchData();
  }, [id, fetchData]);

  const handleUpdateStatus = async (expenseId, newStatus, amount, userId) => {
    if (!confirm(`¿Estás seguro de cambiar el estado a ${newStatus.toUpperCase()}?`)) return;

    try {
        const expenseRef = doc(db, "expenses", expenseId);
        
        // If Rejecting, we need to REVERSE the balance credit (subtract amount)
        // because the user was credited when they submitted the expense.
        if (newStatus === 'rejected') {
             // Only if it's NOT a company expense (which doesn't affect balance)
             const exp = expenses.find(e => e.id === expenseId);
             if (exp && !exp.isCompanyExpense) {
                 // Check logical target ("Caja Chica" uses virtual user)
                 const isCajaChica = project?.name?.toLowerCase().includes("caja chica") || project?.type === 'petty_cash';
                 const targetUserId = isCajaChica ? 'user_caja_chica' : userId;
                 
                 const userRef = doc(db, "users", targetUserId);
                 await updateDoc(userRef, {
                     balance: increment(-amount) 
                 });
             }
        }
        
        // Note: If approving, we don't need to change balance, as it was already credited on submission?
        // Wait, normally approval confirms the reimbursement. 
        // In this "Balance = Debt" model:
        // - Allocation (Debt) -> Balance decreases (gets more negative).
        // - Expense (Payback) -> Balance increases (gets closer to 0 or positive).
        // So upon submission, we already credited them. 
        // If we Reject, we assume the expense was invalid, so we put the debt back (decrement).
        // If we Approve, status just changes, balance remains credited.

        await updateDoc(expenseRef, { status: newStatus });
        
        // Update Project Expenses Total if Approved?
        // Or do we track 'expenses' field in project document?
        // Current logic in AdminProjects list uses `p.expenses`. 
        // We should PROBABLY update the project total when approved.
        // Assuming `p.expenses` tracks APPROVED expenses.
        
        if (newStatus === 'approved') {
             await updateDoc(doc(db, "projects", id), {
                 expenses: increment(amount)
             });
        }

        alert("Estado actualizado.");
        fetchData();
    } catch (e) {
        console.error("Error updating status:", e);
        alert("Error al actualizar.");
    }
  };


  if (loading) return <Layout title="Detalles del Proyecto">Cargando...</Layout>;
  if (!project) return <Layout title="Error">Proyecto no encontrado.</Layout>;

  return (
    <Layout title={`Acciones: ${project.code ? `[${project.code}] ` : ''}${project.name} ${project.recurrence ? `(${project.recurrence})` : ''}`}>
        <div className="mb-6">
            <Link to="/admin/projects" className="text-blue-600 hover:text-blue-800 flex items-center">
                <ArrowLeft className="w-4 h-4 mr-2" /> Volver a Proyectos
            </Link>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <h3 className="text-sm font-medium text-gray-500 mb-1">Presupuesto Total</h3>
                <p className="text-2xl font-bold text-gray-800">{formatCurrency(project.budget)}</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <h3 className="text-sm font-medium text-gray-500 mb-1">Gastos Totales (Aprobados)</h3>
                <p className="text-2xl font-bold text-blue-600">{formatCurrency(project.expenses || 0)}</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                <h3 className="text-sm font-medium text-gray-500 mb-1">Disponible</h3>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(project.budget - (project.expenses || 0))}</p>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Expenses List */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center">
                    <h3 className="font-bold text-gray-700 flex items-center">
                        <FileText className="w-5 h-5 mr-2 text-gray-400" />
                        Historial de Rendiciones
                    </h3>
                    <span className="text-xs font-medium bg-gray-200 text-gray-600 px-2 py-1 rounded-full">{expenses.length}</span>
                </div>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 bg-white">
                            <tr className="border-b">
                                <th className="px-4 py-3 font-medium text-gray-500">Fecha</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Usuario</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Detalle</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Monto</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Estado</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Acción</th>
                            </tr>
                        </thead>
                        <tbody>
                            {expenses.map(e => (
                                <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                                    <td className="px-4 py-3 text-gray-600">{e.date}</td>
                                    <td className="px-4 py-3 text-gray-800 font-medium">
                                        {e.userName}
                                        {e.isCompanyExpense && <span className="block text-xs text-blue-500">Empresa</span>}
                                    </td>
                                    <td className="px-4 py-3 text-gray-600">
                                        <p className="font-medium">{e.category}</p>
                                        <p className="text-xs truncate max-w-[150px]">{e.description}</p>
                                        {e.imageUrl && (
                                            <a href={e.imageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-xs block mt-1">Ver Boleta</a>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 font-bold text-gray-700">{formatCurrency(e.amount)}</td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2 py-1 rounded-full text-xs font-semibold
                                            ${e.status === 'approved' ? 'bg-green-100 text-green-800' : 
                                              e.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                            {e.status === 'approved' ? 'Aprobado' : e.status === 'rejected' ? 'Rechazado' : 'Pendiente'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        {e.status === 'pending' && (
                                            <div className="flex space-x-2">
                                                <button onClick={() => handleUpdateStatus(e.id, 'approved', e.amount, e.userId)} className="text-green-600 hover:text-green-800" title="Aprobar">
                                                    <CheckCircle className="w-5 h-5" />
                                                </button>
                                                <button onClick={() => handleUpdateStatus(e.id, 'rejected', e.amount, e.userId)} className="text-red-600 hover:text-red-800" title="Rechazar">
                                                    <XCircle className="w-5 h-5" />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                             {expenses.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="px-4 py-8 text-center text-gray-500">No hay rendiciones registradas.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Allocations List */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center">
                    <h3 className="font-bold text-gray-700 flex items-center">
                        <Calendar className="w-5 h-5 mr-2 text-gray-400" />
                        Historial de Viáticos Asignados
                    </h3>
                     <span className="text-xs font-medium bg-gray-200 text-gray-600 px-2 py-1 rounded-full">{allocations.length}</span>
                </div>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-left text-sm">
                         <thead className="sticky top-0 bg-white">
                            <tr className="border-b">
                                <th className="px-4 py-3 font-medium text-gray-500">Fecha</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Asignado A</th>
                                <th className="px-4 py-3 font-medium text-gray-500">Monto</th>
                            </tr>
                        </thead>
                        <tbody>
                            {allocations.map(a => (
                                <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50">
                                    <td className="px-4 py-3 text-gray-600">{new Date(a.date).toLocaleDateString()}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center">
                                            <User className="w-4 h-4 mr-2 text-gray-400" />
                                            {a.userName}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 font-bold text-gray-700">{formatCurrency(a.amount)}</td>
                                </tr>
                            ))}
                            {allocations.length === 0 && (
                                <tr>
                                    <td colSpan="3" className="px-4 py-8 text-center text-gray-500">No hay viáticos asignados.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    </Layout>
  );
}

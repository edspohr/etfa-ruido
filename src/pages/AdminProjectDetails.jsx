import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { db } from '../lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, updateDoc, increment, deleteDoc } from 'firebase/firestore';
import { formatCurrency } from '../utils/format';
import { ArrowLeft, CheckCircle, XCircle, FileText, Calendar, User, Trash2 } from 'lucide-react';
import RejectionModal from '../components/RejectionModal';
import { toast } from 'sonner';

export default function AdminProjectDetails() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);

  // Rejection Modal
  const [rejectionModalOpen, setRejectionModalOpen] = useState(false);
  const [selectedExpenseToReject, setSelectedExpenseToReject] = useState(null);

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

  const handleUpdateStatus = async (expenseId, newStatus, amount, userId, rejectionReason = null) => {
    // Intercept Rejection to open Modal
    if (newStatus === 'rejected' && !rejectionReason) {
        const expense = expenses.find(e => e.id === expenseId);
        setSelectedExpenseToReject(expense);
        setRejectionModalOpen(true);
        return;
    }

    if (!rejectionReason && !confirm(`¿Estás seguro de cambiar el estado a ${newStatus.toUpperCase()}?`)) return;

    try {
        const expenseRef = doc(db, "expenses", expenseId);
        
        let updateData = { status: newStatus };
        if (rejectionReason) {
            updateData.rejectionReason = rejectionReason;
        }

        // If Rejecting, we need to REVERSE the balance credit (subtract amount)
        if (newStatus === 'rejected') {
             const exp = expenses.find(e => e.id === expenseId);
             if (exp && !exp.isCompanyExpense) {
                 const isCajaChica = project?.name?.toLowerCase().includes("caja chica") || project?.type === 'petty_cash';
                 const targetUserId = isCajaChica ? 'user_caja_chica' : userId;
                 
                 const userRef = doc(db, "users", targetUserId);
                 await updateDoc(userRef, {
                     balance: increment(-amount) 
                 });
             }
        }
        
        // If Approving, Update Project Expenses Total
        let projectExpenseChange = 0;
        if (newStatus === 'approved') {
             await updateDoc(doc(db, "projects", id), {
                 expenses: increment(amount)
             });
             projectExpenseChange = amount;
        }

        await updateDoc(expenseRef, updateData);

        toast.success("Estado actualizado.");
        
        // Optimistic Update
        setExpenses(prev => prev.map(e => {
            if (e.id === expenseId) return { ...e, status: newStatus, rejectionReason: rejectionReason || null };
            return e;
        }));

        if (projectExpenseChange !== 0) {
            setProject(prev => ({ ...prev, expenses: (prev.expenses || 0) + projectExpenseChange }));
        }

    } catch (e) {
        console.error("Error updating status:", e);
        toast.error("Error al actualizar.");
    }
  };

  const handleConfirmRejection = (expense, reason) => {
      handleUpdateStatus(expense.id, 'rejected', expense.amount, expense.userId, reason);
  };

  const handleDeleteExpense = async (expense) => {
      if (!confirm("ADVERTENCIA: ¿Estás seguro de eliminar este gasto definitivamente?\nSe revertirán los saldos asociados.")) return;

      try {
          // Reversal Logic
          const isCredited = expense.status === 'pending' || expense.status === 'approved';
          const isProjectCharged = expense.status === 'approved';

          // 1. Revert User Balance (if it was credited and not company expense)
          if (isCredited && !expense.isCompanyExpense) {
              const isCajaChica = project?.name?.toLowerCase().includes("caja chica") || project?.type === 'petty_cash';
              const targetUserId = isCajaChica ? 'user_caja_chica' : expense.userId;
              
              if (targetUserId) {
                  await updateDoc(doc(db, "users", targetUserId), {
                      balance: increment(-expense.amount)
                  });
              }
          }

          // 2. Revert Project Total (if it was charged)
          if (isProjectCharged) {
              await updateDoc(doc(db, "projects", id), {
                  expenses: increment(-expense.amount)
              });
              setProject(prev => ({ ...prev, expenses: (prev.expenses || 0) - expense.amount }));
          }

          // 3. Delete Document
          await deleteDoc(doc(db, "expenses", expense.id));
          
          setExpenses(prev => prev.filter(e => e.id !== expense.id));
          toast.success("Gasto eliminado y saldos revertidos.");

      } catch (e) {
          console.error("Error deleting expense:", e);
          toast.error("Error al eliminar gasto.");
      }
  };

  const handleDeleteAllocation = async (allocation) => {
      if (!confirm("ADVERTENCIA: ¿Estás seguro de eliminar este VIÁTICO?\nSe descontará del saldo del profesional.")) return;

      try {
          // 1. Revert User Balance
          if (allocation.userId) {
              const userRef = doc(db, "users", allocation.userId);
              await updateDoc(userRef, {
                  balance: increment(-allocation.amount)
              });
          }

          // 2. Delete Document
          await deleteDoc(doc(db, "allocations", allocation.id));

          // 3. Update State
          setAllocations(prev => prev.filter(a => a.id !== allocation.id));
          
          toast.success("Viático eliminado y saldo actualizado.");
      } catch(e) {
          console.error("Error deleting allocation", e);
          toast.error("Error al eliminar viático");
      }
  };

  if (loading) return <Layout title="Detalles del Proyecto">Cargando...</Layout>;
  if (!project) return <Layout title="Error">Proyecto no encontrado.</Layout>;

  return (
    <Layout title={`Acciones: ${project.code ? `[${project.code}] ` : ''}${project.recurrence ? `(${project.recurrence}) ` : ''}${project.name}`}>
        <div className="mb-6">
            <Link to="/admin/projects" className="text-blue-600 hover:text-blue-800 flex items-center">
                <ArrowLeft className="w-4 h-4 mr-2" /> Volver a Proyectos
            </Link>
        </div>

        {/* Summary Cards */}
        {(() => {
             // Calculate Total Assigned dynamically from allocations
             const totalAllocated = allocations.reduce((acc, a) => acc + (Number(a.amount) || 0), 0);
             
             // Calculate specific totals from expenses (Approved ones)
             const approvedExpenses = expenses.filter(e => e.status === 'approved');
             
             const totalRenderedByUsers = approvedExpenses
                 .filter(e => !e.isCompanyExpense)
                 .reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
                 
             const totalSpent = approvedExpenses
                 .reduce((acc, e) => acc + (Number(e.amount) || 0), 0);

             return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col justify-center">
                        <h3 className="text-sm font-bold text-gray-500 mb-1 uppercase tracking-wide">Viático Asignado</h3>
                        <p className="text-2xl font-bold text-gray-800">{formatCurrency(totalAllocated)}</p>
                        <p className="text-xs text-gray-400 mt-1">Fondos entregados a profesionales</p>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col justify-center">
                        <h3 className="text-sm font-bold text-gray-500 mb-1 uppercase tracking-wide">Gasto Rendido</h3>
                        <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalRenderedByUsers)}</p>
                        <p className="text-xs text-gray-400 mt-1">Justificado por profesionales</p>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col justify-center">
                        <h3 className="text-sm font-bold text-gray-500 mb-1 uppercase tracking-wide">Gasto Total</h3>
                        <p className="text-2xl font-bold text-indigo-600">{formatCurrency(totalSpent)}</p>
                        <p className="text-xs text-gray-400 mt-1">Incluye gastos directos empresa</p>
                    </div>
                </div>
             );
        })()}

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
                                        {e.rejectionReason && e.status === 'rejected' && (
                                            <p className="text-xs text-red-500 mt-1 italic">"{e.rejectionReason}"</p>
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
                                        <div className="flex items-center space-x-2">
                                            {e.status === 'pending' && (
                                                <>
                                                    <button onClick={() => handleUpdateStatus(e.id, 'approved', e.amount, e.userId)} className="text-green-600 hover:text-green-800" title="Aprobar">
                                                        <CheckCircle className="w-5 h-5" />
                                                    </button>
                                                    <button onClick={() => handleUpdateStatus(e.id, 'rejected', e.amount, e.userId)} className="text-red-600 hover:text-red-800" title="Rechazar">
                                                        <XCircle className="w-5 h-5" />
                                                    </button>
                                                </>
                                            )}
                                            <button 
                                                onClick={() => handleDeleteExpense(e)} 
                                                className="text-gray-400 hover:text-red-500" 
                                                title="Eliminar Definitivamente"
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                        </div>
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
                                <th className="px-4 py-3 font-medium text-gray-500 text-right">Acciones</th>
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
                                    <td className="px-4 py-3 text-right">
                                        <button 
                                            onClick={() => handleDeleteAllocation(a)} 
                                            className="text-gray-400 hover:text-red-500" 
                                            title="Eliminar Viático"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </td>
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

        <RejectionModal 
          isOpen={rejectionModalOpen}
          onClose={() => setRejectionModalOpen(false)}
          onConfirm={handleConfirmRejection}
          expense={selectedExpenseToReject}
        />
    </Layout>
  );
}

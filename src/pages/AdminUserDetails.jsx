import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import Layout from "../components/Layout";
import { db } from "../lib/firebase";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  increment,
  deleteDoc,
} from "firebase/firestore";
import { formatCurrency } from "../utils/format";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  FileText,
  Calendar,
  Wallet,
  User,
  ChevronDown,
  ChevronUp,
  Trash2,
  ArrowRightLeft
} from "lucide-react";
import { addDoc } from 'firebase/firestore';
import { toast } from 'sonner';

export default function AdminUserDetails() {
  const { id } = useParams();
  const [user, setUser] = useState(null);
  const [projectsList, setProjectsList] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedProject, setExpandedProject] = useState(null);

  const toggleProject = (pid) => {
      if (expandedProject === pid) setExpandedProject(null);
      else setExpandedProject(pid);
  };

  // Transfer Logic
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({ 
      sourceProjectId: '', 
      targetProjectId: '', 
      amount: '' 
  });

  const handleTransferFunds = async (e) => {
      e.preventDefault();
      if (!transferForm.sourceProjectId || !transferForm.targetProjectId || !transferForm.amount) return;

      const amount = Number(transferForm.amount);
      if (amount <= 0) { toast.error("El monto debe ser positivo"); return; }
      if (transferForm.sourceProjectId === transferForm.targetProjectId) { toast.error("El proyecto destino debe ser distinto"); return; }

      try {
          const sourceProject = projectsList.find(p => p.id === transferForm.sourceProjectId);
          const targetProject = projectsList.find(p => p.id === transferForm.targetProjectId);

          // 1. Create Negative Allocation (Source)
          await addDoc(collection(db, "allocations"), {
              userId: id,
              userName: user.displayName,
              projectId: sourceProject.id,
              projectName: sourceProject.name,
              amount: -amount, // Negative allocation reduces the project budget
              date: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              type: 'transfer_out'
          });

          // 2. Create Positive Allocation (Target)
          await addDoc(collection(db, "allocations"), {
              userId: id,
              userName: user.displayName,
              projectId: targetProject.id,
              projectName: targetProject.name,
              amount: amount,
              date: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              type: 'transfer_in'
          });

          // 3. Update User Balance? NO. Net change is 0. (-Amount + Amount = 0).

          toast.success("Fondos reasignados exitosamente.");
          setTransferModalOpen(false);
          setTransferForm({ sourceProjectId: '', targetProjectId: '', amount: '' });
          
          // Refresh Data
          fetchData();

      } catch (err) {
          console.error("Error transferring funds:", err);
          toast.error("Error al reasignar fondos.");
      }
  };

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      // 1. Get User
      const uRef = doc(db, "users", id);
      const uSnap = await getDoc(uRef);
      if (uSnap.exists()) {
        let userData = { id: uSnap.id, ...uSnap.data() };
        // (Terreno logic removed as user is deleted)
        setUser(userData);
      }

      // 2. Get Expenses (for this user)
      const qExp = query(collection(db, "expenses"), where("userId", "==", id));
      const expSnap = await getDocs(qExp);
      const expData = expSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      setExpenses(expData);

      // 3. Get Allocations (for this user)
      const qAlloc = query(
        collection(db, "allocations"),
        where("userId", "==", id)
      );
      const allocSnap = await getDocs(qAlloc);
      const allocData = allocSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      setAllocations(allocData);

      // 4. Fetch Projects Map (for correct names/codes)
      const pSnap = await getDocs(collection(db, "projects"));
      const pData = pSnap.docs.map(d => ({id: d.id, ...d.data()}));
      setProjectsList(pData);

    } catch (e) {
      console.error("Error fetching details:", e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) fetchData();
  }, [id, fetchData]);

  const handleUpdateStatus = async (expenseId, newStatus, amount) => {
    if (
      !confirm(
        `¿Estás seguro de cambiar el estado a ${newStatus.toUpperCase()}?`
      )
    )
      return;

    try {
      const expenseRef = doc(db, "expenses", expenseId);

      // If Rejecting, we need to REVERSE the balance credit (subtract amount)
      let balanceChange = 0;
      if (newStatus === "rejected") {
        const exp = expenses.find((e) => e.id === expenseId);
        if (exp && !exp.isCompanyExpense) {
          const userRef = doc(db, "users", id);
          await updateDoc(userRef, {
            balance: increment(-amount),
          });
          balanceChange = -amount;
        }
      }

      await updateDoc(expenseRef, { status: newStatus });

      // Update Project Expenses Total if Approved
      if (newStatus === "approved") {
        const exp = expenses.find((e) => e.id === expenseId);
        if (exp?.projectId) {
          await updateDoc(doc(db, "projects", exp.projectId), {
            expenses: increment(amount),
          });
        }
      }

      // Optimistic / Local Update (No Re-fetch)
      setExpenses((prev) =>
        prev.map((e) => {
          if (e.id === expenseId) return { ...e, status: newStatus };
          return e;
        })
      );

      if (balanceChange !== 0) {
        setUser((prev) => ({
          ...prev,
          balance: (prev.balance || 0) + balanceChange,
        }));
      }
      toast.success("Estado actualizado.");
    } catch (e) {
      console.error("Error updating status:", e);
      toast.error("Error al actualizar.");
    }
  };

  const handleDeleteExpense = async (expense) => {
      if (!confirm("ADVERTENCIA: ¿Estás seguro de eliminar este gasto definitivamente?\nSe revertirán los saldos asociados.")) return;

      try {
          // Reversal Logic
          const isCredited = expense.status === 'pending' || expense.status === 'approved';
          const isProjectCharged = expense.status === 'approved';

          let balanceChange = 0;

          // 1. Revert User Balance (if it was credited and not company expense)
          if (isCredited && !expense.isCompanyExpense) {
              const userRef = doc(db, "users", id);
              await updateDoc(userRef, {
                  balance: increment(-expense.amount)
              });
              balanceChange = -expense.amount;
          }

          // 2. Revert Project Total (if it was charged)
          if (isProjectCharged && expense.projectId) {
              await updateDoc(doc(db, "projects", expense.projectId), {
                  expenses: increment(-expense.amount)
              });
          }

          // 3. Delete Document
          await deleteDoc(doc(db, "expenses", expense.id));
          
          setExpenses(prev => prev.filter(e => e.id !== expense.id));
          
          if (balanceChange !== 0) {
              setUser(prev => ({ ...prev, balance: (prev.balance || 0) + balanceChange }));
          }

          toast.success("Gasto eliminado y saldos revertidos.");

      } catch (e) {
          console.error("Error deleting expense:", e);
          toast.error("Error al eliminar gasto.");
      }
  };

  const handleDeleteAllocation = async (allocation) => {
      if (!confirm("ADVERTENCIA: ¿Estás seguro de eliminar este VIÁTICO?\nSe descontará del saldo del profesional.")) return;

      try {
          // 1. Revert User Balance (Allocation adds to balance, so we subtract)
          const userRef = doc(db, "users", id);
          
          // Verify user exists (sanity check)
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
             await updateDoc(userRef, {
                balance: increment(Number(allocation.amount))
             });
             // Update Local User State
             setUser(prev => ({ ...prev, balance: (prev.balance || 0) - Number(allocation.amount) }));
          } else {
             console.warn("User not found, skipping balance update.");
          }

          // 2. Delete Document
          await deleteDoc(doc(db, "allocations", allocation.id));

          // 3. Update Allocations State
          setAllocations(prev => prev.filter(a => a.id !== allocation.id));

          toast.success("Viático eliminado.");
      } catch (e) {
          console.error("Error deleting allocation:", e);
          toast.error("Error al eliminar viático: " + e.message);
      }
  };

  if (loading) return <Layout title="Detalles del Usuario">Cargando...</Layout>;
  if (!user) return <Layout title="Error">Usuario no encontrado.</Layout>;

  return (
    <Layout title={`Profesional: ${user.displayName}`}>
      <div className="mb-6">
        <Link
          to="/admin/balances"
          className="text-blue-600 hover:text-blue-800 flex items-center"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Volver a Balances
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex items-center">
          <div className="mr-4 bg-gray-100 p-3 rounded-full">
            <User className="w-8 h-8 text-gray-500" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-1">
              Información
            </h3>
            <p className="text-lg font-bold text-gray-800">
              {user.displayName} {user.code ? `[${user.code}]` : ""}
            </p>
            <p className="text-sm text-gray-500">{user.email}</p>
            <p className="text-sm text-gray-500 capitalize">{user.role}</p>
          </div>
        </div>
        <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-lg shadow-sm border border-blue-500 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Wallet className="w-16 h-16" />
          </div>
          <div className="relative z-10">
            <h3 className="text-blue-100 text-sm font-medium mb-1">
              Saldo Actual (Viático)
            </h3>
            <p className="text-3xl font-bold">
              {formatCurrency(user.balance || 0)}
            </p>
            <p className="text-blue-200 text-xs mt-1">
              {(user.balance || 0) < 0 ? "Fondos por Rendir" : "Saldo a Favor"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        
        {/* Project Summary Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50">
               <h3 className="font-bold text-gray-700 flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-gray-400" />
                  Resumen por Proyecto
               </h3>
               <button 
                  onClick={() => setTransferModalOpen(true)}
                  className="text-sm bg-blue-50 text-blue-600 px-3 py-1 rounded-full hover:bg-blue-100 flex items-center font-medium transition"
               >
                 <ArrowRightLeft className="w-4 h-4 mr-1" /> Reasignar Recursos
               </button>
            </div>
            
            <div className="overflow-x-auto">
               <table className="w-full text-left text-sm">
                   <thead className="bg-white">
                      <tr className="border-b">
                          <th className="px-6 py-3 font-medium text-gray-500">Proyecto</th>
                          <th className="px-6 py-3 font-medium text-gray-500">Recurrencia</th>
                          <th className="px-6 py-3 font-medium text-gray-500 text-right">Total Viáticos</th>
                          <th className="px-6 py-3 font-medium text-gray-500 text-right">Total Rendido</th>
                          <th className="px-6 py-3 font-medium text-gray-500 text-right">Saldo</th>
                          <th className="px-6 py-3 font-medium text-gray-500 text-right">Estado</th>
                          <th className="px-6 py-3 font-medium text-gray-500 text-right"></th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-gray-100">
                      {(() => {
                           // Aggregate Data
                           const projectStats = {};

                           // Initialize with expenses
                           expenses.forEach(e => {
                               if (e.status === 'rejected') return; // Exclude rejected
                               const pid = e.projectId || 'unknown';
                               if (!projectStats[pid]) projectStats[pid] = { totalExp: 0, totalAlloc: 0, name: e.projectName || 'Sin Proyecto' };
                               projectStats[pid].totalExp += (Number(e.amount) || 0);
                               // Update name from latest expense if available
                               if (e.projectName) projectStats[pid].name = e.projectName; 
                           });

                           // Add allocations
                           allocations.forEach(a => {
                               const pid = a.projectId || 'unknown';
                               if (!projectStats[pid]) projectStats[pid] = { totalExp: 0, totalAlloc: 0, name: a.projectName || 'Sin Proyecto' };
                               projectStats[pid].totalAlloc += (Number(a.amount) || 0);
                           });

                           // Map to Array with Metadata
                           const rows = Object.entries(projectStats).map(([pid, stats]) => {
                               const projectMeta = projectsList.find(p => p.id === pid);
                               return {
                                   id: pid,
                                   name: projectMeta ? projectMeta.name : stats.name,
                                   code: projectMeta ? projectMeta.code : '',
                                   recurrence: projectMeta ? projectMeta.recurrence : '',
                                   ...stats
                               };
                           });

                           if (rows.length === 0) return <tr><td colSpan="6" className="p-8 text-center text-gray-400">No hay actividad registrada.</td></tr>;

                           return rows.map(row => {
                               const isExpanded = expandedProject === row.id;
                               // Filter details for this project
                               const projectExpenses = expenses.filter(e => e.projectId === row.id || (!e.projectId && row.id === 'unknown'));
                               const projectAllocations = allocations.filter(a => a.projectId === row.id || (!a.projectId && row.id === 'unknown'));

                               return (
                                   <>
                                   <tr key={row.id} className={`hover:bg-gray-50 transition cursor-pointer ${isExpanded ? 'bg-gray-50' : ''}`} onClick={() => toggleProject(row.id)}>
                                       <td className="px-6 py-4">
                                           <span className="font-medium text-gray-800">
                                                {row.code ? `[${row.code}] ` : ''}{row.name}
                                           </span>
                                       </td>
                                       <td className="px-6 py-4 text-gray-600">
                                           {row.recurrence || '-'}
                                       </td>
                                       <td className="px-6 py-4 text-right font-medium text-green-600">
                                           {formatCurrency(row.totalAlloc)}
                                       </td>
                                       <td className="px-6 py-4 text-right font-medium text-blue-600">
                                           {formatCurrency(row.totalExp)}
                                       </td>

                                       <td className={`px-6 py-4 text-right font-bold ${row.totalExp - row.totalAlloc >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                                           {formatCurrency(row.totalExp - row.totalAlloc)}
                                       </td>
                                       <td className="px-6 py-4 text-right">
                                           {row.totalAlloc > row.totalExp ? (
                                               <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">En Rango</span>
                                           ) : row.totalExp > row.totalAlloc ? (
                                                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">⚠️ Excedido</span>
                                           ) : (
                                                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">-</span>
                                           )}
                                       </td>
                                       <td className="px-6 py-4 text-right text-gray-400">
                                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                       </td>
                                   </tr>
                                   {isExpanded && (
                                       <tr>
                                           <td colSpan="6" className="bg-gray-50 px-6 py-4">
                                               <div className="flex flex-col lg:flex-row gap-8 pl-4 border-l-2 border-blue-200">
                                                    {/* Allocations Detail */}
                                                    <div className="flex-1">
                                                        <h4 className="font-semibold text-gray-600 mb-2 flex items-center text-xs uppercase tracking-wider">
                                                            <Wallet className="w-4 h-4 mr-2" /> Viáticos Asignados
                                                        </h4>
                                                        {projectAllocations.length === 0 ? <p className="text-xs text-gray-400 italic">Sin registros</p> : (
                                                            <div className="bg-white rounded border border-gray-100 overflow-hidden">
                                                                <table className="w-full text-xs">
                                                                    <tbody>
                                                                        {projectAllocations.map(a => (
                                                                                <tr key={a.id} className="border-b last:border-0 hover:bg-gray-50 group">
                                                                                    <td className="px-3 py-2 text-gray-500">{new Date(a.date).toLocaleDateString()}</td>
                                                                                    <td className="px-3 py-2 font-medium text-right text-green-700">{formatCurrency(a.amount)}</td>
                                                                                    <td className="px-3 py-2 text-right">
                                                                                        <button 
                                                                                            onClick={() => handleDeleteAllocation(a)}
                                                                                            className="text-gray-300 hover:text-red-500 transition-colors p-1 opacity-0 group-hover:opacity-100"
                                                                                            title="Eliminar Viático"
                                                                                        >
                                                                                            <Trash2 className="w-4 h-4" />
                                                                                        </button>
                                                                                    </td>
                                                                                </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Expenses Detail */}
                                                    <div className="flex-[2]">
                                                        <h4 className="font-semibold text-gray-600 mb-2 flex items-center text-xs uppercase tracking-wider">
                                                            <FileText className="w-4 h-4 mr-2" /> Rendiciones
                                                        </h4>
                                                        {projectExpenses.length === 0 ? <p className="text-xs text-gray-400 italic">Sin registros</p> : (
                                                            <div className="bg-white rounded border border-gray-100 overflow-hidden">
                                                                <table className="w-full text-xs">
                                                                    <thead className="bg-gray-50">
                                                                        <tr>
                                                                            <th className="px-3 py-2 text-left">Fecha</th>
                                                                            <th className="px-3 py-2 text-left">Detalle</th>
                                                                            <th className="px-3 py-2 text-right">Monto</th>
                                                                            <th className="px-3 py-2 text-center">Estado</th>
                                                                            <th className="px-3 py-2 text-center">Acción</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {projectExpenses.map(e => (
                                                                            <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                                                                                <td className="px-3 py-2 text-gray-500 w-24">{e.date}</td>
                                                                                <td className="px-3 py-2">
                                                                                    <p className="font-medium text-gray-700">{e.category}</p>
                                                                                    <p className="text-gray-400 truncate max-w-[150px]">{e.description}</p>
                                                                                    {e.imageUrl && <a href={e.imageUrl} target="_blank" className="text-blue-500 hover:underline">Ver Boleta</a>}
                                                                                </td>
                                                                                <td className="px-3 py-2 font-bold text-gray-700 text-right">{formatCurrency(e.amount)}</td>
                                                                                <td className="px-3 py-2 text-center">
                                                                                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold
                                                                                        ${e.status === 'approved' ? 'bg-green-100 text-green-700' : 
                                                                                          e.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                                                                        {e.status === 'approved' ? 'OK' : e.status === 'rejected' ? 'RECH' : 'PEND'}
                                                                                    </span>
                                                                                </td>
                                                                                <td className="px-3 py-2 text-center">
                                                                                    {e.status === 'pending' && (
                                                                                        <div className="flex justify-center gap-1">
                                                                                            <button onClick={(ev) => { ev.stopPropagation(); handleUpdateStatus(e.id, 'approved', e.amount); }} className="p-1 text-green-600 hover:bg-green-100 rounded"><CheckCircle className="w-4 h-4"/></button>
                                                                                            <button onClick={(ev) => { ev.stopPropagation(); handleUpdateStatus(e.id, 'rejected', e.amount); }} className="p-1 text-red-600 hover:bg-red-100 rounded"><XCircle className="w-4 h-4"/></button>
                                                                                            <button onClick={(ev) => { ev.stopPropagation(); handleDeleteExpense(e); }} className="p-1 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-4 h-4"/></button>
                                                                                        </div>
                                                                                    )}
                                                                                    {e.status !== 'pending' && (
                                                                                        <button onClick={(ev) => { ev.stopPropagation(); handleDeleteExpense(e); }} className="p-1 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-4 h-4"/></button>
                                                                                    )}
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                    </div>
                                               </div>
                                           </td>
                                       </tr>
                                   )}
                                   </>
                               );
                           });
                      })()}
                   </tbody>
               </table>
            </div>
        </div>

      </div>
      {/* Transfer Modal */}
      {transferModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg p-6 max-w-md w-full">
                  <h3 className="text-lg font-bold mb-4 flex items-center text-blue-800">
                      <ArrowRightLeft className="w-5 h-5 mr-2" /> Reasignar Recursos entre Proyectos
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                      Mueve saldo asignado de un proyecto a otro. Esto ajustará los totales asignados sin afectar el saldo global del usuario.
                  </p>
                  <form onSubmit={handleTransferFunds} className="space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-gray-700">Proyecto Origen (Extrae Fondos)</label>
                          <select 
                              className="mt-1 w-full p-2 border rounded"
                              value={transferForm.sourceProjectId}
                              onChange={e => setTransferForm({...transferForm, sourceProjectId: e.target.value})}
                              required
                          >
                              <option value="">Seleccionar Proyecto...</option>
                              {projectsList.map(p => (
                                  <option key={p.id} value={p.id}>
                                      {p.code ? `[${p.code}] ` : ''}{p.recurrence ? `(${p.recurrence}) ` : ''}{p.name}
                                  </option>
                              ))}
                          </select>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700">Proyecto Destino (Recibe Fondos)</label>
                          <select 
                              className="mt-1 w-full p-2 border rounded"
                              value={transferForm.targetProjectId}
                              onChange={e => setTransferForm({...transferForm, targetProjectId: e.target.value})}
                              required
                          >
                              <option value="">Seleccionar Proyecto...</option>
                              {projectsList.map(p => (
                                  <option key={p.id} value={p.id}>
                                      {p.code ? `[${p.code}] ` : ''}{p.recurrence ? `(${p.recurrence}) ` : ''}{p.name}
                                  </option>
                              ))}
                          </select>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700">Monto a Reasignar ($)</label>
                          <input 
                              type="number" 
                              className="mt-1 w-full p-2 border rounded"
                              value={transferForm.amount}
                              onChange={e => setTransferForm({...transferForm, amount: e.target.value})}
                              required 
                              min="0"
                          />
                      </div>
                      <div className="flex justify-end gap-2 mt-6">
                          <button 
                              type="button"
                              onClick={() => setTransferModalOpen(false)}
                              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
                          >
                              Cancelar
                          </button>
                          <button 
                              type="submit"
                              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                              Reasignar
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}
    </Layout>
  );
}

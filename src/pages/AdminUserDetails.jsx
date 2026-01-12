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
  ChevronUp
} from "lucide-react";
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
            </div>
            
            <div className="overflow-x-auto">
               <table className="w-full text-left text-sm">
                   <thead className="bg-white">
                      <tr className="border-b">
                          <th className="px-6 py-3 font-medium text-gray-500">Proyecto</th>
                          <th className="px-6 py-3 font-medium text-gray-500">Recurrencia</th>
                          <th className="px-6 py-3 font-medium text-gray-500 text-right">Total Viáticos</th>
                          <th className="px-6 py-3 font-medium text-gray-500 text-right">Total Rendido</th>
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
                                                                            <tr key={a.id} className="border-b last:border-0">
                                                                                <td className="px-3 py-2 text-gray-500">{new Date(a.date).toLocaleDateString()}</td>
                                                                                <td className="px-3 py-2 font-medium text-right text-green-700">{formatCurrency(a.amount)}</td>
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
                                                                                        </div>
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
    </Layout>
  );
}

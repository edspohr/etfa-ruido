import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { db } from '../lib/firebase';
import { doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { formatCurrency } from '../utils/format';
import { PlusCircle, Wallet, FileText, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function UserDashboard() {
  const { currentUser } = useAuth();
  const [balance, setBalance] = useState(0);
  const [expenses, setExpenses] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [projectsList, setProjectsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedProject, setExpandedProject] = useState(null);

  const toggleProject = (pid) => {
      if (expandedProject === pid) setExpandedProject(null);
      else setExpandedProject(pid);
  };

  useEffect(() => {
    async function fetchData() {
        if (!currentUser) return;
        
        try {
            setLoading(true);
            // 1. Get Live Balance
            const userRef = doc(db, "users", currentUser.uid);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                setBalance(userSnap.data().balance || 0);
            }

            // 2. Get Expenses (for this user)
            const qExp = query(collection(db, "expenses"), where("userId", "==", currentUser.uid));
            const expSnap = await getDocs(qExp);
            const expData = expSnap.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .sort((a, b) => new Date(b.date) - new Date(a.date));
            setExpenses(expData);

            // 3. Get Allocations (for this user)
            const qAlloc = query(collection(db, "allocations"), where("userId", "==", currentUser.uid));
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
         <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-2xl shadow-lg border border-blue-500 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Wallet className="w-24 h-24" />
                </div>
                <div className="relative z-10">
                    <h3 className="text-blue-100 text-sm font-medium mb-1">Mi Cuenta Corriente (Viáticos)</h3>
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

        {/* Project Summary Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center">
               <h3 className="font-bold text-gray-700 flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-gray-400" />
                  Mi Resumen por Proyecto
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
                                                            <FileText className="w-4 h-4 mr-2" /> Mis Rendiciones
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
    </Layout>
  );
}
